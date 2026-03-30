# Hexatone IO Refactor — Code Review and Annotations

*Review date: 2026-03-30. Written after examining the current codebase state
alongside HexatoneIOrefactor.md.*

---

## Overall Assessment

The roadmap is well-conceived. The IO-pipeline framing (input → hex → output)
is the right mental model and will survive the project growing further. The
phased execution order is also correct in principle: fix state bugs first,
extract pure logic second, then build new features on top of stable ground.

The main gap between the document and the code is that several files the
roadmap treats as targets for future creation already exist (partially):
`use-synth-wiring.js`, `session-defaults.js`, `use-import.js`, `use-presets.js`,
`keyboard/mts-helpers.js`, `normalize-settings.js`. The roadmap should be
read as "restructure these" not "create these from scratch". This is good news
— less to write, more to untangle.

---

## Critical Issues To Address First (Before Any Feature Work)

### 1. The `use-query.js` falsy-value bug is real and load-bearing

Line 83 in `use-query.js`:

```js
if (localStorage.getItem(key)) {
```

This silently drops any persisted value that is falsy: `0`, `false`, `""`.
So `tuning_map_number: 0` never survives a page reload. `sysex_type: 0` would
not survive either. Any boolean setting that was last set to `false` is lost.

This is not a minor edge case. Several MTS settings have meaningful zero values
(`device_id: 0`, `tuning_map_number: 0`, `direct_channel: 0`). The roadmap
note at the top of the document is exactly right that this should be the first
concrete fix.

Fix: replace the `if` check with an explicit null check:

```js
const stored = localStorage.getItem(key);
if (stored !== null) {
  initial[key] = extract.restore(key);
}
```

### 2. `session-defaults.js` has the same falsy collapse problem

The pattern `parseInt(...) || 0` and `parseInt(...) || 127` throughout
`session-defaults.js` will also collapse `0` to the default. For example:

```js
direct_channel: parseInt(sessionStorage.getItem("direct_channel")) || -1,
device_id: parseInt(sessionStorage.getItem("device_id")) || 127,
```

If `direct_channel` was saved as `0` (first channel), it reads back as `-1`.
If `device_id` was set to `0`, it reads back as `127` (broadcast). These are
not just UX glitches — they will silently misdirect MTS traffic.

The correct idiom for nullable integer storage is:

```js
const raw = sessionStorage.getItem("direct_channel");
direct_channel: raw !== null ? parseInt(raw) : -1,
```

Some keys already do this correctly (e.g. `midiin_steps_per_channel`). The
fix should be consistently applied to all numeric session keys. A good test
would be: save `0` for every numeric key and verify it round-trips.

### 3. Persistence and derived state are conflated in `session-defaults.js`

`session-defaults.js` mixes two very different categories in one object:

- User choices that should survive reload: device names, channel numbers,
  map numbers, modes
- Runtime values that should not be stored: `spectrum_colors: true`,
  `retuning_mode`, `axis49_center_note`, `wheel_to_recent`

The roadmap correctly identifies this split but understates how concretely it
applies to the existing file. Before any new feature lands, the following keys
in `session-defaults.js` should be audited and moved to a derived/runtime
defaults object that is never written to `sessionStorage`:

- `spectrum_colors`
- `retuning_mode`
- `key_labels`
- `axis49_center_note`
- `wheel_to_recent`
- `lumatone_center_channel`
- `lumatone_center_note`

---

## Annotations On The Roadmap Phases

### Phase 1 (Immediate Functional Fixes) — Mostly correct, one omission

The listed tasks are right. The one thing missing from Phase 1: **add tests
for the falsy-value round-trip before touching any setting key names**. If you
rename `direct_*` keys to `mts_bulk_*` before the storage logic is correct,
you will lose old user data and also carry the same bug forward under a new name.

Concrete addition to Phase 1:

- write a `use-query.test.js` case that stores `0` and `false` and verifies
  they survive a restore cycle
- write a matching test for the session-defaults pattern

### Phase 2 (Pure Tuning Extraction) — Well-specified, right priority

`keyboard/mts-helpers.js` already exists and contains some of this logic.
The extraction work is therefore scoped narrowly: identify what is already pure
in `mts-helpers.js`, what is still mixed into `midi_synth/index.js`, and what
is duplicated between them, then consolidate.

One observation: the roadmap mentions extracting `centsToMTS` / `mtsToMidiFloat`
as if they are free-floating duplicates. In the current code, similar logic
appears in at least three places. Before extracting, map all call sites first
to avoid leaving a dead duplicate behind.

The scale-math direction note (preserving ratios as exact forms, monzos) is
aspirational and correct architecturally, but it belongs to a separate future
roadmap. Bundling it into Phase 2 risks scope creep. Recommendation: note it as
a future `src/tuning/pitch-model.js` design constraint, do not implement it in
this refactor.

### Phase 3 (Input Domain) — Underspecified in one area

The `hex_layout` vs `scale` split is well-described. What is underspecified
is how **MPE input** fits this model. MPE input carries per-note pitch bend
which amounts to incoming retuning data on each channel. The roadmap gestures
at this ("in future, incoming retuning data") but does not commit to a place
in the module layout. As you formalize `src/input/`, plan a slot for an
`mpe-input-handler.js` even if it starts empty — otherwise MPE input will
stay scattered in `keys.js` indefinitely.

### Phase 4 (Output Domain) — Correct, but watch the reconstruction boundary

