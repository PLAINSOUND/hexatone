/**
 * Session-scoped output/input settings.
 *
 * Restored from sessionStorage on every page load so device choices survive
 * tab refresh without polluting the URL or localStorage.
 *
 * Generated from SETTINGS_REGISTRY entries where tier === 'session'.
 * Runtime-only keys (axis49_center_note, lumatone_center_channel, etc.) are
 * NOT included here — they live as plain defaults in preset_values.js or are
 * set imperatively when a controller is detected.
 *
 * Keys also in PRESET_SKIP_KEYS act as fallback defaults when no preset is
 * loaded.
 */

import { SETTINGS_REGISTRY, CROSS_CONTROLLER_ENTRIES } from "./persistence/settings-registry.js";
import {
  sessionInt,
  sessionFloat,
  sessionBool,
  sessionString,
  localInt,
  localFloat,
  localBool,
  localString,
} from "./persistence/storage-utils.js";

// Read one session key using the correct parser for its type.
function restoreSession(entry) {
  switch (entry.type) {
    case "int":
      return sessionInt(entry.key, entry.default);
    case "float":
      return sessionFloat(entry.key, entry.default);
    case "bool":
      return sessionBool(entry.key, entry.default);
    case "string":
      return sessionString(entry.key, entry.default);
    // 'joined' arrays are not session-stored (they live in URL/localStorage via useQuery)
    default:
      return entry.default;
  }
}

// Read one cross-controller local key from localStorage.
function restoreLocal(entry) {
  switch (entry.type) {
    case "int":
      return localInt(entry.key, entry.default);
    case "float":
      return localFloat(entry.key, entry.default);
    case "bool":
      return localBool(entry.key, entry.default);
    case "string":
      return localString(entry.key, entry.default);
    default:
      return entry.default;
  }
}

const sessionDefaults = {
  // Session-scoped keys (sessionStorage) — device/output choices.
  ...Object.fromEntries(
    SETTINGS_REGISTRY.filter((e) => e.tier === "session").map((e) => [e.key, restoreSession(e)]),
  ),
  // Cross-controller local keys (localStorage, not per-controller) — restored
  // here so they are available immediately on page load without waiting for the
  // user to select a MIDI device (which is when loadControllerPrefs normally fires).
  ...Object.fromEntries(CROSS_CONTROLLER_ENTRIES.map((e) => [e.key, restoreLocal(e)])),
};

export default sessionDefaults;
