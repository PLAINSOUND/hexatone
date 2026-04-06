# Hexatone Issues

*Generated: 2026-04-01. Updated: 2026-04-05. Source: ClaudeRefactorPlan.md, TODO.md, HexatoneIOrefactor.md, midi-input-ux.md*

Tags: `todo` `done` · Priority: `high` `medium` `low` · Complexity: `trivial` `small` `medium` `large` `xlarge`

---

## Bugs

### BUG-01 · Preset/scale reactivity regression
**Tags:** `done`

After generating an equal division scale, the preset selector now correctly switches to "User Tunings" and displays the generated name. Confirmed fixed 2026-04-01 — likely resolved as a side effect of the persistence refactor flushing stale state.

---

### BUG-02 · Pitch bend smoothness and MPE stuck notes
**Tags:** `done` `high` `large`

Pitch bend is unsatisfactory across all synths, and MPE output has stuck-note issues.

**Audit completed 2026-04-01. Initial transport/stuck-note fixes landed 2026-04-02. Held-note retune and output-lifecycle fixes completed 2026-04-05.**

1. **Dynamic Bulk Dump flooded by wheel** — `DynamicBulkHex.retune()` was sending a full 128-note (408-byte) bulk dump on every call. At 14-bit MIDI resolution (~500 events/sec) this overflows the SysEx queue. **Fixed:** `transport.retune()` in `createBulkDynamicTransport` now coalesces via `requestAnimationFrame` — map entries update immediately but the SysEx send fires at most once per frame (~60fps). `noteOn` cancels any pending rAF before sending its own immediate dump.

2. **Retrigger path sends no noteOff** — `VoicePool.noteOn()` detects retrigger (same coords already active) and returns `retrigger: true, stolenSlot: null`. `MpeHex` constructor only sent a noteOff when `stolenSlot !== null`, so a retriggered note got PB + noteOn without a prior noteOff → stuck note in downstream synth. **Fixed:** `MpeHex` constructor now checks `retrigger` first and sends `noteOff` for `pool.getLastNote(channel)` before the new PB + noteOn.

3. **`Ableton_workaround` note selection wrong** — `channel % 16` was used as `baseNote` (always MIDI 0–15), completely disconnected from the target pitch. For channel 16, `baseNote = 0`, producing notes near MIDI 0 or 112. **Fixed:** Start from `nearestNote = round(targetMidi)` (same as normal mode), then apply `channelOffset = c - 16*floor(c/8)` where `c = channel - 1`. Channels 0–7 raise by 0..+7 semitones; channels 8–15 lower by 1..8 semitones. The played note is always within ±8 semitones of the target; pitch bend corrects the remainder. Edge clamping (MIDI 0/127) is safe because deviation stays small when the target itself is near the boundary.

**Also removed `PB_GUARD_MS`:** PB and noteOn are sent in the same synchronous block in the constructor — MIDI driver FIFO guarantees ordering without a timer.

**Follow-up work completed 2026-04-05:**

4. **Held-note retunes were driven by stale pitch bases** — live TuneCell / reference-frequency drags could retune a sounding note, but incoming bend would still resolve from the note-on base and snap back toward the old pitch. **Fixed:** held-note retunes now update against each note's live `_baseCents`, MPE input bend resolves from the live base, and current bend state is reapplied after preview/save/revert transitions. MPE held-note retunes stay in bend-only mode so glides can cross semitone boundaries continuously.

5. **Retune smoothing lived in the wrong layer** — drag smoothing in the scale-table UI was tied to pointer / animation cadence, which produced zippering on large drags and poor agreement across outputs. **Fixed:** the glide model moved into `keys.js` as a shared held-note retune scheduler. TuneCell now sends target cents immediately; `Keys` advances one shared cents-domain glide for all active outputs. Current defaults: `tick=4 ms`, `tau=40 ms`, `max slew=4800 cents/sec`, `snap=0.1 cents`.

6. **Reference Frequency A/B preview accumulated intervals** — compare mode could keep reapplying the same shift instead of restoring the original snapshot. **Fixed:** fundamental preview now resolves against an immutable preview snapshot for the full compare cycle.

