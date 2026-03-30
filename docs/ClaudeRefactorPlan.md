# Hexatone Persistence / Reactivity Refactor Plan

*Written: 2026-03-30. Based on codebase survey and HexatoneIOrefactor.md.*

---

## The Core Problem

The app has three overlapping persistence stores (URL, localStorage, sessionStorage)
with no single authoritative registry of which keys live where, and no explicit rule
for which settings changes trigger a synth rebuild vs. a lighter update.

The bugs follow directly from that:
- falsy zeros get dropped on restore
- stale synths survive settings changes
- anchor-note logic is duplicated in two places that can drift

---

## Scope Of This Slice

This plan covers **persistence and reactivity only**. It does not include:

- MTS transport or bulk dump feature work
- `keys.js` canvas/input separation
- scale math exact-ratio model
- settings UI renaming (`direct_*` → `mts_bulk_*` etc.)
- `app.jsx` structural decomposition

Those belong to later slices, and will be easier once this foundation is solid.

---

## Step 1 — Fix Falsy-Value Bugs

**No structural change. Two files. Safe to ship immediately.**

### 1a. `src/use-query.js` line 83

Current code silently drops any persisted value that is falsy (`0`, `false`, `""`):

```js
// BROKEN — drops 0, false, ""
if (localStorage.getItem(key)) {
  initial[key] = extract.restore(key);
}
```

Fix:

```js
// CORRECT — only skips when key was never stored
const stored = localStorage.getItem(key);
if (stored !== null) {
  initial[key] = extract.restore(key);
}
```

### 1b. `src/session-defaults.js` — 12 integer keys

Pattern `parseInt(...) || default` collapses `0` to the default.
Affected keys (all in `session-defaults.js`):

| Key | Wrong default when 0 stored |
|---|---|
| `direct_channel` | `-1` |
| `direct_device_id` | `127` |
| `direct_tuning_map_number` | `0` (harmless but wrong) |
| `mpe_lo_ch` | `2` |
| `mpe_hi_ch` | `8` |
| `mpe_pitchbend_range` | `48` |
| `mpe_pitchbend_range_manager` | `2` |
| `midiin_channel` | `0` (harmless but wrong) |
| `midi_channel` | `0` (harmless but wrong) |
| `midi_velocity` | `72` |
| `sysex_type` | `126` |
| `device_id` | `127` |
| `tuning_map_number` | `0` (harmless but wrong) |

Fix pattern (already used correctly for `fluidsynth_channel` and `midiin_steps_per_channel`):

```js
// BROKEN
direct_channel: parseInt(sessionStorage.getItem("direct_channel")) || -1,

// CORRECT
direct_channel: (() => {
  const raw = sessionStorage.getItem("direct_channel");
  return raw !== null ? parseInt(raw) : -1;
})(),
```

### 1c. Tests to write before proceeding

File: `src/use-query.test.js` (extend existing)

- Store `"0"` for an `ExtractInt` key, call restore, assert result is `0` not null
- Store `"false"` for an `ExtractBool` key, call restore, assert result is `false` not null
- Store `""` for an `ExtractString` key, call restore, assert result is `""` not null

File: `src/session-defaults.test.js` (new)

- For each of the 12 affected keys: mock sessionStorage with `"0"`, import
  session-defaults, assert the key value is `0` not the default

---

## Step 2 — Write a Settings Registry

**New file only. No deletions yet. No wiring changes.**

Create `src/persistence/settings-registry.js`.

This is a **flat data table**, not logic. Its purpose is to make every implicit
persistence decision explicit in one place.

### Tier definitions

| Tier | Store | Survives |
|---|---|---|
| `'url'` | URL param + localStorage | browser restart, shared links |
| `'session'` | sessionStorage | tab refresh, not new tab |
| `'local'` | localStorage only | browser restart |
| `'runtime'` | never stored | not persisted at all |

### Shape of each entry

```js
{
  key: 'direct_channel',   // settings object key
  tier: 'session',         // storage tier (see above)
  type: 'int',             // 'int' | 'float' | 'bool' | 'string'
  default: -1,             // value when nothing is stored
}
```

