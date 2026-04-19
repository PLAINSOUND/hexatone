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
 *
 * ## Intentional omissions
 *
 *   octave_offset — The OCT button transpose state is intentionally NOT registered.
 *                   It is reset to 0 on every synth rebuild (output routing change),
 *                   structural rebuild (preset/scale/layout change), and PANIC.
 *                   Persisting it would cause pitch mismatches after these events.
 *                   Implementation: resetOctave() in use-synth-wiring.js, called
 *                   from useEffect([synth]) and the PANIC button in app.jsx.
 *                   The structuralSettings reset lives in app.jsx useEffect([structuralSettings]).
 *
 *   octave_deferred — Stored directly in sessionStorage by use-synth-wiring.js
 *                     (key: "octave_deferred"). Not in this registry because it is
 *                     UI interaction state, not a settings value — it controls whether
 *                     the next OCT shift defers to the next note-on rather than
 *                     retuning held notes immediately.
 */

export const SETTINGS_REGISTRY = [
  // ── Preset metadata ─────────────────────────────────────────────────────────
  { key: "name", tier: "url", type: "string", default: "", presetSkip: true },
  { key: "description", tier: "url", type: "string", default: "", presetSkip: true },
  { key: "short_description", tier: "session", type: "string", default: "" },

  // ── Scale / tuning ───────────────────────────────────────────────────────────
  { key: "scale", tier: "url", type: "joined", default: null, presetSkip: true },
  { key: "note_names", tier: "url", type: "joined", default: null, presetSkip: true },
  { key: "note_colors", tier: "url", type: "joined", default: null, presetSkip: true },
  { key: "equivSteps", tier: "url", type: "int", default: 12, presetSkip: true },
  { key: "reference_degree", tier: "url", type: "int", default: 0, presetSkip: true },
  { key: "fundamental", tier: "url", type: "float", default: 440, presetSkip: true },
  { key: "spectrum_colors", tier: "url", type: "bool", default: true, presetSkip: true },
  { key: "fundamental_color", tier: "url", type: "string", default: "#f2e3e3", presetSkip: true },
  { key: "key_labels", tier: "url", type: "string", default: "no_labels", presetSkip: true },
  // HEJI notation anchor: defines the rational offset for the entire spelling.
  // heji_anchor_ratio — the ratio (Scala format, e.g. "3/2" or "702.0") of the
  //   reference pitch whose deviation is 0¢ on a tuning meter.  This is
  //   measured from scale degree 0 (1/1).  It does not need to be a scale
  //   degree; it is a free-form interval that anchors the HEJI frame.
  //   Default "1/1" means the root is the 0¢ reference.
  // heji_anchor_label — the HEJI pitch-class spelling for that pitch (e.g. "nA").
  //   When key_labels === "heji", all degree labels are auto-generated from
  //   this anchor pair + the committed ratio of each degree.
  { key: "heji_anchor_ratio", tier: "url", type: "string", default: "", presetSkip: true },
  { key: "heji_anchor_label", tier: "url", type: "string", default: "", presetSkip: true },
  // When false, cents deviation is omitted from key labels (still shown in scale table).
  { key: "heji_show_cents", tier: "url", type: "bool", default: false, presetSkip: true },
  // Internal-only for now: TuneCell supports an alternate reference-degree save
  // mode ('transpose_scale'), but there is no exposed UI toggle yet, so this
  // remains session-scoped and stays out of share URLs.
  { key: "retuning_mode", tier: "session", type: "string", default: "recalculate_reference" },

  // ── Layout / grid ────────────────────────────────────────────────────────────
  { key: "rSteps", tier: "url", type: "int", default: 2, presetSkip: true },
  { key: "drSteps", tier: "url", type: "int", default: 1, presetSkip: true },
  { key: "center_degree", tier: "url", type: "int", default: 0, presetSkip: true },
  { key: "hexSize", tier: "url", type: "int", default: 42, presetSkip: true },
  { key: "rotation", tier: "url", type: "float", default: -16.102113751, presetSkip: true },

  // ── Per-controller local preferences ─────────────────────────────────────────
  // tier: 'local'  — stored in localStorage, not URL-synced, not session-scoped.
  // perController: true  — storage key is `${controllerId}_${key}`.
  //                        Value is loaded into settings on controller connect
  //                        via loadControllerPrefs() in controller-anchor.js.
  // perController: false — storage key is the plain key (cross-controller pref).
  //
  // These keys also appear in the 'session' section below as their runtime
  // representation in the settings object. The 'local' entries here describe
  // the *persistence* layer; the session entries describe the *live* state.
  {
    key: "midiin_mpe_input",
    tier: "local",
    type: "bool",
    default: false,
    perController: true,
    description: "Enable MPE input for this controller",
  },
  {
    key: "midiin_bend_flip",
    tier: "local",
    type: "bool",
    default: false,
    perController: true,
    description: "Reverse pitch bend direction for this controller",
  },
  {
    key: "midiin_bend_range",
    tier: "local",
    type: "string",
    default: "64/63",
    perController: false,
    description: "Pitch bend interval (shared across controllers)",
  },
  {
    key: "midiin_scale_bend_range",
    tier: "local",
    type: "int",
    default: 48,
    perController: true,
    description: "MPE pitch bend range (semitones) used in Nearest Scale Degree mode",
  },
  {
    key: "midi_passthrough",
    tier: "local",
    type: "bool",
    default: false,
    perController: true,
    description: "Sequential (passthrough) mode for this controller",
  },
  {
    key: "tonalplexus_input_mode",
    tier: "local",
    type: "string",
    default: "layout_205",
    perController: true,
    description: "Tonal Plexus input interpretation for this controller",
  },

  // ── MIDI input ───────────────────────────────────────────────────────────────
  { key: "midiin_device", tier: "session", type: "string", default: "OFF" },
  { key: "midiin_controller_override", tier: "session", type: "string", default: "auto" },
  { key: "midiin_channel", tier: "session", type: "int", default: 0 },
  { key: "midiin_steps_per_channel", tier: "session", type: "int", default: 0 },
  { key: "midiin_channel_group_size", tier: "session", type: "int", default: 1 },
  { key: "midiin_anchor_channel", tier: "session", type: "int", default: 1 },
  { key: "controller_anchor_note", tier: "session", type: "int", default: null },
  { key: "midiin_channel_legacy", tier: "session", type: "bool", default: false },
  // midi_passthrough is tier: 'local', perController: true — see per-controller section above.
  { key: "midiin_central_degree", tier: "session", type: "int", default: 60 },
  // Input runtime mode keys
  { key: "midiin_mapping_target", tier: "session", type: "string", default: "hex_layout" },
  // midiin_mpe_input, midiin_bend_range, midiin_bend_flip are 'local' tier (see above).
  // MPE input voice channel range. Channels 1 and 16 are typically reserved
  // (manager/global channel per MPE spec), so the default voice range is 2–15.
  { key: "midiin_mpe_lo_ch", tier: "session", type: "int", default: 2 },
  { key: "midiin_mpe_hi_ch", tier: "session", type: "int", default: 15 },
  { key: "midiin_scale_tolerance", tier: "session", type: "int", default: 25 },
  { key: "midiin_scale_fallback", tier: "session", type: "string", default: "accept" },
  { key: "midiin_pitchbend_mode", tier: "session", type: "string", default: "recency" },
  { key: "midiin_pressure_mode", tier: "session", type: "string", default: "all" },
  {
    key: "midiin_modwheel_value",
    tier: "session",
    type: "int",
    default: 0,
    description: "Last known CC1 mod-wheel value for the active MIDI input, restored on refresh",
  },
  {
    key: "midiin_modwheel_source",
    tier: "session",
    type: "string",
    default: "",
    description: "MIDI input device id that the restored mod-wheel value belongs to",
  },

  // ── Controller anchors (hardware-scoped, survive device disconnect) ──────────
  // These are keyed dynamically as "${controllerId}_anchor" in localStorage.
  // Listed here as a documentation anchor for the local tier; not used directly
  // by the registry loop since the key name is runtime-derived.
  // { key: '${controllerId}_anchor',         tier: 'local', type: 'int' },
  // { key: '${controllerId}_anchor_channel', tier: 'local', type: 'int' },

  // ── Sample synth ─────────────────────────────────────────────────────────────
  { key: "output_sample", tier: "session", type: "bool", default: true },
  { key: "instrument", tier: "session", type: "string", default: "WMRIByzantineST" },

  // ── MTS real-time output ──────────────────────────────────────────────────────
  { key: "output_mts", tier: "session", type: "bool", default: false },
  { key: "midi_device", tier: "session", type: "string", default: "OFF" },
  { key: "midi_channel", tier: "session", type: "int", default: 0 },
  { key: "midi_mapping", tier: "session", type: "string", default: "MTS1" },
  { key: "midi_velocity", tier: "session", type: "int", default: 72 },
  { key: "sysex_auto", tier: "session", type: "bool", default: false },
  { key: "sysex_type", tier: "session", type: "int", default: 126 },
  { key: "device_id", tier: "session", type: "int", default: 127 },
  { key: "tuning_map_number", tier: "session", type: "int", default: 0 },

  // ── MTS bulk dump output (dynamic + static) ───────────────────────────────────
  { key: "output_direct", tier: "session", type: "bool", default: false },
  { key: "direct_device", tier: "session", type: "string", default: "OFF" },
  { key: "direct_mode", tier: "session", type: "string", default: "dynamic" },
  { key: "direct_channel", tier: "session", type: "int", default: -1 },
  { key: "direct_sysex_auto", tier: "session", type: "bool", default: false },
  { key: "direct_device_id", tier: "session", type: "int", default: 127 },
  { key: "direct_tuning_map_number", tier: "session", type: "int", default: 0 },
  { key: "direct_tuning_map_name", tier: "session", type: "string", default: null },

  // ── MPE output ────────────────────────────────────────────────────────────────
  { key: "output_mpe", tier: "session", type: "bool", default: false },
  { key: "mpe_device", tier: "session", type: "string", default: "OFF" },
  { key: "mpe_manager_ch", tier: "session", type: "string", default: "1" },
  { key: "mpe_lo_ch", tier: "session", type: "int", default: 2 },
  { key: "mpe_hi_ch", tier: "session", type: "int", default: 8 },
  { key: "mpe_mode", tier: "session", type: "string", default: "Ableton_workaround" },
  { key: "mpe_pitchbend_range", tier: "session", type: "int", default: 48 },
  { key: "mpe_pitchbend_range_manager", tier: "session", type: "int", default: 2 },

  // ── FluidSynth / OSC mirror ───────────────────────────────────────────────────
  { key: "fluidsynth_device", tier: "session", type: "string", default: "" },
  { key: "fluidsynth_channel", tier: "session", type: "int", default: -1 },
  { key: "output_osc", tier: "session", type: "bool", default: false },
  { key: "osc_bridge_url", tier: "session", type: "string", default: "ws://localhost:8089" },
  // OSC layer volumes — written by onOscLayerVolumeChange in use-synth-wiring.js
  // via both setSettings (so deriveOscVolumes reads the live value on every
  // in-session rebuild) and localStorage (so values survive page reload and
  // are read back via CROSS_CONTROLLER_ENTRIES in session-defaults.js).
  // tier: 'local', perController: false — plain key, cross-controller.
  { key: "osc_volume_pluck",   tier: "local", type: "float", default: 0.5, perController: false },
  { key: "osc_volume_buzz",    tier: "local", type: "float", default: 0.5, perController: false },
  { key: "osc_volume_formant", tier: "local", type: "float", default: 0.5, perController: false },
  { key: "osc_volume_saw",     tier: "local", type: "float", default: 0.5, perController: false },
  // WebMIDI permission/access level restored on refresh so the explicit
  // Enable MIDI / Enable Sysex checkboxes stay in sync with device menus.
  // This is session-scoped runtime state, not a shareable preset value.
  { key: "webmidi_enabled", tier: "session", type: "bool", default: false },
  { key: "webmidi_sysex_enabled", tier: "session", type: "bool", default: false },
  { key: "webmidi_access", tier: "session", type: "string", default: "none" },

  // ── Controller geometry (runtime-derived, never stored) ───────────────────────
  // These are computed from the detected controller at startup; persisting them
  // would cause stale values if the user swaps controllers between sessions.
  { key: "axis49_center_note", tier: "runtime", type: "int", default: 53 },
  { key: "lumatone_center_channel", tier: "runtime", type: "int", default: 3 },
  { key: "lumatone_center_note", tier: "runtime", type: "int", default: 26 },
  { key: "wheel_to_recent", tier: "session", type: "bool", default: true },
  { key: "midi_wheel_range", tier: "session", type: "string", default: "64/63" },
  { key: "wheel_scale_aware", tier: "session", type: "bool", default: false },
  { key: "midi_wheel_semitones", tier: "session", type: "int", default: 2 },

  // ── LED sync ─────────────────────────────────────────────────────────
  {
    key: "lumatone_led_sync",
    tier: "local",
    type: "bool",
    default: false,
    perController: false,
    description: "Auto Send Colours to Lumatone LEDs when scale changes",
  },
  {
    key: "exquis_led_sync",
    tier: "local",
    type: "bool",
    default: true,
    perController: false,
    description: "Auto Send Colours to Exquis LEDs when scale changes",
  },
  {
    key: "linnstrument_led_sync",
    tier: "local",
    type: "bool",
    default: true,
    perController: false,
    description: "Auto Send Colours to LinnStrument LEDs when scale changes",
  },
  {
    key: "exquis_led_luminosity",
    tier: "local",
    type: "int",
    default: 15,
    perController: false,
    description: "Exquis LED global brightness (0–100, firmware clamps above 100)",
  },
  {
    key: "exquis_led_saturation",
    tier: "local",
    type: "float",
    default: 1.3,
    perController: false,
    description: "Exquis LED colour saturation multiplier applied in okLab space (1.0–2.5)",
  },

  // ── App preferences (localStorage, not session) ───────────────────────────────
  // hexatone_persist_on_reload is handled separately in app.jsx / use-presets.js
  // and is intentionally not part of the settings object.

  // ── Rationalisation search prefs ──────────────────────────────────────────────
  // These are stored outside the settings object, managed directly by
  // scale-table/index.js and scale-table/search-prefs.js.
  //
  // hexatone_search_prefs       (localStorage)  — JSON blob of searchPrefs state
  //                              (primeLimit, oddLimit, centsTolerance, region,
  //                              primeBounds, primeBoundsUt, existingRatios …).
  //                              Merged with DEFAULT_SEARCH_PREFS on load so new
  //                              keys are always present after updates.
  // hexatone_search_prefs_open  (sessionStorage) — "true"/"false"; keeps the panel
  //                              open across page refreshes within a session.
  // Restore Defaults clears hexatone_search_prefs and resets to DEFAULT_SEARCH_PREFS.
  //
  // There are no rationalise_* keys in the settings object. The search prefs live
  // entirely in localStorage under hexatone_search_prefs and are not URL-synced.
];

