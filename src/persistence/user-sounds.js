/** Versioned sound-only snapshots. No tuning, MIDI ports, bridge credentials or sample bytes. */
import { SETTINGS_REGISTRY } from "./settings-registry.js";
import { dsfControlsFromSettings } from "../dsf_synth/controls.js";
import { readSampleVolume } from "../audio/sample-volume.js";
import { normalizeFluidSynthSmoothing, readFluidSynthSmoothing } from "../fluidsynth_synth/smoothing.js";
import { readFluidSynthReverb } from "../fluidsynth_synth/reverb.js";

export const USER_SOUNDS_KEY = "hexatone_user_sounds";
const entries = SETTINGS_REGISTRY.filter(({ key }) =>
  key.startsWith("dsf_") || key.startsWith("osc_volume_") ||
  ["output_dsf", "output_sample", "output_fluidsynth", "output_osc", "instrument",
    "osc_brightness", "osc_quick_release", "osc_quick_release_time",
    "osc_quick_release_raster_only", "osc_retrigger_buzz_formant"].includes(key));
const bounded = (value, fallback, low, high) => Number.isFinite(value)
  ? Math.max(low, Math.min(high, value)) : fallback;
const storedNumber = (key, fallback) => {
  const raw = localStorage.getItem(key);
  return raw === null ? fallback : Number(raw);
};

export function normalizeUserSound(record) {
  if (record?.format !== "hexatone-user-sound" || record.version !== 1 ||
      typeof record.name !== "string" || !record.name.trim() || !record.settings ||
      typeof record.settings !== "object") throw new Error("Not a supported Hexatone User Sound.");
  const settings = {};
  for (const entry of entries) {
    const value = record.settings[entry.key] ?? entry.default;
    settings[entry.key] = entry.type === "bool" ? value === true
      : entry.type === "string" ? (typeof value === "string" ? value : entry.default)
      : bounded(value, entry.default, 0, entry.key === "osc_quick_release_time" ? 4 : 1);
  }
  const dsf = dsfControlsFromSettings(record.settings);
  for (const [key, value] of Object.entries(dsf)) settings[`dsf_${key}`] = value;
  const fluid = record.soundfont ?? {};
  return {
    format: "hexatone-user-sound", version: 1, name: record.name.trim().slice(0, 200), settings,
    sampleVolume: bounded(record.sampleVolume, 0.5, 0, 1),
    soundfont: {
      name: typeof fluid.name === "string" ? fluid.name.slice(0, 255) : "",
      preset: /^\d+:\d+$/.test(fluid.preset) ? fluid.preset : "0:0",
      volume: bounded(fluid.volume, 100, 0, 127),
      reverb: bounded(fluid.reverb, 20, 0, 127),
      smoothing: normalizeFluidSynthSmoothing(fluid.smoothing),
    },
  };
}

export function captureUserSound(name, settings, { engine, oscBrightness } = {}) {
  const values = { ...settings };
  for (const entry of entries) {
    if (entry.key.startsWith("osc_") && entry.type !== "bool")
      values[entry.key] = storedNumber(entry.key, values[entry.key] ?? entry.default);
  }
  if (Number.isFinite(oscBrightness)) values.osc_brightness = oscBrightness;
  return normalizeUserSound({
    format: "hexatone-user-sound", version: 1, name, settings: values,
    sampleVolume: readSampleVolume(),
    soundfont: {
      name: engine?.pendingSoundfont?.source?.name ?? engine?.soundfontSource?.name ??
        localStorage.getItem("fluidsynth_last_hosted_soundfont") ?? "",
      preset: engine?.pendingSoundfont?.preferredPreset ?? (engine?.selectedPreset
        ? `${engine.selectedPreset.bank}:${engine.selectedPreset.program}` : settings.fluidsynth_preset),
      volume: engine?.volume ?? storedNumber("fluidsynth_internal_volume", 100),
      reverb: engine?.reverb ?? readFluidSynthReverb(),
      smoothing: engine?.smoothing ?? readFluidSynthSmoothing(),
    },
  });
}

export function parseUserSounds(text) {
  const value = JSON.parse(text);
  const records = Array.isArray(value) ? value : [value];
  if (!records.length) throw new Error("No User Sounds found.");
  return records.map(normalizeUserSound);
}

export function loadUserSounds() {
  try { return parseUserSounds(localStorage.getItem(USER_SOUNDS_KEY) ?? "[]"); }
  catch { return []; }
}
export function saveUserSounds(records) {
  const normalized = records.map(normalizeUserSound);
  localStorage.setItem(USER_SOUNDS_KEY, JSON.stringify(normalized));
  return normalized;
}

// Factory defaults stay independent of saved browser preferences.
export const BUILTIN_USER_SOUNDS = [
  normalizeUserSound({ format: "hexatone-user-sound", version: 1, name: "Default", settings: {} }),
  normalizeUserSound({ format: "hexatone-user-sound", version: 1, name: "Test Tone", settings: {
    output_dsf: true, output_sample: false, output_fluidsynth: false, output_osc: false,
    dsf_volume: 0.5, dsf_timbre: 0, dsf_volumeEnvelope: false, dsf_timbreEnvelope: false,
    dsf_velocityVolume: 0, dsf_velocityTimbre: 0, dsf_velocityAttack: 0,
    dsf_releaseVelocityRelease: 0, dsf_pressure: false, dsf_timbreResponse: false,
  } }),
];