### Runtime-only keys (must never be persisted)

These currently live in `session-defaults.js` mixed with real session keys.
They should be moved to a separate runtime defaults object:

- `spectrum_colors`
- `retuning_mode`
- `key_labels`
- `axis49_center_note`
- `wheel_to_recent`
- `lumatone_center_channel`
- `lumatone_center_note`

### What this unlocks

Once the registry exists:
- `session-defaults.js` can be generated from it rather than hand-maintained
- `useQuery`'s spec object can be generated from it
- It becomes trivial to audit "is this key stored in the right place?"
- Migration between key names is a single registry entry change, not a hunt
  through multiple files

This file does not need to be wired in immediately. Just having it written down
forces classification of every key and makes the next steps safer.

### Tests to write

File: `src/persistence/settings-registry.test.js` (new)

- Every key has a valid `tier` value
- No key appears twice
- All `'runtime'` tier entries have no storage read/write
- All `'session'` entries have a non-null `default`
- All `'int'` and `'float'` entries have a numeric `default`

---

## Step 3 — Document the Reconstruction Boundary Contract

**No new files needed. Comment block added to `src/use-synth-wiring.js`.**

Before any logic moves, explicitly classify every setting by what it triggers.
This makes the next refactors safe: you can check any new setting against this
list before wiring it.

### Proposed classification

**Full synth rebuild** (tears down and recreates all active output engines):
- `instrument` — requires re-loading sample buffers
- `fundamental`, `reference_degree`, `scale` — affects all pitch math
- `midi_device`, `midi_channel`, `midi_mapping` — MTS output routing change
- `mpe_device`, `mpe_lo_ch`, `mpe_hi_ch` — MPE port/channel change
- `output_sample`, `output_mts`, `output_mpe`, `output_direct`, `output_osc` — enable/disable

**Transport-only update** (reconfigures output, no sample reload):
- `direct_device`, `direct_mode` — bulk dump device or mode change
- `device_id`, `tuning_map_number`, `sysex_type` — MTS transport params
- `center_degree` — static bulk map anchor changes

**Canvas-only update** (no synth or transport change):
- `note_colors`, `spectrum_colors`, `fundamental_color`

**No rebuild needed** (runtime/UI state):
- `midi_velocity` — used per-note, not at synth construction
- `direct_sysex_auto` — controls auto-send trigger, not synth shape
- `key_labels`, `retuning_mode` — UI or playback behaviour only

### Action

Add this classification as a comment block at the top of the `useEffect` in
`use-synth-wiring.js` that drives reconstruction. This is ground truth for
future contributors and for your own reference when wiring new settings.

---

## Step 4 — Consolidate Duplicated Anchor Logic

**New file. Removes duplication between two existing files.**

Currently, loading a saved per-controller anchor note appears in two places:

- `src/use-settings-change.js` lines ~69–101 (on device selection)
- `src/use-synth-wiring.js` lines ~509–545 (on MIDI learn)

Both call `detectController()`, read `localStorage.getItem(${ctrl.id}_anchor)`,
and write to `sessionStorage` and `setSettings`. If one is updated, the other
can drift.

Extract into: `src/input/controller-anchor.js`

```js
// Proposed API

/**
 * Load the saved anchor note for a controller from localStorage.
 * Falls back to controller.anchorDefault if nothing saved.
 */
export function loadSavedAnchor(controller) { ... }

/**
 * Save an anchor note for a controller to localStorage.
 */
export function saveAnchor(controller, note) { ... }

/**
 * For Lumatone: load/save the anchor channel too.
 */
export function loadSavedAnchorChannel(controller) { ... }
export function saveAnchorChannel(controller, channel) { ... }
```

Both call sites in `use-settings-change.js` and `use-synth-wiring.js` become
one-liners. This is the first file in the new `src/input/` folder.

### Tests to write

File: `src/input/controller-anchor.test.js` (new)

- Given mock controller + mock localStorage with saved value, returns that value
- Falls back to `controller.anchorDefault` when nothing stored
- `saveAnchor` writes the correct key to localStorage
- Lumatone channel variants work the same way

---

