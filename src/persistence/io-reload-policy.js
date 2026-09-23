/**
 * Separates active I/O restoration from tuning/sequence preset restoration.
 * Selects I/O keys from settings-registry and resets session connection intent when
 * restore is disabled, without deleting saved controller preference profiles.
 */

import { SETTINGS_REGISTRY } from "./settings-registry.js";

export const IO_RESTORE_KEY = "hexatone_restore_io_on_reload";

// Saved controller profiles remain user preferences, not active connections.
export const IO_SETTING_KEYS = new Set(
  SETTINGS_REGISTRY.filter(
    ({ key }) =>
      /^(midi|mono_|mpe_|mts_bulk_|output_|osc_|webmidi_|fluidsynth_|sysex_|exquis_|linnstrument_|hakenaudio_|lumatone_)/.test(
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

export function restoreIOOnReload(storage = localStorage) {
  return storage.getItem(IO_RESTORE_KEY) !== "false";
}

export function applyIOReloadPolicy({
  navigationType = performance.getEntriesByType("navigation")[0]?.type,
  local = localStorage,
  session = sessionStorage,
  location = window.location,
  history = window.history,
} = {}) {
  if (navigationType !== "reload" || restoreIOOnReload(local)) return;
  for (const key of IO_SETTING_KEYS) {
    session.removeItem(key);
    local.removeItem(key);
  }
  // Legacy aliases and sound controls stored outside the settings registry.
  for (const key of [
    "output_direct",
    "direct_device",
    "direct_mode",
    "direct_channel",
    "direct__auto",
    "direct_sysex_auto",
    "direct_device_id",
    "direct_tuning_map_number",
    "direct_tuning_map_name",
  ])
    session.removeItem(key);
  for (const key of ["synth_volume", "synth_muted"]) local.removeItem(key);
  const url = new URL(location.href);
  for (const key of IO_SETTING_KEYS) url.searchParams.delete(key);
  if (url.href !== location.href) history.replaceState({}, "Hexatone WebApp", url);
}
