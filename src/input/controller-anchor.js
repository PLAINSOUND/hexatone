/**
 * input/controller-anchor.js
 *
 * Single source of truth for loading and saving per-controller hardware
 * preferences from/to localStorage.
 *
 * ## Two classes of persistent controller preference:
 *
 *   Per-controller  — keyed as `${controller.id}_${key}` in localStorage.
 *                     Different controllers can have different values.
 *                     Defined in settings-registry.js with `perController: true`.
 *                     Examples: midiin_mpe_input, midiin_bend_flip.
 *
 *   Cross-controller — keyed as plain `key` in localStorage.
 *                     One value shared across all controllers.
 *                     Defined in settings-registry.js with `perController: false`.
 *                     Example: midiin_bend_range.
 *
 * ## Special anchor keys (not in the registry):
 *
 *   `${controller.id}_anchor`         — physical MIDI note number (int)
 *   `${controller.id}_anchor_channel` — MIDI channel for channel-aware
 *                                       controllers such as Lumatone (int)
 *
 *   These predate the registry and use controller-specific fallback logic
 *   (controller.anchorDefault, controller.anchorChannelDefault), so they
 *   are handled by dedicated functions below rather than the generic helpers.
 *
 * ## Adding a new per-controller preference:
 *
 *   1. Add an entry to SETTINGS_REGISTRY in persistence/settings-registry.js
 *      with tier: 'local' and perController: true (or false for cross-controller).
 *   2. That's it — loadControllerPrefs() / saveControllerPref() pick it up
 *      automatically. No changes needed here.
 */

import { PER_CONTROLLER_ENTRIES, CROSS_CONTROLLER_ENTRIES } from '../persistence/settings-registry.js';

// ── Generic registry-driven load/save ─────────────────────────────────────────

/**
 * Parse a raw localStorage string value according to a registry entry type.
 *
 * @param {string} raw     Raw string from localStorage
 * @param {string} type    Registry type: 'bool', 'int', 'float', 'string'
 * @returns {*}
 */
function parseLocalValue(raw, type) {
  if (raw === null || raw === undefined) return undefined;
  switch (type) {
    case 'bool':    return raw === 'true';
    case 'int':     return parseInt(raw, 10);
    case 'float':   return parseFloat(raw);
    default:        return raw; // string
  }
}

/**
 * Load all local-tier preferences for a controller and return a settings
 * update object ready to be merged into app settings.
 *
 * Per-controller prefs: read from `${controller.id}_${key}`.
 *   Falls back to the registry default if never saved.
 *   Special case for midiin_mpe_input: falls back to controller.mpe capability
 *   rather than the registry default (false), so MPE devices default to MPE on.
 *
 * Cross-controller prefs: read from plain `key`.
 *   Falls back to the registry default.
 *
 * @param {object} controller  Registry entry (must have .id)
 * @returns {object}  Partial settings update
 */
export function loadControllerPrefs(controller) {
  const update = {};

  for (const entry of PER_CONTROLLER_ENTRIES) {
    const storageKey = `${controller.id}_${entry.key}`;
    const raw = localStorage.getItem(storageKey);
    if (raw !== null) {
      update[entry.key] = parseLocalValue(raw, entry.type);
    } else {
      // Special fallback: MPE input defaults to device capability, not registry default.
      if (entry.key === 'midiin_mpe_input') {
        update[entry.key] = !!controller.mpe;
      } else {
        update[entry.key] = entry.default;
      }
    }
  }

  for (const entry of CROSS_CONTROLLER_ENTRIES) {
    const raw = localStorage.getItem(entry.key);
    update[entry.key] = raw !== null ? parseLocalValue(raw, entry.type) : entry.default;
  }

  return update;
}

/**
 * Save a single local-tier preference to localStorage.
 *
 * For per-controller keys: stores as `${controller.id}_${key}`.
 * For cross-controller keys: stores as plain `key`.
 *
 * If `key` is not found in the local-tier registry, logs a warning and no-ops.
 *
 * @param {object|null} controller  Registry entry (required for per-controller keys)
 * @param {string}      key         Settings key (must be a local-tier registry entry)
 * @param {*}           value       Value to save
 */
export function saveControllerPref(controller, key, value) {
  const perEntry = PER_CONTROLLER_ENTRIES.find(e => e.key === key);
  if (perEntry) {
    if (!controller) { console.warn(`saveControllerPref: no controller for per-controller key "${key}"`); return; }
    localStorage.setItem(`${controller.id}_${key}`, String(value));
    return;
  }
  const crossEntry = CROSS_CONTROLLER_ENTRIES.find(e => e.key === key);
  if (crossEntry) {
    localStorage.setItem(key, String(value));
    return;
  }
  console.warn(`saveControllerPref: key "${key}" is not a local-tier registry entry`);
}

