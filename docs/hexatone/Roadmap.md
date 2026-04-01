# Hexatone Refactor Roadmap

*Synthesised: 2026-04-01. Updated: 2026-04-01. Sources: ClaudeRefactorPlan.md, HexatoneIOrefactor.md, TODO.md, midi-input-ux.md.*

Tags: `done` `in-progress` `todo` · Priority: `high` `medium` `low` · Complexity: `trivial` `small` `medium` `large` `xlarge`

---

## Architecture Vision

Hexatone is an IO pipeline:

```
Input sources  →  Hex grid (central musical state)  →  Output engines
```

The architectural rules:
- **Input logic** chooses which hexes are active.
- **Output logic** renders or transmits the active hexes.
- **Tuning logic** is shared, pure, and lives in its own module.
- **Persistence** stores user choices, not transient runtime state.

The refactor moves from the current situation (persistence/reactivity/transport all entangled) toward five clean runtime modules: Input Mapping, Hex Interaction, Tuning Domain, Output Transport, and Persistence.

---

## Completed Work

### Foundation: Persistence Layer  `done` `high`

*ClaudeRefactorPlan.md Steps 1–5 · Completed 2026-03-30*

The fragmented three-store persistence model (URL params, localStorage, sessionStorage) was rationalised around a canonical settings registry.

**What was done:**
- Fixed falsy-value bugs: `use-query.js` now uses `!== null` rather than truthy check so `0`, `false`, and `""` survive reload correctly.
- Fixed 12 `parseInt(...) || default` collapses in `session-defaults.js` (e.g. `direct_channel`, `midi_channel`, `midi_velocity`).
- Created `src/persistence/settings-registry.js` — a flat table of every settings key with its tier (`url`, `session`, `local`, `runtime`), type, and default. Single source of truth.
- Created `src/persistence/storage-utils.js` — safe parse helpers (`safeParseInt`, `safeParseBool`, etc.).
- Wired the registry into `session-defaults.js` (generated from the `session` tier) and into `useQuery` spec (generated from the `url` tier).
- Added `buildRegistryDefaults()` and `buildQuerySpec()` exports so app.jsx no longer hand-maintains these lists.

**New persistence tiers introduced:**
| Tier | Store | Survives |
|---|---|---|
| `url` | URL params + localStorage | browser restart, shareable |
| `session` | sessionStorage | tab refresh |
| `local` | localStorage only | browser restart, per-controller |
| `runtime` | never stored | startup default only |

---

### Foundation: Tuning Module  `done` `high`

*ClaudeRefactorPlan.md Phase 2 · Completed 2026-03-30*

Pure tuning functions extracted into `src/tuning/`, tested in isolation, and made reusable across input and output.

**New files:**
| File | Contents |
|---|---|
| `src/tuning/mts-format.js` | `centsToMTS`, `mtsToMidiFloat`, `buildRealtimeSingleNoteMessage`, `buildBulkDumpMessage`, `sanitizeBulkDumpName` |
| `src/tuning/center-anchor.js` | `degree0ToRef`, `computeCenterPitchHz`, `computeNaturalAnchor`, `chooseStaticMapCenterMidi`, `computeStaticMapDegree0` |
| `src/tuning/tuning-map.js` | `buildTuningMapEntries`, `patchTuningEntry`, `mtsTuningMap` |

81 tests across the three files. `src/keyboard/mts-helpers.js` converted to a re-export shim (to be deleted once the 4 remaining callers are migrated — see B1 below).

---

### Foundation: MIDI Input UX Refactor  `done` `high`

*midi-input-ux.md · Completed 2026-03-31*

The MIDI Inputs settings panel was restructured to match a clear visibility specification:
- Enable MPE Input moved to **first** position (before controller name/anchor).
- `showChannelTranspose` formula finalised: `!using2DMap && !mpe_input && isMultiChannelSequential`.
- Pitch Bend Interval unified outside the MPE block (Scala form when MPE or wheel-to-recent on; semitone integer form otherwise).
- Reverse Bend Direction moved outside the MPE block (always shown when device connected).
- Lumatone Layout file hidden in sequential mode.
- Unknown controller info text removed.
- Exquis SysEx Output row commented out (reserved for future firmware).
- Lumatone sequential defaults (`sequentialTransposeDefault`, `sequentialLegacyDefault`) applied on controller connect.

---

### Phase 3: Input Runtime Model  `done` `high`

