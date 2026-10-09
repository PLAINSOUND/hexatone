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
import { reattackFluidSynthSnapshots } from "./voices.js";

let enginePromise = null;
let engine = null;
let pendingLoad = null;
let wasmBytesPromise = null;
let rebindGeneration = 0;
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

const baseUrl = import.meta.env.BASE_URL || "/";

const waitForMessage = (node, predicate, failOnError = false) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      node.port.removeEventListener("message", onMessage);
      reject(new Error("FluidSynth AudioWorklet did not respond in time"));
    }, 30000);
    const onMessage = ({ data }) => {
      if (data?.type === "error" && failOnError) {
        clearTimeout(timeout);
        node.port.removeEventListener("message", onMessage);
        reject(new Error(data.message || "FluidSynth AudioWorklet failed"));
      } else if (predicate(data)) {
        clearTimeout(timeout);
        node.port.removeEventListener("message", onMessage);
        resolve(data);
      }
    };
    node.port.addEventListener("message", onMessage);
    node.port.start();
  });

async function createWorkletNode(context) {
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
    processorOptions: { wasmBytes },
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
  const bytes = await source.arrayBuffer();
  const loaded = waitForMessage(
    active.node,
    (message) => message?.type === "soundfont-loaded",
    true,
  );
  active.node.port.postMessage(
    { type: replacing ? "replace-soundfont" : "load-soundfont", bytes },
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
  if (notify) notifyEngineListeners();
  return result;
}

async function rebindEngineToContext(context, signal) {
  const generation = ++rebindGeneration;
  const nextNode = await createWorkletNode(context);
  const discard = () => {
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
  const oldNode = engine.node;
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
        candidate.node.port.postMessage({ type: "midi-batch", events:
          Array.from({ length: 128 }, (_, channel) => ({
            command: { channel, op: "cc", a: 7, b: volume },
          })) });
      },
    };
    try {
      await installSoundFont(candidate, source, previousPreset, { notify: false });
      checkCurrent();
    } catch (error) {
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
    engine.soundfontId = candidate.soundfontId;
    engine.presets = candidate.presets;
    engine.selectedPreset = candidate.selectedPreset;
    engine.volume = candidate.volume;
  } else {
    engine.context = context;
    engine.node = nextNode;
  }

  signal?.removeEventListener("abort", discard);

  oldNode?.disconnect?.();
  if (oldNode) recoveryGates.get(oldNode)?.disconnect();
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

export async function forceFluidSynthEngineRebuild() {
  if (!engine) return false;
  const controller = new AbortController();
  let timer;
  const currentContext = peekSharedAudioContextNow();
  // If another backend has already replaced the shared context, only rebind
  // FluidSynth. Otherwise this is a FluidSynth-only graph, so request the same
  // explicit iOS context recreation the sample backend performs.
  const contextWasAlreadyRebuilt = engine.context !== currentContext;
  // Start replacement/resume synchronously, while this call still owns the tap.
  const contextWork = recoverSharedAudioContext({ forceRecreate: !contextWasAlreadyRebuilt });
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
  const cleared = waitForMessage(node, message => message?.type === "recovery-cleared", true);
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
      };
      notifyEngineListeners();

      engine.output = createFluidMidiScheduler(() => engine, ensureFluidSynthEngineAwake);
      engine.setVolume = (value) => {
        engine.volume = Math.max(0, Math.min(127, Math.round(Number(value) || 0)));
        for (let channel = 0; channel < 128; channel++) {
          engine.output.sendCommand({ channel, op: "cc", a: 7, b: engine.volume });
        }
      };
      engine.selectPreset = (preset) => {
        if (!preset || engine.soundfontId == null) return;
        const changed = engine.selectedPreset?.bank !== preset.bank ||
          engine.selectedPreset?.program !== preset.program;
        engine.selectedPreset = { bank: preset.bank, program: preset.program };
        engine.node.port.postMessage({
          type: "select-program",
          soundfontId: engine.soundfontId,
          bank: preset.bank,
          program: preset.program,
        });
        if (changed) reattackFluidSynthSnapshots(engine.output);
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

export async function loadFluidSynthSoundFont(
  file,
  { onDownloadProgress, onDownloadComplete, onBytesReady, preferredPreset, signal } = {},
) {
  if (!file) throw new Error("Choose a SoundFont file first");
  const active = await getFluidSynthEngine();
  signal?.throwIfAborted();
  if (pendingLoad) {
    try { await pendingLoad; } catch (error) {
      if (error.name !== "AbortError") throw error;
    }
    signal?.throwIfAborted();
  }
  pendingLoad = (async () => {
    // Keep the File/hosted source object, not another copy of the potentially
    // large bank bytes. iOS may replace the shared AudioContext on recovery,
    // requiring a fresh worklet synth and SoundFont load.
    const source = file;
    const bytes = await source.arrayBuffer(onDownloadProgress);
    signal?.throwIfAborted();
    onDownloadComplete?.();
    // Persist before transferring/detaching the ArrayBuffer into the worklet.
    await onBytesReady?.(source, bytes);
    signal?.throwIfAborted();
    const replacing = active.soundfontId != null;
    const requested = typeof preferredPreset === "string" ? preferredPreset.split(":").map(Number) : null;
    const previousPreset = requested ? { bank: requested[0], program: requested[1] }
      : active.soundfontSource?.name === source.name ? active.selectedPreset : null;
    active.soundfontId = null;
    active.presets = [];
    active.selectedPreset = null;
    const loaded = waitForMessage(
      active.node,
      (message) => message?.type === "soundfont-loaded",
      true,
    );
    active.node.port.postMessage(
      { type: replacing ? "replace-soundfont" : "load-soundfont", bytes },
      [bytes],
    );
    try {
      const result = await loaded;
      active.soundfontId = result.soundfontId;
      active.presets = result.presets || [];
      active.soundfontSource = source;
      try {
        localStorage.setItem("fluidsynth_last_soundfont_source", JSON.stringify({ name: source.name, url: source.url || "" }));
      } catch { /* Persistence restrictions must not interrupt playback. */ }
      const selected = active.presets.find(
        (item) => item.bank === previousPreset?.bank && item.program === previousPreset?.program,
      ) ?? active.presets[0];
      if (selected) active.selectPreset(selected);
      active.setVolume(active.volume);
      notifyEngineListeners();
      return result;
    } catch (error) {
      active.soundfontId = null;
      active.presets = [];
      active.selectedPreset = null;
      active.soundfontSource = null;
      notifyEngineListeners();
      throw error;
    }
  })().finally(() => {
    pendingLoad = null;
  });
  return pendingLoad;
}

export const peekFluidSynthEngine = () => engine;