## Step 5 — Wire the Registry Into session-defaults and useQuery

**Replace the hand-maintained lists with generated equivalents.**

Once Steps 1–4 are stable and tested, replace:

- The body of `session-defaults.js` with a loop over `SETTINGS_REGISTRY`
  entries where `tier === 'session'`, using the safe null-check helpers from
  `storage-utils.js` (see below)
- The `spec` object passed to `useQuery` with a loop over entries where
  `tier === 'url'`

This eliminates the risk of a key being declared in one place but not the other.

---

## New Files This Slice Creates

```
src/
  persistence/
    settings-registry.js     flat key/tier/default/type table
    storage-utils.js         safe parseInt/parseBool/parseFloat helpers
    settings-registry.test.js
  input/
    controller-anchor.js     extracted anchor load/save logic
    controller-anchor.test.js
```

---

## Files Modified This Slice

| File | Change |
|---|---|
| `src/use-query.js` | 1-line null-check fix |
| `src/session-defaults.js` | 12 null-check fixes; runtime keys annotated |
| `src/use-synth-wiring.js` | reconstruction boundary comment block added |
| `src/use-settings-change.js` | anchor logic replaced with controller-anchor.js call |
| `src/use-query.test.js` | falsy round-trip tests added |

---

## What NOT To Do In This Slice

- Do not rename `direct_*` keys to `mts_bulk_*` — requires a migration pass,
  will break existing user sessions, belongs to Phase 7 of HexatoneIOrefactor.md
- Do not restructure `app.jsx` — it will shrink naturally as modules are extracted
- Do not touch `keys.js` — canvas/input separation is a separate slice
- Do not implement exact-ratio scale math — future roadmap item
- Do not add new MTS transport features — those build on this foundation, not before it

---

## Suggested Session Order

1. Fix `use-query.js` (1 line) + write tests → confirm green
2. Fix `session-defaults.js` (12 lines) + write tests → confirm green
3. Write `src/persistence/settings-registry.js` (data only)
4. Write `src/persistence/storage-utils.js` (safe parse helpers)
5. Write `settings-registry.test.js` → confirm green
6. Extract `src/input/controller-anchor.js` + tests → confirm green
7. Add reconstruction boundary comment to `use-synth-wiring.js`
8. Wire registry into `session-defaults.js` and `useQuery` (Step 5)

Each step is independently shippable. Steps 1–2 can go to production immediately
and will fix real user-facing bugs. Steps 3–8 are structural improvements with
no user-visible change.

---

## Review Gates Before Moving To Next Slice

Before calling this slice complete:

1. `"0"` round-trips correctly through both `useQuery` and `session-defaults`
   for every numeric key
2. Every key in `session-defaults.js` and `useQuery`'s spec appears in
   `settings-registry.js` with a classified tier
3. No `runtime`-tier key is ever written to any storage
4. Anchor load/save logic exists in exactly one place
5. Reconstruction boundary is documented and matches current wiring behaviour
6. All new and modified tests pass under `yarn test`

---

## Next Slice: Tuning Module Extraction + Exact Interval Architecture

*Added: 2026-03-30. Based on discussion of xen-dev-utils integration goal.*

### Phase 2 implementation summary

*Completed: 2026-03-30.*

Three canonical tuning modules created in `src/tuning/`. The duplicate
`centsToMTS` in `midi_synth/index.js` was removed. `mts-helpers.js` was
converted to a re-export shim so all existing callers continue to work without
changes; it is ready to be deleted once callers are migrated.

**New files:**

| File | Contents |
|---|---|
| `src/tuning/mts-format.js` | `centsToMTS`, `mtsToMidiFloat`, `sanitizeBulkDumpName`, `resolveBulkDumpName`, `buildRealtimeSingleNoteMessage`, `buildBulkDumpMessage` |
| `src/tuning/center-anchor.js` | `degree0ToRef`, `computeCenterPitchHz`, `computeNaturalAnchor`, `chooseStaticMapCenterMidi`, `computeStaticMapDegree0` |
| `src/tuning/tuning-map.js` | `buildTuningMapEntries`, `patchTuningEntry`, `mtsTuningMap` |
| `src/tuning/mts-format.test.js` | 36 tests — round-trips, edge cases, message structure |
| `src/tuning/center-anchor.test.js` | 23 tests — degree0ToRef, Hz derivation, anchor selection |
| `src/tuning/tuning-map.test.js` | 22 tests — 128-entry output, identity tuning, Partch integration |

