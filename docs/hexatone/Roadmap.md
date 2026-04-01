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
Audit completed 2026-04-01. Three distinct issues found:

1. **Dynamic Bulk Dump flooded by wheel** — `DynamicBulkHex.retune()` sends a full 128-note (408-byte) bulk dump on every `retune()` call. At 14-bit MIDI resolution (~500 events/sec) this overflows the SysEx queue. Fix: throttle via `requestAnimationFrame` coalescing or a `lastSentAt` guard.

2. **Retrigger path sends no noteOff** — `VoicePool.noteOn()` detects retrigger (same coords already active) and returns `stolenSlot: null`. `MpeHex` constructor only sends a noteOff when `stolenSlot !== null`, so a retriggered note gets PB + noteOn without a prior noteOff → stuck note in downstream synth.

3. **`Ableton_workaround` bend overflow** — `channel % 16 = 0` sets `baseNote = 0`; fallback clamps (`note = baseNote`, `note = baseNote + 112`) can place the note outside the ±48-semitone bend range, producing wrong pitch. `deviationToBend()` clamps the MIDI value so no corruption, but the pitch is wrong and silent notes can result.

Priority order for fixes: #2 (stuck notes) → #1 (smoothness) → #3 (Ableton edge case). (See Issues.md BUG-02.)

### A3 — Scale-mapper test coverage  `todo` `medium` `small`
Write `src/input/scale-mapper.test.js`: nearest degree in 12-EDO/31-EDO/JI; tolerance gate; `'accept'` vs `'discard'`; octave wrapping; exact match; negative pitchCents. (See Issues.md TEST-01.)

### A4 — Scale target mode: pitch mapped to wrong degree  `done`
Fixed 2026-04-01. The scale-mapper path used `midiin_central_degree` and `center_degree` (layout/hardware settings) to compute the pitch reference, causing wrong degree matches whenever the preset tuning diverged from 12-EDO defaults.

The two input modes have separate chains:
- **Layout mode** — hardware geometry: `note → steps (anchor + center_degree) → coords → hexCoordsToCents → pitch`. Layout settings are essential.
- **Scale mode** — musical pitch: `note → pitchHz → pitchCents relative to degree0Hz → findNearestDegree → steps → coords`. Layout settings are irrelevant.

Fix: compute `degree0Hz` from `fundamental` and `reference_degree` only; convert incoming MIDI note to Hz; take the log ratio. No layout parameters involved:
```js
const degree0Hz  = fundamental / 2^(degree0toRefCents / 1200);
const pitchHz    = 440 * 2^((note - 69) / 12);
const pitchCents = 1200 * log2(pitchHz / degree0Hz);
```
Applied identically to `midinoteOn` and `midinoteOff`. (See Issues.md BUG-04.)

### A5 — Scala interval fields accept negative values and zero ranges  `done`
Fixed 2026-04-01. No Scala-style text input validated its value. The Divide Equave button also had a 30-line inline duplicate of `scalaToCents` with no zero/negative guard.

Fix: added `parseScalaInterval(str, context)` to `parse-scale.js`; new `ScalaInput` component with red-border feedback, cents preview, zero coercion, and revert-on-invalid; wired into all four Scala input fields (Pitch Bend Interval, Equave sidebar, scale table degree cells, scale table equave row); Divide Equave button now uses `parseScalaInterval`. CSS updated for `ScalaInput`'s wrapper `<span>` inside flex cells. (See Issues.md BUG-05.)

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
- Monzo-based harmonic-radius matching in scale-mapper (see Phase G)
- Future temperament calculations
- `getConvergents()` for nearest-valid-tuning in dynamic retuning

**Dependency:** `yarn add xen-dev-utils` (add before starting this phase).

**Phase G depends on this phase being complete first.**

---

## Phase E: Settings UX and Key Renaming  `todo` `low` `medium`

*HexatoneIOrefactor.md Phase 7.*

Rename internal implementation keys to domain-facing names:
- `direct_*` → `mts_bulk_*` (e.g. `direct_device` → `mts_bulk_device`)
- `sysex_type` → clearer transport naming
- Decide whether `DIRECT` remains a user-facing label (recommended: yes, mapping to static bulk mode)

**Requires a migration pass** to avoid breaking existing user sessions. Phase C is now stable, so this can proceed when there is appetite for the migration effort.

---

## Phase G: Harmonic-Radius Chord Matching for Scale Mode  `todo` `low` `xlarge`

*Depends on Phase D (Exact Interval Layer). Sketched 2026-04-01.*

### Motivation

The current `findNearestDegree` function resolves each incoming MIDI note independently: it folds the note's Hz into `[0, equave)` and picks the closest scale degree by cent distance alone. This works for monophonic or step-by-step input but breaks down when the incoming controller sends chords with microtonal inflection. Two notes each closest to a scale degree individually can together form an interval that is far from any harmonically meaningful ratio in the scale — producing a mistuned chord even though each note "matched".

