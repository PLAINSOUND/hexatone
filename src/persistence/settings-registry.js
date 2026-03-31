/**
 * persistence/settings-registry.js
 *
 * Canonical registry of all Hexatone settings keys.
 *
 * Every key that appears in useQuery's spec, session-defaults, or anywhere
 * else in the persistence layer should have an entry here.
 *
 * ## Tiers
 *
 *   'url'      — synced to URL search params AND localStorage.
 *                Survives browser restart and can be shared as a link.
 *                These are the keys passed to useQuery's spec object.
 *
 *   'session'  — stored in sessionStorage only.
 *                Survives tab refresh but not a new tab/window.
 *                These are the keys in session-defaults.js.
 *
 *   'local'    — stored in localStorage only (not in URL).
 *                Survives browser restart but not shareable.
 *                Used for per-controller hardware preferences.
 *
 *   'runtime'  — never stored anywhere.
 *                Always derived from defaults at startup.
 *                Must not be written to any browser storage.
 *
 * ## Types
 *
 *   'int'    — integer, parsed with parseInt
 *   'float'  — float, parsed with parseFloat
 *   'bool'   — boolean, parsed as === "true"
 *   'string' — string, no parsing
 *   'joined' — comma-joined array (ExtractJoinedString)
 *
 * ## Preset skip
 *
 *   presetSkip: true  — key is excluded from URL/localStorage persistence
 *                       (matches PRESET_SKIP_KEYS in use-presets.js).
 *                       Only populated by explicit preset load or session storage.
 */