*ClaudeRefactorPlan.md Phase 3 / HexatoneIOrefactor.md Phase 3 · Completed 2026-03-31 to 2026-04-01*

Formalised the two top-level input targets (`hex_layout` and `scale`), replaced ad-hoc settings reads in `keys.js` with a derived `inputRuntime` object, and added full expression routing.

#### Step 3.1 — `inputRuntime` derived object  `done`
All input mode decisions now flow through a single `inputRuntime` useMemo in `app.jsx`, decoupling `keys.js` from legacy setting names. Fields: `target`, `layoutMode`, `mpeInput`, `seqAnchorNote`, `seqAnchorChannel`, `stepsPerChannel`, `legacyChannelMode`, `scaleTolerance`, `scaleFallback`, `pitchBendMode`, `pressureMode`, `bendRange`, `bendFlip`, `wheelSemitones`.

Per-controller local persistence (`tier: 'local'`, `perController` flag) added to the registry for `midiin_mpe_input`, `midiin_bend_flip`, `midiin_bend_range`. `controller-anchor.js` rewritten with `loadControllerPrefs` / `saveControllerPref`.

#### Step 3.2 — Hex expression interface  `done`
`cc74`, `aftertouch`, `pressure`, `modwheel`, `expression` implemented on all hex types. CC74 lowpass filter chain in `sample_synth` (`source → gainNode → filterNode → masterGain`). Per-instrument control via `filter_freq` and `filter_amount`.

#### Step 3.3 — Full CC passthrough and routing  `done`
All CCs pass through to output. CC1/CC11 broadcast to all active hexes. CC74 routed per-channel in MPE mode or to recency-front in non-MPE mode. CC64 sustain, CC66 sostenuto (stub), CC67 soft pedal (stub), CC123/120/121 handled internally and forwarded.

#### Step 3.4 — Pitch bend and pressure routing modes  `done`
`'recency'` and `'all'` modes implemented for both pitch bend and channel pressure. Both modes use `hex._baseCents` (frozen at note-on) to prevent drift accumulation. `midiin_pressure_mode` default changed to `'all'`.

Standard wheel mode: when wheel-to-recent is off, raw pitch bend passes through to all MIDI outputs; sample synth voices retuned directly. New setting: `midi_wheel_semitones` (session, int, default 2).

#### Step 3.5 — MPE input mode  `done`
`activeMidiByChannel: Map<channel, hex>` tracked alongside `activeMidi`. Per-channel pitch bend, channel pressure, and CC74 routed to the correct hex. MTS output blocks raw pitch bend and CC74 passthrough to prevent conflicts. Works with all output synth types.

#### Step 3.6 — Scale target input mode  `done`
New "Input Mode" selector in the MIDI Inputs panel: **MIDI to Hex Layout** (default) or **MIDI to Nearest Scale Degree**.

`src/input/scale-mapper.js`: `findNearestDegree(pitchCents, scale, equave, toleranceCents, fallback)` — folds pitch into `[0, equave)`, searches all degrees with equave-wrap distance, returns `{ steps, distanceCents }` or `null`.

In scale mode: geometry, anchor, channel transposition, and sequential controls are hidden. Tolerance (default 25¢) and fallback (`'accept'` / `'discard'`) are user-configurable and persisted to sessionStorage.

---

### Fixes: iOS AudioContext  `done` `high`

*Completed 2026-04-01*

On iOS, `AudioContext.resume()` and `decodeAudioData` must be called within a user gesture. `prepare()` was previously called in a `.then()` continuation outside the gesture window, causing the spinner to hang until the ⟳ button was pressed.

Fix: `onFirstInteraction` callback plumbed through `Keyboard → Keys`; called synchronously from `handleTouch` on the very first touch; calls `setUserHasInteracted(true)` and `synthRef.current.prepare()` inside the gesture window.

---

### Fix: Mod Wheel and Channel Pressure Expression  `done` `medium`

*Completed 2026-04-01*

- **Mod wheel (CC1):** wired to the same lowpass filter path as MPE cc74 in `sample_synth`. Smooth first-move: filter initialises from `lastModWheel` at note-on.
- **Channel pressure:** default changed to `'all'` mode — broadcasts to all active voices simultaneously (sample synth gain swell; MTS passthrough; MPE manager channel zone-wide). No change in MPE input mode (already per-voice).

---

## Phase A: Immediate Bugs  `todo` `high`

*These block normal use or are known regressions. Do before new feature work.*

