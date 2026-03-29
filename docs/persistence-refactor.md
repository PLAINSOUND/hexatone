# Persistence Refactor

## Purpose

This document defines the Phase 1 contract for refactoring Hexatone state
persistence. The goal is to centralize persistence policy, reduce ambiguity,
and make later implementation work testable and incremental.

This document is intentionally architecture-first. It freezes the desired
behavior before runtime code is changed.

## Goals

- Establish one canonical persistence policy for every state key.
- Replace the current distributed persistence logic with a single in-memory
  source of truth plus explicit persistence adapters.
- Restrict URL state to shareable musical state.
- Keep session-scoped MIDI and device routing out of shareable state.
- Preserve cross-session local preferences for personally owned devices and
  selected browser-side sound settings.
- Make hydration precedence explicit and testable.

## Non-Goals

- No framework rewrite is included in this plan.
- No TypeScript migration is required for the persistence refactor.
- No UI redesign is required.
- No runtime behavior should change during Phase 1 beyond test scaffolding.

## Current Problems

The current persistence model is spread across:

- `src/use-query.js`
- `src/session-defaults.js`
- `src/use-presets.js`
- `src/use-settings-change.js`
- several UI components that write directly to browser storage

This creates the following issues:

- URL, `sessionStorage`, and `localStorage` all behave as overlapping sources
  of truth.
- `useQuery` writes to both URL and `localStorage`, which conflates sharing
  and local persistence.
- `sessionDefaults` preloads state before the rest of the app resolves
  precedence.
- several storage writes happen directly in UI code instead of in a central
  persistence layer.
- skip lists and clear lists do not align cleanly.

## Desired Architecture

The refactor should move toward:

- one central runtime settings store
- one explicit hydration function
- three persistence adapters:
  - URL
  - session storage
  - local storage
- one flat registry describing the persistence policy for every key

Browser storage should become an implementation detail of the store layer, not
something individual components mutate directly.

## MIDI Input Domain Model

Before finalizing the persistence implementation, the MIDI input section should
be cleaned up conceptually. The current code overloads several anchor-related
keys, especially `midiin_central_degree`, which today mixes:

- input anchor note for sequential mapping
- input anchor note for some known 2D controllers
- remembered controller preference
- exported metadata in `.ascl` / `.kbm`
- some output-related reference usage

That overload should not be preserved in the refactor. Instead, the MIDI input
domain should be expressed in terms of explicit user choices.

### Input Flow

After selecting an input port, the user chooses one of two top-level input
targets:

- MIDI input mapped to hexatone layout
- MIDI input mapped to scale

Current Hexatone behavior corresponds to:

- MIDI input mapped to hexatone layout

### `hex_layout` Target

When MIDI input is mapped to the hexatone layout, the user then chooses how the
layout mapping works:

- `controller_geometry`
- `sequential`

Meaning:

- `controller_geometry`
  - use a known 2D controller geometry when one exists
  - anchor note and channel are controller-specific
  - the selected geometry mode and the learned anchor should persist per
    controller in local storage

- `sequential`
  - bypass 2D geometry and interpret incoming note/channel sequentially
  - use global sequential anchor note and channel
  - channel transposition and legacy `mod 8` handling remain available here

In addition, this section should expose:

- an `MPE` checkbox for input interpretation

This affects how channels and pitch bend/controllers are interpreted for input.
It does not replace the distinction between `hex_layout` and `scale`.

### `scale` Target

When MIDI input is mapped to scale:

- there is no anchor note
- there is no anchor channel
- incoming MIDI notes, pitch bend, and later possible MTS data are interpreted
  as desired pitch

This target is the future home for:

- normal MIDI playback context
- MPE controller pitch interpretation
- MIDI sequence playback into a selected scale
- nearest-scale mapping
- dynamic tuning selection based on harmonic radius

This path should remain separate from layout-anchor concepts.

### Defaults

Defaults should work as follows:

- global fallback anchor note and channel:
  - note 60
  - channel 1

- each known controller has its own hardcoded default anchor note and channel
  based on its geometry

- the default input target is:
  - `hex_layout`

### Persistence Rules For MIDI Input

The MIDI input redesign should preserve these rules:

- each known controller remembers:
  - preferred layout mode (`controller_geometry` or `sequential`)
  - preferred controller-specific anchor note
  - preferred controller-specific anchor channel

- if a user reconnects a known controller, the app restores that controller's
  saved preference and anchor settings

- if the user bypasses geometry, sequential mode restores its own previously
  saved sequential anchor note and channel, or the global defaults

- switching between geometry and sequential mode must not overwrite the
  previously saved anchor values for the other mode

- `scale` mapping ignores anchor note and anchor channel entirely

### Recommended Runtime Key Direction

The persistence refactor should move toward the following runtime concepts:

- `midiin_mapping_target`
  - `"hex_layout" | "scale"`

- `midiin_layout_mode`
  - `"controller_geometry" | "sequential"`
  - only meaningful when target is `hex_layout`

- `midiin_mpe`
  - boolean

- `midiin_seq_anchor_note`
  - sequential/global anchor note

- `midiin_seq_anchor_channel`
  - sequential/global anchor channel

- `midiin_steps_per_channel`
  - retained for sequential mode

- `midiin_channel_legacy`
  - retained for sequential mode

Controller-specific preferences should be stored separately per controller id,
for example:

- `controller_layout_mode:<controller_id>`
- `controller_anchor_note:<controller_id>`
- `controller_anchor_channel:<controller_id>`

These may remain storage-level keys rather than primary runtime state keys, as
long as the runtime model clearly distinguishes:

- sequential anchor settings
- controller-specific geometry anchor settings
- scale-mapped input, which uses no anchor

### Migration Direction

The current anchor-related keys should be treated as transitional.

Current behavior maps roughly to this new model:

- `midi_passthrough`
  - maps to `midiin_layout_mode = "sequential"` when target is `hex_layout`

- known-controller geometry active
  - maps to `midiin_layout_mode = "controller_geometry"`

- `midiin_central_degree`
  - should be retired as a canonical concept
  - its current uses should be split between:
    - `midiin_seq_anchor_note`
    - controller-specific anchor preferences
    - legacy import/export compatibility where needed

- `midiin_anchor_channel`
  - becomes `midiin_seq_anchor_channel`

- `lumatone_center_note` and `lumatone_center_channel`
  - remain controller-specific geometry state unless a broader generalized
    controller-anchor representation replaces them later

The flat persistence registry below should therefore be read as Phase 1
baseline policy, but the MIDI-input-related entries are expected to evolve to
match this domain model during implementation planning.

## Hydration Precedence

Hydration order is global and fixed:

1. app defaults
2. preset defaults
3. local preferences
4. session state, only if `hexatone_persist_on_reload === true`
5. URL share state

Interpretation:

- URL is authoritative for shareable state when present.
- local preferences survive across sessions unless the URL overrides them.
- session state is optional and only restored when the user opts in.
- derived state is never hydrated.

## Reload Toggle Policy

The current UI text is "Restore preset on reload", but under the new
architecture the stored preference means:

- restore previous session state on reload

This is controlled by:

- `hexatone_persist_on_reload` in `localStorage`

If `hexatone_persist_on_reload === false`:

- do not restore session-scoped state from `sessionStorage`
- do still apply local preferences
- do still apply URL share state

If `hexatone_persist_on_reload === true`:

- restore session-scoped state from `sessionStorage`
- then apply URL share state on top

This toggle should gate only session restoration. It should not suppress:

- app defaults
- preset defaults
- local preferences
- URL hydration

## Buckets

There is one canonical flat registry. The four logical buckets are derived
views over that registry.

### `shareable`

State worth transferring between users:

- scale and tuning data
- visual note metadata
- layout geometry
- built-in sound choice

This bucket is serialized to URL on explicit Share action. It should not be
written continuously on every state change.

### `session`

State relevant only to the current browser session:

- MIDI input/output routing
- output toggles
- protocol details for attached devices
- current active preset identity
- transient controller behavior for this session

This bucket is stored in `sessionStorage` and restored only when the local
reload preference allows it.

### `local`

Stable personal preferences tied to the browser and device:

- preferred internal instrument fallback
- synth volume and mute state
- per-controller anchor note/channel settings
- reload preference

This bucket is stored in `localStorage`.

### `derived`

Values computed from canonical settings and never persisted:

- normalized scale arrays
- derived label flags
- normalized rotation
- render-only helpers

## Canonical Key Policy

The canonical key list should be built from the runtime settings surface used
by the app.

Rules:

- a key belongs to exactly one persistence scope
- a key may have a fallback source, but only one canonical storage scope
- derived values never enter hydration
- browser storage keys may differ from runtime keys, but runtime keys remain
  canonical

## Renames And Legacy Migration

Canonical runtime key:

- `mpe_manager_ch`

Legacy alias that may exist in previously stored state:

- `mpe_master_ch`

Migration rule:

- read `mpe_manager_ch` first
- if absent, read `mpe_master_ch`
- normalize into `mpe_manager_ch`
- never write `mpe_master_ch`

Any later key rename should follow the same pattern:

- read legacy
- normalize once
- write canonical only

## Flat Registry

This flat registry is the canonical persistence contract. Bucket summaries
must be generated from it rather than maintained separately.

