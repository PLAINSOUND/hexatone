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
