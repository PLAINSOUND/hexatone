/**
 * Main-thread control bridge for the FluidSynth AudioWorklet.
 * The worklet owns the FluidSynth/WASM instance; this module exposes a virtual
 * MIDI output so Hexatone can reuse its existing MTS allocator and note lifecycle.
 */

import {
  peekSharedAudioContextNow,
  primeSharedSampleAudio,
  recoverSharedAudioContext,
} from "../sample_synth/prime-shared-audio.js";
import { warnLog } from "../debug/logging.js";
import { createRecoveryGate } from "../audio/recovery-gate.js";
import { createFluidMidiScheduler } from "./midi-scheduler.js";
import { readFluidSynthReverb } from "./reverb.js";
import { normalizeFluidSynthSmoothing, readFluidSynthSmoothing } from "./smoothing.js";
import { soundfontStorageKey } from "./soundfont-storage.js";
import { HOSTED_SOUNDFONTS, LAST_BANK_KEY, rememberBankPreset } from "./soundfont-catalog.js";
import { readRecoverySoundfont } from "./recovery-source.js";
import { soundfontCacheBudget } from "./cache-budget.js";
import { recordAudioRuntime, registerFluidSynthLifecycleDiagnostics } from "../audio/runtime-diagnostics.js";
import { getLatencyMeasurementEnabled, subscribeLatencyMeasurement } from "../audio/runtime-diagnostics.js";

subscribeLatencyMeasurement(() => {
  engine?.node?.port.postMessage({ type: "latency-diagnostics", enabled: getLatencyMeasurementEnabled() });
});

let nextProcessorId = 0;
let disposedProcessors = 0;
let stoppedProcessors = 0;
const processorLifecycle = new Map();
export function getFluidSynthLifecycleDiagnostics() {
  return { created: nextProcessorId, disposalAcknowledged: disposedProcessors,
    finalCallbackAcknowledged: stoppedProcessors, processors: [...processorLifecycle.values()],
    meaning: "Disposed confirms synth/buffer destruction. Processing-stopped confirms a callback returned false; a disconnected processor may receive no further callback. Missing acknowledgements are unknown, not proof of continued processing." };
}
registerFluidSynthLifecycleDiagnostics(getFluidSynthLifecycleDiagnostics);

let enginePromise = null;
let engine = null;
let pendingLoad = null;
let wasmBytesPromise = null;
let rebindGeneration = 0;
let nextSoundfontRequest = 0;
const engineListeners = new Set();
const failedNodes = new WeakSet();
const recoveryGates = new WeakMap();

function notifyEngineListeners() {
  engineListeners.forEach((listener) => listener(engine));
}

export function subscribeFluidSynthEngine(listener) {
  engineListeners.add(listener);
  return () => engineListeners.delete(listener);
}

// OFF disposes only FluidSynth, never the shared sample AudioContext.
export async function stopFluidSynthEngine({ naturalRelease = false } = {}) {
  recordAudioRuntime("fluidsynth-shutdown-start", { naturalRelease });
  if (enginePromise && !engine) {
    try { await enginePromise; } catch { /* Nothing left to dispose. */ }
  }
  ++rebindGeneration;
  const previous = engine;
  if (naturalRelease && previous?.node && previous.soundfontId != null) {
    previous.stopping = true;
    previous.output?.resetClock();
    const released = waitForMessage(previous.node, message => message?.type === "release-complete", true);
    previous.node.port.postMessage({ type: "release-for-shutdown" });
    try { await released; }
    catch (error) { previous.stopping = false; throw error; }
  }
  engine = null;
  enginePromise = null;
  pendingLoad = null;
  if (!naturalRelease) previous?.output?.panic?.();
  if (previous?.node) {
    recoveryGates.get(previous.node)?.disconnect();
    previous.node.disconnect();
    previous.node.port.postMessage({ type: "dispose" });
    previous.node = null;
  }
  try {
    localStorage.removeItem("fluidsynth_last_soundfont_source");
    localStorage.removeItem(LAST_BANK_KEY);
  } catch { /* Storage restrictions must not prevent shutdown. */ }
  notifyEngineListeners();
  recordAudioRuntime("fluidsynth-shutdown-detached");
}