7. **Output toggles were too destructive** — enabling/disabling sample/MTS/MPE rebuilt the composite synth stack, cutting tails and retriggering MPE startup corrections. **Fixed:** live output changes no longer reconstruct `Keys`; unchanged synth families are reused, disabled families drain via `releaseAll()`, and old notes are allowed to tail naturally on their existing family object while new notes use the new output set.

8. **MPE startup state could be dirty after re-enable** — the first note after recreating the MPE synth could start from stale PB state and then correct itself. **Fixed:** MPE synth creation now immediately recenters voice-channel PB, keeps a deferred cleanup pass, and only sends that deferred reset on `IDLE` channels so active/retriggered notes are not zeroed underneath the player.

**Regression watchpoint:** the deferred MPE release guard is currently `500 ms`. It is intentionally conservative to protect lingering tails during output switches, but it should stay under observation in case hardware or patch-specific regressions reappear. If first-note startup or unexpected PB-zeroing returns, inspect the interaction between the guard window, `IDLE`-only deferred reset, and long-release external patches first.

---

### BUG-03 · Fundamental defaults to wrong value on fresh load
**Tags:** `done`

Fixed 2026-04-01. `fundamental` was `tier: 'url'` without `presetSkip: true`, so it survived fresh loads via localStorage even when other scale keys were cleared.

**Fix:**
- Added `fundamental` to `PRESET_SKIP_KEYS` in `use-presets.js` — it now clears on reload alongside `scale`, `reference_degree`, etc.
- Added `presetSkip: true` to the `fundamental` entry in `settings-registry.js`.
- Changed the registry default from `260.740741` to `440` Hz — on a fresh load with no preset, the app now starts at concert A.

---

### BUG-04 · Scale target input mode: incoming MIDI pitch mapped to wrong scale degree
**Tags:** `done`

Fixed 2026-04-01. The scale-mapper path in `keys.js` `midinoteOn/Off` went through two incorrect intermediate forms before reaching the correct solution:

**Original code** used `(note - midiin_central_degree) * 100` then added `center_degree` after the search — wrong because `midiin_central_degree` maps to `center_degree`, not degree 0, so the reference was misaligned.

**First attempted fix** mirrored `noteToSteps()` using `(note - midiin_central_degree + center_degree) * 100` — still wrong because this uses 12-EDO semitone arithmetic anchored to a hardware setting, not to the musical tuning (`fundamental` + `reference_degree`). Notes triggered incorrect degrees whenever the preset tuning diverged from 12-EDO or the reference was not A=440.

**Root cause:** the two input modes have fundamentally different chains:
- **Layout mode** — hardware geometry chain: `note → steps (via midiin_central_degree + center_degree anchor) → coords`. The anchor maps physical keys onto grid positions; `hexCoordsToCents` derives pitch from grid position. Layout settings are essential here.
- **Scale mode** — musical pitch chain: `note → pitchHz (12-EDO absolute) → pitchCents (relative to degree0Hz) → findNearestDegree → steps → coords`. Layout settings (`midiin_central_degree`, `center_degree`, `rSteps`) are entirely irrelevant.

**Correct fix:** compute `degree0Hz` from `fundamental` and `reference_degree`, convert incoming MIDI to Hz, then take the log ratio — no layout parameters involved:

```js
const degree0Hz = fundamental / 2^(degree0toRefCents / 1200);
const pitchHz   = 440 * 2^((note - 69) / 12);
const pitchCents = 1200 * log2(pitchHz / degree0Hz);
```

`degree0toRefCents` comes from `this.settings.degree0toRef_asArray[0]` (pre-computed at Keys construction from `reference_degree` and the normalised scale). Applied identically to both `midinoteOn` and `midinoteOff`.

---

### BUG-05 · Scala interval fields accept negative values and zero ranges
**Tags:** `done`

Fixed 2026-04-01. No Scala-style text input in the UI validated its value — negative cents, zero-range intervals, and NaN-producing strings (e.g. `"0/0"`) were all silently accepted and passed downstream to `scalaToCents`.

Additionally, the "Divide Equave" button in the scale panel had a 30-line inline duplicate of `scalaToCents` logic (using `Math.log2` instead of the shared function) with no zero/negative guard.

