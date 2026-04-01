# Hexatone Issues

*Generated: 2026-04-01. Source: ClaudeRefactorPlan.md, TODO.md, HexatoneIOrefactor.md, midi-input-ux.md*

Tags: `todo` `done` · Priority: `high` `medium` `low` · Complexity: `trivial` `small` `medium` `large` `xlarge`

---

## Bugs

### BUG-01 · Preset/scale reactivity regression
**Tags:** `todo` `high` `small`

After generating an equal division scale (e.g. "Divide Equave into 12 Equal Divisions"), the preset selector does not switch focus to "User Tunings" and does not display the generated scale name (e.g. "12ed2"). This behaviour worked before the persistence refactor (Step 5) and is now broken.

**Investigate:** `use-presets.js` dirty-detection logic and the `scale_divide` handler in `use-settings-change.js`. Likely the `name`/`description` fields are no longer being set correctly when `scale_divide` fires.

---

### BUG-02 · Pitch bend smoothness and MPE stuck notes
**Tags:** `todo` `high` `large`

Pitch bend is unsatisfactory across all synths, and MPE output has stuck-note issues.

**Likely causes to audit:**
- `_handleWheelBend` fires on every raw MIDI pitch-bend event (~500/sec at 14-bit resolution); may be flooding MTS retune or MPE bend messages — add throttling if needed.
- MPE stuck notes: `noteOff` is never delayed, but a PB message arriving after `noteOff` on a RELEASING channel could interact with the `releaseGuardMs` window — audit timing in `MpeHex.noteOff` and the pool state machine.
- `retrigger` flag in `pool.noteOn` — check whether the retrigger path always sends a clean `noteOff` before the new `noteOn`, especially when the stolen voice is in RELEASING state.
- `Ableton_workaround` mode in `freqToMidiAndCents` uses `channel % 16` as the base MIDI note — verify this doesn't produce out-of-range notes at the extremes of the voice channel range (silent stuck notes).

---

### BUG-03 · Fundamental defaults to wrong value on fresh load
**Tags:** `todo` `medium` `small`

When "Restore preset on reload" is unchecked and the user refreshes, the fundamental frequency from the last loaded preset persists instead of resetting to the expected default. The `fundamental` key is `tier: 'url'` in the registry (synced to URL + localStorage), so it survives reload even when preset-skip keys are cleared.

**Fix options:**
- When preset restoration is disabled on load, clear `fundamental` from localStorage (and from the URL if present) so the registry default is used.
- Or: change the registry default from `260.740741` (middle C at A=440) to `440` (concert A), and update `reference_degree` default to the A-degree of the default scale. Users expect 440.

---

### BUG-04 · `lumatone-export.js` geometry inconsistencies (6 failing tests)
**Tags:** `todo` `medium` `medium`

`src/settings/scale/lumatone-export.js` has a standalone hex geometry implementation (`BOARD_KEY_COORDS`, `keyStepsFromRef`) that duplicates logic now in `controllers/registry.js`. The export tests expose inconsistencies: wrong col range, wrong step values for key 33.

**Do not fix these tests individually** — they will be replaced when the module is rewritten. See ARCH-05.

---

## Architecture / Refactoring

### ARCH-01 · Migrate 4 shim callers off `mts-helpers.js`
**Tags:** `todo` `medium` `small`

`src/keyboard/mts-helpers.js` was converted to a re-export shim pointing at `src/tuning/mts-format.js`. Four callers still import from the shim instead of the canonical module:

- `src/keyboard/keys.js`
- `src/use-synth-wiring.js`
- `src/midi_synth/index.js`
- `src/midioutputs.js`

Once all four are migrated to direct `src/tuning/` imports, `mts-helpers.js` can be deleted.

---

### ARCH-02 · Extract `deriveOutputRuntime()` into `src/output/output-modes.js`
**Tags:** `todo` `medium` `medium`

The output runtime derivation is currently inline inside `use-synth-wiring.js`. Extracting it into `src/output/output-modes.js` is Phase 1 of the IO refactor:

- Makes output mode logic independently testable
- Parallels the already-completed `inputRuntime` derived object in `app.jsx`
- Enables `use-synth-wiring.js` to consume the derived object cleanly

See `HexatoneIOrefactor.md` Phase 1 section for the proposed shape.

---

### ARCH-03 · Complete `inputRuntime` — move remaining fields out of `keys.js` direct `settings` reads
**Tags:** `todo` `medium` `medium`

Step 3.1 of Phase 3 is partially done: `bendRange`, `bendFlip`, `wheelSemitones`, `target`, `scaleTolerance`, `scaleFallback` are in `inputRuntime`. `keys.js` still reads some fields directly from `settings`. All input mode decisions should come from `inputRuntime`, not `settings`, to decouple `keys.js` from legacy setting names.

