# Hexatone Refactor Roadmap

*Synthesised: 2026-04-01. Updated: 2026-04-05. Sources: ClaudeRefactorPlan.md, HexatoneIOrefactor.md, TODO.md, midi-input-ux.md.*

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

### Exquis App Mode LED Engine  `done` `high`

*Completed 2026-04-01*

Implemented App Mode LED colour sync for the Exquis (Intuitive Instruments) controller. App Mode keeps the native MPE engine fully active (`pad_remote=0`) while the host drives LED colours independently — unlike Dev Mode which disabled MPE.

**Protocol** (`F0 00 21 7E <CMD> [...] F7`):
- `0x00` version request/response — firmware ≥ 3.0.0 required
- `0x1E 0x00` pad_remote=0 — keep native MPE engine
- `0x05` luminosity — global brightness 0–100
- `0x14` note_colour — rgb7 (0–127), note_id 0–60
- heartbeat empty payload — every 500 ms, App Mode drops after ~10 s without it
- `0x03` quit — exit App Mode cleanly

**Key architectural decisions:**

1. **App Mode lifecycle lives in `app.jsx`**, not inside `Keyboard` or `Keys`. `Keyboard` only mounts when `isValid` (a scale is loaded), but App Mode must be active as soon as the Exquis is selected as input — even on a blank page with no preset. Moving the `useEffect` to `app.jsx` solved this.

2. **One long-lived `ExquisLEDs` instance** stored in `exquisLedsRef`. Created when `exquisRawPorts` becomes non-null and `inputRuntime.target !== 'scale'`. Destroyed only on genuine exit (scale mode switch or device disconnect) via `exit()`. During Keys reconstruction (preset change, layout change), the instance is assigned imperatively to the new Keys — no version re-query, no heartbeat gap.

3. **`midi_passthrough` does not block App Mode.** The Exquis defaults to `passthroughDefault: true` (Sequential mode) on first connect. App Mode should still activate in sequential mode — the check is `target !== 'scale'` only.

4. **Pads always blank on App Mode entry** — `_enterAppMode()` sends black to all 61 pads unconditionally before any colour send. `pad_remote=0` alone does not clear the Rainbow display.

5. **Colours sent only explicitly** — `sendColors()` and `clearColors()` are called from `updateColors` (when `exquis_led_sync` is on and colour settings change) or from the Send Now / Clear buttons. Nothing is sent during connection or reconstruction.

**Settings added** (`settings-registry.js`, all `tier: 'local'`, `perController: false`):
- `exquis_led_sync` (bool, default false) — Auto Send Colours checkbox
- `exquis_led_luminosity` (int, default 15) — LED brightness slider 0–100
- `exquis_led_saturation` (float, default 1.5) — okLab chroma multiplier slider 0.75–2.5

**Persistence:** All three keys are `local` cross-controller tier. They are loaded into `sessionDefaults` at startup by reading `CROSS_CONTROLLER_ENTRIES` from localStorage directly — without waiting for the user to select a device (which is when `loadControllerPrefs` normally fires).

**Files:**
- `src/controllers/exquis-leds.js` — `ExquisLEDs` class: version query, `_enterAppMode()`, `sendColors()`, `clearColors()`, `setLuminosity()`, `setSaturation()`, `exit()`; inline okLab saturation boost helpers
- `src/app.jsx` — `exquisLedsRef` + App Mode `useEffect`; `exquisLedsRef` passed to `Keyboard` and attached to `Keys` in `onKeysReady`
- `src/keyboard/index.js` — Keys reconstruction assigns `exquisLedsRef.current` to `keys.exquisLEDs`; no LED lifecycle here
- `src/session-defaults.js` — reads `CROSS_CONTROLLER_ENTRIES` from localStorage at startup
- `src/settings/midi/index.js` — LED Output status line, Auto Send Colours checkbox, Send Now / Clear buttons, LED Brightness and Saturation sliders

---

### Fix: Shared Held-Note Retune Glide and Output Toggle Lifecycle  `done` `high`

*Completed 2026-04-05*

Pitch-bend smoothness, held-note retuning, compare previews, and output toggles were all interacting through separate ad-hoc paths. This has now been consolidated into one runtime model.