### A1 — Preset/scale reactivity regression  `todo` `high` `small`
After generating an equal division scale, the preset selector doesn't switch to "User Tunings". Investigate `use-presets.js` dirty-detection and the `scale_divide` handler in `use-settings-change.js`. (See Issues.md BUG-01.)

### A2 — Pitch bend smoothness / MPE stuck notes  `todo` `high` `large`
`_handleWheelBend` may flood at 14-bit resolution; MPE stuck notes from `releaseGuardMs` / retrigger path / `Ableton_workaround` out-of-range notes. Requires audit and likely throttling. (See Issues.md BUG-02.)

### A3 — Scale-mapper test coverage  `todo` `medium` `small`
Write `src/input/scale-mapper.test.js`: nearest degree in 12-EDO/31-EDO/JI; tolerance gate; `'accept'` vs `'discard'`; octave wrapping; exact match; negative pitchCents. (See Issues.md TEST-01.)

---

## Phase B: Architecture Cleanup  `todo` `medium`

*Short-to-medium effort items that complete the structural work already started.*

### B1 — Delete `mts-helpers.js` shim  `todo` `medium` `small`
Migrate the 4 remaining callers (`keys.js`, `use-synth-wiring.js`, `midi_synth/index.js`, `midioutputs.js`) to direct `src/tuning/` imports, then delete `mts-helpers.js`. (See Issues.md ARCH-01.)

### B2 — Extract `deriveOutputRuntime()` into `src/output/output-modes.js`  `done`
`deriveOutputRuntime(settings, midi, tuningRuntime)` exists in `src/use-synth-wiring.js` and is fully functional. It is not yet extracted into a standalone module — defer this until it needs to change. (See Issues.md ARCH-02.)

### B3 — Complete `app.jsx` hook extractions  `todo` `low` `medium`
Two hooks remain to extract (from `TODO.md` §2.3–2.4):
- `useScaleImport` — `onImport` handler + `importCount`; self-contained import parsing.
- `useSessionDefaults` — 50-line defaults object into a mount-once factory.

### B4 — Fundamental default value  `todo` `medium` `small`
Registry default is `260.740741` (middle C). Users expect `440` Hz. Change registry default to `440`; update `reference_degree` default to A-degree of the default scale; clear `fundamental` from localStorage on reload when preset restoration is disabled. (See Issues.md BUG-03.)

---

## Phase C: Output Domain  `todo` `high`

*HexatoneIOrefactor.md Phases 4–6. The main remaining feature work.*

### C1 — Define explicit output transport strategies  `todo` `high` `large`
Move transport logic into output-specific modules under `src/output/`. Keep `keys.js` focused on hex activation and orchestration.

Five output modes need clean runtime representations:
- Sample synth (already relatively clean)
- MPE output
- MTS real-time (single-note sysex per carrier)
- MTS dynamic bulk dump (patch + full dump on each note-on)
- MTS static bulk dump (one map, built once, MIDI keyboard plays it)

Per-mode: required settings, runtime state, rebuild triggers, and transport logic should all be co-located.

### C2 — Dynamic Bulk Dump output  `todo` `high` `large`

*HexatoneIOrefactor.md Phase 5.*

Enables bulk-dump-only synths to receive real-time MTS with MTS1-style semantics:
- Maintain an in-memory 128-note map.
- On note-on: choose carrier (MTS1 allocation logic), compute triplet, patch the map, send full bulk dump, trigger note.
- Shared core with MTS real-time: same carrier selection, same MTS encoding — only the transport step differs.
- Investigate whether a note-on delay after sysex send is needed in practice.
- Leave reduced-range (MTS2-style) allocation as a later extension.

### C3 — Centered Static Bulk Dump  `todo` `high` `medium`

*HexatoneIOrefactor.md Phase 6.*

The static 128-note map should be musically centered around `center_degree` on screen:
1. Derive the pitch of `center_degree`.
2. Search MIDI notes 57–72 (A3–C5) for the note whose 12-EDO pitch class best matches.
3. Build the map centered on that note.

This maximises useful range coverage and makes the screen center and external keyboard physically correspond. `chooseStaticMapCenterMidi` in `src/tuning/center-anchor.js` already provides the search logic.

Also: OCT button must recalculate and re-send the map (or defer carrier slots that are currently held) — see Issues.md FEAT-06.

### C4 — Input/output correlation for static bulk  `todo` `medium` `small`
Ensure `scale` input target (nearest-degree mapping) and `hex_layout` anchor interpretation both align with the centered static map. The same centering logic should inform both incoming anchor interpretation and outgoing map construction.