The fix is a polyphonic matching layer that evaluates the **harmonic plausibility of the incoming chord as a whole**, adjusts degree assignments globally to minimise total harmonic error, and does so in real time.

### Conceptual architecture

```
Incoming notes (Hz per note, from MTS or MPE pre-bend)
  │
  ▼
1. Per-note nearest-degree candidates
   findNearestDegree → { steps, distanceCents }[]          (existing, per note)
   Also compute ±1 neighbours as alternate candidates.

  │
  ▼
2. Interval rationalisation (xen-dev-utils)
   For each pair of simultaneously sounding notes:
     - compute the interval in cents: Δ = pitchHz_b / pitchHz_a → cents
     - use xen-dev-utils getConvergents(Δ) to find the nearest simple ratio
     - store as { ratio: Fraction, errorCents }

  │
  ▼
3. Harmonic radius per assignment (Sabat/Tenney/Benedetti)
   Two complementary scores, both using Marc Sabat's extension of Tenney/Benedetti
   harmonic distance to chords:

   Each radius measure has two parallel variants, mirroring the
   Tenney/Benedetti duality:

   ── Geometric (Radius) variant ──────────────────────────────────────────
   Work directly with the partial integers. Geometric mean over all
   numerators and denominators of the chord expressed as a ratio
   constellation in lowest terms.

     Pairwise (dyad):   Radius(p/q)  = sqrt(p * q)
     Full chord (N notes, partials P = {p1, q1, p2, q2, …}):
       Harmonic Radius  = (∏ P)^(1/|P|)
       Odd Radius       = (∏ odd_parts(P))^(1/|P|)

   Note: for a dyad, Harmonic Radius = sqrt(p * q) — pairwise and
   full-chord scores are on the same scale.

   ── Log Radius (arithmetic mean of log₂ partials) variant ───────────────
   Take log₂ of each partial before averaging — analogous to how
   Tenney distance = log₂(p * q) is the log form of the dyad radius.

     Pairwise (dyad):   logRadius(p/q)  = log2(p * q)   [= Tenney distance]
     Full chord:
       log Harmonic Radius = (1/|P|) * Σ log2(partials)
       log Odd Radius      = (1/|P|) * Σ log2(odd_parts)

   The log variant is additive and cheaper to compute; the geometric
   variant preserves ratio intuition. Both are monotonically equivalent
   for ranking, so either can be used in the scoring function.
   `midiin_scale_radius_mode` selects which variant is active.

   Use both pairwise and full-chord scores: pairwise catches dissonant
   dyads within an otherwise simple chord; full-chord radius rewards
   voicings that sit inside a low harmonic series.
   Lower radius = more harmonically simple chord.

  │
  ▼
4. Global assignment optimisation
   For a chord of N notes, each with K candidates (K ≈ 3: nearest + two neighbours):
     - enumerate K^N assignments (small: K=3, N≤6 → ≤729 candidates)
     - score each by: w_individual * sum(distanceCents²) + w_pairwise * sum(sqrt(p*q) per pair) + w_chord * harmonicRadius (or oddRadius)
     - return the assignment with lowest combined score

  │
  ▼
5. Chord continuity (voice-leading)
   Keep a "previous chord" buffer: the last resolved degree assignment.
   Penalise assignments that move each voice by more than ½ equave from its
   previous degree — preserves smooth voice-leading across chord changes.
   Weight: w_continuity * sum(|newDegree_i − prevDegree_i|)

  │
  ▼
6. Output: best assignment vector → existing coords resolution path
```

### Key data structures

```js
// Per-active-note state (stored in activeMidi / activeMidiByChannel entries)
{
  noteNumber: int,
  pitchHz: float,          // exact Hz (from MTS/MPE pre-bend, or 12-EDO)
  candidateDegrees: [      // nearest + neighbours
    { steps: int, distanceCents: float },
    ...
  ],
  assignedDegree: int,     // result of global optimisation
}

// Chord state (stored on Keys instance)
this._prevChordAssignment = Map<noteNumber, steps>   // previous resolved chord
this._currentChordNotes   = Map<noteNumber, { pitchHz, candidateDegrees }>
```

### New functions / files

| Location | Function | Purpose |
|---|---|---|
| `src/input/scale-mapper.js` | `findCandidates(pitchCents, scale, equave, window)` | returns N nearest degrees within `window` cents |
| `src/input/chord-rationaliser.js` | `rationaliseChord(notes, scale, equave, options)` | steps 3–5 above; returns best assignment vector |
| `src/tuning/harmonic-radius.js` | `harmonicRadius(fractions[])`, `oddRadius(fractions[])`, `logHarmonicRadius(fractions[])`, `logOddRadius(fractions[])` | Geometric and log variants of Sabat/Tenney/Benedetti chord radius; dyad case recovers sqrt(p·q) and log2(p·q) respectively |

