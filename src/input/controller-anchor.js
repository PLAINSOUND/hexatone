/* eslint-disable no-console */
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

import {
  PER_CONTROLLER_ENTRIES,
  CROSS_CONTROLLER_ENTRIES,
} from "../persistence/settings-registry.js";

function isModeAwareController(controller) {
  return !!controller?.modes && typeof controller?.resolveMode === "function";
}

function getModeStorageKey(controller) {
  return `${controller.id}__active_mode`;
}

function getModeScopedStorageKey(controller, modeKey, key) {
  return `${controller.id}__${modeKey}__${key}`;
}

function getLegacyStorageKey(controller, key) {
  return `${controller.id}_${key}`;
}

function getModeDefault(controller, modeKey, key) {
  return controller?.modes?.[modeKey]?.defaultPrefs?.[key];
}

export function getControllerMode(
  controller,
  settings = null,
  overrides = null,
  { preferStored = true } = {},
) {
  if (!isModeAwareController(controller)) return "default";

  const merged = { ...(settings || {}), ...(overrides || {}) };
  if (!preferStored) {
    const resolved = controller.resolveMode(merged);
    if (resolved && controller.modes[resolved]) return resolved;
  }

  const stored = localStorage.getItem(getModeStorageKey(controller));
  if (preferStored && stored && controller.modes[stored]) return stored;

  // No stored mode — try resolving from live settings before falling back
  // to defaultMode. This handles first-connect where the stored mode is absent
  // but the current settings already indicate a non-default mode (e.g.
  // midi_passthrough: true → bypass).
  const resolved = controller.resolveMode(merged);
  if (resolved && controller.modes[resolved]) return resolved;

  if (controller.defaultMode && controller.modes[controller.defaultMode]) {
    return controller.defaultMode;
  }

  return Object.keys(controller.modes)[0] ?? "default";
}

export function saveControllerMode(controller, modeKey) {
  if (!isModeAwareController(controller)) return;
  if (!modeKey || !controller.modes?.[modeKey]) return;
  localStorage.setItem(getModeStorageKey(controller), modeKey);
}

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
    case "bool":
      return raw === "true";
    case "int":
      return parseInt(raw, 10);
    case "float":
      return parseFloat(raw);
    default:
      return raw; // string
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
 * @param {object|null} settings
 * @param {object} [opts]
 * @param {boolean} [opts.preferStored=true]  When false, resolve mode from live
 *   settings rather than stored active mode (use when settings is authoritative).
 * @returns {object}  Partial settings update
 */
