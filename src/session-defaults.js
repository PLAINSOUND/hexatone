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

import { SETTINGS_REGISTRY } from './persistence/settings-registry.js';
import { sessionInt, sessionFloat, sessionBool, sessionString } from './persistence/storage-utils.js';

// Read one session key using the correct parser for its type.
function restoreSession(entry) {
  switch (entry.type) {
    case 'int':    return sessionInt(entry.key, entry.default);
    case 'float':  return sessionFloat(entry.key, entry.default);
    case 'bool':   return sessionBool(entry.key, entry.default);
    case 'string': return sessionString(entry.key, entry.default);
    // 'joined' arrays are not session-stored (they live in URL/localStorage via useQuery)
    default:       return entry.default;
  }
}

// Special case: output_sample defaults to true, so absent === true (not false).
// The bool helper treats absent as the fallback, so this is already handled
// correctly by the registry entry (default: true). Verified below.

const sessionDefaults = Object.fromEntries(
  SETTINGS_REGISTRY
    .filter(e => e.tier === 'session')
    .map(e => [e.key, restoreSession(e)])
);

export default sessionDefaults;
