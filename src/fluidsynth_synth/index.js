/**
 * Main-thread control bridge for the FluidSynth AudioWorklet.
 * The worklet owns the FluidSynth/WASM instance; this module exposes a virtual
 * MIDI output so Hexatone can reuse its existing MTS allocator and note lifecycle.
 */

import { primeSharedSampleAudio } from "../sample_synth/index.js";
import { warnLog } from "../debug/logging.js";

let enginePromise = null;
let engine = null;
let pendingLoad = null;

const baseUrl = import.meta.env.BASE_URL || "/";

const waitForMessage = (predicate, failOnError = false) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      engine?.node.port.removeEventListener("message", onMessage);
      reject(new Error("FluidSynth AudioWorklet did not respond in time"));
    }, 30000);
    const onMessage = ({ data }) => {
      if (data?.type === "error" && failOnError) {
        clearTimeout(timeout);
        engine?.node.port.removeEventListener("message", onMessage);
        reject(new Error(data.message || "FluidSynth AudioWorklet failed"));
      } else if (predicate(data)) {
        clearTimeout(timeout);
        engine?.node.port.removeEventListener("message", onMessage);
        resolve(data);
      }
    };
    engine?.node.port.addEventListener("message", onMessage);
    engine?.node.port.start();
  });

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
      const wasmBytes = await response.arrayBuffer();
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
      engine = { context, node, soundfontId: null, presets: [], selectedPreset: null, volume: 100 };
      const ready = waitForMessage((message) => message?.type === "ready", true);
      node.connect(context.destination);
      node.onprocessorerror = () => {
        warnLog("FluidSynth AudioWorklet processor error");
      };
      await ready;

      engine.output = {
        id: "hexatone-internal-fluidsynth",
        name: "Hexatone FluidSynth",
        send(data) {
          if (!engine?.node || !data?.length) return;
          engine.node.port.postMessage({ type: "midi", data: Array.from(data) });
        },
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
    const replacing = active.soundfontId != null;
    const bytes = await file.arrayBuffer(onDownloadProgress);
    onDownloadComplete?.();
    active.soundfontId = null;
    active.presets = [];
    active.selectedPreset = null;
    const loaded = waitForMessage((message) => message?.type === "soundfont-loaded", true);
    active.node.port.postMessage(
      { type: replacing ? "replace-soundfont" : "load-soundfont", bytes },
      [bytes],
    );
    try {
      const result = await loaded;
      active.soundfontId = result.soundfontId;
      active.presets = result.presets || [];
      if (active.presets.length) active.selectPreset(active.presets[0]);
      active.setVolume(active.volume);
      return result;
    } catch (error) {
      active.soundfontId = null;
      active.presets = [];
      active.selectedPreset = null;
      throw error;
    }
  })().finally(() => {
    pendingLoad = null;
  });
  return pendingLoad;
}

export const peekFluidSynthEngine = () => engine;