**Review `inputRuntime` in `app.jsx`** and audit any remaining direct `settings.midiin_*` reads in `keys.js` that should come from `inputRuntime`.

---

### ARCH-04 · Split `keys.js` into input-handler modules
**Tags:** `todo` `low` `xlarge`

`keys.js` is ~2300+ lines mixing rendering, input handling, MIDI routing, and audio triggering. Suggested splits:

- **`src/input/midi-input-handler.js`** — MIDI listener setup, `midinoteOn/Off`, `allnotesOff`, channel arithmetic, step table, recency stack, pitch bend methods. Interface: receives a `Keys` instance; returns `deconstruct()`.
- **`src/input/pointer-input-handler.js`** — Touch, mouse, computer-keyboard event handlers.
- **`src/keyboard/hex-renderer.js`** — `drawHex`, `drawGrid`, `hexCoordsToScreen`, `getHexCoordsAt`, colour computation, label rendering. Pure rendering with no input/audio deps.

**Do when `keys.js` needs significant new features** (e.g. controller overlay rendering) — not urgent on its own.

---

### ARCH-05 · Rewrite `lumatone-export.js` using registry geometry
**Tags:** `todo` `medium` `large`

`src/settings/scale/lumatone-export.js` has a standalone hex geometry implementation that duplicates `controllers/registry.js` (`buildLumatoneMap`, `LUMATONE_BLOCK_OFFSETS`). This causes the 6 failing export tests (see BUG-04).

**Plan:**
- Rewrite `lumatone-export.js` to derive key positions from `buildLumatoneMap` — the authoritative source.
- Eliminates duplicate geometry; fixes test failures as a side effect.
- Enables correct export for arbitrary anchor positions (not just the hardcoded default).
- Ensure exported `.ltn` files are valid for the standard Lumatone editor format.

**Do after Phase 3 input work is stable** (controller geometry layer must be frozen first).

---

### ARCH-06 · Unify state persistence (URL/session/local)
**Tags:** `todo` `low` `xlarge`

Three overlapping stores with no clear rules. Problems:
- `useQuery` writes to both URL and localStorage on every `setSettings` call → URLs grow enormous; localStorage goes stale when URL is shared.
- `sessionDefaults` reads sessionStorage *before* `useQuery` runs → fragile merge order.
- `PRESET_SKIP_KEYS` doesn't match `SCALE_KEYS_TO_CLEAR` → asymmetries on reset.

**Proposed model:**
- **URL params:** Shareable layout state only. Written on explicit "share" action, not on every change.
- **sessionStorage:** All transient state (MIDI devices, output toggles, instrument, preset tracking). Read on mount, written on change.
- **localStorage:** User presets only (already handled by `custom-presets.js`). Remove the localStorage mirror from `useQuery`.

This eliminates the URL-gets-enormous problem and the three-way merge on load.

---

### ARCH-07 · `app.jsx` structural decomposition
**Tags:** `todo` `low` `large`

`app.jsx` is large and mixes concerns. Will shrink naturally as remaining hooks and modules are extracted. Deferred — do not restructure proactively; extract specific pieces as they are needed.

Remaining hook extractions identified in `TODO.md`:
- **`useScaleImport`** — `onImport` handler + `importCount`; import parsing (Scala format, Hexatone JSON, labels, colours, metadata detection) is entirely independent of other concerns.
- **`useSessionDefaults`** — 50-line `sessionDefaults` object into a hook or factory that reads sessionStorage once and returns merged defaults.

---

## Tests

### TEST-01 · `src/input/scale-mapper.test.js` — missing tests for scale target input
**Tags:** `todo` `medium` `small`

`scale-mapper.js` exists and is wired in, but the test file called for in the plan has not been written.

**Cases to cover:**
- Nearest degree in 12-EDO
- Nearest degree in 31-EDO
- Nearest degree in a JI scale
- Tolerance gate: pitch too far from any degree → returns `null` in `'discard'` mode
- `'accept'` mode: always returns best match regardless of distance
- Octave wrapping (pitch near equave boundary matches degree 0 of next octave)
- Exact match (0¢ distance)
- Negative pitchCents (notes below the reference)

---

### TEST-02 · Controller registry tests
**Tags:** `todo` `low` `medium`

- Each controller's `buildMap()` returns correct `(x, y)` for known anchor values.
- `detectController()` matches expected device name strings.
- Anchor at `(0, 0)` for the anchor key.
- Map size matches expected key count (98 for AXIS-49, 280 for Lumatone, etc.).

---

### TEST-03 · `midinoteOn/Off` integration tests
**Tags:** `todo` `low` `large`

Mock synth + mock canvas → verify `hexOn` called with correct coords for known controller input. Also: step arithmetic for generic keyboard input; sustain + latch behaviour with MIDI input.