export function loadControllerPrefs(controller, settings = null, { preferStored = true } = {}) {
  const update = {};
  const modeKey = getControllerMode(controller, settings, null, { preferStored });

  for (const entry of PER_CONTROLLER_ENTRIES) {
    const raw = isModeAwareController(controller)
      ? (localStorage.getItem(getModeScopedStorageKey(controller, modeKey, entry.key)) ??
        localStorage.getItem(getLegacyStorageKey(controller, entry.key)))
      : localStorage.getItem(getLegacyStorageKey(controller, entry.key));

    if (raw !== null) {
      update[entry.key] = parseLocalValue(raw, entry.type);
    } else {
      const modeDefault = getModeDefault(controller, modeKey, entry.key);
      // First-connect fallbacks: use device capability rather than registry default
      // when nothing has been explicitly saved for this controller yet.
      if (modeDefault !== undefined) {
        update[entry.key] = modeDefault;
      } else if (entry.key === "midiin_mpe_input") {
        update[entry.key] = !!controller.mpe;
      } else if (entry.key === "midi_passthrough") {
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
export function saveControllerPref(controller, key, value, settings = null, overrides = null) {
  const perEntry = PER_CONTROLLER_ENTRIES.find((e) => e.key === key);
  if (perEntry) {
    if (!controller) {
      console.warn(`saveControllerPref: no controller for per-controller key "${key}"`);
      return;
    }
    const modeKey = getControllerMode(controller, settings, overrides, { preferStored: false });
    if (isModeAwareController(controller)) {
      localStorage.setItem(getModeScopedStorageKey(controller, modeKey, key), String(value));
      saveControllerMode(controller, modeKey);
    } else {
      localStorage.setItem(getLegacyStorageKey(controller, key), String(value));
    }
    return;
  }
  const crossEntry = CROSS_CONTROLLER_ENTRIES.find((e) => e.key === key);
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
 * @param {object|null} settings
 * @param {object} [opts]
 * @param {boolean} [opts.preferStored=true]  When false, resolve mode from live
 *   settings rather than stored active mode.
 * @returns {number}
 */
export function loadSavedAnchor(controller, settings = null, { preferStored = true } = {}) {
  const modeKey = getControllerMode(controller, settings, null, { preferStored });
  const raw = isModeAwareController(controller)
    ? (localStorage.getItem(getModeScopedStorageKey(controller, modeKey, "anchor")) ??
      localStorage.getItem(getLegacyStorageKey(controller, "anchor")))
    : localStorage.getItem(getLegacyStorageKey(controller, "anchor"));
  if (raw !== null) return parseInt(raw, 10);
  return getModeDefault(controller, modeKey, "anchorNote") ?? controller.anchorDefault;
}

/**
 * Load the saved anchor channel for a channel-aware controller (e.g. Lumatone).
 * Returns null for single-channel controllers (no anchorChannelDefault).
 *
 * @param {object} controller
 * @param {object|null} settings
 * @param {object} [opts]
 * @param {boolean} [opts.preferStored=true]  When false, resolve mode from live
 *   settings rather than stored active mode.
 * @returns {number|null}
 */
export function loadSavedAnchorChannel(controller, settings = null, { preferStored = true } = {}) {
  if (controller.anchorChannelDefault == null) return null;
  const modeKey = getControllerMode(controller, settings, null, { preferStored });
  const raw = isModeAwareController(controller)
    ? (localStorage.getItem(getModeScopedStorageKey(controller, modeKey, "anchor_channel")) ??
      localStorage.getItem(getLegacyStorageKey(controller, "anchor_channel")))
    : localStorage.getItem(getLegacyStorageKey(controller, "anchor_channel"));
  if (raw !== null) return parseInt(raw, 10);
  return getModeDefault(controller, modeKey, "anchorChannel") ?? controller.anchorChannelDefault;
}

/**
 * Save an anchor note for a controller to localStorage.
 *
 * @param {object} controller
 * @param {number} note
 */
export function saveAnchor(controller, note, settings = null, overrides = null) {
  const modeKey = getControllerMode(controller, settings, overrides, { preferStored: false });
  if (isModeAwareController(controller)) {
    localStorage.setItem(getModeScopedStorageKey(controller, modeKey, "anchor"), String(note));
    saveControllerMode(controller, modeKey);
    return;
  }
  localStorage.setItem(getLegacyStorageKey(controller, "anchor"), String(note));
}

/**
 * Save an anchor channel for a channel-aware controller.
 * No-op for single-channel controllers.
 *
 * @param {object} controller
 * @param {number} channel
 */
export function saveAnchorChannel(controller, channel, settings = null, overrides = null) {
  if (controller.anchorChannelDefault == null) return;
  const modeKey = getControllerMode(controller, settings, overrides, { preferStored: false });
  if (isModeAwareController(controller)) {
    localStorage.setItem(
      getModeScopedStorageKey(controller, modeKey, "anchor_channel"),
      String(channel),
    );
    saveControllerMode(controller, modeKey);
    return;
  }
  localStorage.setItem(getLegacyStorageKey(controller, "anchor_channel"), String(channel));
}

// ── Combined helpers used by call sites ───────────────────────────────────────

/**
 * Build the full settings update to apply when a controller is connected.
 * Called from use-synth-wiring.js whenever (midi, midiin_device) resolves to
 * a known controller — on page refresh, device selection, or reconnect.
 *
 * Merges:
 *   - Anchor note / channel (special, controller-specific fallbacks)
 *   - All local-tier prefs (registry-driven via loadControllerPrefs)
 *     midi_passthrough and midiin_mpe_input use first-connect fallbacks
 *     (controller.passthroughDefault, controller.mpe) when nothing is saved.
 *   - Fixed MPE voice channel range (if controller defines mpeVoiceChannels)
 *
 * @param {object} controller  Registry entry
 * @returns {object}  Partial settings update
 */
export function loadAnchorSettingsUpdate(controller, settings = null) {
  // When live settings are available, resolve the mode from them (e.g. from
  // midi_passthrough) rather than from the stored active mode, which may
  // reflect a previous session in a different mode.
  const preferStored = settings === null;
  const update = {
    midiin_central_degree: loadSavedAnchor(controller, settings, { preferStored }),
    // All local-tier prefs — includes midi_passthrough and midiin_mpe_input
    // with their first-connect fallbacks handled inside loadControllerPrefs.
    ...loadControllerPrefs(controller, settings, { preferStored }),
  };

  const ch = loadSavedAnchorChannel(controller, settings, { preferStored });
  if (ch !== null) {
    // midiin_anchor_channel drives the channel-offset formula in channelToStepsOffset()
    // for all layouts (sequential, passthrough). Must match the loaded anchor channel
    // so that (incomingChannel - anchorChannel) evaluates to 0 at the anchor position.
    update.midiin_anchor_channel = ch;
    update.lumatone_center_channel = ch;
    // lumatone_center_note is the block-local anchor note (0–55), which is the
    // same value loadSavedAnchor returned above. Populate it here so Keys has
    // both fields correctly set without relying on session-scoped stale defaults.
    update.lumatone_center_note = update.midiin_central_degree;
  } else {
    // Single-channel controllers must actively clear any stale anchor-channel
    // state left by a previously connected multichannel controller.
    update.midiin_anchor_channel = 1;
  }

  // Auto-apply fixed MPE voice channel range for controllers that define one.
  if (controller.mpeVoiceChannels) {
    update.midiin_mpe_lo_ch = controller.mpeVoiceChannels.lo;
    update.midiin_mpe_hi_ch = controller.mpeVoiceChannels.hi;
  }

  // Apply controller-specific sequential transposition defaults (e.g. Lumatone:
  // equave transposition + mod-8 wrapping for its 5-block channel layout).
  // Skip in bypass mode — the controller is acting as a plain MIDI device and
  // channel-based transposition would produce wrong pitches.
  const activeMode = getControllerMode(controller, settings, null, { preferStored });
  const isLayout = !isModeAwareController(controller) || activeMode !== "bypass";
  if (isLayout) {
    if ("sequentialTransposeDefault" in controller) {
      update.midiin_steps_per_channel = controller.sequentialTransposeDefault;
    }
    if ("sequentialChannelGroupSize" in controller) {
      update.midiin_channel_group_size = controller.sequentialChannelGroupSize;
    }
    if ("sequentialLegacyDefault" in controller) {
      update.midiin_channel_legacy = controller.sequentialLegacyDefault;
    }
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
export function saveAnchorFromLearn(controller, note, channel, settings = null, overrides = null) {
  saveAnchor(controller, note, settings, overrides);
  saveAnchorChannel(controller, channel, settings, overrides);

  const update = {
    midiin_central_degree: note,
    midiin_anchor_channel: channel,
  };
  if (controller.anchorChannelDefault != null) {
    update.lumatone_center_channel = channel;
    update.lumatone_center_note = note; // 0–55 within the block for Lumatone
  }
  return update;
}