const baseUrl = import.meta.env.BASE_URL || "/";

const waitForMessage = (node, predicate, failOnError = false, timeoutMs = 30000,
  { signal, observe } = {}) =>
  new Promise((resolve, reject) => {
    let timeout;
    const cleanUp = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      node.port.removeEventListener("message", onMessage);
      node.removeEventListener?.("processorerror", onProcessorError);
    };
    const onAbort = () => {
      cleanUp();
      reject(signal.reason);
    };
    const onProcessorError = () => {
      cleanUp();
      reject(new Error("FluidSynth stopped responding. Restart the audio engine and try again."));
    };
    const onMessage = ({ data }) => {
      observe?.(data);
      if (data?.type === "error" && failOnError) {
        cleanUp();
        reject(new Error(data.message || "FluidSynth AudioWorklet failed"));
      } else if (predicate(data)) {
        cleanUp();
        resolve(data);
      } else if (data?.type === "processor-disposed") {
        cleanUp();
        reject(new DOMException("FluidSynth was turned off", "AbortError"));
      }
    };
    if (signal?.aborted) return onAbort();
    if (Number.isFinite(timeoutMs)) timeout = setTimeout(() => {
      cleanUp();
      reject(new Error("FluidSynth AudioWorklet did not respond in time"));
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    node.port.addEventListener("message", onMessage);
    node.addEventListener?.("processorerror", onProcessorError);
    node.port.start();
  });

function adoptSoundfont(active, source, result, preferredPreset, retainSoundingVoices = false) {
  active.soundfontId = result.soundfontId;
  active.presets = result.presets || [];
  active.soundfontSource = source;
  active.pendingSoundfont = null;
  const requested = typeof preferredPreset === "string" ? preferredPreset.split(":").map(Number) : null;
  const selected = active.presets.find(p => p.bank === result.selectedPreset?.bank && p.program === result.selectedPreset?.program) ??
    active.presets.find(p => p.bank === requested?.[0] && p.program === requested?.[1]) ?? active.presets[0];
  if (selected) active.selectPreset(selected, { deferAttackProgram: retainSoundingVoices });
  if (!retainSoundingVoices) {
    active.setVolume(active.volume);
    active.setReverb(active.reverb);
  }
  try {
    localStorage.setItem("fluidsynth_last_soundfont_source", JSON.stringify({ name: source.name, url: source.url || "" }));
    if (HOSTED_SOUNDFONTS.includes(source.name)) localStorage.setItem(LAST_BANK_KEY, source.name);
  } catch { /* Persistence must not interrupt playback. */ }
  if (selected) rememberBankPreset(soundfontStorageKey(source), `${selected.bank}:${selected.program}`);
  notifyEngineListeners();
}

async function createWorkletNode(context) {
  recordAudioRuntime("fluidsynth-worklet-module-start");
  wasmBytesPromise ??= (async () => {
    const wasmUrl = `${baseUrl}fluidsynth/fluidsynth.wasm`;
    let response;
    try {
      response = await fetch(wasmUrl);
    } catch (error) {
      throw new Error(`Could not fetch FluidSynth WASM from ${wasmUrl}: ${error.message}`, {
        cause: error,
      });
    }
    if (!response.ok) {
      throw new Error(`FluidSynth WASM request failed (${response.status}): ${wasmUrl}`);
    }
    return response.arrayBuffer();
  })();
  const wasmBytes = await wasmBytesPromise;
  const processorUrl = `${baseUrl}fluidsynth/processor.js`;
  try {
    await context.audioWorklet.addModule(processorUrl);
  } catch (error) {
    throw new Error(`Could not load FluidSynth AudioWorklet module ${processorUrl}: ${error.message}`, {
      cause: error,
    });
  }
  const node = new AudioWorkletNode(context, "hexatone-fluidsynth", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { wasmBytes, latencyDiagnostics: getLatencyMeasurementEnabled(),
      soundfontCacheBudget: soundfontCacheBudget() },
  });
  const processorId = ++nextProcessorId;
  const lifecycle = { processorId, createdAt: new Date().toISOString(), state: "created" };
  processorLifecycle.set(processorId, lifecycle);
  if (processorLifecycle.size > 24) processorLifecycle.delete(processorLifecycle.keys().next().value);
  recordAudioRuntime("fluidsynth-processor-created", { processorId });
  node.port.addEventListener("message", ({ data }) => {
    const active = engine?.node === node ? engine : null;
    if (data?.type === "soundfont-cache" && active) {
      const previous = active.soundfontCache;
      const previousPrepared = previous?.preparedKeys ?? [];
      active.soundfontCache = data;
      const prepared = data.preparedKeys ?? [];
      if (previous?.estimatedBytes !== data.estimatedBytes || previous?.preparedBytes !== data.preparedBytes ||
          previous?.wasmHeapCapacityBytes !== data.wasmHeapCapacityBytes ||
          previousPrepared.length !== prepared.length || previousPrepared.some((key, index) => key !== prepared[index])) {
        notifyEngineListeners();
      }
    }
    if (!["ready", "processor-disposed", "processing-stopped", "soundfont-loaded", "release-complete", "memory-snapshot", "soundfont-cache", "soundfont-staged"].includes(data?.type)) return;
    Object.assign(lifecycle, { state: data.type, updatedAt: new Date().toISOString() });
    if (data.type === "processor-disposed" && !lifecycle.disposedAt) {
      lifecycle.disposedAt = lifecycle.updatedAt;
      disposedProcessors++;
    }
    if (data.type === "processing-stopped" && !lifecycle.processingStoppedAt) {
      lifecycle.processingStoppedAt = lifecycle.updatedAt;
      stoppedProcessors++;
    }
    if (data.memory) lifecycle.memory = data.memory;
    if (data.loadTimingMs) lifecycle.loadTimingMs = data.loadTimingMs;
    recordAudioRuntime(`fluidsynth-${data.type}`, { processorId, frame: data.frame ?? null,
      ...(data.memory ? { memory: data.memory } : {}),
      ...(data.loadTimingMs ? { loadTimingMs: data.loadTimingMs } : {}),
      ...(data.phase ? { phase: data.phase, inputBytes: data.inputBytes } : {}) });
  });
  const ready = waitForMessage(node, (message) => message?.type === "ready", true);
  // A new worklet must never join the speakers at full gain. The owning
  // output fades up on its first note; recovery also explicitly fades up.
  const recoveryGate = createRecoveryGate(context, true);
  recoveryGates.set(node, recoveryGate);
  node.connect(recoveryGate.node);
  node.onprocessorerror = () => {
    failedNodes.add(node);
    warnLog("FluidSynth AudioWorklet processor error");
  };
  try { await ready; } catch (error) {
    recoveryGate.disconnect();
    node.disconnect();
    node.port.close();
    throw error;
  }
  return node;
}

