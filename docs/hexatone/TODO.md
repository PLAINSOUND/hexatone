# Hexatone Targeted TODO

*Created: 2026-04-05. Purpose: short next-steps list derived from Roadmap.md plus current code state.*

## 1. Lumatone mode-aware controller prefs

Highest priority.

Implement the new `controllerId + modeKey` persistence model for **Lumatone only**, following the Exquis pattern but with Lumatone-specific modes:
- `layout2d`
- `bypass`

Required behavior:
- separate persisted anchors for 2D and bypass
- defaults:
  - 2D: note `26`, channel `3`
  - bypass: note `60`, channel `4`
- Pitch Wheel settings remain available in both modes
- mode flips restore the correct saved anchor and related prefs

Why this is first:
- it validates the controller architecture on the next important hardware target
- it prevents new Lumatone-specific special cases from spreading through the UI and persistence code

## 2. Lumatone first-load colour send bug

Test and fix the known first-send problem on hardware.

Observed behavior:
- on first Lumatone selection / first colour send, only one key updates
- second send works correctly

Likely area already patched:
- controller-pref preload on device selection in `src/use-settings-change.js`

Next step:
- verify on real hardware
- if still failing, trace initial LED/layout send ordering and stale synth/Keys lifetime on first controller selection

## 3. Scale-mapper tests

Add `src/input/scale-mapper.test.js`.

Cover:
- nearest degree in 12-EDO
- nearest degree in 31-EDO
- nearest degree in JI
- tolerance gate
- `'accept'` vs `'discard'`
- octave wrapping
- exact match
- negative `pitchCents`

Why now:
- small task
- protects a newer input path that is now structurally important

## 4. Controller-state replay follow-through

The basic replay path is now implemented for:
- CC state memory
- pitch wheel position
- channel pressure replay
- synth reattachment / patch-change replay

Next step:
- hardware-test mod wheel, sustain, pitch wheel, and related controller-state carry-over
- confirm behavior on sample synth, direct MIDI, and MPE outputs
- extend engine response later as more synth parameters become CC-aware

This is not a crisis item, but it should be verified while controller/input work is active.

## 5. Remove `mts-helpers.js` shim

Migrate remaining callers to direct `src/tuning/` imports, then delete the shim.

Remaining callers noted in Roadmap / Issues:
- `src/keyboard/keys.js`
- `src/use-synth-wiring.js`
- `src/midi_synth/index.js`
- `src/midioutputs.js`

This is a contained cleanup and should be done once current controller work is stable.

## 6. Rewrite `lumatone-export.js`

Rewrite `src/settings/scale/lumatone-export.js` to use controller-registry geometry instead of its standalone copy.

Why:
- fixes the known export inconsistencies properly
- removes duplicated geometry logic
- aligns export behavior with the live controller model

Best done after the Lumatone mode/persistence pass.

## 7. Static bulk OCT synchronization

Implement Roadmap item `C5`.

Needed behavior:
- non-deferred OCT updates static bulk maps immediately
- deferred OCT skips still-sounding carrier slots and updates them on release

This is the main remaining output-domain feature gap.

## 8. Later, not immediate

Defer until the controller/runtime layer settles:
- `app.jsx` hook extractions
- `keys.js` module split
- exact interval layer
- harmonic-radius chord matching

These are still real tasks, but they are not the right next moves while controller architecture is actively being verified on hardware.
