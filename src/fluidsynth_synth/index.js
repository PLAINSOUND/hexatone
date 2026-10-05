/**
 * Main-thread control bridge for the FluidSynth AudioWorklet.
 * The worklet owns the FluidSynth/WASM instance; this module exposes a virtual
 * MIDI output so Hexatone can reuse its existing MTS allocator and note lifecycle.
 */

import {
  peekSharedAudioContext,
  primeSharedSampleAudio,
  recoverSharedAudioContext,
} from "../sample_synth/prime-shared-audio.js";
import { warnLog } from "../debug/logging.js";

let enginePromise = null;
let engine = null;
let pendingLoad = null;
let wasmBytesPromise = null;
const engineListeners = new Set();

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
  node.connect(context.destination);
  node.onprocessorerror = () => {
    warnLog("FluidSynth AudioWorklet processor error");
  };
  try { await ready; } catch (error) {
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

async function rebindEngineToContext(context) {
  const nextNode = await createWorkletNode(context);
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
    } catch (error) {
      nextNode.disconnect?.();
      try {
        nextNode.port.close?.();
      } catch {
        // The candidate worklet may already have failed or closed its port.
      }
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

  oldNode?.disconnect?.();
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
  if (engine.context === context && engine.node && context.state === "running") {
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
  const currentContext = await peekSharedAudioContext();
  // If another backend has already replaced the shared context, only rebind
  // FluidSynth. Otherwise this is a FluidSynth-only graph, so request the same
  // explicit iOS context recreation the sample backend performs.
  const contextWasAlreadyRebuilt = engine.context !== currentContext;
  const context = await recoverSharedAudioContext({ forceRecreate: !contextWasAlreadyRebuilt });
  if (context !== engine.context || !engine.node || context.state !== "running") {
    await rebindEngineToContext(context);
  }
  return context.state === "running";
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

      let pendingMidi = [];
      let midiFlushScheduled = false;
      const enqueue = (event, timestamp) => {
        if (!engine?.node) return;
        const active = engine;
        const frame = Math.ceil((active.context.currentTime +
          (Number.isFinite(timestamp) ? Math.max(0, timestamp - performance.now()) / 1000 : 0)) * active.context.sampleRate);
        pendingMidi.push({ ...event, frame });
        if (midiFlushScheduled) return;
        midiFlushScheduled = true;
        queueMicrotask(() => {
          midiFlushScheduled = false;
          const events = pendingMidi;
          pendingMidi = [];
          if (engine === active) active.node.port.postMessage({ type: "midi-batch", events });
        });
      };
      engine.output = {
        id: "hexatone-internal-fluidsynth",
        name: "Hexatone FluidSynth",
        sendCommand(command, timestamp) { enqueue({ command }, timestamp); },
        send(data, timestamp) {
          if (!engine?.node || !data?.length) return;
          enqueue({ data: Array.from(data) }, timestamp);
        },
        ensureAwake: ensureFluidSynthEngineAwake,
      };
      engine.setVolume = (value) => {
        engine.volume = Math.max(0, Math.min(127, Math.round(Number(value) || 0)));
        for (let channel = 0; channel < 128; channel++) {
          engine.output.sendCommand({ channel, op: "cc", a: 7, b: engine.volume });
        }
      };
      engine.selectPreset = (preset) => {
        if (!preset || engine.soundfontId == null) return;
        engine.selectedPreset = { bank: preset.bank, program: preset.program };
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