export const SETTINGS_REGISTRY = [

  // ── Preset metadata ─────────────────────────────────────────────────────────
  { key: 'name',              tier: 'url',     type: 'string',  default: '',    presetSkip: true },
  { key: 'description',       tier: 'url',     type: 'string',  default: '',    presetSkip: true },
  { key: 'short_description', tier: 'session', type: 'string',  default: '' },

  // ── Scale / tuning ───────────────────────────────────────────────────────────
  { key: 'scale',             tier: 'url',     type: 'joined',  default: null,  presetSkip: true },
  { key: 'note_names',        tier: 'url',     type: 'joined',  default: null,  presetSkip: true },
  { key: 'note_colors',       tier: 'url',     type: 'joined',  default: null,  presetSkip: true },
  { key: 'equivSteps',        tier: 'url',     type: 'int',     default: 12,    presetSkip: true },
  { key: 'reference_degree',  tier: 'url',     type: 'int',     default: 0,     presetSkip: true },
  { key: 'fundamental',       tier: 'url',     type: 'float',   default: 260.740741 },
  { key: 'spectrum_colors',   tier: 'url',     type: 'bool',    default: true,  presetSkip: true },
  { key: 'fundamental_color', tier: 'url',     type: 'string',  default: '#f2e3e3', presetSkip: true },
  { key: 'key_labels',        tier: 'url',     type: 'string',  default: 'no_labels', presetSkip: true },
  { key: 'retuning_mode',     tier: 'url',     type: 'string',  default: 'recalculate_reference' },

  // ── Layout / grid ────────────────────────────────────────────────────────────
  { key: 'rSteps',            tier: 'url',     type: 'int',     default: 2,     presetSkip: true },
  { key: 'drSteps',           tier: 'url',     type: 'int',     default: 1,     presetSkip: true },
  { key: 'center_degree',     tier: 'url',     type: 'int',     default: 0,     presetSkip: true },
  { key: 'hexSize',           tier: 'url',     type: 'int',     default: 42,    presetSkip: true },
  { key: 'rotation',          tier: 'url',     type: 'float',   default: -16.102113751, presetSkip: true },

  // ── MIDI input ───────────────────────────────────────────────────────────────
  { key: 'midiin_device',           tier: 'session', type: 'string', default: 'OFF' },
  { key: 'midiin_channel',          tier: 'session', type: 'int',    default: 0 },
  { key: 'midiin_steps_per_channel',tier: 'session', type: 'int',    default: 0 },
  { key: 'midiin_anchor_channel',   tier: 'session', type: 'int',    default: 1 },
  { key: 'controller_anchor_note',  tier: 'session', type: 'int',    default: null },
  { key: 'midiin_channel_legacy',   tier: 'session', type: 'bool',   default: false },
  { key: 'midi_passthrough',        tier: 'session', type: 'bool',   default: false },
  { key: 'midiin_central_degree',   tier: 'session', type: 'int',    default: null },
  // Input runtime mode keys
  { key: 'midiin_mapping_target',   tier: 'session', type: 'string', default: 'hex_layout' },
  { key: 'midiin_mpe_input',        tier: 'session', type: 'bool',   default: false },
  // MPE input voice channel range. Channels 1 and 16 are typically reserved
  // (manager/global channel per MPE spec), so the default voice range is 2–15.
  { key: 'midiin_mpe_lo_ch',        tier: 'session', type: 'int',    default: 2 },
  { key: 'midiin_mpe_hi_ch',        tier: 'session', type: 'int',    default: 15 },
  { key: 'midiin_scale_tolerance',  tier: 'url',     type: 'int',    default: 50 },
  { key: 'midiin_pitchbend_mode',   tier: 'session', type: 'string', default: 'recency' },
  { key: 'midiin_pressure_mode',    tier: 'session', type: 'string', default: 'recency' },

  // ── Controller anchors (hardware-scoped, survive device disconnect) ──────────
  // These are keyed dynamically as "${controllerId}_anchor" in localStorage.
  // Listed here as a documentation anchor for the local tier; not used directly
  // by the registry loop since the key name is runtime-derived.
  // { key: '${controllerId}_anchor',         tier: 'local', type: 'int' },
  // { key: '${controllerId}_anchor_channel', tier: 'local', type: 'int' },

  // ── Sample synth ─────────────────────────────────────────────────────────────
  { key: 'output_sample',   tier: 'session', type: 'bool',   default: true },
  { key: 'instrument',      tier: 'session', type: 'string', default: 'HvP8_retuned' },

  // ── MTS real-time output ──────────────────────────────────────────────────────
  { key: 'output_mts',        tier: 'session', type: 'bool',   default: false },
  { key: 'midi_device',       tier: 'session', type: 'string', default: 'OFF' },
  { key: 'midi_channel',      tier: 'session', type: 'int',    default: 0 },
  { key: 'midi_mapping',      tier: 'session', type: 'string', default: 'MTS1' },
  { key: 'midi_velocity',     tier: 'session', type: 'int',    default: 72 },
  { key: 'sysex_auto',        tier: 'session', type: 'bool',   default: false },
  { key: 'sysex_type',        tier: 'session', type: 'int',    default: 126 },
  { key: 'device_id',         tier: 'session', type: 'int',    default: 127 },
  { key: 'tuning_map_number', tier: 'session', type: 'int',    default: 0 },

  // ── MTS bulk dump output (dynamic + static) ───────────────────────────────────
  { key: 'output_direct',            tier: 'session', type: 'bool',   default: false },
  { key: 'direct_device',            tier: 'session', type: 'string', default: 'OFF' },
  { key: 'direct_mode',              tier: 'session', type: 'string', default: 'dynamic' },
  { key: 'direct_channel',           tier: 'session', type: 'int',    default: -1 },
  { key: 'direct_sysex_auto',        tier: 'session', type: 'bool',   default: false },
  { key: 'direct_device_id',         tier: 'session', type: 'int',    default: 127 },
  { key: 'direct_tuning_map_number', tier: 'session', type: 'int',    default: 0 },
  { key: 'direct_tuning_map_name',   tier: 'session', type: 'string', default: null },

  // ── MPE output ────────────────────────────────────────────────────────────────
  { key: 'output_mpe',                  tier: 'session', type: 'bool',   default: false },
  { key: 'mpe_device',                  tier: 'session', type: 'string', default: 'OFF' },
  { key: 'mpe_manager_ch',             tier: 'session', type: 'string', default: '1' },
  { key: 'mpe_lo_ch',                   tier: 'session', type: 'int',    default: 2 },
  { key: 'mpe_hi_ch',                   tier: 'session', type: 'int',    default: 8 },
  { key: 'mpe_mode',                    tier: 'session', type: 'string', default: 'Ableton_workaround' },
  { key: 'mpe_pitchbend_range',         tier: 'session', type: 'int',    default: 48 },
  { key: 'mpe_pitchbend_range_manager', tier: 'session', type: 'int',    default: 2 },

  // ── FluidSynth / OSC mirror ───────────────────────────────────────────────────
  { key: 'fluidsynth_device',  tier: 'session', type: 'string', default: '' },
  { key: 'fluidsynth_channel', tier: 'session', type: 'int',    default: -1 },
  { key: 'output_osc',         tier: 'session', type: 'bool',   default: false },
  { key: 'osc_bridge_url',     tier: 'session', type: 'string', default: 'ws://localhost:8089' },

  // ── Controller geometry (runtime-derived, never stored) ───────────────────────
  // These are computed from the detected controller at startup; persisting them
  // would cause stale values if the user swaps controllers between sessions.
  { key: 'axis49_center_note',     tier: 'runtime', type: 'int',  default: 53 },
  { key: 'lumatone_center_channel',tier: 'runtime', type: 'int',  default: 3 },
  { key: 'lumatone_center_note',   tier: 'runtime', type: 'int',  default: 26 },
  { key: 'wheel_to_recent',        tier: 'runtime', type: 'bool', default: false },
  { key: 'midi_wheel_range',       tier: 'session', type: 'string', default: '9/8' },
  { key: 'wheel_scale_aware',      tier: 'session', type: 'bool',   default: false },

  // ── Lumatone LED sync ─────────────────────────────────────────────────────────
  { key: 'lumatone_led_sync', tier: 'session', type: 'bool', default: false },

  // ── App preferences (localStorage, not session) ───────────────────────────────
  // hexatone_persist_on_reload is handled separately in app.jsx / use-presets.js
  // and is intentionally not part of the settings object.
];