```ts
type PersistenceScope = "shareable" | "session" | "local" | "derived";

type StorageCodec = "string" | "int" | "float" | "bool" | "csv" | "json";

type StateRegistryEntry = {
  key: string;
  scope: PersistenceScope;
  storage:
    | { kind: "url"; param: string; codec: StorageCodec }
    | { kind: "session"; key: string; codec: StorageCodec }
    | { kind: "local"; key: string; codec: StorageCodec }
    | { kind: "none" };
  defaultSource: "app" | "preset" | "local_pref" | "session_only";
  hydrateOrder: number;
  shareable: boolean;
  notes?: string;
};

const STATE_REGISTRY: StateRegistryEntry[] = [
  { key: "name", scope: "shareable", storage: { kind: "url", param: "name", codec: "string" }, defaultSource: "preset", hydrateOrder: 5, shareable: true },
  { key: "description", scope: "shareable", storage: { kind: "url", param: "description", codec: "string" }, defaultSource: "preset", hydrateOrder: 5, shareable: true },
  { key: "short_description", scope: "shareable", storage: { kind: "url", param: "short_description", codec: "string" }, defaultSource: "preset", hydrateOrder: 5, shareable: true, notes: "Optional metadata; not required for runtime." },

  { key: "scale", scope: "shareable", storage: { kind: "url", param: "scale", codec: "csv" }, defaultSource: "preset", hydrateOrder: 5, shareable: true },
  { key: "equivSteps", scope: "shareable", storage: { kind: "url", param: "equivSteps", codec: "int" }, defaultSource: "preset", hydrateOrder: 5, shareable: true },
  { key: "fundamental", scope: "shareable", storage: { kind: "url", param: "fundamental", codec: "float" }, defaultSource: "preset", hydrateOrder: 5, shareable: true },
  { key: "reference_degree", scope: "shareable", storage: { kind: "url", param: "reference_degree", codec: "int" }, defaultSource: "preset", hydrateOrder: 5, shareable: true },
  { key: "center_degree", scope: "shareable", storage: { kind: "url", param: "center_degree", codec: "int" }, defaultSource: "preset", hydrateOrder: 5, shareable: true },
  { key: "retuning_mode", scope: "shareable", storage: { kind: "url", param: "retuning_mode", codec: "string" }, defaultSource: "app", hydrateOrder: 5, shareable: true },

  { key: "note_names", scope: "shareable", storage: { kind: "url", param: "note_names", codec: "csv" }, defaultSource: "preset", hydrateOrder: 5, shareable: true },
  { key: "note_colors", scope: "shareable", storage: { kind: "url", param: "note_colors", codec: "csv" }, defaultSource: "preset", hydrateOrder: 5, shareable: true },
  { key: "key_labels", scope: "shareable", storage: { kind: "url", param: "key_labels", codec: "string" }, defaultSource: "preset", hydrateOrder: 5, shareable: true },
  { key: "spectrum_colors", scope: "shareable", storage: { kind: "url", param: "spectrum_colors", codec: "bool" }, defaultSource: "preset", hydrateOrder: 5, shareable: true },
  { key: "fundamental_color", scope: "shareable", storage: { kind: "url", param: "fundamental_color", codec: "string" }, defaultSource: "preset", hydrateOrder: 5, shareable: true },

  { key: "rSteps", scope: "shareable", storage: { kind: "url", param: "rSteps", codec: "int" }, defaultSource: "preset", hydrateOrder: 5, shareable: true },
  { key: "drSteps", scope: "shareable", storage: { kind: "url", param: "drSteps", codec: "int" }, defaultSource: "preset", hydrateOrder: 5, shareable: true },
  { key: "hexSize", scope: "shareable", storage: { kind: "url", param: "hexSize", codec: "int" }, defaultSource: "preset", hydrateOrder: 5, shareable: true },
  { key: "rotation", scope: "shareable", storage: { kind: "url", param: "rotation", codec: "float" }, defaultSource: "preset", hydrateOrder: 5, shareable: true },

  { key: "instrument", scope: "shareable", storage: { kind: "url", param: "instrument", codec: "string" }, defaultSource: "local_pref", hydrateOrder: 5, shareable: true, notes: "Dual-role key: local fallback preference, but URL can override." },

  { key: "output_sample", scope: "session", storage: { kind: "session", key: "output_sample", codec: "bool" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "output_mts", scope: "session", storage: { kind: "session", key: "output_mts", codec: "bool" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "output_mpe", scope: "session", storage: { kind: "session", key: "output_mpe", codec: "bool" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "output_direct", scope: "session", storage: { kind: "session", key: "output_direct", codec: "bool" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "output_osc", scope: "session", storage: { kind: "session", key: "output_osc", codec: "bool" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },

  { key: "midiin_device", scope: "session", storage: { kind: "session", key: "midiin_device", codec: "string" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "midiin_channel", scope: "session", storage: { kind: "session", key: "midiin_channel", codec: "int" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false, notes: "Retain only if explicit input-channel filtering remains a feature." },
  { key: "midiin_mapping_target", scope: "session", storage: { kind: "session", key: "midiin_mapping_target", codec: "string" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false, notes: "Expected values: hex_layout | scale." },
  { key: "midiin_layout_mode", scope: "session", storage: { kind: "session", key: "midiin_layout_mode", codec: "string" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false, notes: "Expected values: controller_geometry | sequential. Meaningful only when midiin_mapping_target = hex_layout." },
  { key: "midiin_mpe", scope: "session", storage: { kind: "session", key: "midiin_mpe", codec: "bool" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false, notes: "Input-side MPE interpretation toggle." },
  { key: "midiin_seq_anchor_note", scope: "session", storage: { kind: "session", key: "midiin_seq_anchor_note", codec: "int" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false, notes: "Sequential / generic / bypass anchor note. Global fallback defaults to note 60." },
  { key: "midiin_seq_anchor_channel", scope: "session", storage: { kind: "session", key: "midiin_seq_anchor_channel", codec: "int" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false, notes: "Sequential / generic / bypass anchor channel. Global fallback defaults to channel 1." },
  { key: "midiin_steps_per_channel", scope: "session", storage: { kind: "session", key: "midiin_steps_per_channel", codec: "int" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false, notes: "Sequential mode only." },
  { key: "midiin_channel_legacy", scope: "session", storage: { kind: "session", key: "midiin_channel_legacy", codec: "bool" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false, notes: "Sequential mode only." },

  { key: "midi_device", scope: "session", storage: { kind: "session", key: "midi_device", codec: "string" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "midi_channel", scope: "session", storage: { kind: "session", key: "midi_channel", codec: "int" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "midi_mapping", scope: "session", storage: { kind: "session", key: "midi_mapping", codec: "string" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "midi_velocity", scope: "session", storage: { kind: "session", key: "midi_velocity", codec: "int" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "sysex_auto", scope: "session", storage: { kind: "session", key: "sysex_auto", codec: "bool" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "sysex_type", scope: "session", storage: { kind: "session", key: "sysex_type", codec: "int" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "device_id", scope: "session", storage: { kind: "session", key: "device_id", codec: "int" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "tuning_map_number", scope: "session", storage: { kind: "session", key: "tuning_map_number", codec: "int" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },

  { key: "fluidsynth_device", scope: "session", storage: { kind: "session", key: "fluidsynth_device", codec: "string" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "fluidsynth_channel", scope: "session", storage: { kind: "session", key: "fluidsynth_channel", codec: "int" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },

  { key: "direct_device", scope: "session", storage: { kind: "session", key: "direct_device", codec: "string" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "direct_channel", scope: "session", storage: { kind: "session", key: "direct_channel", codec: "int" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "direct_sysex_auto", scope: "session", storage: { kind: "session", key: "direct_sysex_auto", codec: "bool" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "direct_device_id", scope: "session", storage: { kind: "session", key: "direct_device_id", codec: "int" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "direct_tuning_map_number", scope: "session", storage: { kind: "session", key: "direct_tuning_map_number", codec: "int" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },

  { key: "mpe_device", scope: "session", storage: { kind: "session", key: "mpe_device", codec: "string" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "mpe_manager_ch", scope: "session", storage: { kind: "session", key: "mpe_manager_ch", codec: "string" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "mpe_lo_ch", scope: "session", storage: { kind: "session", key: "mpe_lo_ch", codec: "int" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "mpe_hi_ch", scope: "session", storage: { kind: "session", key: "mpe_hi_ch", codec: "int" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "mpe_mode", scope: "session", storage: { kind: "session", key: "mpe_mode", codec: "string" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "mpe_pitchbend_range", scope: "session", storage: { kind: "session", key: "mpe_pitchbend_range", codec: "int" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "mpe_pitchbend_range_manager", scope: "session", storage: { kind: "session", key: "mpe_pitchbend_range_manager", codec: "int" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },

  { key: "osc_bridge_url", scope: "session", storage: { kind: "session", key: "osc_bridge_url", codec: "string" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "osc_synth_names", scope: "session", storage: { kind: "session", key: "osc_synth_names", codec: "csv" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "osc_volumes", scope: "local", storage: { kind: "local", key: "osc_volumes", codec: "csv" }, defaultSource: "local_pref", hydrateOrder: 3, shareable: false, notes: "Keep local unless later promoted to explicit shared sound design." },

  { key: "wheel_to_recent", scope: "session", storage: { kind: "session", key: "wheel_to_recent", codec: "bool" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "midi_wheel_range", scope: "session", storage: { kind: "session", key: "midi_wheel_range", codec: "string" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "wheel_scale_aware", scope: "session", storage: { kind: "session", key: "wheel_scale_aware", codec: "bool" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },

  { key: "lumatone_led_sync", scope: "session", storage: { kind: "session", key: "lumatone_led_sync", codec: "bool" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },

  { key: "synth_volume", scope: "local", storage: { kind: "local", key: "synth_volume", codec: "float" }, defaultSource: "local_pref", hydrateOrder: 3, shareable: false },
  { key: "synth_muted", scope: "local", storage: { kind: "local", key: "synth_muted", codec: "bool" }, defaultSource: "local_pref", hydrateOrder: 3, shareable: false },

  { key: "controller_layout_mode_by_id", scope: "local", storage: { kind: "local", key: "controller_layout_mode_by_id", codec: "json" }, defaultSource: "local_pref", hydrateOrder: 3, shareable: false, notes: "Maps controller id to preferred layout mode: controller_geometry | sequential." },
  { key: "controller_anchor_note_by_id", scope: "local", storage: { kind: "local", key: "controller_anchor_note_by_id", codec: "json" }, defaultSource: "local_pref", hydrateOrder: 3, shareable: false, notes: "Maps controller id to preferred geometry anchor note." },
  { key: "controller_anchor_channel_by_id", scope: "local", storage: { kind: "local", key: "controller_anchor_channel_by_id", codec: "json" }, defaultSource: "local_pref", hydrateOrder: 3, shareable: false, notes: "Maps controller id to preferred geometry anchor channel." },
  { key: "axis49_center_note", scope: "derived", storage: { kind: "none" }, defaultSource: "app", hydrateOrder: 0, shareable: false, notes: "Legacy/controller-specific transitional key. Prefer controller_anchor_note_by_id." },
  { key: "lumatone_center_channel", scope: "derived", storage: { kind: "none" }, defaultSource: "app", hydrateOrder: 0, shareable: false, notes: "Legacy/controller-specific transitional key. Prefer controller_anchor_channel_by_id." },
  { key: "lumatone_center_note", scope: "derived", storage: { kind: "none" }, defaultSource: "app", hydrateOrder: 0, shareable: false, notes: "Legacy/controller-specific transitional key. Prefer controller_anchor_note_by_id." },

  { key: "hexatone_preset_source", scope: "session", storage: { kind: "session", key: "hexatone_preset_source", codec: "string" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "hexatone_preset_name", scope: "session", storage: { kind: "session", key: "hexatone_preset_name", codec: "string" }, defaultSource: "session_only", hydrateOrder: 4, shareable: false },
  { key: "hexatone_persist_on_reload", scope: "local", storage: { kind: "local", key: "hexatone_persist_on_reload", codec: "bool" }, defaultSource: "local_pref", hydrateOrder: 3, shareable: false },

  { key: "scale_import", scope: "derived", storage: { kind: "none" }, defaultSource: "preset", hydrateOrder: 0, shareable: false, notes: "Treat as import/export text, not canonical persisted runtime state." },
  { key: "midiin_central_degree", scope: "derived", storage: { kind: "none" }, defaultSource: "app", hydrateOrder: 0, shareable: false, notes: "Legacy transitional key to be retired. Replace with midiin_seq_anchor_note and controller-specific geometry preferences." },
  { key: "midiin_anchor_channel", scope: "derived", storage: { kind: "none" }, defaultSource: "app", hydrateOrder: 0, shareable: false, notes: "Legacy transitional key to be retired. Replace with midiin_seq_anchor_channel." },
  { key: "midi_passthrough", scope: "derived", storage: { kind: "none" }, defaultSource: "app", hydrateOrder: 0, shareable: false, notes: "Legacy transitional key. Replace with midiin_layout_mode = sequential." },
  { key: "equivInterval", scope: "derived", storage: { kind: "none" }, defaultSource: "app", hydrateOrder: 0, shareable: false },
  { key: "scala_names", scope: "derived", storage: { kind: "none" }, defaultSource: "app", hydrateOrder: 0, shareable: false },
  { key: "degree", scope: "derived", storage: { kind: "none" }, defaultSource: "app", hydrateOrder: 0, shareable: false },
  { key: "note", scope: "derived", storage: { kind: "none" }, defaultSource: "app", hydrateOrder: 0, shareable: false },
  { key: "scala", scope: "derived", storage: { kind: "none" }, defaultSource: "app", hydrateOrder: 0, shareable: false },
  { key: "cents", scope: "derived", storage: { kind: "none" }, defaultSource: "app", hydrateOrder: 0, shareable: false },
  { key: "no_labels", scope: "derived", storage: { kind: "none" }, defaultSource: "app", hydrateOrder: 0, shareable: false },
  { key: "keyCodeToCoords", scope: "derived", storage: { kind: "none" }, defaultSource: "app", hydrateOrder: 0, shareable: false },
];
```