async function installSoundFont(active, source, preset = null, { notify = true } = {}) {
  const replacing = active.soundfontId != null;
  const bytes = await readRecoverySoundfont(source);
  const loaded = waitForMessage(
    active.node,
    (message) => message?.type === "soundfont-loaded",
    true,
  );
  active.node.port.postMessage(
    { type: replacing ? "replace-soundfont" : "load-soundfont", bytes, reverbSend: active.reverb,
      cacheKey: soundfontStorageKey(source) },
    [bytes],
  );
  const result = await loaded;
  active.soundfontId = result.soundfontId;
  active.presets = result.presets || [];
  const selected = active.presets.find(
    (item) => item.bank === preset?.bank && item.program === preset?.program,
  ) ?? active.presets[0];
  if (selected) active.selectPreset(selected);
  active.setVolume(active.volume);
  active.setReverb?.(active.reverb);
  active.setSmoothing?.(active.smoothing);
  if (notify) notifyEngineListeners();
  return result;
}

async function rebindEngineToContext(context, signal) {
  const generation = ++rebindGeneration;
  const oldNode = engine.node;
  // Recovery is already silent. Retire the old synth before loading a second
  // sample bank, rather than retaining both until replacement succeeds.
  if (oldNode) {
    failedNodes.add(oldNode);
    const disposed = waitForMessage(oldNode, message => message?.type === "processor-disposed", false, 250);
    try { oldNode.port.postMessage({ type: "dispose" }); } catch { /* Dead worklet. */ }
    let acknowledged = false;
    try { await disposed; acknowledged = true; } catch { /* A frozen worklet cannot acknowledge. */ }
    recoveryGates.get(oldNode)?.disconnect();
    oldNode.disconnect?.();
    recordAudioRuntime("fluidsynth-recovery-retired-old-processor", { acknowledged });
  }
  const nextNode = await createWorkletNode(context);
  const discard = () => {
    try { nextNode.port.postMessage({ type: "dispose" }); } catch { /* Dead worklet. */ }
    recoveryGates.get(nextNode)?.disconnect();
    nextNode.disconnect?.();
    try { nextNode.port.close?.(); } catch { /* Already closed by the browser. */ }
  };
  const checkCurrent = () => {
    if (signal?.aborted || generation !== rebindGeneration) {
      discard();
      throw new Error("FluidSynth recovery superseded or timed out");
    }
  };
  checkCurrent();
  signal?.addEventListener("abort", discard, { once: true });
  const source = engine.soundfontSource;
  const previousPreset = engine.selectedPreset;

  if (source) {
    // Keep the current engine's visible/selected state intact while the new
    // worklet loads. Some mobile browsers interrupt this longer operation.
    const candidate = {
      node: nextNode,
      soundfontId: null,
      presets: [],
      selectedPreset: null,
      volume: engine.volume,
      reverb: engine.reverb,
      smoothing: engine.smoothing,
      setSmoothing(value) {
        candidate.smoothing = normalizeFluidSynthSmoothing(value);
        candidate.node.port.postMessage({ type: "set-smoothing", ...candidate.smoothing });
      },
      setReverb(value) {
        candidate.reverb = value;
        candidate.node.port.postMessage({ type: "set-reverb", value });
      },
      selectPreset(preset) {
        if (!preset || candidate.soundfontId == null) return;
        candidate.selectedPreset = { bank: preset.bank, program: preset.program };
        candidate.node.port.postMessage({
          type: "select-program",
          soundfontId: candidate.soundfontId,
          bank: preset.bank,
          program: preset.program,
        });
      },
      setVolume(value) {
        const volume = Math.max(0, Math.min(127, Math.round(Number(value) || 0)));
        candidate.volume = volume;
        candidate.node.port.postMessage({ type: "midi", command: { op: "volume", b: volume } });
      },
    };
    try {
      await installSoundFont(candidate, source, previousPreset, { notify: false });
      checkCurrent();
    } catch (error) {
      recoveryGates.get(nextNode)?.disconnect();
      try { nextNode.port.postMessage({ type: "dispose" }); } catch { /* Port already closed. */ }
      nextNode.disconnect?.();
      try {
        nextNode.port.close?.();
      } catch {
        // The candidate worklet may already have failed or closed its port.
      }
      signal?.removeEventListener("abort", discard);
      throw error;
    }
    engine.context = context;
    engine.node = nextNode;
    engine.pendingSoundfont = null;
    engine.soundfontCache = null;
    engine.soundfontId = candidate.soundfontId;
    engine.presets = candidate.presets;
    engine.selectedPreset = candidate.selectedPreset;
    engine.output.attackProgram = engine.selectedPreset && { soundfontId: engine.soundfontId, ...engine.selectedPreset };
    engine.volume = candidate.volume;
  } else {
    engine.context = context;
    engine.node = nextNode;
    engine.pendingSoundfont = null;
    engine.soundfontCache = null;
  }

  signal?.removeEventListener("abort", discard);

  engine.setSmoothing?.(engine.smoothing);
  try {
    oldNode?.port?.close?.();
  } catch {
    // The old AudioContext may already have closed its message port.
  }
  notifyEngineListeners();
}