**What changed:**
- **Held-note glide moved into `keys.js`.** TuneCell / reference-frequency drags now send target cents immediately; `Keys` owns a shared cents-domain retune scheduler for sounding notes.
- **Current glide defaults:** `tick = 4 ms`, `tau = 40 ms`, `max slew = 4800 cents/sec`, `snap = 0.1 cents`.
- **MPE held-note retunes stay bend-only.** A sounding note now traverses intermediate semitones continuously instead of hopping carrier notes while dragged.
- **Live bend resolves from the active pitch base.** MPE input bend and preview/save/revert paths reuse the note's live `_baseCents`, so bending a retuned note no longer snaps back toward its original note-on pitch.
- **Reference Frequency compare now uses an immutable preview snapshot.** A/B no longer accumulates the same interval on each toggle.
- **Output toggles are no longer structural.** `Keyboard` no longer reconstructs `Keys` on synth/output changes; `use-synth-wiring` reuses unchanged synth families and drains disabled ones with `releaseAll()`.
- **MPE startup state is cleaned explicitly.** Voice channels are recentred on synth creation, and the deferred cleanup pass now only resets `IDLE` channels.

**Why this architecture is better:**
- One glide model in cents keeps sample synth, MPE, and MTS perceptually aligned.
- UI event cadence no longer determines retune quality.
- Output toggles behave like routing changes rather than full instrument teardown.

**Keep in sight:** the deferred MPE release guard is currently `500 ms`. It protects tails during output switches, but it is still a tuning constant rather than a proven invariant. If regressions reappear, inspect first-note startup and delayed PB-zeroing behavior before widening the guard further.

---

## Phase A: Immediate Bugs  `todo` `high`

*These block normal use or are known regressions. Do before new feature work.*

### A1 — Preset/scale reactivity regression  `done`
Confirmed fixed 2026-04-01. Preset selector correctly switches to "User Tunings" after generating an equal division scale. (See Issues.md BUG-01.)

### A2 — Pitch bend smoothness / MPE stuck notes  `done` `high` `large`
Audit completed 2026-04-01. Initial transport/stuck-note fixes landed 2026-04-02; held-note retune and output-lifecycle work completed 2026-04-05.

**Delivered:**
- Dynamic Bulk Dump retune coalescing to stop wheel-driven SysEx flooding.
- Correct MPE retrigger noteOff behavior.
- `Ableton_workaround` carrier-note selection fixed so the played note stays near the target pitch.
- Shared held-note retune glide in `keys.js`, replacing UI-driven drag smoothing.
- MPE bend-only live retuning across semitone boundaries.
- Fundamental compare snapshot fix.
- Non-structural live output toggling with synth-family reuse and `releaseAll()` drainage for disabled outputs.
- MPE startup PB cleanup with an `IDLE`-only deferred reset.

**Residual watchpoint:** the MPE release guard currently sits at `500 ms`. Treat it as an observed safeguard, not final truth; keep it under hardware regression watch around output switching, long-release patches, and first-note behavior after re-enable. (See Issues.md BUG-02.)

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

### B5 — Mode-aware controller prefs and anchors  `todo` `high` `medium`

*Reframed 2026-04-05. Builds on the derived-state owner work in Issues.md ARCH-08.*

The current architecture is directionally correct: controller prefs load from one derived-state path rather than from scattered UI events. But it is still keyed at the wrong granularity. As the controller registry grows (Exquis, LinnStrument, Lumatone, Tonal Plexus, Push, Launchpad, etc.), `controller.id` alone is no longer enough.

**The missing concept is controller mode/state.**

Many controllers have more than one meaningful operating state, each with different anchor semantics and different defaults:
- **Lumatone** — 2D geometry vs bypass/sequential layout
- **Exquis / LinnStrument** — MPE vs standard polytouch / multichannel operation
- Future SysEx-capable controllers — mode, colour, or routing states that change anchor behaviour

If prefs are keyed only by `controller.id`, one mode overwrites another. The right persistence identity is:

```txt
controllerId + modeKey
```

Examples:
- `lumatone + layout2d`
- `lumatone + bypass`
- `exquis + mpe`
- `exquis + poly`

**Design:**

Keep the current architecture, but formalise three layers:

1. **Hardware profile** — registry-owned, stable facts
   - detection
   - geometry builder
   - multichannel / MPE capability
   - SysEx capabilities
   - fixed MPE channel ranges

2. **Controller modes** — registry-owned, per-mode defaults
   - mode names (`layout2d`, `bypass`, `mpe`, `poly`, `default`, ...)
   - mode resolver: `resolveMode(settings, controller)`
   - default prefs per mode

3. **User prefs** — persisted overrides keyed by `{ controllerId, modeKey }`
   - anchor note
   - anchor channel
   - `midiin_mpe_input`
   - `midi_passthrough`
   - optionally `midiin_steps_per_channel`, `midiin_channel_legacy`, bend prefs if they prove mode-specific

**Target registry shape:**

```js
{
  id: 'lumatone',
  modes: {
    layout2d: {
      defaultPrefs: { anchorNote: 26, anchorChannel: 3, midi_passthrough: false },
    },
    bypass: {
      defaultPrefs: { anchorNote: 60, anchorChannel: 4, midi_passthrough: true },
    },
  },
  resolveMode(settings) {
    return settings.midi_passthrough ? 'bypass' : 'layout2d';
  },
}
```

