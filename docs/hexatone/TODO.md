# Hexatone Targeted TODO

*Created: 2026-04-05. Purpose: short next-steps list derived from Roadmap.md plus current code state.*

## 1. Lumatone mode-aware controller prefs   DONE

Separate persisted anchors for `layout2d` and `bypass`, following the Exquis pattern.
Defaults: 2D note 26/ch 3, bypass note 60/ch 4.
`midiin_anchor_channel` set on connect in both modes so channel-offset arithmetic is correct.
Sequential transposition suppressed in bypass. `lumatone_led_sync` persists at controller level.
Lumatone LED first-send stall fixed (lifetime keyed on stable port IDs, owned in app.jsx).

## 2. Scale-mapper tests   DONE

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

## 6. Lumatone .ltn export  *(retired old code — rethink before rebuilding)*

`lumatone-export.js` and its test were deleted 2026-04-06. The geometry was wrong and inconsistent with the registry. "Download .ltn" and "Export .ltn" UI buttons removed. "Send to Lumatone" (live sysex) is unaffected and still works.

Future export should be built from `NOTE_XY` + `LUMATONE_BLOCK_OFFSETS` in `controllers/lumatone.js` once the use-case (bypass-mode sequential layout with colours) is clearly specified. See Roadmap F3.

## 7. Static bulk OCT synchronization   DONE

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


# TODO

## Big Structural TODO

- `keys.js` is still the main architectural pressure point in Hexatone.
- Before adding much more live-retuning, controller-routing, sequencer, or expressive-input logic, plan the split outlined in [docs/hexatone/issues.md](/Users/marcsabat/Library/CloudStorage/OneDrive-Personal/mail_pl_org/Documents/GitHub/hexatone/docs/hexatone/issues.md) under `ARCH-04`.
- Target extraction order:
  - `src/input/midi-input-handler.js`
  - `src/input/pointer-input-handler.js`
  - `src/keyboard/hex-renderer.js`
- Keep using focused tests to pin behavior in place first, especially around `midinoteOn/Off`, sustain/latch state, controller geometry, and held-note retuning.