`rationaliseChord` depends on `xen-dev-utils` `getConvergents` and `Fraction`. It is a **pure function** (no side effects) suitable for unit testing.

### Triggering strategy

The optimiser runs on **every note-on and note-off** in scale mode, over the full set of currently active notes. At typical polyphony (2–6 notes) the K^N search over 3 candidates is ≤ 729 iterations of simple arithmetic — well under 1 ms even on mobile.

The **previous chord buffer** is reset on `allNotesOff` and on controller disconnect.

### Settings to add (session tier)

| Key | Default | Meaning |
|---|---|---|
| `midiin_scale_pairwise_weight` | `0.3` | weight of summed pairwise Tenney distance in scoring |
| `midiin_scale_chord_weight` | `0.3` | weight of full-chord Harmonic/Odd Radius in scoring |
| `midiin_scale_radius_mode` | `'log_harmonic'` | `'harmonic'` geometric mean of partials; `'odd'` geometric mean of odd parts; `'log_harmonic'` arithmetic mean of log₂ partials; `'log_odd'` arithmetic mean of log₂ odd parts |
| `midiin_scale_continuity_weight` | `0.3` | weight of voice-leading continuity penalty |
| `midiin_scale_candidate_window` | `75` | cent window for alternate candidates (± this value around nearest) |

### Implementation order

1. **Phase D first** — `parseInterval` must return `{ monzo }` before step 3 can look up harmonic distances from the scale.
2. `findCandidates` in `scale-mapper.js` — extend existing function, backward compatible.
3. `tenneyDistance` + `chordHarmonicRadius` in `src/tuning/harmonic-radius.js` — pure math, unit testable independently.
4. `rationaliseChord` in `src/input/chord-rationaliser.js` — integrates 1–3.
5. Wire into `midinoteOn` / `midinoteOff` in `keys.js` (scale mode path only).
6. Add the three new session settings to the registry and expose in the MIDI Inputs UI.

### Open questions / deferred decisions

- **Enharmonic equivalents in non-octave equaves** — equave folding before rationalisation may need adjustment for stretched/compressed octaves. Leave as todo within chord-rationaliser.js.
- **Polyphony cap** — if N > 6, fall back to per-note greedy matching to avoid combinatorial blowup. Threshold is a constant, not a user setting.
- **MTS sysex received mid-chord** — `_mtsInputTable` update does not retroactively retune held notes. Accepted limitation; document in Issues.

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
Rewrite `src/settings/scale/lumatone-export.js` to derive geometry from `buildLumatoneMap` in `registry.js`, eliminating the duplicate standalone implementation and fixing 6 failing export tests. Phase C is now stable, so the geometry layer is ready. (Issues.md ARCH-05, BUG-06.)

### F4 — Dead code removal  `todo` `low` `trivial`
`AXIS49_MAP` / `getAxis49Position` legacy exports; `buildLumatoneRawCoords` duplicate; `ExtractArray` in `use-query.js`; `colors.test-fix-unfinished.js`; commented-out `console.log` statements. (Issues.md CLEAN-01.)

### F5 — Persistence unification  `todo` `low` `xlarge`
The registry exists and list duplications have been eliminated (2026-04-01: `PRESET_SKIP_KEYS` and `SCALE_KEYS_TO_CLEAR` now have single authoritative sources). However `useQuery` still writes to both URL and localStorage on every `setSettings` call, making URLs extremely long. Proposed: URL params only written on explicit "share" action; sessionStorage for all transient state; localStorage for presets only. (Issues.md ARCH-06.)

---

## Execution Order Summary

```
NOW (bugs blocking normal use)
  A1  Preset/scale reactivity regression         high   small   DONE
  A2  Pitch bend / MPE stuck notes               high   large
  A3  scale-mapper tests                         medium small
  A4  Scale target mode pitch reference          high   small   DONE
  A5  Scala input validation                     medium small   DONE

SHORT TERM (complete structural work already started)
  B1  Delete mts-helpers.js shim                 medium small
  B3  useScaleImport / useSessionDefaults hooks  low    medium
  C5  OCT button / static map                    medium medium

LONGER TERM (foundational / quality)
  D   Exact interval layer (xen-dev-utils)        low   xlarge  ← G depends on this
  G   Harmonic-radius chord matching              low   xlarge  ← depends on D
  E   Settings UX renaming (direct_ → mts_bulk_) low   medium
  F1  Test coverage                               low   medium
  F3  Lumatone export rewrite                     medium large
  F2  keys.js split                               low   xlarge
  F5  Persistence unification                     low   xlarge
```