The critical risk in Phase 4 is the reconstruction boundary. Currently,
`keys.js` is destroyed and recreated when structural settings change. That
boundary is implicit — the `structuralSettings` useMemo in `app.jsx` defines
it ad hoc. Once output transport modules are separate, you need an explicit
contract: which settings changes require reconstructing `keys`, which require
reconstructing only the output transport, and which only require updating
runtime state.

Recommendation: before moving transport logic out of `keys.js`, write down
the reconstruction rules explicitly (even as a comment block in
`use-synth-wiring.js`). Then the module extraction can be guided by that
contract rather than discovering it accidentally.

### Phase 5 (Dynamic Bulk Dump) — Well-specified

The note about testing whether a note-on delay is needed is practical and
important. Different synths have different latency tolerances after a bulk
dump. Recommendation: implement a configurable `bulk_dump_note_delay_ms`
setting (default 0, hidden unless needed) from the start, rather than
hardcoding and revisiting later.

### Phase 6 (Centered Static Bulk Dump) — Correct, one clarification needed

The 57..72 search range for center anchor is reasonable. The edge case to
handle explicitly: what if the center pitch is outside the range of 12-EDO
pitch classes that MIDI covers at all (e.g., a very high or very low
fundamental)? The search should define a fallback (e.g., default to MIDI
note 69, A4) rather than silently producing an invalid center.

Also: the Input/Output Correlation section notes that `hex_layout` anchor
and static bulk centering should align. This is architecturally correct but
it means Phase 6 is partly blocked on Phase 3. Either make this dependency
explicit in the execution order, or implement Phase 6 with a one-way
approximation (output side only) and revisit the input alignment in Phase 3.

### Phase 7 (Settings UX) — Low risk, defer confidently

Defer this until Phase 4 is complete. Renaming settings keys before the
persistence layer is correct will cause migration problems for existing users.

### Phase 8 (Centralize Persistence) — This is Phase 1, not Phase 8

The roadmap puts persistence centralization last, but the note at the top of
`HexatoneIOrefactor.md` (added 2026-03-30) correctly overrides this ordering.
The falsy-value bug and the persisted-vs-derived split are load-bearing for
everything else. If you build Dynamic Bulk Dump on top of broken storage, the
first reported bug will be a session-state regression, not a transport issue.

**Revised phase ordering recommendation:**

1. Fix `use-query.js` falsy persistence bug (plus tests)
2. Fix `session-defaults.js` integer-zero collapse (plus tests)
3. Audit and annotate persisted vs derived keys
4. Extract pure tuning module (Phase 2 content)
5. Implement Dynamic Bulk Dump (Phase 5 content)
6. Implement Centered Static Bulk Dump (Phase 6 content)
7. Formalize input domain (Phase 3 content)
8. Formalize output domain (Phase 4 content)
9. Settings UX rename (Phase 7 content)

This departs from the document's order by moving persistence fundamentals to
the top and deferring input/output structural work until after the two main
features are working.

---

## Items The Roadmap Does Not Address But Should

### `normalize-settings.js` needs to fit the new model

`normalize-settings.js` exists and presumably sanitizes loaded settings.
Its relationship to the new settings registry and hydration function is
unspecified. Before Phase 8, decide: does `normalize-settings.js` become the
hydration function, get merged into it, or stay as a separate normalization
pass?

### `use-settings-change.js` reconstruction triggers are not inventoried

The roadmap mentions this file repeatedly as a target but does not inventory
what reconstruction triggers it currently defines or which ones are correct
vs accidental. Before moving transport logic around, read this file and
document which settings changes currently cause a full `keys` reconstruction
vs a lighter update. Some of those triggers may be unnecessary (causing
performance regressions) and some necessary ones may be missing (causing the
stale-state bugs the roadmap is trying to fix).

### Test coverage plan is incomplete

The roadmap calls out tests for MTS triplet encoding, bulk dump headers, and
map centering. It does not call out tests for:

- `use-query` falsy round-trip (above)
- session-defaults integer-zero round-trip (above)
- `deriveOutputRuntime()` mapping correctness
- reconstruction boundary rules

These are higher-value tests than transport encoding tests because they guard
against the class of regression that has already bitten the project.

### No mention of migration for existing users

Several setting keys are likely to be renamed (e.g. `direct_*` → `mts_bulk_*`,
`sysex_type` → something more explicit). Existing users have these keys in
localStorage. The persistence registry should include a one-time migration pass
that reads old keys and writes new ones on first load under the new version.
This is easy to implement and easy to forget until users report their settings
disappearing after an update.

---

## The Scale Math Section

The section on retaining exact ratio forms and considering monzo/exponent-vector
representations is architecturally sound for a long-term microtonal tool. The
Scale Workshop angle is real — there is an active community around this math.

However, this is a separate project from the IO refactor. Bundling it risks
making Phase 2 indefinitely large. Recommendation: extract this into its own
separate roadmap document (`docs/ScaleMathDirection.md`) and reference it from
Phase 2 as a design constraint on `pitch-model.js` without implementing it now.

---

## Summary: What To Do Next Session

1. Fix `use-query.js` line 83: `if (stored !== null)` instead of `if (stored)`.
2. Fix `session-defaults.js`: replace all `parseInt(...) || default` with
   explicit null-check patterns.
3. Write tests for both of the above before any setting key renames.
4. Open `use-settings-change.js` and write a comment-block inventory of which
   settings changes currently trigger reconstruction and which should.

These four steps are the leverage point the top-of-file note identified. They
are also reversible (no API changes, no user-visible renames) and testable.
Do them before touching MTS transport code.