// ── Anchor note / channel (special — not in the registry) ─────────────────────

/**
 * Load the saved anchor note for a controller from localStorage.
 * Falls back to `controller.anchorDefault` if no value has been saved.
 *
 * @param {object} controller  Registry entry (must have .id and .anchorDefault)
 * @returns {number}
 */
export function loadSavedAnchor(controller) {
  const raw = localStorage.getItem(`${controller.id}_anchor`);
  return raw !== null ? parseInt(raw, 10) : controller.anchorDefault;
}

/**
 * Load the saved anchor channel for a channel-aware controller (e.g. Lumatone).
 * Returns null for single-channel controllers (no anchorChannelDefault).
 *
 * @param {object} controller
 * @returns {number|null}
 */
export function loadSavedAnchorChannel(controller) {
  if (controller.anchorChannelDefault == null) return null;
  const raw = localStorage.getItem(`${controller.id}_anchor_channel`);
  return raw !== null ? parseInt(raw, 10) : controller.anchorChannelDefault;
}

/**
 * Save an anchor note for a controller to localStorage.
 *
 * @param {object} controller
 * @param {number} note
 */
export function saveAnchor(controller, note) {
  localStorage.setItem(`${controller.id}_anchor`, String(note));
}

/**
 * Save an anchor channel for a channel-aware controller.
 * No-op for single-channel controllers.
 *
 * @param {object} controller
 * @param {number} channel
 */
export function saveAnchorChannel(controller, channel) {
  if (controller.anchorChannelDefault == null) return;
  localStorage.setItem(`${controller.id}_anchor_channel`, String(channel));
}

// ── Combined helpers used by call sites ───────────────────────────────────────

/**
 * Build the full settings update to apply when a controller is connected.
 * Called by use-settings-change.js on MIDI input device selection.
 *
 * Merges:
 *   - Anchor note / channel (special, controller-specific fallbacks)
 *   - All local-tier prefs (registry-driven via loadControllerPrefs)
 *   - Fixed MPE voice channel range (if controller defines mpeVoiceChannels)
 *   - Sequential passthrough default (if controller.passthroughDefault)
 *
 * @param {object} controller  Registry entry
 * @returns {object}  Partial settings update
 */
export function loadAnchorSettingsUpdate(controller) {
  const update = {
    midiin_central_degree: loadSavedAnchor(controller),
    // All local-tier prefs (midiin_mpe_input, midiin_bend_flip, midiin_bend_range, …)
    ...loadControllerPrefs(controller),
  };

  const ch = loadSavedAnchorChannel(controller);
  if (ch !== null) update.lumatone_center_channel = ch;

  // Auto-apply fixed MPE voice channel range for controllers that define one.
  if (controller.mpeVoiceChannels) {
    update.midiin_mpe_lo_ch = controller.mpeVoiceChannels.lo;
    update.midiin_mpe_hi_ch = controller.mpeVoiceChannels.hi;
  }

  // Some controllers (e.g. Exquis) default to sequential mode on first connect
  // because 2D geometry requires manual device setup (e.g. Rainbow Layout).
  if (controller.passthroughDefault) {
    update.midi_passthrough = true;
  }

  // Apply controller-specific sequential transposition defaults (e.g. Lumatone:
  // equave transposition + mod-8 wrapping for its 5-block channel layout).
  if ('sequentialTransposeDefault' in controller) {
    update.midiin_steps_per_channel = controller.sequentialTransposeDefault;
  }
  if ('sequentialLegacyDefault' in controller) {
    update.midiin_channel_legacy = controller.sequentialLegacyDefault;
  }

  return update;
}

/**
 * Save all anchor state after a MIDI-learn event and return the settings
 * update to merge. Mirrors loadAnchorSettingsUpdate but writes rather than reads.
 *
 * Used by use-synth-wiring.js in onAnchorLearn.
 *
 * @param {object} controller
 * @param {number} note     Learned anchor note
 * @param {number} channel  Learned anchor channel
 * @returns {object}  Partial settings update
 */
export function saveAnchorFromLearn(controller, note, channel) {
  saveAnchor(controller, note);
  saveAnchorChannel(controller, channel);

  const update = {
    midiin_central_degree: note,
    midiin_anchor_channel: channel,
  };
  if (controller.anchorChannelDefault != null) {
    update.lumatone_center_channel = channel;
    update.lumatone_center_note    = note; // 0–55 within the block for Lumatone
  }
  return update;
}
