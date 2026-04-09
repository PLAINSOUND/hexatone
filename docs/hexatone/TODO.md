# Hexatone Targeted TODO

*Created: 2026-04-05. Updated: 2026-04-06.*
*Purpose: short next-steps list derived from Roadmap.md plus current code state.*

---

## 1. Lumatone mode-aware controller prefs   DONE

Separate persisted anchors for `layout2d` and `bypass`, following the Exquis pattern.
Defaults: 2D note 26/ch 3, bypass note 60/ch 4.
`midiin_anchor_channel` set on connect in both modes so channel-offset arithmetic is correct.
Sequential transposition suppressed in bypass. `lumatone_led_sync` persists at controller level.
Lumatone LED first-send stall fixed (lifetime keyed on stable port IDs, owned in app.jsx).

---

## 2. Scale-mapper tests   ← NEXT

Add `src/input/scale-mapper.test.js`.

Cover:
- nearest degree in 12-EDO
- nearest degree in 31-EDO
- nearest degree in JI
- tolerance gate (`'discard'` returns null when pitch too far)
- `'accept'` mode always returns best match
- octave wrapping
- exact match (0¢ distance)
- negative `pitchCents`

Why now: small task, protects a newer input path that is now structurally important.

---

## 3. Controller-state replay hardware verification

The basic replay path is implemented for:
- CC state memory
- pitch wheel position
- channel pressure replay
- synth reattachment / patch-change replay

Next step:
- hardware-test mod wheel, sustain, pitch wheel, and controller-state carry-over with AXIS-49, Lumatone, and Exquis
- confirm on sample synth, direct MIDI, and MPE outputs

Not a crisis item, but verify while controller/input work is fresh.

---

## 4. Before entering the retuning/sequencer arc — pre-flight checklist

These are the remaining cleanup and closure items that should be resolved (or consciously deferred) before the development focus shifts to retuning logic and sequencer work. Ordered by priority.

### 4a. Delete `mts-helpers.js` shim   `medium` `small`
Migrate 4 remaining callers to direct `src/tuning/` imports, then delete the shim.
Callers: `src/keyboard/keys.js`, `src/use-synth-wiring.js`, `src/midi_synth/index.js`, `src/midioutputs.js`.
(Roadmap B1 / Issues ARCH-01)

### 4b. LinnStrument mode-aware prefs   `medium` `small`
LinnStrument is the one controller not yet upgraded to the `defaultMode`/`modes`/`resolveMode` pattern.
Its bypass semantics (multi-channel MPE vs standard) are different from single-channel controllers.
Do when LinnStrument is available for hardware testing.

### 4c. OCT + static bulk dump synchronisation   `medium` `medium`
OCT transpose must update the static bulk map:
- immediate mode: recalculate and resend (when auto-send is on)
- deferred mode: skip held carrier slots, update on release
(Roadmap C5 / Issues FEAT-06)

### 4d. Lumatone .ltn export rethink   `medium` `large`
Old `lumatone-export.js` retired 2026-04-06 (geometry was wrong). The "Send to Lumatone" live
sysex path is unaffected. A future export should be built from registry geometry once the
bypass-mode use-case is clearly specified. See Roadmap F3.

### 4e. Dead code removal   `low` `trivial`
- `controllers/axis49.js` — legacy `AXIS49_MAP`, `getAxis49Position`
- `controllers/lumatone.js` — `buildLumatoneRawCoords` duplicate
- `use-query.js` — `ExtractArray` class (never used)
- `settings/scale/colors.test-fix-unfinished.js`
- Commented-out `console.log` statements
(Issues CLEAN-01)

### 4f. `useScaleImport` hook extraction   `low` `medium`
Extract `onImport` handler + `importCount` from `app.jsx` into `useScaleImport`.
Self-contained; enables TEST-04 (synth wiring tests). (Roadmap B3 / Issues ARCH-07)

### 4g. TEST-02 Controller registry tests   `low` `medium`
- Each controller's `buildMap()` returns correct `(x, y)` for known anchor values
- `detectController()` matches expected device name strings
- Anchor at `(0, 0)` for the anchor key
- Map size matches expected key count (98 for AXIS-49, 280 for Lumatone, etc.)

---

## 5. Retuning logic and sequencer arc   ← FUTURE

This is the next major development arc. Do not start until the pre-flight checklist (item 4) is
reviewed and the most critical items are resolved.

Key work in this arc (see Roadmap Phases D, G, and sequencer design docs):

- **Phase D — Exact interval layer** (`src/tuning/interval.js`): stop discarding ratio identity
  at `normalize()`. Wrap `xen-dev-utils` `Fraction` + `toMonzo()`. Foundation for everything below.

- **Phase G — Harmonic-radius chord matching** for scale-target input mode:
  - `findCandidates` in `scale-mapper.js` (extend existing, backward-compatible)
  - `harmonicRadius.js` — pure math, Marc Sabat/Tenney/Benedetti chord radius
  - `chord-rationaliser.js` — global polyphonic degree assignment
  - Wire into `midinoteOn/Off` (scale mode path only)
  - Depends on Phase D

- **Sequencer** — no design doc yet. Define scope before coding.

---

## 6. Deferred architecture (do not rush)

These are real but should not interrupt active musical work:

- `app.jsx` hook extractions (Roadmap B3)
- `keys.js` module split (Roadmap F2) — only when `keys.js` needs significant new features
- Persistence unification: URL/session/local separation (Roadmap F5)
- Settings key renaming `direct_*` → `mts_bulk_*` (Roadmap E / Issues FEAT-05)
- TEST-03 `midinoteOn/Off` integration tests
- TEST-04 Synth wiring tests (after `useScaleImport` extraction)
- TS16 and Tonal Plexus registry entries (Issues FEAT-07)
- CLEAN-02 MIDI input settings panel UX spec verification
- CLEAN-03 Code style consistency (semicolons, PropTypes, array dep keys)
