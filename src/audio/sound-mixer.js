import { peekFluidSynthEngine } from "../fluidsynth_synth/index.js";
import { REVERB_KEY } from "../fluidsynth_synth/reverb.js";

export const FLUID_VOLUME_KEY = "fluidsynth_internal_volume";
export const OSC_LAYER_KEYS = ["pluck", "buzz", "formant", "saw"].map(layer => "osc_volume_" + layer);
const defaults = new Map([
  ...OSC_LAYER_KEYS.map(key => [key, 0.5]), ["synth_volume", 0.5],
  [FLUID_VOLUME_KEY, 100], [REVERB_KEY, 20],
]);

export const isMixerParameter = key => defaults.has(key);
export function mixerValue(key, value) {
  const number = Number(value ?? defaults.get(key));
  if (!Number.isFinite(number)) return defaults.get(key);
  return key === FLUID_VOLUME_KEY || key === REVERB_KEY
    ? Math.max(0, Math.min(127, Math.round(number)))
    : Math.max(0, Math.min(1, number));
}

export function readMixerValue(key, settings) {
  let stored;
  try { stored = localStorage.getItem(key); } catch { /* Use settings. */ }
  return mixerValue(key, stored ?? settings?.[key]);
}

export function applyMixerParameter(key, value, { sample, layer, recall }) {
  if (key === "synth_volume") return sample?.(value);
  if (key === FLUID_VOLUME_KEY || key === REVERB_KEY) {
    const volume = key === FLUID_VOLUME_KEY;
    recall?.editBankMix({ [volume ? "volume" : "reverb"]: value });
    const engine = peekFluidSynthEngine();
    if (volume) engine?.setVolume?.(value);
    else engine?.setReverb?.(value);
    return;
  }
  layer?.(OSC_LAYER_KEYS.indexOf(key), value);
}
