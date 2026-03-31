# Hexatone TODO — Prioritised Refactoring & Feature Plan

**Generated:** March 2026  
**Current version:** 3.1.0_beta  
**Context:** Controller registry rewrite + structural cleanup

---

## 1. done (new controller geometry architecture)

## 2. done (Extract hooks from app.jsx)

### 2.1 done `useSynthWiring(settings, midi, ready, userHasInteracted)`

**Extract:** Lines ~496–676 (the large `useEffect` that creates/destroys
synths based on output settings).

**Returns:** `{ synth, loading }` — the composite synth and loading counter.

**Why:** This is the most complex effect in the app. It has its own internal
logic for `wantSample`, `wantMts`, `wantDirect`, `wantMpe`, FluidSynth
mirroring, `Promise.all`, and `create_composite_synth`. Isolating it makes
the synth lifecycle testable and keeps app.jsx focused on UI orchestration.

### 2.2 done `usePresets(settings, setSettings)`

**Extract:** `presetChanged`, `onLoadCustomPreset`, `onRevertBuiltin`,
`onRevertUser`, `onClearUserPresets`, `findPreset`, `snapshotOf`, `isDirty`,
`activeSource`, `activePresetName`, `savedPresetSnapshot`.

**Returns:** All of the above as a single object.

**Why:** Preset logic is self-contained and has no dependency on the canvas
or synth. It only reads/writes settings.

### 2.3 `useScaleImport(settings, setSettings)`

**Extract:** `onImport` handler (lines ~892–964) and `importCount`.

**Why:** Import parsing is complex (Scala format, Hexatone JSON, labels,
colours, metadata detection) and entirely independent of other concerns.

### 2.4 `useSessionDefaults()`

**Extract:** The 50-line `sessionDefaults` object (lines ~219–293) into a
hook or factory that reads sessionStorage once and returns the merged defaults.

---

## 3. Split keys.js (PRIORITY: MEDIUM)

At ~2335 lines, `keys.js` mixes rendering, input handling, MIDI routing,
and audio triggering. Suggested splits:

### 3.1 `midi-input-handler.js`

All MIDI listener setup (constructor lines ~167–398), `midinoteOn`,
`midinoteOff`, `allnotesOff`, `channelToStepsOffset`, `buildStepsTable`,
`stepsToVisibleCoords`, `bestVisibleCoord`, the recency stack + wheel bend
methods.

**Interface:** Receives a `Keys` instance (for `hexOn`/`hexOff`/state access)
and settings. Returns a `deconstruct()` method to remove listeners.

### 3.2 `pointer-input-handler.js`

Touch, mouse, and computer-keyboard event handlers. Currently interleaved
with MIDI setup in the constructor.

### 3.3 `hex-renderer.js`

`drawHex`, `drawGrid`, `hexCoordsToScreen`, `getHexCoordsAt`, colour
computation (`centsToColor`), label rendering. Pure rendering with no
input or audio dependencies.

**Note:** This split is lower priority than the controller rewrite and hook
extractions. Do it when keys.js needs significant new features (e.g.,
controller overlay rendering).

---

## 4. Unify state persistence (PRIORITY: MEDIUM)

Currently state is persisted across three mechanisms with different semantics:

| Mechanism | What's stored | When read | Cleared by |
|-----------|--------------|-----------|------------|
| URL search params | Layout, scale, non-skip keys | Initial load | `history.replaceState` |
| localStorage | Same as URL (mirror) | Initial load (fallback) | `useQuery` on skip keys |
| sessionStorage | Output settings, MIDI devices, preset source | Every render cycle | Browser tab close, reload clears scale keys |

Problems:
- `useQuery` writes to *both* URL and localStorage on every `setSettings` call,
  making URLs extremely long and localStorage stale when URL is shared.
- `sessionDefaults` reads sessionStorage *before* `useQuery` runs, so the
  merge order is fragile.
