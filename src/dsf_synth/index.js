/** Polyphonic DSF output. Owns its worklet/gate, never the shared AudioContext. */
import processorUrl from "./dsf-processor.js?worker&url";
import { ensureSharedAudioContext } from "../audio/shared-context.js";
import { createRecoveryGate } from "../audio/recovery-gate.js";
import { audioAttackAllowed } from "../audio/attack-gate.js";
import { normalizeDsfControls } from "./controls.js";
import { recordTouchAudio } from "../audio/runtime-diagnostics.js";
import { readSnapshotExpression } from "../sequencer/snapshot-expression.js";

const normalized = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const midiExpression = (value, value14) => normalized(Number.isFinite(value14) ? value14 / 16256 : value / 127);

const modules = new WeakMap();
async function loadModule(context) {
  if (!modules.has(context)) {
    const work = context.audioWorklet.addModule(processorUrl).catch(error => { modules.delete(context); throw error; });
    modules.set(context, work);
  }
  await modules.get(context);
}

export async function createDsfSynth({ controls = {}, fundamental = 440, referenceCents = 0, signal } = {}) {
  let context, node, gate;
  let parameters = normalizeDsfControls(controls);
  let epoch = 0, nextId = 0, nextAck = 0;
  let closed = false, stopping = false, failed = false, recoveryMuted = false;
  let rebuilding = null, shutdownPromise = null, shutdownTimer, finishShutdown;
  let stats = {};
  let globalTimbre = 0;
  const acknowledgements = new Map();
  const active = new Map();
  const timestampFrames = new Map();
  const post = data => { if (node && !closed) node.port.postMessage({ ...data, epoch }); };
  const frameAt = timestamp => {
    if (!Number.isFinite(timestamp)) return Math.round(context.currentTime * context.sampleRate);
    if (!timestampFrames.has(timestamp)) {
      if (timestampFrames.size >= 64) timestampFrames.delete(timestampFrames.keys().next().value);
      timestampFrames.set(timestamp, Math.round((context.currentTime +
        Math.max(0, timestamp - performance.now()) / 1000) * context.sampleRate));
    }
    return timestampFrames.get(timestamp);
  };
  const clear = ack => {
    epoch++;
    timestampFrames.clear();
    for (const hex of active.values()) hex.sounding = false;
    active.clear();
    post({ command: "clear", ack });
  };
  const disposeNode = () => {
    if (node) { node.port.onmessage = null; node.onprocessorerror = null; node.disconnect(); node.port.close?.(); }
    gate?.disconnect();
    node = gate = null;
    for (const { reject, timer } of acknowledgements.values()) {
      clearTimeout(timer); reject(new Error("DSF processor replaced"));
    }
    acknowledgements.clear();
  };
  const build = async () => {
    signal?.throwIfAborted();
    const nextContext = ensureSharedAudioContext();
    await loadModule(nextContext);
    signal?.throwIfAborted();
    if (closed || stopping) throw new Error("DSF output closed during startup");
    disposeNode();
    context = nextContext;
    node = new AudioWorkletNode(context, "hexatone-dsf", {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
    });
    gate = createRecoveryGate(context, recoveryMuted);
    node.connect(gate.node);
    failed = false;
    stats = {};
    node.onprocessorerror = () => { failed = true; };
    node.port.onmessage = ({ data }) => {
      if (data.type === "stats") stats = { ...data, observedAtMs: performance.now() };
      if (data.type === "ended") {
        const hex = active.get(data.id);
        if (hex) {
          if (hex.voiceId === data.id) { hex.sounding = false; hex.stolen = !!data.stolen; }
          active.delete(data.id);
        }
      }
      if (data.type === "cleared") {
        const pending = acknowledgements.get(data.ack);
        if (pending) { clearTimeout(pending.timer); acknowledgements.delete(data.ack); pending.resolve(); }
      }
    };
    clear();
    post({ command: "controls", controls: parameters });
  };
  const frequencyFor = cents => fundamental * 2 ** ((cents - referenceCents) / 1200);
  const synth = {
    family: "dsf", audioBackend: "dsf", usesSharedAudioContext: true,
    getAudioContext: () => context,
    currentTime: () => context?.currentTime,
    async prepare() {
      if (closed || stopping) throw new Error("DSF output is closed");
      if (context !== ensureSharedAudioContext() || failed) await synth.forceAudioRebuild();
      await context.resume();
    },
    forceAudioRebuild() {
      if (closed || stopping) return Promise.reject(new Error("DSF output is closed"));
      rebuilding ??= build().finally(() => { rebuilding = null; });
      return rebuilding;
    },
    resumeAfterAudioRestart: () => synth.forceAudioRebuild(),
    muteForRecovery(durationMs) { recoveryMuted = true; return gate?.mute(durationMs); },
    fadeAfterRecovery() { recoveryMuted = false; return gate?.fadeIn(); },
    clearRecoveryEvents() {
      return new Promise((resolve, reject) => {
        if (closed || failed) { reject(new Error("DSF processor is unavailable")); return; }
        const ack = ++nextAck;
        const timer = setTimeout(() => { acknowledgements.delete(ack); reject(new Error("DSF clear timed out")); }, 1200);
        acknowledgements.set(ack, { resolve, reject, timer });
        clear(ack);
      });
    },
    setControls(values) {
      const next = normalizeDsfControls(values);
      if (Object.keys(next).every(key => next[key] === parameters[key])) return;
      parameters = next;
      post({ command: "controls", controls: parameters });
    },
    setMod(value) { globalTimbre = normalized(value - 1); },
    applyZoneModwheel(value) {
      globalTimbre = midiExpression(value);
      for (const hex of new Set(active.values())) hex.applyNormalizedSnapshotTimbre(globalTimbre);
    },
    setTuningReference(hz, cents = 0) {
      if (Number.isFinite(hz) && hz > 0) fundamental = hz;
      if (Number.isFinite(cents)) referenceCents = cents;
    },
    getDiagnostics() {
      return { backend: "dsf", controls: { ...parameters }, processorFailed: failed,
        logicalVoices: active.size, audioContext: { state: context?.state,
          currentTime: context?.currentTime, sampleRate: context?.sampleRate,
          baseLatency: context?.baseLatency, outputLatency: context?.outputLatency ?? null },
        engine: { metrics: { engineProcessCount: stats.blocks ?? 0 }, ...stats } };
    },
    makeHex(coords, cents, _steps, _equaves, _equivSteps, _previous, _next, notePlayed, velocityPlayed = 72,
      _bend, _ratio, playbackOptions = {}) {
      let id = 0;
      const hex = {
        pressureValue: 0, timbreValue: globalTimbre,
        coords, cents, release: false, note_played: notePlayed, velocity: velocityPlayed,
        velocity_played: velocityPlayed, _onVel: velocityPlayed, sounding: false,
        sequence: Number.isFinite(playbackOptions.absoluteMidicents),
        noteOn(timestamp) {
          if (closed || stopping || failed || !audioAttackAllowed(context) || (this.sounding && !this.release)) return;
          id = ++nextId;
          this.voiceId = id;
          this.release = false;
          this.sounding = true;
          this.voiceEpoch = epoch;
          this.attackFrame = frameAt(timestamp);
          active.set(id, this);
          post({ command: "start", id, frequency: frequencyFor(this.cents), velocity: this.velocity,
            pressure: this.pressureValue, timbre: this.timbreValue,
            frame: this.attackFrame });
          recordTouchAudio("dsf", context, Number.isFinite(timestamp) ? Math.max(0, timestamp - performance.now()) : 0);
        },
        noteOff(velocity = 0, timestamp) {
          this.release = true;
          if (this.voiceEpoch !== epoch || !this.sounding) return;
          const frame = frameAt(timestamp);
          if (frame < this.attackFrame) {
            post({ command: "cancel", id });
            this.sounding = false;
            active.delete(id);
          } else post({ command: "stop", id, frame, velocity });
        },
        retune(value, _bendOnly, _bend21, timestamp) {
          if (!Number.isFinite(value) || this.release) return;
          this.cents = value;
          if (this.voiceEpoch === epoch && this.sounding)
            post({ command: "frequency", id, frequency: frequencyFor(value),
              frame: Math.max(this.attackFrame, frameAt(timestamp)) });
        },
        sequenceRetune(value) { this.retune(value); },
        sendExpression(dimension) {
          if (this.release || !this.sounding || this.voiceEpoch !== epoch) return;
          post({ command: "expression", id, [dimension]: dimension === "pressure" ? this.pressureValue : this.timbreValue,
            frame: Math.max(this.attackFrame, frameAt()) });
        },
        applyNormalizedSnapshotPressure(value) { this.pressureValue = normalized(value); this.sendExpression("pressure"); },
        applyNormalizedSnapshotTimbre(value) { this.timbreValue = normalized(value); this.sendExpression("timbre"); },
        prepareNormalizedSnapshotPressure(value) { this.pressureValue = normalized(value); },
        prepareSnapshotPressure(value, value14) { this.pressureValue = midiExpression(value, value14); },
        prepareSnapshotExpression(note) {
          if (note.expression) {
            const values = readSnapshotExpression(note);
            this.pressureValue = normalized(values.pressure);
            this.timbreValue = normalized(values.timbre);
          } else {
            this.pressureValue = midiExpression(note.pressure, note.pressure14);
            this.timbreValue = midiExpression(note.timbre, note.timbre14);
          }
        },
        pressure(value, value14) { this.applyNormalizedSnapshotPressure(midiExpression(value, value14)); },
        aftertouch(value, value14) { this.pressure(value, value14); },
        cc74(value, value14) { this.applyNormalizedSnapshotTimbre(midiExpression(value, value14)); },
        polyTimbre(value, value14) { this.cc74(value, value14); },
        mpeTimbre(value, value14) { this.cc74(value, value14); },
        modwheel(value) { synth.applyZoneModwheel(value); },
        expression(value) { synth.applyZoneModwheel(value); },
        cancelPendingEvents() { if (id) post({ command: "cancel", id }); },
        needsRetainedVoiceRecovery() { return !this.release && this.voiceEpoch != null &&
          (this.voiceEpoch !== epoch || !this.sounding); },
      };
      return hex;
    },
    cancelSequenceEvents() {
      for (const [id, hex] of active) if (hex.sequence) {
        post({ command: "cancel", id });
        post({ command: "stop", id, frame: frameAt() });
      }
    },
    allSoundOff: () => clear(),
    hasVoices: () => active.size > 0,
    shutdown({ panic = false } = {}) {
      if (closed) return shutdownPromise;
      const dispose = () => {
        closed = true; clearTimeout(shutdownTimer); disposeNode(); active.clear();
        finishShutdown?.(); finishShutdown = null;
      };
      if (panic) { gate?.mute(); clear(); dispose(); return; }
      if (stopping) return shutdownPromise;
      stopping = true;
      for (const [id] of active) {
        post({ command: "cancel", id });
        post({ command: "stop", id, frame: frameAt() });
      }
      gate?.mute(30);
      shutdownPromise = new Promise(resolve => { finishShutdown = resolve; shutdownTimer = setTimeout(dispose, 50); });
      return shutdownPromise;
    },
  };
  try { await build(); return synth; }
  catch (error) { closed = true; disposeNode(); throw error; }
}

// Retain the console sine-test entry point, backed by the production engine.
export async function createDsfTest() {
  const synth = await createDsfSynth();
  await synth.prepare();
  let note;
  return {
    start(frequency = 440) {
      note?.noteOff();
      note = synth.makeHex(null, 1200 * Math.log2(frequency / 440));
      note.noteOn();
    },
    frequency(frequency) { note?.retune(1200 * Math.log2(frequency / 440)); },
    stop: () => note?.noteOff(),
    disconnect: () => synth.shutdown({ panic: true }),
  };
}
