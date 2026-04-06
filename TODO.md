# TODO

## Big Structural TODO

- `keys.js` is still the main architectural pressure point in Hexatone.
- Before adding much more live-retuning, controller-routing, sequencer, or expressive-input logic, plan the split outlined in [docs/hexatone/issues.md](/Users/marcsabat/Library/CloudStorage/OneDrive-Personal/mail_pl_org/Documents/GitHub/hexatone/docs/hexatone/issues.md) under `ARCH-04`.
- Target extraction order:
  - `src/input/midi-input-handler.js`
  - `src/input/pointer-input-handler.js`
  - `src/keyboard/hex-renderer.js`
- Keep using focused tests to pin behavior in place first, especially around `midinoteOn/Off`, sustain/latch state, controller geometry, and held-note retuning.
