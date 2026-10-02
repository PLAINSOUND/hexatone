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
  node.onprocessorerror = () => warnLog("FluidSynth AudioWorklet processor error");
  await ready;
  return node;
}

async function installSoundFont(active, source, preset = null) {
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
  return result;
}

async function rebindEngineToContext(context) {
  const nextNode = await createWorkletNode(context);
  const oldNode = engine.node;
  oldNode?.disconnect?.();
  try {
    oldNode?.port?.close?.();
  } catch {
    // The old AudioContext may already have closed its message port.
  }
  engine.context = context;
  engine.node = nextNode;
  if (engine.soundfontSource) {
    const previousPreset = engine.selectedPreset;
    engine.soundfontId = null;
    engine.presets = [];
    engine.selectedPreset = null;
    await installSoundFont(engine, engine.soundfontSource, previousPreset);
  }
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

      engine.output = {
        id: "hexatone-internal-fluidsynth",
        name: "Hexatone FluidSynth",
        send(data) {
          if (!engine?.node || !data?.length) return;
          engine.node.port.postMessage({ type: "midi", data: Array.from(data) });
        },
        ensureAwake: ensureFluidSynthEngineAwake,
      };
      engine.setVolume = (value) => {
        engine.volume = Math.max(0, Math.min(127, Math.round(Number(value) || 0)));
        engine.output.send([0xb0, 7, engine.volume]);
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
  { onDownloadProgress, onDownloadComplete } = {},
) {
  if (!file) throw new Error("Choose a SoundFont file first");
  const active = await getFluidSynthEngine();
  if (pendingLoad) return pendingLoad;
  pendingLoad = (async () => {
    // Keep the File/hosted source object, not another copy of the potentially
    // large bank bytes. iOS may replace the shared AudioContext on recovery,
    // requiring a fresh worklet synth and SoundFont load.
    const source = file;
    const bytes = await source.arrayBuffer(onDownloadProgress);
    onDownloadComplete?.();
    const replacing = active.soundfontId != null;
    const previousPreset = active.selectedPreset;
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
      return result;
    } catch (error) {
      active.soundfontId = null;
      active.presets = [];
      active.selectedPreset = null;
      active.soundfontSource = null;
      throw error;
    }
  })().finally(() => {
    pendingLoad = null;
  });
  return pendingLoad;
}

export const peekFluidSynthEngine = () => engine;
