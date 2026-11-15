import { DsfOscillator } from "./dsf-oscillator.js";
import { dsfLoudnessGain } from "./equal-loudness.js";
import { normalizeDsfControls } from "./controls.js";
import { createDsfYzEnvelope } from "./generated-yz.js";

const MAX_VOICES = 64;
const MAX_QUEUE = 4096;
const TRANSITION_SECONDS = 0.01;
const NOTE_GAIN = 0.084375;
// Keep the ISO contour intact, with a gentler overall listening level.
const ISO_OUTPUT_GAIN = 0.85;

export class DsfProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.controls = normalizeDsfControls();
    this.volume = this.controls.volume;
    this.volumeStep = 0;
    this.volumeRemaining = 0;
    this.voices = new Map();
    this.stolenTails = [];
    this.queue = [];
    this.frame = typeof currentFrame === "number" ? currentFrame : 0;
    this.epoch = 0;
    this.blocks = 0;
    this.lateEvents = 0;
    this.droppedEvents = 0;
    this.stolenVoices = 0;
    this.peak = 0;
    this.port.onmessage = ({ data }) => this.message(data);
  }

  message(data) {
    if (!data || typeof data.command !== "string") return;
    if (data.command === "clear") {
      this.epoch = Math.max(this.epoch, data.epoch ?? this.epoch);
      this.queue.length = 0;
      this.voices.clear();
      this.stolenTails.length = 0;
      this.port.postMessage({ type: "cleared", ack: data.ack });
      return;
    }
    if (data.epoch != null && data.epoch !== this.epoch) return;
    if (data.command === "controls") {
      const velocityChanged = this.controls.velocity !== (data.controls?.velocity === true);
      const generationChanged = this.controls.generateYZ !== (data.controls?.generateYZ === true);
      this.controls = normalizeDsfControls(data.controls);
      this.volumeRemaining = Math.max(1, Math.round(sampleRate * TRANSITION_SECONDS));
      this.volumeStep = (this.controls.volume - this.volume) / this.volumeRemaining;
      for (const voice of this.voices.values()) {
        if (generationChanged && (!this.controls.generateYZ || !voice.released)) this.initGenerated(voice);
        this.transition(voice, voice.frequency);
        this.expressiveGain(voice);
        if (!voice.released && velocityChanged) this.envelope(voice, this.attackLevel(voice),
          voice.remaining > 0 ? voice.remaining * 1000 / sampleRate : TRANSITION_SECONDS * 1000);
      }
      return;
    }
    if (data.command === "cancel") {
      this.queue = this.queue.filter(event => event.id !== data.id);
      if (!this.voices.has(data.id)) this.port.postMessage({ type: "ended", id: data.id });
      return;
    }
    if (!["start", "stop", "frequency", "expression"].includes(data.command)) return;
    if (["start", "frequency"].includes(data.command) && (!Number.isFinite(data.frequency) ||
        data.frequency <= 0 || data.frequency >= sampleRate / 2)) return;
    const event = { ...data, id: data.id ?? 0,
      frame: Number.isFinite(data.frame) ? Math.max(0, Math.round(data.frame)) : this.frame };
    if (this.queue.length >= MAX_QUEUE) {
      this.droppedEvents++;
      if (event.command !== "stop") return;
      // A full queue may reject attacks, but must not strand an existing voice.
      this.apply(event);
      return;
    }
    let index = this.queue.length;
    while (index > 0 && this.queue[index - 1].frame > event.frame) index--;
    this.queue.splice(index, 0, event);
  }

  // Cubic departure from MIDI 64 keeps the middle gentle and emphasizes extremes.
  velocityCurve(velocity) {
    const v = this.normalized((velocity ?? 64) / 127) * 127;
    return ((v - 64) / (v < 64 ? 64 : 63)) ** 3;
  }

  attackLevel(voice) {
    if (!this.controls.velocity) return 1;
    const curve = this.velocityCurve(voice.velocity);
    return 1 + curve * (curve < 0 ? 0.6 : 0.25);
  }

  timbreFor(voice) {
    const expression = voice.generatedValues ?? voice;
    return Math.min(1, this.controls.timbre +
      (this.controls.timbreResponse ? 0.2 * expression.timbre : 0) +
      (this.controls.pressure ? this.pressureBite(expression.pressure) : 0) +
      (this.controls.velocity ? 0.1 * voice.velocity / 127 : 0));
  }

  pressureBite(pressure) {
    // A light touch briefly brightens the spectrum; smooth shoulders avoid a
    // hard threshold as pressure crosses this region in either direction.
    const smooth = t => t * t * (3 - 2 * t);
    if (pressure <= 0 || pressure >= 0.3) return 0;
    if (pressure < 0.04) return 0.12 * smooth(pressure / 0.04);
    return 0.12 * (1 - smooth((pressure - 0.04) / 0.26));
  }

  expressiveGain(voice) {
    voice.expressionTarget = this.pressureGain((voice.generatedValues ?? voice).pressure);
    voice.expressionRemaining = Math.max(1, Math.round(sampleRate * TRANSITION_SECONDS));
    voice.expressionStep = (voice.expressionTarget - voice.expressionGain) / voice.expressionRemaining;
  }

  initGenerated(voice) {
    const time = this.frame * 1000 / sampleRate;
    voice.generated = this.controls.generateYZ ? createDsfYzEnvelope(voice.velocity, time) : null;
    if (voice.generated && voice.pressure > 0) voice.generated.pressure(voice.pressure, time);
    voice.generatedValues = voice.generated?.sample(time) ?? null;
    voice.nextGeneratedFrame = this.frame;
  }

  pressureGain(pressure) {
    // Reserve most of the boost for the upper part of the pressure gesture.
    return this.controls.pressure ? 1 + 3 * pressure ** 3 : 1;
  }

  envelope(voice, target, durationMs) {
    voice.targetGain = target;
    voice.remaining = Math.max(0, Math.round(durationMs * sampleRate / 1000));
    if (voice.remaining === 0) { voice.gain = target; voice.gainStep = 0; return; }
    voice.gainStep = (target - voice.gain) / voice.remaining;
  }

  compensate(voice) {
    voice.compensationTarget = this.compensationFor(voice.frequency);
    voice.compensationRemaining = Math.max(1, Math.round(sampleRate * TRANSITION_SECONDS));
    voice.compensationStep = (voice.compensationTarget - voice.compensation) / voice.compensationRemaining;
  }

  compensationFor(frequency) {
    return this.controls.iso226 ? ISO_OUTPUT_GAIN * dsfLoudnessGain(frequency) : 1;
  }

  transition(voice, frequency) {
    voice.frequency = frequency;
    this.compensate(voice);
    if (voice.transitionRemaining) { voice.pendingTransition = true; return; }
    const timbre = this.timbreFor(voice);
    if (voice.osc.frequency === frequency && voice.osc.timbre === timbre &&
        voice.osc.partials === this.controls.partials) return;
    voice.previous = voice.osc.clone();
    voice.osc.configure(frequency, timbre, this.controls.partials);
    voice.transitionLength = Math.max(1, Math.round(sampleRate * TRANSITION_SECONDS));
    voice.transitionRemaining = voice.transitionLength;
  }

  apply(event) {
    if (event.frame < this.frame) this.lateEvents++;
    if (event.command === "start") {
      if (this.voices.has(event.id)) return;
      if (this.voices.size >= MAX_VOICES) {
        const old = [...this.voices.values()].find(voice => voice.released) ?? this.voices.values().next().value;
        this.voices.delete(old.id);
        old.released = true;
        this.envelope(old, 0, 5);
        if (this.stolenTails.length >= 8) this.stolenTails.shift();
        this.stolenTails.push(old);
        this.port.postMessage({ type: "ended", id: old.id, stolen: true });
        this.stolenVoices++;
      }
      const osc = new DsfOscillator(sampleRate);
      const voice = { id: event.id, osc, frequency: event.frequency,
        pressure: this.normalized(event.pressure), timbre: this.normalized(event.timbre),
        velocity: Math.max(0, Math.min(127, event.velocity ?? 72)), gain: 0, released: false };
      this.initGenerated(voice);
      osc.configure(event.frequency, this.timbreFor(voice), this.controls.partials);
      voice.expressionGain = this.pressureGain((voice.generatedValues ?? voice).pressure);
      voice.compensation = this.compensationFor(event.frequency);
      this.envelope(voice, this.attackLevel(voice), this.envelopeTime(this.controls.attack, voice.velocity));
      this.voices.set(event.id, voice);
    } else {
      const voice = this.voices.get(event.id);
      if (!voice) return;
      if (event.command === "frequency" && !voice.released) this.transition(voice, event.frequency);
      if (event.command === "expression" && !voice.released) {
        if (Number.isFinite(event.pressure)) voice.pressure = this.normalized(event.pressure);
        if (Number.isFinite(event.timbre)) voice.timbre = this.normalized(event.timbre);
        if (voice.generated && Number.isFinite(event.pressure))
          voice.generated.pressure(voice.pressure, this.frame * 1000 / sampleRate);
        this.expressiveGain(voice);
        this.transition(voice, voice.frequency);
      }
      if (event.command === "stop" && !voice.released) {
        voice.generated?.release(event.velocity ?? 0, this.frame * 1000 / sampleRate);
        voice.released = true;
        this.envelope(voice, 0, this.envelopeTime(this.controls.release, event.velocity));
      }
    }
  }

  normalized(value) { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }

  envelopeTime(milliseconds, velocity) {
    if (!this.controls.velocity) return milliseconds;
    const curve = this.velocityCurve(velocity);
    return milliseconds * (1 - curve * (curve < 0 ? 1 : 0.75));
  }

  voiceSample(voice) {
    // Sample the shared expression ramps on the audio clock, without MIDI,
    // browser timers, channel limits or main-thread heartbeat dependencies.
    if (voice.generated && this.frame >= voice.nextGeneratedFrame) {
      voice.nextGeneratedFrame = this.frame + Math.max(1, Math.round(sampleRate * 0.002));
      const values = voice.generated.sample(this.frame * 1000 / sampleRate);
      if (values.pressure !== voice.generatedValues.pressure || values.timbre !== voice.generatedValues.timbre) {
        voice.generatedValues = values;
        this.expressiveGain(voice);
        this.transition(voice, voice.frequency);
      }
    }
    if (voice.remaining > 0) {
      voice.gain += voice.gainStep;
      if (--voice.remaining === 0) voice.gain = voice.targetGain;
    }
    let value = voice.osc.nextSample();
    if (voice.transitionRemaining > 0) {
      const blend = 1 - voice.transitionRemaining / voice.transitionLength;
      value = voice.previous.nextSample() * (1 - blend) + value * blend;
      if (--voice.transitionRemaining === 0) {
        voice.previous = null;
        if (voice.pendingTransition) {
          voice.pendingTransition = false;
          this.transition(voice, voice.frequency);
        }
      }
    }
    if (voice.compensationRemaining > 0) {
      voice.compensation += voice.compensationStep;
      if (--voice.compensationRemaining === 0) voice.compensation = voice.compensationTarget;
    }
    if (voice.expressionRemaining > 0) {
      voice.expressionGain += voice.expressionStep;
      if (--voice.expressionRemaining === 0) voice.expressionGain = voice.expressionTarget;
    }
    return value * voice.gain * voice.compensation * voice.expressionGain;
  }

  report() {
    this.port.postMessage({ type: "stats", blocks: this.blocks, frame: this.frame,
      voices: this.voices.size, releaseTails: this.stolenTails.length,
      queued: this.queue.length, lateEvents: this.lateEvents,
      droppedEvents: this.droppedEvents, stolenVoices: this.stolenVoices, peak: this.peak });
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    if (!channels?.length) return true;
    let peak = 0;
    for (let i = 0; i < channels[0].length; i++, this.frame++) {
      while (this.queue.length && this.queue[0].frame <= this.frame) this.apply(this.queue.shift());
      if (this.volumeRemaining > 0) {
        this.volume += this.volumeStep;
        if (--this.volumeRemaining === 0) this.volume = this.controls.volume;
      }
      let value = 0;
      for (const [id, voice] of this.voices) {
        value += this.voiceSample(voice);
        if (voice.released && voice.remaining === 0) {
          this.voices.delete(id);
          this.port.postMessage({ type: "ended", id });
        }
      }
      for (let tail = this.stolenTails.length - 1; tail >= 0; tail--) {
        const voice = this.stolenTails[tail];
        value += this.voiceSample(voice);
        if (voice.remaining === 0) this.stolenTails.splice(tail, 1);
      }
      value *= NOTE_GAIN * this.volume;
      if (!Number.isFinite(value)) value = 0;
      peak = Math.max(peak, Math.abs(value));
      for (const channel of channels) channel[i] = value;
    }
    this.peak = peak;
    if (++this.blocks % 32 === 0) this.report();
    return true;
  }
}
registerProcessor("hexatone-dsf", DsfProcessor);