## Derived Bucket Views

These lists should be generated from `STATE_REGISTRY`.

```ts
const SHAREABLE_KEYS = STATE_REGISTRY.filter(x => x.scope === "shareable").map(x => x.key);
const SESSION_KEYS = STATE_REGISTRY.filter(x => x.scope === "session").map(x => x.key);
const LOCAL_KEYS = STATE_REGISTRY.filter(x => x.scope === "local").map(x => x.key);
const DERIVED_KEYS = STATE_REGISTRY.filter(x => x.scope === "derived").map(x => x.key);
```

## Ambiguous Key Decisions

These decisions are frozen for the persistence refactor:

- `instrument`
  - local fallback preference
  - URL-shareable override

- `output_sample`
  - session only

- `synth_volume`
  - local only

- `scale_import`
  - import/export only
  - not canonical runtime persistence

- `midiin_central_degree`
  - transitional only
  - should be retired as a canonical concept
  - to be replaced by explicit sequential anchor settings plus controller-
    specific geometry preferences

## Invariants

These must hold after the refactor:

- no key belongs to more than one canonical persistence scope
- URL state is never mirrored into `localStorage`
- derived state is never hydrated from browser storage
- generic state setters do not write directly to browser storage
- URL share serialization is explicit, not continuous
- legacy keys may be read during migration, but only canonical keys are written