**Fix:**
- Added `parseScalaInterval(str, context)` to `src/settings/scale/parse-scale.js` — returns `{ cents, valid, error }`. Validates: non-finite/NaN → invalid; negative → invalid; zero in `'interval'` context → invalid (zero bend range or equave is meaningless).
- Added `ScalaInput` component (`src/settings/scale/scala-input.js`) — wraps any Scala text field with red-border feedback on invalid input, cents preview, zero coercion to `"0."` on blur (degree context), and revert-to-last-good on blur (invalid entry).
- Wired `ScalaInput` into all four affected locations: Pitch Bend Interval (`midiin_bend_range`), Equave sidebar input, all scale table degree cells, scale table equave row.
- Replaced the inline Divide Equave parser with `parseScalaInterval(equaveStr, 'interval')`.
- CSS updated: `.freq-cell > span` and `.freq-cell > span input` added to handle `ScalaInput`'s wrapper `<span>` inside the flex cell; `.sidebar-input` gains `justify-content: flex-end` for when it is applied to a flex wrapper.

---

### BUG-07 · Exquis firmware: pad stuck after MPE mode switch while held
**Tags:** `todo` `medium` `trivial` · **Upstream firmware bug — workaround in place**

**Observed behaviour:** If a pad is physically held on the Exquis when `CMD 0x07` (MPE mode toggle) is sent via App Mode SysEx, that pad becomes permanently unresponsive — it stops sending note-on for that pad ID until the device is power-cycled. All other pads continue to work normally.

**Root cause:** Exquis firmware does not flush held pad state before processing the mode switch. The pad's internal press/release state machine gets stuck in "pressed", so subsequent note-on events for that pad are suppressed.

**Workaround (implemented 2026-04-02):** `ExquisLEDs.setMPEMode()` defers sending `CMD 0x07` until all pads are released. A `_heldPadCount` counter is maintained by tracking note-on/note-off messages from the Exquis input port in `_onMessage`. When the user toggles MPE mode, `_mpeModePending` is set; the actual SysEx is sent on the note-off event that brings `_heldPadCount` to zero. If no pads are held at toggle time, the command is sent immediately.

**To report to Intuitive Instruments:**

> **Subject:** App Mode firmware bug — CMD 0x07 (mpe) while pad held causes permanent pad lockout
>
> When `CMD 0x07` is sent while a pad is physically held, that pad stops generating note-on events for the remainder of the session. The pad appears stuck in a "pressed" state internally — it does not respond to new presses until the device is power-cycled. All other pads are unaffected.
>
> Repro steps:
> 1. Enter App Mode (heartbeat + `pad_remote=0`).
> 2. Hold any pad down.
> 3. While the pad is held, send `F0 00 21 7E 07 01 F7` (or `07 00`).
> 4. Release the pad.
> 5. Press the same pad again — no note-on is generated.
>
> Expected: `CMD 0x07` applies cleanly regardless of pad hold state; the device flushes or defers internal pad state.
>
> Firmware version under test: 3.0.0.

---

### BUG-08 · `lumatone-export.js` geometry inconsistencies (6 failing tests)
**Tags:** `todo` `medium` `medium`

`src/settings/scale/lumatone-export.js` has a standalone hex geometry implementation (`BOARD_KEY_COORDS`, `keyStepsFromRef`) that duplicates logic now in `controllers/registry.js`. The export tests expose inconsistencies: wrong col range, wrong step values for key 33.

**Do not fix these tests individually** — they will be replaced when the module is rewritten. See ARCH-05.

---

### BUG-09 Fundamental Tune Cell not working as expected
**Tags:** done

The bug
In previewFundamental (keys.js:775), the snapshot was unconditionally cleared whenever deltaCents === 0:

if (deltaCents === 0) this._fundamentalSnapshot = null;  // ← the problem
onCompare calls previewFundamental(0) to restore the original pitch for the A/B listen. This correctly retunes to the snapshot base, but then destroyed the snapshot as a side-effect. On the next Compare click back to the retuned state, snap was null, so base = hex.cents (now the original pitch), and the delta was applied correctly — once. But the following click to original called previewFundamental(0) again with hex.cents = original + delta, returning original + delta + 0, not original. Each cycle accumulated another +delta.

Fix: previewFundamental now takes an explicit clearSnapshot parameter (default false). Only onSave and onRevert pass true — they are the calls that genuinely end the drag session. onCompare continues to pass no argument (default false), so the snapshot survives the full compare cycle


