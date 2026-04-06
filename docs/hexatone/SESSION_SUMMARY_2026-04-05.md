# Codex Session Summary

Date: 2026-04-05
Repo: `hexatone`
Purpose: handoff/resume context after refresh, re-auth, or session restart

## Project state at a glance

The app is now materially further along than the older roadmap implied.

Main completed areas:
- persistence registry foundation
- pure tuning modules in `src/tuning/`
- MIDI input UX cleanup
- `inputRuntime` architecture
- scale-target input mode
- iOS AudioContext fix
- full expression routing (`cc74`, mod wheel, channel pressure, expression)
- Exquis App Mode LED support
- shared held-note retune glide and non-destructive output toggling
- first pass of mode-aware controller prefs, implemented for Exquis

Main near-term open areas:
- Lumatone migration to mode-aware controller prefs
- Lumatone first-load color-send bug verification/fix on hardware
- `scale-mapper` tests
- removal of remaining `mts-helpers.js` shim callers
- `lumatone-export.js` rewrite against registry geometry

## Documents updated in this session

Updated:
- `docs/hexatone/Roadmap.md`
- `docs/hexatone/Issues.md`

Added:
- `docs/hexatone/TODO.md`

The roadmap/issues docs were brought into sync with the app state as of 2026-04-05, especially:
- `BUG-02` is now documented as resolved with a regression watchpoint
- `ARCH-08` / roadmap `B5` was reframed around mode-aware controller prefs

## Major technical changes from this session

### 1. Held-note retuning, pitch bend, and output toggle lifecycle

This was the largest body of work in the session.

Core outcome:
- live retune preview is now owned by `keys.js`, not the UI layer
- one shared cents-domain glide drives held-note retunes across outputs
- output toggles no longer reconstruct `Keys`

Current glide constants in `src/keyboard/keys.js`:
- `RETUNE_GLIDE_TICK_MS = 4`
- `RETUNE_GLIDE_TAU_MS = 40`
- `RETUNE_GLIDE_MAX_CENTS_PER_SEC = 4800`
- `RETUNE_GLIDE_SNAP_CENTS = 0.1`

Important behavioral fixes:
- held MPE notes retune in bend-only mode across semitone boundaries
- MPE bend now resolves from the live retuned base, not stale note-on pitch
- Reference Frequency compare uses an immutable preview snapshot
- sample/MTS toggles drain gracefully instead of tearing down the keyboard
- MPE startup PB cleanup is immediate plus deferred `IDLE`-only reset

Files heavily involved:
- `src/keyboard/keys.js`
- `src/settings/scale/scale-table.js`
- `src/use-synth-wiring.js`
- `src/keyboard/index.js`
- `src/mpe_synth/index.js`
- `src/use-settings-change.js`

Known watchpoint:
- MPE deferred release guard is currently `500 ms`
- it is intentionally conservative and should stay under regression watch

### 2. Exquis mode-aware controller prefs

The architectural direction changed during the session.

Initial thought:
- split Exquis by `mpe` and `poly`

Final decision and implementation:
- Exquis persistence buckets are geometry-scoped:
  - `layout2d`
  - `bypass`

This means:
- anchor is shared between MPE and non-MPE inside the same geometry
- anchor can differ between 2D and bypass
- bend direction and related controller prefs can be geometry-specific

Key files:
- `src/controllers/registry.js`
- `src/input/controller-anchor.js`
- `src/use-synth-wiring.js`
- `src/use-settings-change.js`
- `src/settings/midi/index.js`
- `src/input/controller-anchor.test.js`

Important implementation details:
- active mode is stored separately
- prefs are stored under mode-aware keys
- legacy per-controller keys still fall back if mode-specific values do not exist yet
- `midi_passthrough` changes now trigger derived prefs reload

### 3. Exquis defaults and LED behavior

Exquis first-connect/default behavior was tuned and fixed.

Desired fresh-start behavior now:
- `layout2d` default mode
- MPE input enabled
- Auto Send Colours enabled
- Reverse Bend Direction enabled in 2D
- Reverse Bend Direction disabled in bypass

Important nuance:
- MPE vs non-MPE does not define the anchor bucket
- 2D vs bypass does define the anchor bucket

LED-related behavior:
- Exquis sequential/bypass colors were changed from preserved 2D colors to degree-based sequential colors around the chosen anchor
- those colors now use the hardware-transferred palette via `settings/scale/color-transfer`
- Exquis LED controls are visible in both 2D and sequential modes

Files:
- `src/controllers/registry.js`
- `src/persistence/settings-registry.js`
- `src/keyboard/keys.js`
- `src/settings/midi/index.js`

### 4. Controller-state replay architecture

New work near the end of the session:
- stateful controller input is now tracked centrally in `Keys`
- synths can remember and replay controller state when reattached