## Phase 1 Deliverables

Phase 1 should produce:

- this design document
- a finalized flat registry
- generated bucket summaries
- hydration precedence tests
- legacy key migration tests
- tests for reload-toggle gating of session restoration

No runtime behavior change is required in Phase 1 beyond test scaffolding.

## Later Phase Mapping

This document directly supports later implementation phases:

- central hydration function
- central runtime store
- storage adapters
- removal of direct storage writes from UI code
- explicit Share action for URL state

## Suggested Test Cases

Before changing the implementation, add tests for:

- URL overriding local and session values for shareable keys
- local preferences applying when URL is absent
- session state being restored only when `hexatone_persist_on_reload` is true
- `mpe_master_ch` being read as legacy input and normalized to `mpe_manager_ch`
- `scale_import` being excluded from canonical runtime persistence
- `instrument` using local fallback unless URL provides an override

## Phased Implementation Plan

The persistence refactor should be executed in explicit phases. The MIDI input
domain cleanup above is part of the contract and should be treated as frozen
before runtime persistence code is rewritten.

### Phase 1: Freeze The Contract

Goals:

- establish the persistence policy before changing runtime behavior
- freeze key naming, hydration precedence, and migration rules
- add safety tests around the contract

Work:

- create and maintain this design document
- freeze hydration precedence
- freeze canonical key names and legacy aliases
- define the flat registry and derived bucket views
- freeze the MIDI input domain model
- add tests for precedence, bucket membership, and legacy key migration