export async function ensureFluidSynthEngineAwake() {
  if (!engine) return false;
  const context = await recoverSharedAudioContext();
  if (context.state !== "running") await context.resume();
  if (engine.context === context && engine.node && !failedNodes.has(engine.node) && context.state === "running") {
    if (engine.soundfontSource && engine.soundfontId == null) {
      await installSoundFont(engine, engine.soundfontSource, engine.selectedPreset);
    }
    return true;
  }
  await rebindEngineToContext(context);
  return context.state === "running";
}

export async function forceFluidSynthEngineRebuild({
  sharedContext = null,
} = {}) {
  if (!engine) return false;
  if (sharedContext && (sharedContext !== peekSharedAudioContextNow() || sharedContext.state === "closed"))
    throw new Error("FluidSynth recovery received a stale context");
  const controller = new AbortController();
  let timer;
  const currentContext = peekSharedAudioContextNow();
  // If another backend has already replaced the shared context, only rebind
  // FluidSynth. Otherwise this is a FluidSynth-only graph, so request the same
  // explicit iOS context recreation the sample backend performs.
  const contextWasAlreadyRebuilt = engine.context !== currentContext;
  // Start replacement/resume synchronously, while this call still owns the tap.
  const contextWork = sharedContext
    ? Promise.resolve(sharedContext)
    : recoverSharedAudioContext({ forceRecreate: !contextWasAlreadyRebuilt });
  const work = (async () => {
    const context = await contextWork;
    controller.signal.throwIfAborted();
    // Running contexts can contain a failed/stalled worklet. Explicit recovery
    // always replaces it, restoring the retained SoundFont and selected preset.
    await rebindEngineToContext(context, controller.signal);
    return context.state === "running";
  })();
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("FluidSynth audio recovery timed out"));
      }, 35000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