- `PRESET_SKIP_KEYS` controls what `useQuery` ignores, but the skip list
  doesn't match `SCALE_KEYS_TO_CLEAR` (used on reset), creating asymmetries.

### Proposed simplification

- **URL params:** Only for *shareable* layout state (scale, rSteps, drSteps,
  hexSize, rotation, fundamental, reference_degree). Read on initial load,
  written on explicit "share" action — not on every settings change.
- **sessionStorage:** All transient state (MIDI devices, output toggles,
  instrument, preset tracking). Read on mount, written on change.
- **localStorage:** Only for user presets (already handled by `custom-presets.js`).
  Remove the localStorage mirror from `useQuery`.

This eliminates the URL-gets-enormous problem and the three-way merge on load.

---

## 5. Improve test coverage (PRIORITY: LOW-MEDIUM)

Current coverage is thin — mainly `parse-scale`, `matrix`, `keyboard_math`,
`scale-table`, and `use-query`. High-value additions:

### 5.1 Controller registry tests

- Each controller's `buildMap()` returns correct (x, y) for known anchor values
- `detectController()` matches expected device name strings
- Anchor at (0, 0) for the anchor key
- Map size matches expected key count (98 for AXIS-49, 280 for Lumatone, etc.)

### 5.2 midinoteOn/Off integration tests

- Mock synth + mock canvas → verify `hexOn` called with correct coords for
  known controller input
- Verify step arithmetic for generic keyboard input
- Sustain + latch behaviour with MIDI input

### 5.3 Synth wiring tests (after hook extraction)

- `useSynthWiring` creates correct synth type for each output combination
- `create_composite_synth` fans out noteOn/Off to all children
- Volume/mute propagates imperatively

---

## 6. Minor cleanup items (PRIORITY: LOW)

### 6.1 Dead code

- `controllers/axis49.js` legacy exports (`AXIS49_MAP`, `getAxis49Position`)
  — only used by the old buildAxis49Table path that's already been replaced
  by registry.js.
- `controllers/lumatone.js` — similarly, `buildLumatoneRawCoords` is
  duplicated in registry.js's `buildLumatoneMap`.
- `use-query.js` `ExtractArray` class and array extractors — `restore()` and
  `store()` return null with `// TODO` comments, never used.
- `settings/scale/colors.test-fix-unfinished.js` — incomplete test file.

### 6.2 Consistency

- Semicolons: mixed across files. Pick a convention and enforce with a linter.
- `PropTypes`: used in some components but not others. Either adopt everywhere
  or remove (given no TypeScript migration is planned, keeping them is
  reasonable for the public-facing API of each component).
- Several `console.log` statements are commented out but left in place.
  Remove or convert to a debug flag.

### 6.3 Performance

- `useQuery`'s `setState` rebuilds the full URL on every settings change
  (including colour picker drags). This is unnecessary for transient state
  and causes visible URL flickering. Fixing this falls out of §4
  (persistence unification).
- `JSON.stringify` for array deps (`scaleKey`, `noteNamesKey`, `noteColorsKey`)
  runs on every render. These could use a shallow array comparison instead.

---

## 7. Input module (PRIORITY: HIGH — in progress)

### 7.1 Exquis dual-mode support

Exquis in Rainbow Layout (notes 0–60) can send either **polyphonic aftertouch**
or **MPE** (per-note pitch bend + pressure + CC74 on individual channels).
The 2D geometry mapping is identical in both cases — only the expression
routing differs.

Currently the registry marks Exquis as `mpe: true`. This needs revisiting:

- Detect or let user select which mode the device is in
- In poly-AT mode: route keyaftertouch per-note, no per-note bend
- In MPE mode: full per-channel expression routing (pitch bend, pressure, CC74)
- The geometry (`buildExquisMap`) is correct for both modes — only
  `inputRuntime.mpeInput` and the CC routing in `keys.js` change

**Do after Step 3.5 (MPE input mode) is implemented.**

### 7.2 Lumatone export rewrite using registry geometry