Tracked state currently includes:
- remembered CC values
- channel pressure
- current non-MPE pitch bend value

New synth-level APIs:
- `rememberControllerState(state)`
- `applyControllerState(state)`

Implemented on:
- `src/sample_synth/index.js`
- `src/midi_synth/index.js`
- `src/mpe_synth/index.js`
- `src/composite_synth/index.js`

Current purpose:
- if mod wheel, sustain, pitch wheel, etc. are already held when a patch/output changes, the new synth can inherit the current state instead of jumping on next movement

Important limitation:
- only engines/features that actually respond to a given CC will sound different today
- but the architecture is now in place for future synths, e.g. drawbar-style work

### 5. Scale/settings UI polish

Several settings UI issues were cleaned up.

Completed:
- `reference_degree = 0` no longer highlights both degree 0 and equave
- Assigned Scale Degree row now shares the same yellow reference highlight
- row highlights are visually consistent across fields, including right-side inputs
- Central Scale Degree uses a pale green highlight
- yellow reference highlight takes precedence over green if both apply
- Layout panel now starts expanded on fresh start
- toggle hover text was standardized:
  - Scale: `Toggle to show scale table` / `Toggle to hide scale table`
  - Layout: `Toggle to show Hexatone Layout settings` / `Toggle to hide Hexatone Layout settings`
- MIDI row `Anchor Key → Central Degree` also got the pale green highlight and consistent field tinting

Files:
- `src/settings/scale/scale-table.js`
- `src/settings/scale/index.js`
- `src/settings/layout.js`
- `src/settings/settings.css`
- tests in matching `*.test.js` files

## Lumatone status

Not fully migrated yet.

Current known design target:
- Lumatone should be the next controller migrated to the mode-aware prefs model
- meaningful modes:
  - `layout2d`
  - `bypass`
- defaults:
  - 2D: anchor note `26`, channel `3`
  - bypass: anchor note `60`, channel `4`

Known suspected bug:
- on first Lumatone selection / first Send Colours, only one key may send
- second send works
- one proactive patch was already added:
  - `use-settings-change.js` now preloads known-controller prefs immediately on device selection
- this still needs real hardware verification

## Files changed in this session

High-signal files changed:
- `docs/hexatone/Roadmap.md`
- `docs/hexatone/Issues.md`
- `docs/hexatone/TODO.md`
- `src/keyboard/keys.js`
- `src/use-synth-wiring.js`
- `src/use-settings-change.js`
- `src/keyboard/index.js`
- `src/controllers/registry.js`
- `src/input/controller-anchor.js`
- `src/settings/midi/index.js`
- `src/persistence/settings-registry.js`
- `src/sample_synth/index.js`
- `src/midi_synth/index.js`
- `src/mpe_synth/index.js`
- `src/composite_synth/index.js`
- `src/settings/scale/scale-table.js`
- `src/settings/scale/index.js`
- `src/settings/layout.js`
- `src/settings/settings.css`

New/updated tests:
- `src/input/controller-anchor.test.js`
- `src/mpe_synth.test.js`
- `src/use-synth-wiring.test.js`
- `src/settings/layout.test.js`
- `src/settings/scale/scale-table.test.js`
- `src/settings/scale/index.test.js`
- `src/composite_synth.test.js`
- `src/midi_synth.test.js`

## Tests run during session

Focused test sets repeatedly passed, especially:
- `yarn test src/input/controller-anchor.test.js`
- `yarn test src/mpe_synth.test.js`
- `yarn test src/settings/layout.test.js src/settings/scale/scale-table.test.js src/settings/scale/index.test.js`
- `yarn test src/composite_synth.test.js src/midi_synth.test.js src/mpe_synth.test.js src/use-synth-wiring.test.js src/app.test.js`

No new broad test failures were introduced in the focused areas worked on.

## Priority next steps

This was written separately into:
- `docs/hexatone/TODO.md`

Short version:
1. migrate Lumatone to mode-aware prefs
2. verify/fix Lumatone first-load color send on hardware
3. add `src/input/scale-mapper.test.js`
4. hardware-verify controller-state replay behavior
5. remove remaining `mts-helpers.js` shim callers
6. rewrite `lumatone-export.js` against registry geometry

## If resuming in a new Codex session

Suggested resume note:

> Read `codex/SESSION_SUMMARY_2026-04-05.md`, `docs/hexatone/TODO.md`, `docs/hexatone/Roadmap.md`, and `docs/hexatone/Issues.md`. Current priority is Lumatone mode-aware controller prefs and first-load color-send verification. Exquis mode-aware prefs are already implemented with geometry-scoped buckets (`layout2d` / `bypass`), and held-note retune/output lifecycle work from BUG-02 is already landed.