Simple controllers keep a single `default` mode.

**Why this is better than more special cases:**
- The existing derived-state load in `use-synth-wiring.js` remains the one owner.
- New controllers become mostly data entries in `controllers/registry.js`.
- Learn-anchor, hot-plug, and mode flips can restore the correct last-used anchor for that controller state.
- First-connect behaviour becomes clear: use mode defaults when no saved override exists.

**Refactor direction:**
1. Extend controller registry entries with `modes` and `resolveMode(settings)`.
2. Upgrade `input/controller-anchor.js` from controller-only prefs to controller-plus-mode prefs.
3. Move anchor note/channel into the same mode-aware preference model instead of keeping them as legacy special keys.
4. Keep the app-facing output of the loader flat — it should still emit the current settings update object (`midiin_central_degree`, `lumatone_center_channel`, `midi_passthrough`, etc.).
5. Add one-time compatibility migration: if old `${controller.id}_anchor` keys exist and no mode-specific value exists yet, import them into the currently resolved mode.

**Priority controllers for the new model:**
- Exquis
- Lumatone
- LinnStrument

These cover the important cases: MPE, multichannel geometry, and explicit mode-dependent anchors.

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

### C6 — Research: multitimbral static bulk spread  `todo` `low` `large`

Investigate a third bulk-dump strategy for synths that can host multiple simultaneously addressable parts/programs on different MIDI channels, where each part holds its own static tuning map and the allocator spreads notes across those parts.

**Motivation:** dynamic bulk dump is flexible but can become latency-prone and drop notes under dense data flow. A multitimbral static approach could trade setup complexity for lower live transport traffic by preloading several maps and switching channels instead of rewriting one map continuously.

**Candidate shape:**
- Preload `N` static maps, one per part/program/channel group.
- Where the hardware couples tuning data to the currently active user program, require multiple copies of the same sound in multiple user program slots.
- Route note-ons to the part whose preloaded map best covers the target pitch window.
- Keep note-offs, sustain, aftertouch, and controller passthrough bound to the allocated part/channel.

**Known user-experience cost:**
- Not user-friendly.
- Requires multiple copies of the same sound in user program slots.
- Sound design becomes harder because edits must be replicated across those linked programs.
- Setup may depend on an old-style hardware "multi mode" or equivalent multi-channel layering/split workflow.

**Capability model to confirm before any implementation:**
- Does the synth support multiple simultaneously active parts/programs on different MIDI channels?
- Is tuning map selection global, per-part, or per-program?
- Can multiple parts respond polyphonically to the same or overlapping key ranges?
- Can identical sounds be hosted in several parts without breaking modulation/state assumptions?

**Architecture if pursued later:**
- Add a new output runtime mode, tentatively `bulk_static_multitimbral`.
- Extend output capability descriptors with:
  - `multitimbralParts`
  - `tuningScope: 'global' | 'per_part' | 'per_program'`
  - `partChannels`
  - `programCoupledTuning`
- Add a part allocator that chooses both `mapId` and `channel`.
- Keep this separate from dynamic bulk mode so transport complexity stays isolated.

**Expectation:** this is likely only worthwhile for a narrow class of older or workstation-style synths. It is probably too cumbersome to be a primary Hexatone path, but it is worth mapping because it could benefit users whose instruments support bulk dump yet do not cope well with live dynamic retuning traffic.

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

### F3 — Lumatone .ltn export  `todo` `medium` `large`
*2026-04-06: Retired the old `lumatone-export.js` — its geometry was wrong and inconsistent with the registry model. The "Download .ltn" and "Export .ltn" UI buttons have been removed. "Send to Lumatone" (live sysex via `sendLumatoneLayout`) remains and works correctly.*

The export should be rethought from first principles: what a bypass-mode user needs is a .ltn that assigns sequential MIDI notes per block (matching Hexatone's bypass input expectations) with the correct rSteps/drSteps layout and live colours. Build this using `NOTE_XY` + `LUMATONE_BLOCK_OFFSETS` from `controllers/lumatone.js` once the use-case is clear.

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
  C6  Multitimbral static bulk spread research   low    large

LONGER TERM (foundational / quality)
  D   Exact interval layer (xen-dev-utils)        low   xlarge  ← G depends on this
  G   Harmonic-radius chord matching              low   xlarge  ← depends on D
  E   Settings UX renaming (direct_ → mts_bulk_) low   medium
  F1  Test coverage                               low   medium
  F3  Lumatone export rewrite                     medium large
  F2  keys.js split                               low   xlarge
  F5  Persistence unification                     low   xlarge
```