**Modified files:**

- `src/keyboard/mts-helpers.js` — converted to re-export shim (no logic remains);
  TODO comment lists the 4 callers to migrate before deletion:
  `keys.js`, `use-synth-wiring.js`, `midi_synth/index.js`, `midioutputs.js`
- `src/midi_synth/index.js` — duplicate `centsToMTS` removed; now re-exports
  from `src/tuning/mts-format.js`
- `src/keyboard/mts-helpers.test.js` — converted to shim-verification test (15
  smoke tests confirming all re-exports are callable and correct); full coverage
  lives in `src/tuning/*.test.js`

**Key discipline maintained:** `src/tuning/` modules accept numeric cents only.
No string-to-cents conversion is embedded in them — callers that need it import
`scalaToCents` from `parse-scale.js` independently. This keeps the tuning
boundary clean for the future exact-interval layer (Phase 2.5).

**Test gate:** all 81 new tests pass; the 10 pre-existing failures in
`scale-table`, `colors`, `index`, `scale-index`, and `lumatone-export` are
unchanged.

### Recommended order (remaining)

**Phase 2 — Extract tuning module** ✓ done 2026-03-30 (see implementation summary above).
Pending: migrate the 4 shim callers to direct `src/tuning/` imports, then delete `mts-helpers.js`.

**Phase 1 output runtime** (do after Phase 2):

Extract `deriveOutputRuntime()` into `src/output/output-modes.js`. This is
cleaner once the tuning primitives are already in their own module. See
`HexatoneIOrefactor.md` Phase 1 section for the suggested shape.

**Phase 2.5 — Exact interval layer** (add after tuning module is stable):

Goal: stop discarding ratio identity at the normalize() boundary.

Add `src/tuning/interval.js` — a thin wrapper around `xen-dev-utils` `Fraction`
and `toMonzo()` that parses a scale degree string and exposes:

```js
// Suggested shape — not yet implemented
export function parseInterval(str) {
  // returns { cents, fraction, monzo }
  // cents: float, computed via exact log2 from Fraction where possible
  // fraction: xen-dev-utils Fraction instance (null for cents/EDO inputs)
  // monzo: prime exponent vector (null for non-JI inputs)
}
```

Wire this into `normaliseDegree` and `scalaToCents` as a drop-in replacement.
Downstream code (normalize, mts-helpers) continues to receive `number[]` cents —
no other change required at this stage.

**Phase 3 — Input runtime model** (do after output runtime and interval layer):

See `HexatoneIOrefactor.md` Phase 3 section for `inputRuntime` derived object
and `mapMidiEventToHexIntent` adapter. By this point the output boundary is
clean and the interval layer provides a stable foundation.

### xen-dev-utils dependency

`xen-dev-utils` (npm: `xen-dev-utils`) provides:

- `Fraction` — exact rational arithmetic; avoids float error in ratio→cents
- `toMonzo()` — prime exponent vectors; enables JI identity checks, temperament
  calculations, and harmonic-radius selection without float blowup
- `getConvergents()` — best rational approximations; useful for nearest-valid-
  tuning selection in future dynamic retuning work

Add as a production dependency (`yarn add xen-dev-utils`) before starting
Phase 2.5. It is already present if you ran `yarn add` after reading this.

The long-term goal is that `src/tuning/interval.js` becomes the single place
where scale degree strings are parsed to exact form, and all downstream math
(MTS encoding, harmonic analysis, export) derives from that representation.
Cents remain the output currency at the MTS boundary only.

---

## Phase 3: Input Runtime Model

*Written: 2026-03-30.*

### Design principles

