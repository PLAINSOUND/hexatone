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

### A1 — Preset/scale reactivity regression  `done`
Confirmed fixed 2026-04-01. Preset selector correctly switches to "User Tunings" after generating an equal division scale. (See Issues.md BUG-01.)

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

### B4 — Fundamental default value  `done`
Fixed 2026-04-01. `fundamental` added to `PRESET_SKIP_KEYS`; registry default changed to `440` Hz; `presetSkip: true` added to registry entry. Fresh loads now start at concert A. (See Issues.md BUG-03.)

---

## Phase C: Output Domain  `done` `high`

*HexatoneIOrefactor.md Phases 4–6. Completed before 2026-04-01.*

All five output modes are implemented, production-ready, and integrated with the full settings/persistence system.

### C1 — Output transport strategies  `done`

Five output mode classes in `src/midi_synth/index.js`, plus `src/mpe_synth/`, `src/sample_synth/`, `src/osc_synth/`, composited via `src/composite_synth/`:

| Mode | Class | Transport |
|---|---|---|
| Sample synth | `ActiveHex` | Web Audio API |
| MPE output | `MpeHex` | Per-channel MIDI, voice pool |
| MTS real-time | `MidiHex` | Single-note real-time sysex per carrier (MTS1/MTS2) |
| MTS dynamic bulk | `DynamicBulkHex` | Maintain 128-note map; patch + full dump on each note-on |
| MTS static bulk | `StaticBulkHex` | Pre-built centered map; MIDI keyboard plays sequentially |
| OSC | `OscHex` | WebSocket bridge to SuperCollider |

All share a unified `makeHex()` interface. `create_composite_synth()` fans out `makeHex/noteOn/noteOff/retune` to all active synths simultaneously.

`deriveOutputRuntime(settings, midi, tuningRuntime)` in `use-synth-wiring.js` builds the config array consumed by `create_midi_synth()`. Separate MTS output objects for main port and optional FluidSynth mirror.

### C2 — Dynamic Bulk Dump output  `done`

`createBulkDynamicTransport()` maintains an in-memory 128-note map. On each note-on: voice pool allocation, carrier selection, MTS triplet computation, map patch, full bulk dump sent, then note triggered. Guard delay (`DIRECT_BULK_GUARD_MS`, currently 0 ms) is configurable. Retuning on held notes patches the carrier slot and resends.

Shared MTS math with real-time mode via `src/tuning/mts-format.js` — only the transport step differs.

### C3 — Centered Static Bulk Dump  `done`

`StaticBulkHex` plays notes as `anchor + steps` from a pre-built centered map. Centering algorithm (in `src/tuning/center-anchor.js`):
1. `computeCenterPitchHz()` — pitch of `center_degree`.
2. `chooseStaticMapCenterMidi()` — search MIDI 57–72 (A3–C5) for best 12-EDO pitch-class match.
3. `computeStaticMapDegree0()` — convert chosen MIDI note to abstract degree-0 anchor for the map.

`mtsSendMap()` in `keys.js` builds and sends the bulk dump with **sustained-note protection**: held notes keep their last tuning bytes; checksum is recomputed if any protected slots differ.

Auto-Send checkbox triggers immediate resend on any relevant settings change. Full UI in `src/settings/midi/midioutputs.js`.

### C4 — Input/output correlation for static bulk  `done`

`scale` input target (nearest-degree mapping via `findNearestDegree`) and `hex_layout` anchor interpretation both use the same centered `center_degree` as the static map anchor. The centering logic in `center-anchor.js` is the shared foundation for both sides.

### C5 — OCT button / static map deferred  `todo` `medium` `medium`

The OCT button applies an octave shift to the view. The static bulk dump must mirror this:
- **Non-deferred OCT:** recalculate the 128-note map (shift carrier slots by 12 semitones) and re-send when auto-send is on.
- **Deferred OCT:** skip carrier slots currently held by sounding notes, send the rest, then update deferred slots as each note releases.

This ties the UI OCT state directly to the static bulk transport. (See Issues.md FEAT-06.)

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

**Requires a migration pass** to avoid breaking existing user sessions. Phase C is now stable, so this can proceed when there is appetite for the migration effort.

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
Rewrite `src/settings/scale/lumatone-export.js` to derive geometry from `buildLumatoneMap` in `registry.js`, eliminating the duplicate standalone implementation and fixing 6 failing export tests. Phase C is now stable, so the geometry layer is ready. (Issues.md ARCH-05, BUG-04.)

### F4 — Dead code removal  `todo` `low` `trivial`
`AXIS49_MAP` / `getAxis49Position` legacy exports; `buildLumatoneRawCoords` duplicate; `ExtractArray` in `use-query.js`; `colors.test-fix-unfinished.js`; commented-out `console.log` statements. (Issues.md CLEAN-01.)

### F5 — Persistence unification  `todo` `low` `xlarge`
The registry exists but `useQuery` still writes to both URL and localStorage on every `setSettings` call, making URLs extremely long. Proposed: URL params only written on explicit "share" action; sessionStorage for all transient state; localStorage for presets only. (Issues.md ARCH-06.)

---

## Execution Order Summary

```
NOW (bugs blocking normal use)
  A1  Preset/scale reactivity regression         high   small
  A2  Pitch bend / MPE stuck notes               high   large
  A3  scale-mapper tests                         medium small

SHORT TERM (complete structural work already started)
  B1  Delete mts-helpers.js shim                 medium small
  B3  useScaleImport / useSessionDefaults hooks  low    medium
  C5  OCT button / static map                    medium medium

LONGER TERM (foundational / quality)
  D   Exact interval layer (xen-dev-utils)        low   xlarge
  E   Settings UX renaming (direct_ → mts_bulk_) low   medium
  F1  Test coverage                               low   medium
  F3  Lumatone export rewrite                     medium large
  F2  keys.js split                               low   xlarge
  F5  Persistence unification                     low   xlarge
```