---

### TEST-04 · Synth wiring tests
**Tags:** `todo` `low` `medium`

- `useSynthWiring` creates correct synth type for each output combination.
- `create_composite_synth` fans out `noteOn/Off` to all children.
- Volume/mute propagates imperatively.

**Do after `useScaleImport` hook extraction** (ARCH-07) — the hook boundary makes the synth lifecycle independently testable.

---

### TEST-05 · `src/input/controller-anchor.test.js` — anchor load/save coverage
**Tags:** `todo` `low` `small`

- Given mock controller + mock localStorage with saved value, returns that value.
- Falls back to `controller.anchorDefault` when nothing stored.
- `saveAnchor` writes the correct key to localStorage.
- Lumatone channel variants work the same way.
- `loadControllerPrefs` applies `!!controller.mpe` as default for `midiin_mpe_input`.

---

## Features / Future Roadmap

### FEAT-01 · Exact interval layer (`src/tuning/interval.js`)
**Tags:** `todo` `low` `xlarge`

**Phase 2.5.** Stop discarding ratio identity at the `normalize()` boundary.

Add `src/tuning/interval.js` — a thin wrapper around `xen-dev-utils` `Fraction` and `toMonzo()`:

```js
export function parseInterval(str) {
  // returns { cents, fraction, monzo }
  // cents: float, computed via exact log2 from Fraction where possible
  // fraction: xen-dev-utils Fraction instance (null for cents/EDO inputs)
  // monzo: prime exponent vector (null for non-JI inputs)
}
```

Wire into `normaliseDegree` and `scalaToCents` as a drop-in replacement. All downstream code continues to receive `number[]` cents. Enables future JI identity checks, temperament calculations, and harmonic-radius selection.

**Dependency:** `yarn add xen-dev-utils`

---

### FEAT-02 · Scale-mapper: MTS sysex pitch override
**Tags:** `todo` `low` `medium`

Extension point in `findNearestDegree`: accept `overrideCents` instead of deriving pitch from the MIDI note number. Enables scale-target input from DAW sequences with embedded MTS sysex tuning data.

---

### FEAT-03 · Scale-mapper: monzo-based JI harmonic radius matching
**Tags:** `todo` `low` `large`

Replace the cent-distance metric in `findNearestDegree` with a monzo-based JI harmonic distance metric. For a JI scale, this selects the most harmonically proximate degree rather than the nearest in log-frequency space.

**Depends on:** FEAT-01 (exact interval layer providing monzo representations).

---

### FEAT-04 · Exquis dual-mode support (poly-AT vs MPE)
**Tags:** `todo` `medium` `medium`

Exquis in Rainbow Layout can send either polyphonic aftertouch or MPE. The registry currently marks Exquis as `mpe: true`. This needs revisiting:
- Detect or let the user select which mode the device is in.
- **Poly-AT mode:** route `keyaftertouch` per-note; no per-note bend.
- **MPE mode:** full per-channel expression routing (pitch bend, pressure, CC74).
- The geometry (`buildExquisMap`) is correct for both modes — only `inputRuntime.mpeInput` and CC routing in `keys.js` change.

**Do after Step 3.5 MPE input mode is fully stable.**

---

### FEAT-05 · Settings key renaming (`direct_*` → `mts_bulk_*`)
**Tags:** `todo` `low` `medium`

UI-facing settings keys like `direct_device`, `direct_mode`, `direct_channel` etc. use internal implementation names rather than domain names. Renaming to `mts_bulk_*` would make the UI and settings more self-explanatory.

**Requires a migration pass** to avoid breaking existing user sessions. Deferred.

---

### FEAT-06 · OCT button behaviour for static bulk dump
**Tags:** `todo` `medium` `medium`

The OCT button applies an octave shift to the view. The static bulk dump must mirror this:
- **Non-deferred OCT:** recalculate the 128-note map (shift carrier slots by 12 semitones) and re-send when auto-send is on.
- **Deferred OCT:** skip carrier slots currently held by sounding notes, send the rest, then update deferred slots as each note releases.

This ties the UI OCT state directly to the static bulk transport. Must be resolved before finalising static bulk behaviour.

---

### FEAT-07 · TS16 and Tonal Plexus controller registry entries
**Tags:** `todo` `low` `small`

Two controllers are planned but not yet added to `src/controllers/registry.js`:
- **TS16** — single-channel non-MPE (similar to TS41).
- **Tonal Plexus** — multichannel non-MPE, 205-EDO, channels 3–14.

---

## Cleanup

### CLEAN-01 · Dead code removal
**Tags:** `todo` `low` `trivial`