MIDI input is treated as a flat space of 2048 entities: 128 notes × 16 channels.
Each `ch.note` combination is a unique voice identity. This allows polyphonic
controllers, multi-channel sequencers, and MPE devices to all be handled by
the same note-tracking map (`activeMidi: Map<ch.note, hex>`) without special
casing.

### Two top-level input targets

#### Target A: `hex_layout` (current, extended)

Incoming MIDI selects hexes by position. Two layout modes:

- `controller_geometry`: 2D controller map lookup (O(1), no arithmetic)
- `sequential`: step arithmetic on note + channel offset → `bestVisibleCoord`

This is the current implemented family. Phase 3 extends it with proper CC
routing, MPE per-channel expression, and cleaner pitch bend routing modes.

#### Target B: `scale` (new)

Incoming MIDI is interpreted as pitch intent, not position intent. The incoming
note's absolute pitch (derived from its MIDI note number and any embedded
tuning data) is matched to the nearest scale degree within a user-configurable
tolerance in cents. The matching hex is triggered at that degree.

Use cases:
- Playing a standard keyboard into a microtonal scale
- Receiving a DAW MIDI sequence and mapping it into the current scale
- Future: sequences with embedded MTS sysex — the sysex pitch overrides the
  12-EDO note number for degree matching
- Future: dynamic retuning by harmonic radius

Scale target does not use anchor note, anchor channel, or controller geometry.
It receives from all channels simultaneously. A polyphonic sequence on multiple
channels holds multiple simultaneous voices, each tracked by `ch.note`.

### New settings keys

| Key | Tier | Type | Default | Meaning |
|---|---|---|---|---|
| `midiin_mapping_target` | session | string | `"hex_layout"` | `"hex_layout"` or `"scale"` |
| `midiin_mpe_input` | session | bool | `false` | Treat incoming data as MPE (per-channel voice routing) |
| `midiin_scale_tolerance` | url | int | `50` | Max matching distance in cents for scale target |

### CC passthrough

All CCs pass through to the output channel (or MPE manager channel) by default.
No filtering — the user manages what their controller sends. This includes
CC123 (all notes off), CC120 (all sound off), CC121 (reset controllers), CC0/32
(bank select). The internal sustain logic (CC64, CC66) still fires as well as
passing through — consume AND forward.

Beyond passthrough, the following CCs are also consumed internally to drive
Hexatone's own voice management:
- **CC64 (sustain)**: drives `sustainOn/Off` as currently; also passed through
- **CC66 (sostenuto)**: drives sostenuto logic (to be implemented); also passed through
- **CC67 (soft pedal)**: drives soft-pedal attenuation (to be implemented); also passed through
- **Channel pressure**: drives per-voice pressure routing (see below); also passed through

Destination for passthrough:
- Non-MPE output: send on the configured output channel
- MPE output: send on the manager channel (zone-wide application per MPE spec)

### Pitch bend routing modes

Pitch bend has two modes, selectable per user preference:

**Mode 1: Recency stack (current default)**
- Pitch bend targets the most-recently-played note (`recencyStack.front`)
- Scale-aware option: asymmetric bend toward adjacent scale degrees
- Fixed-range option: symmetric bend with configurable Scala interval

**Mode 2: All notes**
- Pitch bend is applied to every currently sounding hex simultaneously
- For MPE output: send on the manager channel (per MPE spec, this is zone-wide
  and affects all sounding voices automatically — correct and cheap: one message)
- For MTS output: send one real-time single-note MTS retune per active voice per
  bend event — acceptable for typical polyphony counts (≤8 voices)
- For sample synth: retune each active hex directly

**In MPE input mode**: pitch bend is per-channel (per-voice). Each channel's
bend is routed to the hex registered on that channel (`activeMidiByChannel`),
independent of the recency stack. The recency stack / all-notes modes do not
apply when MPE input is active.

MPE input is intended to work with **all output synth types** — sample, MTS
real-time, MTS bulk, and MPE output. The per-channel expression data (pitch
bend, pressure, CC74) is forwarded to each hex's expression interface regardless
of which output engine is active. The output engine decides how to render it
(MPE output: per-channel PB; MTS output: real-time retune message; sample: Web
Audio parameter).

### Channel pressure routing modes