export function getFluidSynthAudioDiagnostics() {
  return { backend: "fluidsynth", audioContext: engine ? {
    state: engine.context.state, currentTime: engine.context.currentTime,
    sampleRate: engine.context.sampleRate, baseLatency: engine.context.baseLatency,
  } : null, soundfontLoaded: engine?.soundfontId != null,
  selectedPreset: engine?.selectedPreset ?? null, volume: engine?.volume ?? null,
  soundfontCache: engine?.soundfontCache ?? null,
  pendingSoundfont: engine?.pendingSoundfont?.source.name ?? null,
  processorFailed: engine?.node ? failedNodes.has(engine.node) : false };
}

// PANIC must reach this persistent engine even after its output was disabled.
export function panicFluidSynth() {
  engine?.output?.panic?.();
}

export function getFluidSynthAudioContext() {
  return engine?.context ?? null;
}

export function muteFluidSynthForRecovery(durationMs) {
  if (engine?.node) return recoveryGates.get(engine.node)?.mute(durationMs);
}

export function fadeFluidSynthAfterRecovery(options) {
  if (engine?.node) return recoveryGates.get(engine.node)?.fadeIn(options);
}

// Finish the output envelope before publishing a new voice owner. Otherwise a
// short first note can finish while the persistent worklet is still fading up.
export async function prepareFluidSynthOutput() {
  if (!engine?.node) return;
  fadeFluidSynthAfterRecovery({ fromCurrent: true, durationMs: 40 });
  await new Promise(resolve => setTimeout(resolve, 40));
}

export async function clearFluidSynthRecoveryEvents() {
  if (!engine?.node) return;
  engine.output?.resetClock();
  const node = engine.node;
  const cleared = waitForMessage(node, message => message?.type === "recovery-cleared", true, 1500);
  node.port.postMessage({ type: "clear-recovery-events" });
  return cleared;
}

export async function resumeFluidSynthAfterAudioRestart() {
  if (!engine) throw new Error("FluidSynth engine is unavailable");
  engine.output?.resetClock();
  const context = peekSharedAudioContextNow() ?? engine.context;
  if (engine.context !== context || !engine.node || failedNodes.has(engine.node)) {
    await rebindEngineToContext(context);
  }
}

