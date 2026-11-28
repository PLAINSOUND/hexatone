/**
 * Separates active I/O restoration from tuning/sequence preset restoration.
 * Selects I/O keys from settings-registry and resets session connection intent when
 * restore is disabled, without deleting saved controller preference profiles.
 */

import { SETTINGS_REGISTRY } from "./settings-registry.js";

// Legacy preference is a fallback until each new preference has been chosen.
export const IO_RESTORE_KEY = "hexatone_restore_io_on_reload";
export const SOUND_RESTORE_KEY = "hexatone_restore_sound_on_reload";
export const MIDI_RESTORE_KEY = "hexatone_restore_midi_on_reload";
export const PATCH_REARTICULATION_KEY = "hexatone_rearticulate_patch_changes";
export const ACTIVE_SOUND_KEY = "hexatone_active_sound";

// Saved controller profiles remain user preferences, not active connections.
export const IO_SETTING_KEYS = new Set(
  SETTINGS_REGISTRY.filter(
    ({ key }) =>
      /^(midi|mono_|mpe_|mts_bulk_|output_|dsf_|osc_|webmidi_|fluidsynth_|sysex_|exquis_|linnstrument_|hakenaudio_|lumatone_)/.test(
        key,
      ) ||
      [
        "instrument",
        "device_id",
        "tuning_map_number",
        "controller_anchor_note",
        "wheel_to_recent",
        "wheel_scale_aware",
        "tonalplexus_input_mode",
      ].includes(key),
  ).map(({ key }) => key),
);

export const SOUND_SETTING_KEYS = new Set([...IO_SETTING_KEYS].filter(key =>
  /^(dsf_|osc_)/.test(key) ||
  ["output_dsf", "output_sample", "output_fluidsynth", "output_osc", "instrument",
    "fluidsynth_preset", "fluidsynth_runtime_revision"].includes(key)));
export const MIDI_SETTING_KEYS = new Set([...IO_SETTING_KEYS].filter(key => !SOUND_SETTING_KEYS.has(key)));

const restorePreference = (storage, key) =>
  (storage.getItem(key) ?? storage.getItem(IO_RESTORE_KEY)) !== "false";
export const restoreSoundOnReload = (storage = localStorage) => restorePreference(storage, SOUND_RESTORE_KEY);
export const restoreMidiOnReload = (storage = localStorage) => restorePreference(storage, MIDI_RESTORE_KEY);

const SOUND_SESSION_KEY = "hexatone_sound_session";
const soundSessionKeys = [
  ACTIVE_SOUND_KEY, "fluidsynth_last_soundfont_source", "instrument", "output_sample",
  ...SETTINGS_REGISTRY.filter(entry => entry.tier === "session" && SOUND_SETTING_KEYS.has(entry.key) &&
    entry.key !== "fluidsynth_runtime_revision").map(entry => entry.key),
];

export function rememberSoundSession(settings) {
  try {
    if (!restoreSoundOnReload()) {
      localStorage.removeItem(SOUND_SESSION_KEY);
      return;
    }
    const snapshot = {};
    for (const key of soundSessionKeys) {
      const value = settings?.[key] ?? sessionStorage.getItem(key);
      if (value != null) snapshot[key] = String(value);
    }
    localStorage.setItem(SOUND_SESSION_KEY, JSON.stringify(snapshot));
  } catch { /* Keep playback usable when browser storage is unavailable. */ }
}

export function restoreSoundSession() {
  if (!restoreSoundOnReload() || sessionStorage.getItem(ACTIVE_SOUND_KEY) !== null) return;
  try {
    const snapshot = JSON.parse(localStorage.getItem(SOUND_SESSION_KEY));
    for (const key of soundSessionKeys) {
      if (typeof snapshot?.[key] === "string" && sessionStorage.getItem(key) === null)
        sessionStorage.setItem(key, snapshot[key]);
    }
  } catch { /* A missing or unreadable working sound uses the startup defaults. */ }
}

// Compatibility for callers asking whether the entire old I/O setup is restored.
export function restoreIOOnReload(storage = localStorage) {
  return restoreSoundOnReload(storage) && restoreMidiOnReload(storage);
}

export function applyIOReloadPolicy({
  navigationType = performance.getEntriesByType("navigation")[0]?.type,
  local = localStorage,
  session = sessionStorage,
  location = window.location,
  history = window.history,
} = {}) {
  if (navigationType !== "reload") return;
  const resetSounds = !restoreSoundOnReload(local);
  const resetMidi = !restoreMidiOnReload(local);
  if (!resetSounds && !resetMidi) return;
  const keys = new Set([
    ...(resetSounds ? SOUND_SETTING_KEYS : []),
    ...(resetMidi ? MIDI_SETTING_KEYS : []),
  ]);
  for (const key of keys) {
    session.removeItem(key);
    local.removeItem(key);
  }
  if (resetMidi) {
    for (const key of [
      "output_direct", "mono_slide_cc", "direct_device", "direct_mode", "direct_channel",
      "direct__auto", "direct_sysex_auto", "direct_device_id",
      "direct_tuning_map_number", "direct_tuning_map_name",
    ]) session.removeItem(key);
  }
  if (resetSounds) {
    local.removeItem(SOUND_SESSION_KEY);
    session.removeItem(ACTIVE_SOUND_KEY);
    // Clear active sound preferences while retaining sound library references.
    for (const key of [
      "synth_volume", "synth_muted", "fluidsynth_internal_volume",
      "fluidsynth_internal_reverb", "fluidsynth_internal_smoothing",
      "fluidsynth_last_hosted_soundfont", "fluidsynth_last_soundfont_source", "fluidsynth_bank_presets",
    ]) {
      local.removeItem(key);
      session.removeItem(key);
    }
  }
  const url = new URL(location.href);
  for (const key of keys) url.searchParams.delete(key);
  if (url.href !== location.href) history.replaceState({}, "Hexatone WebApp", url);
}