Same two modes as pitch bend:

**Mode 1: Recency stack**
- Channel pressure targets `recencyStack.front`
- "Strike and modulate" style — press a key, then apply pressure to it

**Mode 2: All notes**
- Channel pressure applied to all currently sounding hexes simultaneously

**In MPE input mode**: channel pressure is per-channel, routed by channel to
the matching hex, independent of the recency stack.

Passthrough: channel pressure also forwarded to output channel / manager channel.

### Polyphonic aftertouch

Unchanged from current behaviour. Routed by `ch.note` key to the matching
active hex. Inherently polyphonic — no routing mode needed. Passed through to
output as polyphonic key pressure (0xA0) on the output channel.

### CC74, mod wheel (CC1), expression (CC11)

These are not currently routed to hexes. Phase 3 adds:

- `hex.cc74(value)` — brightness/timbre; sent as CC74 on MPE voice channel
  (per-voice in MPE mode), or on output channel (global in non-MPE mode)
- `hex.modwheel(value)` — CC1; always routed to output/manager channel (global)
- `hex.expression(value)` — CC11; always routed to output/manager channel

In MPE input mode, CC74 arriving on a voice channel is routed to the matching
hex's `cc74()` method. All other CCs arriving on any channel pass through to
the manager channel.

### `inputRuntime` derived object

Introduce in `app.jsx` before passing to `Keys`. Derives explicit mode from
persisted settings, decoupling `keys.js` from legacy setting names:

```js
const inputRuntime = {
  target: settings.midiin_mapping_target || "hex_layout",
  layoutMode: settings.midi_passthrough ? "sequential" : "controller_geometry",
  mpeInput: !!settings.midiin_mpe_input,
  seqAnchorNote: settings.midiin_central_degree ?? 60,
  seqAnchorChannel: settings.midiin_anchor_channel ?? 1,
  stepsPerChannel: settings.midiin_steps_per_channel,
  legacyChannelMode: settings.midiin_channel_legacy,
  scaleTolerance: settings.midiin_scale_tolerance ?? 50,
  pitchBendMode: settings.midiin_pitchbend_mode || "recency",  // "recency" | "all"
  pressureMode: settings.midiin_pressure_mode || "recency",    // "recency" | "all"
};
```

### Hex interface additions

All hex types (`MidiHex`, `MpeHex`, `ActiveHex`, `DynamicBulkHex`,
`StaticBulkHex`) must implement:

```js
hex.cc74(value)       // 0–127; brightness/timbre
hex.modwheel(value)   // 0–127; CC1
hex.expression(value) // 0–127; CC11
hex.pressure(value)   // 0–127; channel pressure (alias for aftertouch in non-MPE)
```

### Step-by-step action plan

Each step is independently shippable and tested before moving to the next.

---

#### Step 3.1 — `inputRuntime` derived object

**File:** `src/app.jsx`

Derive `inputRuntime` from settings before passing to `Keys`. No behaviour
change — this is a refactor that makes the current implicit mode switching
explicit and gives later steps a clean contract to build on.

```js
const inputRuntime = {
  target: settings.midiin_mapping_target || "hex_layout",
  layoutMode: settings.midi_passthrough ? "sequential" : "controller_geometry",
  mpeInput: !!settings.midiin_mpe_input,
  seqAnchorNote: settings.midiin_central_degree ?? 60,
  seqAnchorChannel: settings.midiin_anchor_channel ?? 1,
  stepsPerChannel: settings.midiin_steps_per_channel,
  legacyChannelMode: settings.midiin_channel_legacy,
  scaleTolerance: settings.midiin_scale_tolerance ?? 50,
  pitchBendMode: settings.midiin_pitchbend_mode || "recency",
  pressureMode: settings.midiin_pressure_mode || "recency",
};
```

Pass `inputRuntime` to `Keys` alongside `settings`. `Keys` reads input mode
from `inputRuntime`, not directly from `settings`, for all input decisions.

**New settings to add to registry:**