- `controllers/axis49.js` — legacy exports `AXIS49_MAP`, `getAxis49Position` (replaced by registry.js).
- `controllers/lumatone.js` — `buildLumatoneRawCoords` duplicated in `registry.js`'s `buildLumatoneMap`.
- `use-query.js` — `ExtractArray` class and array extractors (`restore()` and `store()` both return null with `// TODO`; never used).
- `settings/scale/colors.test-fix-unfinished.js` — incomplete test file.
- Commented-out `console.log` statements — remove or convert to a debug flag.

---

### CLEAN-02 · MIDI input settings panel — remaining UX spec items
**Tags:** `todo` `low` `small`

From `midi-input-ux.md`, items not yet confirmed as implemented:

- **Unknown controller info text** — may still appear ("Controller not recognised as 2D isomorphic…"). If still present, remove entirely.
- **Exquis SysEx Output status row** — should be wrapped in `{false && ...}` with a comment. Confirm this is in place.
- **`showChannelTranspose` formula** — confirm final formula (`isMultiChannelSequential = !ctrl || ctrl.multiChannel`) is in the current code.
- **Lumatone Layout file row** — confirm hidden in sequential mode (`{!props.settings.midi_passthrough && <label>...`).
- **Pitch Bend Interval** — confirm both forms (Scala / semitone) are rendered outside the MPE block, with the correct switch condition.

---

### CLEAN-03 · Code style consistency
**Tags:** `todo` `low` `trivial`

- Semicolons: mixed across files. Pick a convention and enforce with a linter.
- `PropTypes`: used in some components but not others. Either adopt everywhere or remove consistently.
- `JSON.stringify` for array deps (`scaleKey`, `noteNamesKey`, `noteColorsKey`) — runs on every render. Replace with shallow array comparison.

---

## Completed (for reference)

### DONE: Persistence refactor (Steps 1–5)
**Tags:** `done`
`settings-registry.js`, `storage-utils.js`, falsy-value fixes in `use-query.js` and `session-defaults.js`, registry wired into `session-defaults.js` and `useQuery` spec.

### DONE: Tuning module extraction (Phase 2)
**Tags:** `done`
`src/tuning/mts-format.js`, `center-anchor.js`, `tuning-map.js` with 81 tests. `mts-helpers.js` converted to re-export shim.

### DONE: `inputRuntime` derived object (Step 3.1)
**Tags:** `done`
All fields wired in `app.jsx` useMemo; `keys.js` reads from `inputRuntime`.

### DONE: Hex expression interface (Step 3.2)
**Tags:** `done`
`cc74`, `aftertouch`, `pressure`, `modwheel`, `expression` on all hex types. CC74 filter in `sample_synth`.

### DONE: Full CC passthrough and routing (Step 3.3)
**Tags:** `done`
CC1/CC11 broadcast to all active hexes; CC74 per-channel (MPE) or recency-front (non-MPE); sustain/sostenuto/soft stubs; all CCs passed through to output.

### DONE: Pitch bend and pressure routing modes (Step 3.4)
**Tags:** `done`
`'all'` pressure mode wired and defaulted; pitch bend `'all'` mode uses `_baseCents`; `midiin_pressure_mode` default `'all'`.

### DONE: MPE input mode (Step 3.5)
**Tags:** `done`
Per-channel pitch bend, pressure, CC74 routing via `activeMidiByChannel`. Fully wired.

### DONE: Scale target input mode (Step 3.6)
**Tags:** `done`
`findNearestDegree` in `src/input/scale-mapper.js`; wired into `keys.js`; UI in MIDI input panel with Input Mode selector, tolerance, and fallback controls.

### DONE: iOS AudioContext fix
**Tags:** `done`
`onFirstInteraction` callback plumbed through `Keyboard → Keys`; called synchronously from `handleTouch`; calls `prepare()` inside gesture window.

### DONE: Per-controller local preferences
**Tags:** `done`
`tier: 'local'` entries in settings-registry; `loadControllerPrefs` / `saveControllerPref` in `controller-anchor.js`.

### DONE: Standard pitch wheel mode
**Tags:** `done`
`midi_wheel_semitones` setting; raw pitch bend passed to all MIDI outputs when wheel-to-recent is off; sample synth retuned directly.

### DONE: Mod wheel → sample synth filter
**Tags:** `done`
CC1 wired to lowpass filter in `sample_synth`; smooth first-move initialisation from `lastModWheel`.

### DONE: MIDI Input UX refactor (midi-input-ux.md)
**Tags:** `done`
MPE input moved to top; `showChannelTranspose` final formula; Pitch Bend Interval unified outside MPE block; Reverse Bend Direction moved outside MPE block; unknown controller info text removed; Exquis SysEx Output commented out; Lumatone layout file hidden in sequential mode; Lumatone sequential defaults on connect.