export async function getFluidSynthEngine() {
  if (engine) return engine;
  if (!enginePromise) {
    enginePromise = (async () => {
      let context;
      try {
        context = await primeSharedSampleAudio();
      } catch (error) {
        throw new Error(`Could not prepare the shared audio context: ${error.message}`, {
          cause: error,
        });
      }
      engine = {
        context,
        node: await createWorkletNode(context),
        soundfontId: null,
        presets: [],
        selectedPreset: null,
        soundfontSource: null,
        volume: 100,
        reverb: readFluidSynthReverb(),
        smoothing: readFluidSynthSmoothing(),
      };
      notifyEngineListeners();

      const ownedEngine = engine;
      engine.setSmoothing = (value) => {
        const next = normalizeFluidSynthSmoothing({ ...ownedEngine.smoothing, ...value });
        if (ownedEngine.smoothingSentNode === ownedEngine.node &&
          ownedEngine.smoothingSent?.pressureMs === next.pressureMs &&
          ownedEngine.smoothingSent?.expressionMs === next.expressionMs &&
          ownedEngine.smoothingSent?.minimumMs === next.minimumMs) return;
        ownedEngine.smoothing = next;
        ownedEngine.smoothingSentNode = ownedEngine.node;
        ownedEngine.smoothingSent = next;
        ownedEngine.node.port.postMessage({ type: "set-smoothing", ...ownedEngine.smoothing });
      };
      engine.setSmoothing(engine.smoothing);
      engine.output = createFluidMidiScheduler(() => ownedEngine.node ? ownedEngine : null,
        () => engine === ownedEngine ? ensureFluidSynthEngineAwake() : false);
      engine.setReverb = (value) => {
        engine.reverb = Math.max(0, Math.min(127, Math.round(Number(value) || 0)));
        engine.output.reverbSend = engine.reverb;
        engine.node.port.postMessage({ type: "set-reverb", value: engine.reverb });
      };
      engine.output.reverbSend = engine.reverb;
      engine.output.volume = engine.volume;
      engine.setPatchMix = ({ volume, reverb }) => {
        engine.output.attackProgram = engine.selectedPreset && { soundfontId: engine.soundfontId, ...engine.selectedPreset };
        engine.volume = Math.round(volume);
        engine.reverb = Math.round(reverb);
        engine.output.volume = engine.volume;
        engine.output.reverbSend = engine.reverb;
      };
      engine.setVolume = (value) => {
        engine.volume = Math.max(0, Math.min(127, Math.round(Number(value) || 0)));
        engine.output.volume = engine.volume;
        engine.output.sendCommand({ op: "volume", b: engine.volume });
      };
      engine.selectPreset = (preset, { deferAttackProgram = false } = {}) => {
        if (!preset || engine.soundfontId == null) return;
        engine.selectedPreset = { bank: preset.bank, program: preset.program };
        if (deferAttackProgram) return;
        engine.output.attackProgram = { soundfontId: engine.soundfontId, ...engine.selectedPreset };
        engine.node.port.postMessage({
          type: "select-program",
          soundfontId: engine.soundfontId,
          bank: preset.bank,
          program: preset.program,
        });
      };
      return engine;
    })().catch((error) => {
      enginePromise = null;
      engine = null;
      throw error;
    });
  }
  return enginePromise;
}

async function waitForColdBankGap(canLoad, signal, onWaiting) {
  if (!canLoad || canLoad()) return;
  onWaiting?.();
  do {
    signal?.throwIfAborted();
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, 50);
      signal?.addEventListener("abort", abort, { once: true });
    });
    signal?.throwIfAborted();
  } while (!canLoad());
}