// ── Derived lookup maps ────────────────────────────────────────────────────────

/** All entries keyed by settings key for O(1) lookup. */
export const REGISTRY_BY_KEY = Object.fromEntries(
  SETTINGS_REGISTRY.map(entry => [entry.key, entry])
);

/** Keys that are synced via useQuery (URL + localStorage). */
export const URL_KEYS = SETTINGS_REGISTRY
  .filter(e => e.tier === 'url')
  .map(e => e.key);

/** Keys that are session-scoped (sessionStorage). */
export const SESSION_KEYS = SETTINGS_REGISTRY
  .filter(e => e.tier === 'session')
  .map(e => e.key);

/** Keys that are runtime-only (never stored). */
export const RUNTIME_KEYS = SETTINGS_REGISTRY
  .filter(e => e.tier === 'runtime')
  .map(e => e.key);

/** Keys excluded from URL/localStorage persistence (preset-specific). */
export const PRESET_SKIP_KEYS = SETTINGS_REGISTRY
  .filter(e => e.presetSkip)
  .map(e => e.key);

/**
 * Build the spec object for useQuery from the registry.
 *
 * Maps each 'url'-tier key to its corresponding Extract* instance.
 * The extractors are passed in by the caller so this module stays free of
 * Preact/use-query imports (pure data layer).
 *
 * @param {object} extractors  { int, float, bool, string, joined } — Extract* instances
 * @returns {object}  spec object for useQuery
 *
 * Usage in app.jsx:
 *   import { buildQuerySpec } from './persistence/settings-registry.js';
 *   import { ExtractInt, ExtractFloat, ... } from './use-query.js';
 *   const spec = buildQuerySpec({ int: ExtractInt, float: ExtractFloat,
 *                                  bool: ExtractBool, string: ExtractString,
 *                                  joined: ExtractJoinedString });
 */
/**
 * Build a flat object of default values for all url-tier and runtime-tier keys.
 * Used as the base layer in the useQuery defaults object, before preset_values
 * default_settings and sessionDefaults are spread on top.
 *
 * This restores the blank-slate defaults that previously lived at the bottom of
 * session-defaults.js (scale, rSteps, drSteps, hexSize, rotation, equivSteps,
 * reference_degree, center_degree, fundamental, etc.).
 */
export function buildRegistryDefaults() {
  const defaults = {};
  for (const entry of SETTINGS_REGISTRY) {
    if (entry.tier === 'url' || entry.tier === 'runtime') {
      if (entry.default !== undefined) defaults[entry.key] = entry.default;
    }
  }
  return defaults;
}

export function buildQuerySpec(extractors) {
  const spec = {};
  for (const entry of SETTINGS_REGISTRY) {
    if (entry.tier !== 'url') continue;
    switch (entry.type) {
      case 'int':    spec[entry.key] = extractors.int;    break;
      case 'float':  spec[entry.key] = extractors.float;  break;
      case 'bool':   spec[entry.key] = extractors.bool;   break;
      case 'string': spec[entry.key] = extractors.string; break;
      case 'joined': spec[entry.key] = extractors.joined; break;
    }
  }
  return spec;
}