---

## Phase D: Exact Interval Layer  `todo` `low` `xlarge`

*ClaudeRefactorPlan.md Phase 2.5.*

Stop discarding ratio identity at the `normalize()` boundary. Currently all scale degrees are converted to float cents at parse time; JI identity is lost.

**New file:** `src/tuning/interval.js` — wraps `xen-dev-utils` `Fraction` and `toMonzo()`:

```js
export function parseInterval(str) {
  // returns { cents, fraction, monzo }
}
```

Wire into `normaliseDegree` and `scalaToCents`. All downstream code continues to receive `number[]` cents — no other change required at this stage.

This is the foundation for:
- JI identity checks and harmonic analysis
- Monzo-based harmonic-radius matching in scale-mapper (FEAT-03)
- Future temperament calculations
- `getConvergents()` for nearest-valid-tuning in dynamic retuning

**Dependency:** `yarn add xen-dev-utils` (add before starting this phase).

---

## Phase E: Settings UX and Key Renaming  `todo` `low` `medium`

*HexatoneIOrefactor.md Phase 7.*

Rename internal implementation keys to domain-facing names:
- `direct_*` → `mts_bulk_*` (e.g. `direct_device` → `mts_bulk_device`)
- `sysex_type` → clearer transport naming
- Decide whether `DIRECT` remains a user-facing label (recommended: yes, mapping to static bulk mode)

**Requires a migration pass** to avoid breaking existing user sessions. Do after output transport modules (Phase C) are stable, since the rename should align with the new domain model.

---

## Phase F: Code Quality  `todo` `low`

*TODO.md §5–6.*

### F1 — Test coverage additions  `todo` `low` `medium`
- Controller registry tests (TEST-02 in Issues.md)
- `midinoteOn/Off` integration tests (TEST-03)
- Synth wiring tests after `useScaleImport` extraction (TEST-04)
- Controller anchor load/save tests (TEST-05)

### F2 — `keys.js` split into input-handler modules  `todo` `low` `xlarge`
Split ~2300-line `keys.js` into:
- `src/input/midi-input-handler.js`
- `src/input/pointer-input-handler.js`
- `src/keyboard/hex-renderer.js`

**Do when `keys.js` needs significant new features** — not a standalone priority.

### F3 — Lumatone export rewrite  `todo` `medium` `large`
Rewrite `src/settings/scale/lumatone-export.js` to derive geometry from `buildLumatoneMap` in `registry.js`, eliminating the duplicate standalone implementation and fixing 6 failing export tests. Do after Phase C (controller geometry layer must be stable). (Issues.md ARCH-05, BUG-04.)

### F4 — Dead code removal  `todo` `low` `trivial`
`AXIS49_MAP` / `getAxis49Position` legacy exports; `buildLumatoneRawCoords` duplicate; `ExtractArray` in `use-query.js`; `colors.test-fix-unfinished.js`; commented-out `console.log` statements. (Issues.md CLEAN-01.)

### F5 — Persistence unification  `todo` `low` `xlarge`
The registry exists but `useQuery` still writes to both URL and localStorage on every `setSettings` call, making URLs extremely long. Proposed: URL params only written on explicit "share" action; sessionStorage for all transient state; localStorage for presets only. (Issues.md ARCH-06.)

---

## Execution Order Summary

```
NOW (bugs blocking normal use)
  A1  Preset/scale reactivity regression         high  small
  A2  Pitch bend / MPE stuck notes               high  large
  A3  scale-mapper tests                         medium small

SHORT TERM (complete structural work already started)
  B1  Delete mts-helpers.js shim                 medium small
  B2  Extract deriveOutputRuntime()              medium medium
  B4  Fix fundamental default to 440             medium small
  B3  useScaleImport / useSessionDefaults hooks  low    medium

MEDIUM TERM (main new feature work)
  C1  Output transport module design             high   large
  C2  Dynamic Bulk Dump output                   high   large
  C3  Centered Static Bulk Dump                  high   medium
  C4  Input/output correlation for static bulk   medium small

LONGER TERM (foundational / quality)
  D   Exact interval layer (xen-dev-utils)        low   xlarge
  E   Settings UX renaming (direct_ → mts_bulk_) low   medium
  F1  Test coverage                               low   medium
  F3  Lumatone export rewrite                     medium large
  F2  keys.js split                               low   xlarge
  F5  Persistence unification                     low   xlarge
```