Deliverables:

- persistence design document
- finalized flat registry
- generated bucket summaries
- safety tests

### Phase 2: Build The New State Boundary

Goals:

- introduce one in-memory source of truth
- make hydration deterministic and testable

Work:

- introduce one central runtime settings store
- implement `buildInitialState()`
- make `buildInitialState()` apply sources in this order:
  1. app defaults
  2. preset defaults
  3. local preferences
  4. session state, only when allowed by reload preference
  5. URL share state
- generate bucket views from the flat registry instead of maintaining manual
  key lists

Deliverables:

- central runtime store
- pure hydration function
- registry-derived bucket selectors

### Phase 3: Replace Hydration

Goals:

- stop bootstrapping state through overlapping mechanisms
- move storage reads into explicit adapters

Work:

- retire `src/session-defaults.js` as a browser-storage loader
- retire `src/use-query.js` as the owner of bootstrap persistence
- introduce three persistence adapters:
  - URL
  - session storage
  - local storage
- add legacy-read compatibility where required, e.g.
  - `mpe_master_ch` -> `mpe_manager_ch`
  - legacy MIDI-input anchor fields -> new runtime concepts

Deliverables:

- adapter-based hydration
- explicit legacy normalization layer

### Phase 4: Move Writes Out Of Components

Goals:

