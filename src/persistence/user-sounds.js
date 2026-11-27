/** Versioned sound-only snapshots. No tuning, MIDI ports, bridge credentials or sample bytes. */
import { SETTINGS_REGISTRY } from "./settings-registry.js";
import { dsfControlsFromSettings } from "../dsf_synth/controls.js";
import { readSampleVolume } from "../audio/sample-volume.js";
import { builtinSoundDefinitions } from "./builtin-user-sounds.js";
import { normalizeFluidSynthSmoothing, readFluidSynthSmoothing } from "../fluidsynth_synth/smoothing.js";
import { readFluidSynthReverb } from "../fluidsynth_synth/reverb.js";

export const USER_SOUNDS_KEY = "hexatone_user_sounds";
const MAX_SOUND_NAME_LENGTH = 200;
const normalizeSoundName = name => name.trim().slice(0, MAX_SOUND_NAME_LENGTH).trimEnd();
const entries = SETTINGS_REGISTRY.filter(({ key }) =>
  key.startsWith("osc_volume_") ||
  ["output_dsf", "output_sample", "output_fluidsynth", "output_osc", "instrument",
    "osc_brightness", "osc_quick_release", "osc_quick_release_time",
    "osc_quick_release_raster_only", "osc_retrigger_buzz_formant"].includes(key));
const bounded = (value, fallback, low, high) => Number.isFinite(value)
  ? Math.max(low, Math.min(high, value)) : fallback;
const storedNumber = (key, fallback) => {
  const raw = localStorage.getItem(key);
  return raw === null ? fallback : Number(raw);
};
const matchesSoundfontReference = (current, reference) =>
  !!reference && current.name === reference.name && current.preset === reference.preset;

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
    format: "hexatone-user-sound", version: 1, name: normalizeSoundName(record.name), settings,
    description: typeof record.description === "string" ? record.description : "",
    sampleVolume: bounded(record.sampleVolume, 0.5, 0, 1),
    soundfont: {
      name: typeof fluid.name === "string" ? fluid.name.slice(0, 255) : "",
      preset: /^\d+:\d+$/.test(fluid.preset) ? fluid.preset : "0:0",
      ...(typeof fluid.fallback?.name === "string" && fluid.fallback.name ? { fallback: {
        name: fluid.fallback.name.slice(0, 255),
        preset: /^\d+:\d+$/.test(fluid.fallback.preset) ? fluid.fallback.preset : "0:0",
      } } : {}),
      volume: bounded(fluid.volume, 100, 0, 127),
      reverb: bounded(fluid.reverb, 20, 0, 127),
      smoothing: normalizeFluidSynthSmoothing(fluid.smoothing),
    },
  };
}

export function captureUserSound(name, settings, { engine, description = "", referenceSoundfont } = {}) {
  const values = { ...settings };
  for (const entry of entries) {
    if (entry.key.startsWith("osc_") && entry.type !== "bool")
      values[entry.key] = storedNumber(entry.key, values[entry.key] ?? entry.default);
  }
  const source = engine?.pendingSoundfont?.source ?? engine?.soundfontSource;
  const soundfont = {
      name: source?.name ??
        localStorage.getItem("fluidsynth_last_hosted_soundfont") ?? "",
      preset: engine?.pendingSoundfont?.preferredPreset ?? (engine?.selectedPreset
        ? `${engine.selectedPreset.bank}:${engine.selectedPreset.program}` : settings.fluidsynth_preset),
      volume: engine?.volume ?? storedNumber("fluidsynth_internal_volume", 100),
      reverb: engine?.reverb ?? readFluidSynthReverb(),
      smoothing: engine?.smoothing ?? readFluidSynthSmoothing(),
  };
  // A disabled engine keeps its previous bank warm. Capture the selected
  // sound's intended bank instead, for dirty checks, saving and export alike.
  if (referenceSoundfont && (settings.output_fluidsynth === false || !source)) {
    soundfont.name = referenceSoundfont.name;
    soundfont.preset = settings.output_fluidsynth === false ? referenceSoundfont.preset
      : settings.fluidsynth_preset ?? referenceSoundfont.preset;
  }
  if (referenceSoundfont?.fallback &&
      (matchesSoundfontReference(soundfont, referenceSoundfont) ||
        matchesSoundfontReference(soundfont, referenceSoundfont.fallback))) {
    soundfont.name = referenceSoundfont.name;
    soundfont.preset = referenceSoundfont.preset;
    soundfont.fallback = referenceSoundfont.fallback;
  }
  return normalizeUserSound({
    format: "hexatone-user-sound", version: 1, name, description, settings: values,
    sampleVolume: readSampleVolume(), soundfont,
  });
}

const sameFields = (left, right) => Object.keys(right).every(key => Object.is(left[key], right[key]));

// Compare musical state, accepting the selected sound's equivalent backup
// bank. No serialization or property-order dependency on the fader path.
export function userSoundHasChanges(current, saved) {
  if (!sameFields(current.settings, saved.settings) || current.name !== saved.name ||
      current.description !== saved.description || current.sampleVolume !== saved.sampleVolume) return true;
  const referenceMatches = matchesSoundfontReference(current.soundfont, saved.soundfont) ||
    matchesSoundfontReference(current.soundfont, saved.soundfont.fallback);
  return !referenceMatches || !sameFields(current.soundfont.smoothing, saved.soundfont.smoothing) ||
    ["volume", "reverb"].some(key => current.soundfont[key] !== saved.soundfont[key]);
}

export function parseUserSounds(text) {
  const value = JSON.parse(text);
  const records = Array.isArray(value) ? value : [value];
  if (!records.length) throw new Error("No User Sounds found.");
  return records.map(normalizeUserSound);
}

export function availableUserSoundName(base, records) {
  const name = normalizeSoundName(base);
  const used = new Set(records.map(record => record.name));
  if (!used.has(name)) return name;
  for (let suffix = 2; ; suffix++) {
    const ending = ` ${suffix}`;
    const candidate = `${name.slice(0, MAX_SOUND_NAME_LENGTH - ending.length).trimEnd()}${ending}`;
    if (!used.has(candidate)) return candidate;
  }
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

export const BUILTIN_USER_SOUNDS = builtinSoundDefinitions().map(record =>
  normalizeUserSound({ format: "hexatone-user-sound", version: 1, ...record }));