export async function loadFluidSynthSoundFont(
  file,
  { onDownloadProgress, onDownloadComplete, onBytesReady, preferredPreset, signal, retainSoundingVoices = false, onWaitingForSilence, canLoadColdBank, prepareOnly = false } = {},
) {
  if (!file) throw new Error("Choose a SoundFont file first");
  recordAudioRuntime("fluidsynth-soundfont-load-start");
  // A suspended context cannot render the block that commits a waiting bank.
  if (engine?.context.state && engine.context.state !== "running") {
    if (!await ensureFluidSynthEngineAwake()) {
      throw new Error("Audio is suspended. Activate audio before loading SoundFonts.");
    }
  }
  // The first engine also compiles and instantiates WASM on its worklet.
  if (!engine && !enginePromise) {
    await waitForColdBankGap(canLoadColdBank, signal, onWaitingForSilence);
  }
  const active = await getFluidSynthEngine();
  signal?.throwIfAborted();
  while (pendingLoad) {
    await pendingLoad.catch(() => {});
    signal?.throwIfAborted();
  }
  const request = (async () => {
    if (engine !== active) throw new DOMException("FluidSynth was turned off", "AbortError");
    const source = file;
    const cacheKey = soundfontStorageKey(source);
    const requestId = ++nextSoundfontRequest;
    if (active.pendingSoundfont) {
      active.node.port.postMessage({ type: "cancel-pending-soundfont" });
      active.pendingSoundfont = null;
    }
    const requestedPreset = preferredPreset ?? (active.soundfontSource?.name === source.name && active.selectedPreset
      ? `${active.selectedPreset.bank}:${active.selectedPreset.program}` : undefined);
    // Hosted/browser-copy selections can reuse a native bank. A freshly chosen
    // local File is deliberately reread, so edits replace its previous version.
    // A page may still own a processor created before a development update.
    // Only query banks explicitly advertised by this worklet; older processors
    // cannot acknowledge the cache protocol and would otherwise lock the UI.
    if ((source.url || prepareOnly) && active.soundfontCache?.keys.includes(cacheKey)) {
      const cached = waitForMessage(active.node,
        data => data?.type === "soundfont-cache-result" && data.requestId === requestId,
        true, 30000, { signal });
      active.node.port.postMessage({ type: "select-cached-soundfont", cacheKey, requestId,
        preferredPreset: requestedPreset, reverbSend: active.reverb, retainSoundingVoices, prepareOnly });
      const result = await cached;
      signal?.throwIfAborted();
      if (engine !== active) throw new DOMException("FluidSynth was turned off", "AbortError");
      if (result.hit) {
        if (!prepareOnly) adoptSoundfont(active, source, result, requestedPreset, retainSoundingVoices);
        return result;
      }
    }
    const bytes = await source.arrayBuffer(onDownloadProgress);
    recordAudioRuntime("fluidsynth-soundfont-bytes-ready", { inputBytes: bytes.byteLength });
    signal?.throwIfAborted();
    onDownloadComplete?.();
    await onBytesReady?.(source, bytes);
    signal?.throwIfAborted();
    if (engine !== active) throw new DOMException("FluidSynth was turned off", "AbortError");
    await waitForColdBankGap(canLoadColdBank, signal, onWaitingForSilence);
    if (engine !== active) throw new DOMException("FluidSynth was turned off", "AbortError");
    const replacing = active.soundfontId != null;
    const waitForSilence = replacing || prepareOnly || active.context.state === "running";
    const node = active.node;
    const matchRequest = data => data.requestId == null || data.requestId === requestId;
    const loaded = waitForMessage(node, data =>
      matchRequest(data) && (data.type === "soundfont-loaded" || data.type === "soundfont-switch-error"),
      true, waitForSilence ? Infinity : 30000, {
      signal,
      observe: data => {
        if (data?.type === "soundfont-staged" && matchRequest(data)) {
          if (!prepareOnly) active.pendingSoundfont = { source, cacheKey, requestId, preferredPreset: requestedPreset };
          onWaitingForSilence?.();
        }
      },
    });
    node.port.postMessage({ type: replacing ? "replace-soundfont" : "load-soundfont",
      bytes, cacheKey, requestId, preferredPreset: requestedPreset,
      waitForSilence, retainSoundingVoices, prepareOnly,
      reuseAllowed: !!source.url || prepareOnly, reverbSend: active.reverb }, [bytes]);
    let result;
    try { result = await loaded; }
    catch (error) {
      if (signal?.aborted && engine === active && active.node === node) {
        node.port.postMessage({ type: "cancel-pending-soundfont", requestId });
      }
      throw error;
    } finally {
      if (active.pendingSoundfont?.requestId === requestId) active.pendingSoundfont = null;
    }
    signal?.throwIfAborted();
    if (result.type === "soundfont-switch-error") throw new Error(result.message);
    if (engine !== active) throw new DOMException("FluidSynth was turned off", "AbortError");
    if (!prepareOnly) adoptSoundfont(active, source, result, requestedPreset, retainSoundingVoices);
    return result;
  })().finally(() => {
    if (pendingLoad === request) pendingLoad = null;
  });
  pendingLoad = request;
  return request;
}

export const peekFluidSynthEngine = () => engine;


export function clearPreparedSoundfonts(cacheKey) {
  engine?.node?.port.postMessage({ type: "unpin-soundfonts", cacheKey });
}