- remove direct browser-storage mutations from UI and hooks
- centralize persistence side effects

Work:

- remove direct storage writes from:
  - `src/use-settings-change.js`
  - `src/settings/midi/index.js`
  - `src/settings/midi/midioutputs.js`
  - `src/settings/sample/sample.js`
- keep UI components limited to dispatching state changes
- move controller-specific preference persistence into the centralized
  local/session persistence layer

Deliverables:

- centralized write policy
- storage no longer mutated directly by view code

### Phase 5: Redefine URL Behavior

Goals:

- make URL state represent shareable state only
- remove continuous URL churn

Work:

- stop rewriting the URL on every settings change
- serialize only `shareable` keys into URL state
- generate URL state on explicit Share action
- stop mirroring URL state into `localStorage`

Deliverables:

- explicit share serialization
- URL no longer used as continuous persistence transport

### Phase 6: Refactor Preset Semantics

Goals:

- make presets state patches rather than persistence owners

Work:

- keep preset load/revert/dirty logic
- move persistence semantics out of preset code
- keep active preset identity in session scope
- keep `hexatone_persist_on_reload` in local scope
- treat `scale_import` as import/export text, not canonical runtime state

Deliverables:

- preset logic decoupled from persistence mechanics

### Phase 7: Stabilize Derived State

Goals:

- preserve a clean boundary between persisted state and runtime-derived state

Work:

- keep normalization separate from persistence
- ensure runtime normalization consumes canonical state only
- prevent derived values from entering hydration or browser storage

Deliverables:

- canonical-vs-derived boundary enforced in code

### Phase 8: Testing And Cleanup

Goals:

- verify the new persistence architecture
- remove obsolete compatibility code once stable

Work:

- add tests for:
  - hydration precedence
  - bucket membership
  - share serialization
  - reload-toggle behavior
  - legacy key migration
- remove obsolete code in:
  - `src/use-query.js`
  - `src/session-defaults.js`
  - legacy MIDI-input persistence paths

Deliverables:

- stable persistence test coverage
- obsolete persistence code removed

## Recommended Work Order

The safest execution order is:

1. stabilize the contract and tests
2. centralize reads and hydration
3. centralize runtime state
4. centralize writes
5. change URL behavior last

This avoids mixing structural refactoring with product-behavior changes too
early.

## PR-Sized Execution Plan

The full phase plan can be compressed into five implementation chunks.

### PR 1: Persistence Spec And Safety Tests

- finalize this design document
- add registry-driven tests
- add hydration precedence tests
- add legacy key migration tests

### PR 2: Central Hydration Layer

- implement `buildInitialState()`
- add URL, session, and local read helpers
- switch app bootstrap to the central hydration function

### PR 3: Central Store

- introduce one runtime settings store
- route the app and major hooks through it
- remove state ownership from `use-query`

### PR 4: Remove Scattered Storage Writes

- remove direct `sessionStorage` / `localStorage` writes from UI and hooks
- centralize persistence side effects
- move controller preference persistence into the persistence layer

### PR 5: URL Policy Cleanup

- remove continuous URL syncing
- add explicit Share serialization
- remove URL-to-local mirroring
- remove obsolete persistence code