### BUG-10 Dynamic Tuning Map failure

Summary of the two fixes
Bug 1 — centsToMTS is not defined (src/midi_synth/index.js:4-7)
buildDynamicBulkAllocation calls centsToMTS but it was never imported. The file imported buildBulkDumpMessage and buildTuningMapEntries from mts-helpers.js but omitted centsToMTS. Added it to the import. This was the root cause of the Dynamic Bulk Dump crash on every noteOn.

Bug 2 — Data bytes must be integers between 0 and 255 (src/keyboard/keys.js:1230-1284)
The static bulk dump in mtsSendMap was using output.sendSysex([manufacturer], msg) where it had msg.shift()-ed the leading 126 byte off and passed it as the manufacturer. WebMidi's sendSysex rejects this — 126 isn't a valid manufacturer ID in its validation model.

The fix matches the pattern already used by createBulkDynamicTransport.sendBulkDump(): use output.send([0xF0, ...msg, 0xF7]) with the full flat payload intact. As part of this, corrected HEADER_LEN from 20 to 21 (the leading 126 byte is part of the payload, so header = 126 + device_id + 8 + 1 + map# + 16-byte name = 21 bytes, not 20) — the sustained-note slot patching was therefore also writing into the wrong positions.

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
**Tags:** `done`

`deriveOutputRuntime(settings, midi, tuningRuntime)` is implemented in `src/use-synth-wiring.js` and fully functional. It is not yet in a standalone module but is correctly positioned and tested through integration. Extraction into `src/output/output-modes.js` is deferred until the function needs to change.

---

### ARCH-03 · Complete `inputRuntime` — move remaining fields out of `keys.js` direct `settings` reads
**Tags:** `done`

All `inputRuntime` fields are wired in `app.jsx` useMemo. `keys.js` reads input mode decisions from `inputRuntime`, not directly from `settings`.

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

`src/settings/scale/lumatone-export.js` has a standalone hex geometry implementation that duplicates `controllers/registry.js` (`buildLumatoneMap`, `LUMATONE_BLOCK_OFFSETS`). This causes the 6 failing export tests (see BUG-06).

**Plan:**
- Rewrite `lumatone-export.js` to derive key positions from `buildLumatoneMap` — the authoritative source.
- Eliminates duplicate geometry; fixes test failures as a side effect.
- Enables correct export for arbitrary anchor positions (not just the hardcoded default).
- Ensure exported `.ltn` files are valid for the standard Lumatone editor format.

**Phase 3 and Phase C (output) are now stable.** The geometry layer is ready — this can proceed.

---

### ARCH-06 · Unify state persistence (URL/session/local)
**Tags:** `todo` `low` `xlarge`

Three overlapping stores with no clear rules. Problems:
- `useQuery` writes to both URL and localStorage on every `setSettings` call → URLs grow enormous; localStorage goes stale when URL is shared.
- `sessionDefaults` reads sessionStorage *before* `useQuery` runs → fragile merge order.
- ~~`PRESET_SKIP_KEYS` doesn't match `SCALE_KEYS_TO_CLEAR` → asymmetries on reset~~ — fixed 2026-04-01: both now derive from the registry / single exported list.

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

### ARCH-08 · Mode-aware controller prefs and anchors
**Tags:** `todo` `high` `medium`

**Decision updated 2026-04-05.** See Roadmap.md B5 for full design.

**How we got here:**

`midiin_mpe_input` was resetting to `false` on every page refresh, even for known MPE controllers (e.g. Exquis). Root cause: `loadAnchorSettingsUpdate` — which reads per-controller prefs from localStorage — only fires when the user explicitly changes `midiin_device` in the dropdown (`use-settings-change.js`). Page refresh, fresh start, and future auto-connect paths were all gaps.

A patch (`_controllerPrefsApplied` ref in `use-synth-wiring.js`) was added as a short-term fix, but this approach does not scale: every new connect path needs its own patch, and with LinnStrument, Tonal Plexus, Seaboard and others coming, the code will fragment.

**The structural problem:** controller prefs are now loaded from one derived-state path, which is good, but they are still keyed only by `controller.id`. That is already too coarse for the next controller wave.

Examples that need separate remembered state:
- Lumatone 2D layout vs bypass/sequential
- Exquis MPE vs standard/polytouch operation
- Future LinnStrument or Tonal Plexus modes with different anchor assumptions

The correct persistence identity is:

```txt
controllerId + modeKey
```

not just `controllerId`.

That means anchor note/channel and related shared fields should be remembered per controller state, not globally and not controller-only. The current derived-state owner in `use-synth-wiring.js` should remain, but it should resolve:
1. controller
2. controller mode
3. saved prefs for that `{ controllerId, modeKey }`
4. mode defaults for anything not yet saved

**Refactor direction:** see Roadmap.md B5.

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
**Tags:** `done` `medium` `medium`

Exquis in Rainbow Layout can send either polyphonic aftertouch or MPE. The registry currently marks Exquis as `mpe: true`. This needs revisiting:
- Detect or let the user select which mode the device is in.
- **Poly-AT mode:** route `keyaftertouch` per-note; no per-note bend.
- **MPE mode:** full per-channel expression routing (pitch bend, pressure, CC74).
- The geometry (`buildExquisMap`) is correct for both modes — only `inputRuntime.mpeInput` and CC routing in `keys.js` change.

**Partial implementation 2026-04-02:** Hexatone now sends `CMD 0x07 P1={0|1}` via App Mode to switch the Exquis between MPE and Poly-AT output when the user toggles "Enable MPE Input". See BUG-07 for the firmware workaround required.

**Step 3.5 MPE input mode is stable.** This can proceed when there is capacity.

---

### FEAT-05 · Settings key renaming (`direct_*` → `mts_bulk_*`)
**Tags:** `todo` `low` `medium`

UI-facing settings keys like `direct_device`, `direct_mode`, `direct_channel` etc. use internal implementation names rather than domain names. Renaming to `mts_bulk_*` would make the UI and settings more self-explanatory.

**Requires a migration pass** to avoid breaking existing user sessions. Phase C is stable, so the domain model is settled — this can proceed when there is appetite for the migration effort.

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

### DONE: Output transport strategies (Phase C1)
**Tags:** `done`
Five output mode classes in `src/midi_synth/index.js` + `src/mpe_synth/`, `src/sample_synth/`, `src/osc_synth/`, composited via `src/composite_synth/`. All share unified `makeHex()` interface. `deriveOutputRuntime()` builds the config array consumed by `create_midi_synth()`.

### DONE: Dynamic Bulk Dump output (Phase C2)
**Tags:** `done`
`createBulkDynamicTransport()` maintains in-memory 128-note map; patches carrier slot and sends full bulk dump on each note-on. MTS1 voice pool allocation. Shared MTS encoding with real-time mode via `src/tuning/mts-format.js`.

### DONE: Centered Static Bulk Dump (Phase C3)
**Tags:** `done`
`StaticBulkHex` plays notes as `anchor + steps` from a pre-built centered map. Centering via `chooseStaticMapCenterMidi()` (search MIDI 57–72 for best pitch-class match). `mtsSendMap()` in `keys.js` with sustained-note protection and auto-send. Full UI in `midioutputs.js`.

### DONE: Input/output correlation for static bulk (Phase C4)
**Tags:** `done`
`scale` input target and `hex_layout` anchor both use `center_degree` as the shared anchor. `center-anchor.js` is the common foundation.

### DONE: Persistence list deduplication
**Tags:** `done`
Fixed 2026-04-01. Three issues resolved:
- `use-presets.js` had its own hardcoded `PRESET_SKIP_KEYS` (16 keys) duplicating the registry export. Replaced with `import { PRESET_SKIP_KEYS } from './persistence/settings-registry.js'` + re-export.
- `app.jsx` `scaleKeysToClear` local array was missing `fundamental`, `rSteps`, `drSteps`, `rotation`, `hexSize` vs `use-presets.js SCALE_KEYS_TO_CLEAR`. Replaced with `[...SCALE_KEYS_TO_CLEAR, ...extraKeysToClear]` where extras are the four session-flag keys specific to the reload context (`hexatone_preset_source`, `hexatone_preset_name`, `lumatone_led_sync`, `direct_sysex_auto`).
- `DIRTY_FIELDS` in `use-presets.js` now automatically tracks the registry since `PRESET_SKIP_KEYS` is imported directly.
