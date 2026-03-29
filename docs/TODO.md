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