| Key | Tier | Type | Default |
|---|---|---|---|
| `midiin_mapping_target` | session | string | `"hex_layout"` |
| `midiin_mpe_input` | session | bool | `false` |
| `midiin_scale_tolerance` | url | int | `50` |
| `midiin_pitchbend_mode` | session | string | `"recency"` |
| `midiin_pressure_mode` | session | string | `"recency"` |

**Review gate:** no behaviour change; all existing tests pass.

---

#### Step 3.2 — Hex interface: expression methods

**Files:** `src/midi_synth/index.js`, `src/mpe_synth/index.js`,
`src/sample_synth/index.js`, `src/composite_synth/index.js`

Add four methods to every hex type. No-ops are acceptable where the output
engine cannot use them yet — the point is a uniform interface.

```js
hex.pressure(value)    // 0–127 — channel pressure
hex.cc74(value)        // 0–127 — brightness/timbre (MPE dimension 3)
hex.modwheel(value)    // 0–127 — CC1 (global in non-MPE, manager ch in MPE)
hex.expression(value)  // 0–127 — CC11
```

**`MidiHex`:** `pressure` → polyphonic key pressure (0xA0) on carrier note;
`cc74` → CC74 on output channel; `modwheel`/`expression` → CC on output channel.

**`MpeHex`:** `pressure` → channel pressure (0xD0) on voice channel (already
partially implemented as `aftertouch`; rename/alias); `cc74` → CC74 (0xB0)
on voice channel; `modwheel`/`expression` → on manager channel.

**`ActiveHex` (sample):** `pressure`/`cc74` → Web Audio gain/filter modulation
where supported; no-op otherwise.

**Tests:** `src/input/hex-interface.test.js` — verify each method exists and
calls the correct MIDI send on a mock output.

**Review gate:** all hex types implement all four methods; tests pass.

---

#### Step 3.3 — CC passthrough and full CC routing

**File:** `src/keyboard/keys.js`

Extend the `controlchange` listener to:

1. **Pass all CCs through** to the configured output channel (or MPE manager
   channel when MPE output is active). No filtering.
2. **Consume internally** for CC64 (sustain), CC66 (sostenuto, stub),
   CC67 (soft pedal, stub), CC123, CC120, CC121 — in addition to passthrough.
3. **Route CC74 to active hexes** in MPE input mode: look up hex by channel,
   call `hex.cc74(value)`.
4. **Route CC1 / CC11** to `hex.modwheel` / `hex.expression` on all active
   hexes (global broadcast in non-MPE mode).

Add a `channelpressure` listener (distinct from `keyaftertouch`):
- In recency mode: route to `recencyStack.front.pressure(value)`
- In all-notes mode: route to every active hex's `pressure(value)`
- Always pass through to output channel / manager channel

**Tests:** `src/input/cc-routing.test.js` — mock MIDI output; verify passthrough
bytes, internal CC64 sustain, CC74 per-channel routing (MPE mode), CC1 broadcast.

**Review gate:** all CCs pass through; CC74 routed correctly in MPE mode;
sustain still works; tests pass.

---

#### Step 3.4 — Pitch bend and pressure routing modes

**File:** `src/keyboard/keys.js`

Extend `_handleWheelBend` and add `_handleChannelPressure`:

**Pitch bend:**
- `"recency"` mode (current): target `recencyStack.front` — unchanged
- `"all"` mode: iterate `state.activeMidi`, call `hex.retune(bentCents)` on
  each; for MPE output additionally send bend on manager channel (one message,
  zone-wide per MPE spec — do not also retune individual MPE voices)

**Channel pressure:**
- `"recency"` mode: target `recencyStack.front.pressure(value)`
- `"all"` mode: iterate `state.activeMidi`, call `hex.pressure(value)` on each

Both modes also pass through to the output channel (non-MPE) or manager channel
(MPE).

**Tests:** `src/input/routing-modes.test.js` — verify recency vs all-notes
dispatch using mock hexes and a stub recency stack.

**Review gate:** both modes work; no regressions on existing wheel behaviour;
tests pass.

---

#### Step 3.5 — MPE input mode

**File:** `src/keyboard/keys.js`

Add `activeMidiByChannel: Map<channel, hex>` alongside the existing
`activeMidi: Map<note_played, hex>`.