`src/settings/scale/lumatone-export.js` has a standalone hex geometry
implementation (`BOARD_KEY_COORDS`, `keyStepsFromRef`) that duplicates
logic now living in `controllers/registry.js` (`buildLumatoneMap`,
`lumatone.js`). The export tests expose inconsistencies in the standalone
geometry (wrong col range, wrong step values for key 33).

**Plan:**
- Rewrite `lumatone-export.js` to derive key positions from `buildLumatoneMap`
  and `LUMATONE_BLOCK_OFFSETS` (the authoritative source in `registry.js`)
- This eliminates the duplicate geometry and fixes the test failures as a
  side effect
- Also enables the export to work correctly for arbitrary anchor positions,
  not just the hardcoded default
- The export should produce valid `.ltn` files that work outside Hexatone
  (standard Lumatone editor format), not just files tuned to Hexatone's
  own note layout

**Do after the controller registry geometry is stable (after Phase 3 input
work, since it touches the same geometry layer).**

### 7.3 lumatone-export.test.js — defer until rewrite

The test file had a syntax error (orphaned `it` body — now fixed). The
remaining 6 failing assertions test the old standalone geometry that will
be replaced. **Do not fix these tests individually** — they will be
rewritten together with the export module.

### 7.4 Persistence: fundamental defaults to 440 on fresh load

When "Restore preset on reload" is unchecked and the user refreshes,
the fundamental frequency from the last loaded preset persists instead of
resetting to the default 440 Hz. The `fundamental` key is tier `url` in
the registry (synced to URL + localStorage), so it survives reload even
when preset-skip keys are cleared.

**Fix:** When preset restoration is disabled on load, clear `fundamental`
from localStorage (and from the URL if present) so the registry default
(currently `260.74 Hz` — see §7.4a below) is used. Alternatively, change
the default to `440` in the registry.

**7.4a:** The registry default for `fundamental` is `260.740741` (middle C
at A=440 equal temperament). Users expect `440` (concert A). Consider
changing the registry default to `440` and updating `reference_degree`
default to the degree corresponding to A in the default scale.

### 7.5 iOS: "Loading" spinner hangs on first preset load (regression)

On iOS, the first load of a user preset causes the "Loading…" indicator to hang
indefinitely. The user must tap the small refresh button to proceed. This was not
present a few days before 2026-03-31 — it is a recent regression.

**Likely causes to investigate:**
- The `prepare()` call on the AudioContext (Web Audio requires a user gesture to
  resume on iOS). If `useSynthWiring` now defers or batches the `prepare()` call
  differently from before, it may no longer fire at the right moment on iOS.
- The sample-loading `Promise.all` inside `useSynthWiring` — if an instrument
  fetch is slow or silently fails on iOS Safari, the loading counter never
  reaches zero.
- The `userHasInteracted` flag — if any recent change to the gesture-detection
  logic (e.g. in `app.jsx` or `use-synth-wiring.js`) causes it to be `false`
  when the preset loads, the synth may wait for interaction that has already
  occurred.

**How to reproduce:** Load Hexatone fresh on iOS Safari → select any user preset
→ observe "Loading…" spinner; tap refresh button → spinner clears.

**Do before Phase 3 is declared complete**, since it is a user-visible regression
that blocks normal use on mobile.

---

## Execution order recommendation

```
Phase 1 (controller rewrite):
  §1.2  Remove elaborate layer (revert)
  §1.3  Build new direct-coordinate system
  §1.4  Test with available controllers

Phase 2 (hook extractions — can overlap with Phase 1):
  §2.1  useSynthWiring
  §2.2  usePresets
  §2.3  useScaleImport
  §2.4  useSessionDefaults

Phase 3 (structural):
  §4    Unify state persistence
  §3    Split keys.js (only if needed for new features)

Phase 4 (quality):
  §5    Test coverage
  §6    Cleanup
```

Phases 1 and 2 are independent and can be worked in parallel on separate
branches. Phase 3 depends on Phase 2 (persistence unification is easier
after hooks are extracted). Phase 4 is ongoing.
