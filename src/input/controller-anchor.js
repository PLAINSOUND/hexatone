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
      // First-connect fallbacks: use device capability rather than registry default
      // when nothing has been explicitly saved for this controller yet.
      if (entry.key === 'midiin_mpe_input') {
        update[entry.key] = !!controller.mpe;
      } else if (entry.key === 'midi_passthrough') {
        update[entry.key] = !!controller.passthroughDefault;
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

// ── Sequential anchor helpers (for passthrough/sequential mode) ─────────────────

/**
 * Load the saved sequential anchor note for a controller from localStorage.
 * Falls back to `controller.anchorDefault` if no value has been saved.
 *
 * @param {object} controller  Registry entry
 * @returns {number}
 */
export function loadSavedSeqAnchor(controller) {
  const raw = localStorage.getItem(`${controller.id}_seq_anchor`);
  return raw !== null ? parseInt(raw, 10) : controller.anchorDefault;
}

/**
 * Load the saved sequential anchor channel for a controller from localStorage.
 * Falls back to `controller.anchorChannelDefault` if no value has been saved.
 *
 * @param {object} controller
 * @returns {number|null}
 */
export function loadSavedSeqAnchorChannel(controller) {
  if (controller.anchorChannelDefault == null) return null;
  const raw = localStorage.getItem(`${controller.id}_seq_anchor_channel`);
  return raw !== null ? parseInt(raw, 10) : controller.anchorChannelDefault;
}

/**
 * Save a sequential anchor note for a controller to localStorage.
 *
 * @param {object} controller
 * @param {number} note
 */
export function saveSeqAnchor(controller, note) {
  localStorage.setItem(`${controller.id}_seq_anchor`, String(note));
}

/**
 * Save a sequential anchor channel for a channel-aware controller.
 * No-op for single-channel controllers.
 *
 * @param {object} controller
 * @param {number} channel
 */
export function saveSeqAnchorChannel(controller, channel) {
  if (controller.anchorChannelDefault == null) return;
  localStorage.setItem(`${controller.id}_seq_anchor_channel`, String(channel));
}

// ── Learn validation ────────────────────────────────────────────────────────────

/**
 * Validate a learned note/channel against controller constraints.
 * Used in 2D geometry mode to ensure learned values are within valid ranges.
 *
 * @param {object} controller  Registry entry
 * @param {number} note        Learned note
 * @param {number} channel     Learned channel
 * @returns {{ valid: boolean, warning: string|null }}
 */
export function validateLearn(controller, note, channel) {
  const c = controller.learnConstraints;
  if (!c) return { valid: true, warning: null };

  const noteOk = note >= c.noteRange.min && note <= c.noteRange.max;
  const chOk = !c.channelRange || (channel >= c.channelRange.min && channel <= c.channelRange.max);

  if (!noteOk || !chOk) {
    let msg = `Note must be ${c.noteRange.min}–${c.noteRange.max}.`;
    if (c.channelRange) {
      msg += ` Channel must be ${c.channelRange.min}–${c.channelRange.max}.`;
    }
    if (c.multiChannel) {
      msg = `Please send the 2D ${controller.name} Layout File to your device!`;
    }
    return { valid: false, warning: msg };
  }
  return { valid: true, warning: null };
}

// ── Combined helpers used by call sites ───────────────────────────────────────

/**
 * Build the full settings update to apply when a controller is connected.
 * Called from use-synth-wiring.js whenever (midi, midiin_device) resolves to
 * a known controller — on page refresh, device selection, or reconnect.
 *
 * Merges:
 *   - Sequential mode anchors (midiin_central_degree, midiin_anchor_channel)
 *   - 2D geometry anchors (lumatone_center_note, lumatone_center_channel)
 *   - All local-tier prefs (registry-driven via loadControllerPrefs)
 *     midi_passthrough and midiin_mpe_input use first-connect fallbacks
 *     (controller.passthroughDefault, controller.mpe) when nothing is saved.
 *   - Fixed MPE voice channel range (if controller defines mpeVoiceChannels)
 *
 * @param {object} controller  Registry entry
 * @returns {object}  Partial settings update
 */
export function loadAnchorSettingsUpdate(controller) {
  const update = {
    // Sequential mode anchors (loaded from per-controller localStorage)
    midiin_central_degree:    loadSavedSeqAnchor(controller),
    midiin_anchor_channel:    loadSavedSeqAnchorChannel(controller) ?? 1,
    // 2D geometry anchors (loaded from per-controller localStorage)
    lumatone_center_note:      loadSavedAnchor(controller),
    lumatone_center_channel:   loadSavedAnchorChannel(controller),
    // All local-tier prefs — includes midi_passthrough and midiin_mpe_input
    // with their first-connect fallbacks handled inside loadControllerPrefs.
    ...loadControllerPrefs(controller),
    // Fixed MPE voice channel range
    ...(controller.mpeVoiceChannels ? {
      midiin_mpe_lo_ch: controller.mpeVoiceChannels.lo,
      midiin_mpe_hi_ch: controller.mpeVoiceChannels.hi,
    } : {}),
    // Sequential defaults
    ...('sequentialTransposeDefault' in controller ? {
      midiin_steps_per_channel: controller.sequentialTransposeDefault,
    } : {}),
    ...('sequentialLegacyDefault' in controller ? {
      midiin_channel_legacy: controller.sequentialLegacyDefault,
    } : {}),
  };

  return update;
}

/**
 * Save all anchor state after a MIDI-learn event and return the settings
 * update to merge.
 *
 * Mode-aware: in sequential mode, stores arbitrary MIDI values. In 2D geometry
 * mode, validates against controller constraints and returns a warning if invalid.
 *
 * Used by use-synth-wiring.js in onAnchorLearn.
 *
 * @param {object}  controller     Registry entry
 * @param {number}  note           Learned anchor note
 * @param {number}  channel        Learned anchor channel
 * @param {boolean} isSequential   True if in sequential/passthrough mode
 * @returns {{ update: object|null, warning: string|null }}
 */
export function saveAnchorFromLearn(controller, note, channel, isSequential) {
  // Validate against controller constraints in 2D geometry mode
  if (!isSequential) {
    const validation = validateLearn(controller, note, channel);
    if (!validation.valid) {
      return { update: null, warning: validation.warning };
    }
  }

  if (isSequential) {
    // Sequential mode: store arbitrary MIDI values
    saveSeqAnchor(controller, note);
    saveSeqAnchorChannel(controller, channel);
    return {
      update: { midiin_central_degree: note, midiin_anchor_channel: channel },
      warning: null,
    };
  }

  // 2D geometry mode: validated, store geometry anchors
  if (controller.multiChannel) {
    saveAnchor(controller, note);
    saveAnchorChannel(controller, channel);
    return {
      update: { lumatone_center_note: note, lumatone_center_channel: channel },
      warning: null,
    };
  } else {
    saveAnchor(controller, note);
    return { update: { midiin_central_degree: note }, warning: null };
  }
}