When `inputRuntime.mpeInput` is true:
- `noteon`: register hex in both maps
- `noteoff`: remove from both maps
- `pitchbend` on channel N: look up `activeMidiByChannel.get(N)`, call
  `hex.retune(bentCents)` — do not use recency stack
- `channelpressure` on channel N: look up by channel, call `hex.pressure(value)`
- `controlchange` CC74 on channel N: look up by channel, call `hex.cc74(value)`
- All other CCs: pass through to manager channel regardless of source channel

MPE input works with all output synth types (sample, MTS, MPE, bulk). The hex's
`retune`/`pressure`/`cc74` methods do the right thing for each output engine.

**Tests:** `src/input/mpe-input.test.js` — verify per-channel routing; verify
no cross-channel bleed; verify fallback to non-MPE when `mpeInput` is false.

**Review gate:** per-channel expression routes correctly to the right hex for
all three output modes (sample, MTS, MPE); tests pass; no stuck notes introduced
(run manual MPE controller test before marking complete).

---

#### Step 3.6 — Scale target input mode

**New file:** `src/input/scale-mapper.js`

Pure function: given a MIDI note number, an octave context, the current scale
(numeric cents array), equave, and tolerance in cents, return the nearest scale
degree within tolerance, or null if no degree is close enough.

```js
export function findNearestDegree(midiNoteCents, scale, equave, toleranceCents) {
  // midiNoteCents: absolute pitch in cents (MIDIcents * 100 - 6900 gives cents from A4)
  // returns { degree, octave, distanceCents } or null
}
```

Wire into `keys.js`: when `inputRuntime.target === "scale"`, replace the
coordinate-resolution block in `midinoteOn` with a call to `findNearestDegree`,
then look up the hex coords for that degree and octave.

Passthrough of pitch bend, pressure, CC74 is identical to hex_layout mode —
the routing mode (recency/all/MPE) still applies.

Future extension points (not implemented now, but the function signature
accommodates them):
- MTS sysex pitch override: pass `overrideCents` instead of deriving from note number
- Harmonic radius matching: replace distance metric with monzo-based JI distance

**Tests:** `src/input/scale-mapper.test.js` — nearest degree in 12-EDO, 31-EDO,
JI scale; tolerance gate (too far → null); octave wrapping; exact match.

**Review gate:** scale target correctly triggers hexes by pitch for both keyboard
and sequencer input; tolerance setting works; tests pass.

### Known issues / TODOs

**TODO (high priority):** Pitch bend smoothness is unsatisfactory across all
synths and MPE output has stuck-note issues. These must be investigated before
or during Phase 3 step 4. Likely causes to audit:

- `_handleWheelBend` fires on every raw MIDI pitch-bend event (up to ~500/sec
  at 14-bit resolution); each call may trigger an MTS retune message or MPE
  bend update — check for message flooding and add throttling if needed
- MPE stuck notes: `noteOff` is never delayed (by design), but a PB message
  arriving after `noteOff` on a RELEASING channel could interact with the
  `releaseGuardMs` window — audit the timing in `MpeHex.noteOff` and the pool
  state machine
- `retrigger` flag in `pool.noteOn` — check whether the retrigger path always
  sends a clean noteOff before the new noteOn, especially when the stolen voice
  is in RELEASING state
- The `Ableton_workaround` mode in `freqToMidiAndCents` uses `channel % 16` as
  the base MIDI note — verify this doesn't produce out-of-range notes at the
  extremes of the voice channel range, which could cause silent stuck notes

**TODO (bug — preset/scale reactivity):** When the user generates an equal
division scale (e.g. "Divide Equave into 12 Equal Divisions") after having
loaded a built-in preset, the preset selector menu should automatically switch
focus to "User Tunings" and display the generated scale name (e.g. "12ed2").
This behaviour used to work and is now broken — likely a regression from the
persistence refactor (Step 5), where the scale/preset dirty-detection or the
`name`/`description` fields are no longer being set correctly when
`scale_divide` fires. Investigate in `use-presets.js` and the `scale_divide`
handler in `use-settings-change.js`.
