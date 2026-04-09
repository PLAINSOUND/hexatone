# Session Summary — 2026-04-06

## What was done this session

### 1. Lumatone first-load colour send stall — fixed (BUG-11)

The ACK-gated sysex queue (`LumatoneLEDs`) would send one packet, receive its ACK, then go permanently silent on first use. Root cause: two compounding problems.

1. `LumatoneLEDs` lived inside `Keys`, which was reconstructed whenever `lumatoneRawPorts` (a `useMemo`) produced a new object reference — even on renders that didn't change the underlying ports. The destroyed engine's `_onMessage` still fired for the in-flight ACK, called `_advance()`, hit `this._out = null`, and the queue crashed silently.

2. After lifting `LumatoneLEDs` into `app.jsx`, the `useEffect` was still keyed on the `lumatoneRawPorts` object reference, so the same race persisted.

**Fix:** Keyed the lifecycle effect on stable Web MIDI port ID strings (`lumatoneInId`, `lumatoneOutId`) rather than the container object. `LumatoneLEDs` now lives in `app.jsx` as `lumatoneLedsRef`, exactly mirroring the `ExquisLEDs` architecture. `deconstruct()` just nulls the reference; `app.jsx` owns the full lifecycle.

**Files changed:** `src/app.jsx`, `src/keyboard/keys.js`, `src/keyboard/index.js`

---

### 2. `lumatone_led_sync` (Auto-Send) — now persists at controller level

Previously session-scoped (reset on every tab close). Changed to `tier: 'local'`, `perController: false` so it survives browser restarts. Default remains `false` — new users are not surprised by automatic sysex traffic on first connect.

**Files changed:** `src/persistence/settings-registry.js`, `src/settings/midi/index.js`

---

### 3. Lumatone mode-aware controller prefs — implemented (ARCH-08 / B5)

Full implementation of the `controllerId + modeKey` persistence model for Lumatone, following the Exquis pattern.

**Two modes:**
- `layout2d` — anchor note 26, channel 3, `midi_passthrough: false`
- `bypass` — anchor note 60, channel 4, `midi_passthrough: true`

**What was built:**

- `registry.js`: added `defaultMode`, `modes`, and `resolveMode` to the Lumatone entry.
- `controller-anchor.js`:
  - `getControllerMode` now resolves from live settings via `resolveMode` *before* falling back to `defaultMode` when nothing is stored. This means first-connect with `midi_passthrough: true` correctly yields `'bypass'` rather than always `'layout2d'`.
  - `loadSavedAnchor`, `loadSavedAnchorChannel`, `loadControllerPrefs` all gained a `{ preferStored }` option.
  - `loadAnchorSettingsUpdate` computes `preferStored = settings === null` and passes it consistently so mode resolution is authoritative from live settings when available, from storage when not.
  - `loadAnchorSettingsUpdate` now also sets `midiin_anchor_channel` alongside `lumatone_center_channel` — without this, the channel-offset formula in `channelToStepsOffset` defaulted to ch 1 regardless of the loaded anchor, causing 3-equave transposition errors in bypass mode.
  - Sequential transposition defaults (`sequentialTransposeDefault`, `sequentialLegacyDefault`) are now suppressed in bypass mode. Applying equave-per-channel transposition to a bypass connection was the source of the octave-transposition bug reported during this session.

**Tests:** 47 passing in `controller-anchor.test.js`. Two new test groups:
- `Lumatone mode-aware controller prefs` — 9 tests covering default mode, bypass resolution, reconnect restore, mode-toggle, mode-scoped storage, legacy fallback, and sequential suppression.
- Extended mock `LUMATONE_MODES` with `sequentialTransposeDefault` / `sequentialLegacyDefault` fields.

---

### 4. Arrow key shortcuts for OCT transpose

Four arrow keys now trigger OCT transposition globally (sidebar open or closed), suppressed only when a text input has focus.

| Key | Direction | Mode |
|-----|-----------|------|
| `↑` | +1 up | deferred |
| `↓` | −1 down | immediate |
| `→` | +1 up | immediate |
| `←` | −1 down | deferred |

"Immediate to the right, deferred to the left, up is up, down is down."

**Architecture:** Added `onShiftOctave` callback to the `Keys` constructor (same pattern as `onTakeSnapshot`). `shiftOctaveExplicit(dir, deferred)` added to `useSynthWiring` — accepts an explicit `deferred` flag so arrow keys can specify the mode independently of the toggle state. Passed through `app.jsx` → `<Keyboard>` prop → `Keys` constructor.

**Files changed:** `src/keyboard/keys.js`, `src/keyboard/index.js`, `src/app.jsx`, `src/use-synth-wiring.js`

---

### 5. AXIS-49 mode-aware controller prefs

`registry.js` AXIS-49 entry updated with `defaultMode`, `modes`, `resolveMode`:
- `layout2d`: anchor note 53, `midi_passthrough: false`
- `bypass`: anchor note 50 (centre of 0–127 MIDI range), `midi_passthrough: true`

**Tests:** 7 tests in new `AXIS-49 mode-aware controller prefs` suite.

---

### 6. All remaining single-channel controllers — mode-aware prefs added

Same `layout2d`/`bypass` pattern applied to:

| Controller | layout2d anchor | bypass anchor |
|------------|----------------|---------------|
| TS41       | 36             | 60            |
| Push2      | 36             | 60            |
| Launchpad  | 36             | 60            |
| Generic    | 60             | 60            |

**Tests:** `describeSingleChannelModes` helper function drives 6 identical assertions for each (32 new tests). Total `controller-anchor.test.js`: 88 passing.

LinnStrument left without modes — its multi-channel MPE bypass semantics are distinct and not yet hardware-tested.

---

## Bug fixes discovered and resolved mid-session

**Bypass octave transposition bug:** When switching to bypass mode, note 60 on ch 4 was arriving 3 equaves too high. Root cause: `loadAnchorSettingsUpdate` was setting `lumatone_center_channel` but not `midiin_anchor_channel`. The channel-offset formula `(incomingChannel - anchorChannel) * stepsPerChannel` defaulted to `anchorChannel = 1`, so ch 4 added `3 * equivSteps` offset. Fixed by adding `update.midiin_anchor_channel = ch` alongside `update.lumatone_center_channel`.

**Sequential transposition in bypass:** Even after fixing the anchor channel, equave-per-channel transposition (`sequentialTransposeDefault: null`) was still being applied in bypass mode. Fixed by checking `activeMode !== 'bypass'` before applying sequential defaults in `loadAnchorSettingsUpdate`.

---

## State of the test suite

```
controller-anchor.test.js    88 tests — all passing
keys-midi-input.test.js      passing
midi_synth/index.test.js     passing
scale-mapper (no test file)  — still missing (TODO item 2)
lumatone-export.test.js      6 failing — pre-existing, file retired
```

---

## TODO carryover into next session

See `TODO.md` for the current prioritised list. The controller persistence arc (TODO item 1) is complete. Next recommended step is **item 2: scale-mapper tests**, then hardware verification of controller-state replay.