// ── Derived lookup maps ────────────────────────────────────────────────────────

/** All entries keyed by settings key for O(1) lookup. */
export const REGISTRY_BY_KEY = Object.fromEntries(
  SETTINGS_REGISTRY.map((entry) => [entry.key, entry]),
);

/** Keys that are synced via useQuery (URL + localStorage). */
export const URL_KEYS = SETTINGS_REGISTRY.filter((e) => e.tier === "url").map((e) => e.key);

/** Keys that are session-scoped (sessionStorage). */
export const SESSION_KEYS = SETTINGS_REGISTRY.filter((e) => e.tier === "session").map((e) => e.key);

/** Keys that are runtime-only (never stored). */
export const RUNTIME_KEYS = SETTINGS_REGISTRY.filter((e) => e.tier === "runtime").map((e) => e.key);

/** All local-tier entries (localStorage, not session, not URL). */
export const LOCAL_ENTRIES = SETTINGS_REGISTRY.filter((e) => e.tier === "local");

/** Local-tier entries that are scoped per-controller (key = `${ctrlId}_${key}`). */
export const PER_CONTROLLER_ENTRIES = SETTINGS_REGISTRY.filter(
  (e) => e.tier === "local" && e.perController,
);

/** Local-tier entries shared across all controllers (key = plain key). */
export const CROSS_CONTROLLER_ENTRIES = SETTINGS_REGISTRY.filter(
  (e) => e.tier === "local" && !e.perController,
);

/** Keys excluded from URL/localStorage persistence (preset-specific). */
export const PRESET_SKIP_KEYS = SETTINGS_REGISTRY.filter((e) => e.presetSkip).map((e) => e.key);

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
    if (entry.tier === "url" || entry.tier === "runtime" || entry.tier === "local") {
      if (entry.default !== undefined) defaults[entry.key] = entry.default;
    }
  }
  return defaults;
}

export function buildQuerySpec(extractors) {
  const spec = {};
  for (const entry of SETTINGS_REGISTRY) {
    if (entry.tier !== "url") continue;
    switch (entry.type) {
      case "int":
        spec[entry.key] = extractors.int;
        break;
      case "float":
        spec[entry.key] = extractors.float;
        break;
      case "bool":
        spec[entry.key] = extractors.bool;
        break;
      case "string":
        spec[entry.key] = extractors.string;
        break;
      case "joined":
        spec[entry.key] = extractors.joined;
        break;
    }
  }
  return spec;
}
