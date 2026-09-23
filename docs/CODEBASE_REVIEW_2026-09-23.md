# Codebase review — 23 September 2026

Reviewed release candidate **3.3.0-rc.3**, starting at commit `90ffa33`.

**Implementation update:** recommendations 1–5 below have now been implemented.
The original findings remain as the audit record; see the follow-up section at the
end for changes, verification and the remaining streamlining order.

## Scope and changes

This is a module-level ownership, dependency and cleanup review, with deeper
inspection of live MIDI forwarding, output lifetime, sequencer entry points and
test coverage. It is not a claim that every execution path or hardware protocol
has been exhaustively validated.

- Inventoried all 269 tracked non-test JavaScript/JSX/MJS, CSS and SuperCollider
  files. Every one now starts with a comment; existing useful headers were retained.
- Added, moved to the top, or corrected documentation in 90 files. Headers explain
  purpose, state ownership, important callers/dependencies and lifecycle boundaries.
- Parsed JavaScript imports/exports and relative string references, including
  worker URLs, and checked test-only and unreferenced modules against HTML entries,
  build scripts, configuration and external patch references.
- Corrected misleading descriptions of abandoned modules and OSC node allocation.
- **No executable code was changed and nothing was deleted.** Recommendations below
  are deliberately separate follow-up work, not fixes included in this pass.
- Generated builds, dependencies, sound libraries, binary documents and third-party
  protocol reference material were not treated as first-party modules to annotate.
  Existing untracked `codex/` and `soundfonts/` content was preserved.

## Ownership map

| Area | Main responsibility and boundary |
| --- | --- |
| `src/app.jsx` | Workspace orchestration and cross-tab state; wires tuning, sequencing, settings and output hooks. |
| `src/keyboard/` | Canvas geometry/rendering and live Keys/note lifetime; delegates controller interpretation to `src/input/`. |
| `src/input/` | Active MIDI listeners, controller-to-note mapping, expression and raster/glide behaviour. |
| `src/controllers/` | Device geometry, policies, preferences and LED/configuration protocols; settings panels are not drivers. |
| `src/tuning/`, `src/notation/` | Interval/monzo calculations, spelling and reference-frame semantics shared by editors and playback data preparation. |
| `src/sequencer/` | Editor, derived runtime model, snapshot capture/playback and timed transport; presentation updates must not rebuild musical data per trigger. |
| `src/calculator/` | Independently editable workspace seeded from Hexatone, with its own persisted draft and pure calculation layer. |
| `src/settings/`, `src/persistence/` | User controls, settings impact classification, preferences and reload policy. |
| `src/hooks/use-synth-wiring.js` | Backend creation, reuse, replacement and MIDI/audio activation. |
| `src/*_synth/`, `src/midi/`, `src/polyphony/` | Backend voice allocation, output transactions, scheduling and transport-specific messages. |
| `src/manual/`, `src/retune/` | Separate HTML entry points as well as shared manual content; lack of main-App imports does not make them dead. |
| `osc-bridge/`, `Synths/`, root/build scripts | External integration and packaging tools; some entry points are invoked outside JavaScript imports. |

## Priority 1 — correctness and safety before cleanup

### 1. Safety tests exercise the wrong expression runtime

**Confirmed.** `src/keyboard/keys.js` imports
`src/input/keys-expression-runtime.js`, but
`src/midi/performance-cc-policy.test.js` imports the older duplicate under
`src/keyboard/keys-expression-runtime.js`.

The legacy copy rejects non-allowlisted CCs using `allowsPerformanceCC`. The live
copy's `passthroughCC` only applies the Continuum-specific restriction. In the
generic listener path, the allowlist protects the controller-value cache, not the
subsequent call to `_passthroughCC`.

A read-only diagnostic loaded both implementations through Vite and invoked
`passthroughCC` with CC126/value1 and a stub output. Results:

| Runtime | Stub output received |
| --- | --- |
| Live `src/input/keys-expression-runtime.js` | `sendControlChange(126, 1, { channels: 1 })` |
| Legacy `src/keyboard/keys-expression-runtime.js` | Nothing |

No physical MIDI messages were sent. This demonstrates a real live/test mismatch,
not proof of the cause of any particular historical hardware incident.

**Next change:** point the safety test at the live implementation, first observe
the failing assertion, then enforce the intended automatic forwarding policy there.
Keep explicitly generated RPN/device configuration separate from generic input
forwarding. Test controller-specific consumption (including learned pedals and
LinnStrument data) before filtering messages too early. Delete the old implementation
only after its remaining test importer is migrated.

Acceptance: forbidden mode/configuration messages never reach generic forwarded
outputs; permitted performance controls and intentional Eagan mappings still work;
tests enter through the real input/listener path as well as its helper.

### 2. Separate mono teardown from channel-wide panic

**Confirmed call chain; hardware consequence depends on routing.**
`src/mono_synth/index.js` aliases `releaseAll` to `panic`, and `shutdown()` calls
`panic()`. That function sends CC64=0 and CC120=0 on the configured channel, even
when there is no carrier. `use-synth-wiring.js` calls shutdown when replacing the
mono instance, including changes to its configuration/tuning cache key.

On a channel shared with another Hexatone instance or sender, ordinary backend
replacement can therefore silence notes it does not own. Explicit Panic may
intentionally do this; routine teardown should have a distinct contract.

**Next change:** implement owned-voice release/cancellation for normal shutdown,
reserve channel-wide commands for explicit panic, and test replacement on a shared
port/channel with timestamped ramps pending. Do not clear the entire shared MIDI
port queue as a shortcut.

### 3. Bring the independent MIDI guardian up to date

**Confirmed gap.** `src/hooks/use-midi-guardian.js` covers `midi_device`,
`fluidsynth_device` and `mpe_device`, but not `mono_device`. Its unload handler calls
the same CC123+CC120 function as Panic, despite the previous header describing only
CC123 on unload. The description is now corrected; behaviour is unchanged.

This does **not** mean normal mono Panic never works: the mono backend has its own
panic implementation. The gap is the independent safety backstop, especially when
Keys is absent or during page teardown.

**Next change:** enumerate enabled output `(port, channel)` targets centrally,
including mono, and deduplicate those pairs rather than only port IDs. Currently
the FluidSynth mirror is skipped when its port matches `midi_device`, even if its
channel differs. Add tests for same-port/different-channel routes, mono-only output,
no mounted Keys, disabled outputs and disconnects. Decide explicitly whether unload
should hard-cut sound or release only owned notes. Browsers cannot guarantee unload
delivery, so do not make it the sole stuck-note recovery mechanism.

## Priority 2 — remove misleading maintenance paths

### 4. Remove or explicitly adopt the orphaned modules

| Module | Evidence / recommended action |
| --- | --- |
| `src/settings/midi/controllers/index.js` | No importer; obsolete copy of `src/settings/midi/index.js` with 13 unresolved relative imports. Remove after a final reference check; do not repair its imports and revive a second coordinator. |
| `src/sequencer/snapshots.jsx` | No importer; old snapshot-list component. Remove after confirming no downstream external consumer. Preserve the distinct, active `snapshots.js`. |
| `src/settings/scale/scale-table/use-live-scale-table-snapshot.js` | No production or test importer. Remove unless deliberately adopting this subscription boundary. |
| `src/keyboard/keys-expression-runtime.js` | Only the safety test imports it. Consolidate as part of Priority 1, not as an isolated deletion. |
| `src/keyboard/keyboard_math.js` | Only its own test imports it; live calculations are elsewhere. Test the actual production math, then either genuinely share the implementation or remove this copy and migrate useful cases. |
| `src/keyboard/use-keyboard-actions.js` | Only its own test imports it. Its former header incorrectly claimed all Keys calls were centralised here. Remove or deliberately integrate; do not maintain a facade with no clients. |
| `src/sequencer/timed-cue-scheduler.js` | Only its own test imports it. Live scheduling is in `timed-transport-controller.js` / `timed-transport-runtime.js`. Migrate useful invariants to live scheduler tests before deleting. |

These are chiefly maintenance/test-confidence improvements. Removing modules that
are already outside the browser dependency graph will not itself speed up playback.

The apparent unresolved `?raw` and `?react` imports are valid Vite transforms, not
missing files. Test utilities, mocks, workers and standalone HTML/build entry points
must not be removed merely because an ordinary static-import scan misses them.

### 5. Repair tooling drift

- `package.json` exposes `generate:preset-tunings`, but
  `scripts/generate-preset-tunings.mjs` is absent. Recover the intended generator or
  remove the obsolete command/documentation after confirming how presets are maintained.
- `.github/workflows/deploy.yml` runs JS lint, tests and build, but not `yarn lint:css`.
  Add that existing CSS check to the deployment gate; it passes locally.
- Keep the general formatting baseline separate from functional cleanup. Avoid
  whole-repository reformatting while addressing live MIDI and transport regressions.

## Priority 3 — measured streamlining, not another wholesale rewrite

### 6. Finish ownership extractions in the large coordinators

The largest remaining concentration points include App (~6,000 lines), Keys
(~3,200), Sequencer (~3,900), settings CSS (~6,500), and MIDI settings/output panels
(~1,100/~1,300). Size identifies review targets, not a performance defect by itself.

Prefer small, independently testable extractions with the real caller switched
over in the same change:

1. Shared output-route enumeration and disposal contracts, starting with the safety
   findings above rather than another settings-panel copy.
2. Sequencer edit/commit orchestration separated from the immediate trigger path;
   keep the derived runtime model keyed to actual musical changes, not cursor,
   highlight, scrolling or transport-counter updates.
3. Controller-specific settings and listeners with a single source of truth for
   accepted CCs, internal consumption and external forwarding. Preserve per-note
   identity, soft pickup, pedal ownership and note-off ordering.
4. Split CSS by existing workspace/component ownership only after checking cascade
   order and phone layouts. File splitting alone is not a rendering optimisation.

Before and after performance changes, measure Fleeting Flight/FALL rapid cue stepping
and timed playback with Edit & Play expanded in Firefox and Chromium. Record handler
duration, long tasks, runtime rebuild count and output timestamps. Unit tests do not
establish real-world low latency or background-worker timing.

### 7. Resolve smaller legacy/support ambiguities

- `ExtractArray.restore/store` in `src/hooks/use-query.js` are TODO no-ops. App uses
  the joined-array extractor; do not casually fill these methods in and change reload
  semantics. Audit callers/exports and remove the unsupported abstraction or document
  and test an intentional URL-only contract.
- The two `Synths/*/formant_rand.js` copies are byte-identical. The Max patch explicitly
  references the MaxMSP copy; the SuperCollider-directory copy has no located reference.
  Confirm external/manual use before consolidating. Standalone musical experiments
  are not automatically disposable just because the web app does not import them.
- SuperCollider startup scripts contain machine-specific audio routing; the
  multi-server script also kills existing `scsynth` processes. Headers now make that
  operational consequence explicit. A later cleanup could separate portable instrument
  definitions from local startup examples without altering the musical material.
- `workbox.config.js` precaches JS/CSS/HTML/PNG/webmanifest and runtime-caches samples,
  but omits the emitted WOFF2 notation fonts. Review deliberate offline coverage and
  test a cold offline reload before promising complete offline notation support.
  No browser-cache failure was reproduced in this review.

## Suggested implementation batches

1. Live CC policy + real-path regression tests + remove stale expression duplicate.
2. Mono owned-note teardown and guardian route coverage, with shared-port tests.
3. Remaining orphaned modules and test migrations; repair the missing generator command
   and CI CSS gate as separate small changes.
4. Profile musical workloads and extract one coordinator responsibility at a time.
5. Optional support-script, offline-cache and persistence tidying.

## Verification of this documentation pass

- Baseline and final suite: **155 test files, 2,346 tests passed**.
- `yarn lint`: passed.
- `yarn lint:css`: passed.
- `yarn build`: passed, including README credits and service-worker generation.
- Parser comparison against HEAD: executable tokens unchanged in all 83 edited
  JavaScript/JSX/MJS files; CSS and SuperCollider edits are comments/whitespace only.
- `git diff --check`: checked separately before handoff.
- No physical MIDI/controller session, real-browser performance profile, or
  SuperCollider execution was performed. Those remain acceptance work for the
  behavioural fixes proposed above.

## Follow-up: recommendations 1–5 implemented

### Changes

1. **Live performance CC policy:** switched the safety test to the production
   `src/input/keys-expression-runtime.js`, observed its failure, then added the
   standard allowlist to forwarding and controller-state replay. The narrower
   Continuum restriction remains in force. Filtering stays after controller
   decoding/learning, and explicitly generated RPN and Eagan macro messages remain
   separate. Added tests through the real Keys listener and MPE manager output.
2. **Mono lifecycle:** normal release/shutdown now cancels the ramp, releases only
   the owned carrier and invalidates held voices. It sends no channel-wide pedal,
   pressure or mode reset. Explicit Panic retains those reset messages. Release
   also cancels a pending output-transaction finalizer, preventing a deferred chord
   commit after cleanup. Tests cover queued-ramp timestamps, stale callbacks/voices,
   shared-port replacement, transaction cancellation and explicit Panic.
3. **Independent MIDI guardian:** `src/midi/output-targets.js` enumerates enabled
   mono, MTS, bulk-MTS and MPE destinations, validates channels and deduplicates
   `(port, channel)` pairs. A failed/disconnected route does not stop recovery on
   other routes. Mounted-hook tests cover current settings, mono-only use without
   Keys, unload, listener disposal and route failures. Unload deliberately retains
   the existing hard-panic policy; it is not used for routine reconstruction.
4. **Dead-code removal:** removed all seven identified orphaned modules and the
   three tests dedicated to the obsolete math/facade/scheduler implementations.
   Useful coordinate/pitch and dispatch-cursor cases now test Keys,
   MidiCoordResolver and timed-transport-runtime. The abandoned relative channel
   wrapping convention was not imposed on the current resolver. Facade-only tests
   were removed, not recreated for a facade with no clients. Deleted files are
   recoverable from Git; musical assets and external synth experiments are unchanged.
5. **Tooling:** removed the broken `generate:preset-tunings` command and documented
   direct JSON maintenance/import-glob discovery in `DEVELOPER_QUICKSTART.md`.
   Added `yarn lint:css` to the GitHub Pages deployment workflow.

### Verification

- Focused live MIDI/mono/guardian/coordinate/transport checks: **276 passed**.
- Full suite: **153 files / 2,301 tests passed**. The net reduction from the audit
  baseline is removal of obsolete implementation tests, partly offset by new live-path tests.
- `yarn lint`, `yarn lint:css`, `yarn build`, `git diff --check`: passed.
- No remaining source imports/references to the removed modules were found.
- Hardware/browser acceptance remains outstanding. In particular, two senders on
  one MIDI channel still share pitch bend, pressure and controller state by MIDI
  design; avoiding global resets during teardown does not provide channel isolation.
- An in-progress commit (`1a63694`) captured the review and some early fixes during
  this work; subsequent changes preserve that commit and remain in the worktree.

### Further streamlining: recommended order

1. **Measure before more playback refactoring.** Capture reproducible Firefox and
   Chromium traces for rapid manual cues and accelerated timed playback of Flight
   and FALL. Use existing runtime diagnostics to measure rebuild counts, long tasks,
   trigger-to-dispatch time and rendering cost with Edit & Play open/closed.
2. **Unify backend lifecycle contracts.** Document and test `releaseAll`,
   `allSoundOff`, `shutdown`, retained tails and queued-message ownership across
   mono/MPE/MTS/OSC/sample outputs. Then extract lifecycle reconciliation from
   `use-synth-wiring.js`, without changing backend reuse keys or sound-switch behaviour
   in the same batch. Extend the route model only where callers have matching semantics.
3. **Separate editor commits from transport presentation.** Extract sequencer
   draft/commit/revert orchestration behind its existing runtime-model boundary.
   Gate on zero musical-model rebuilds for counter/highlight/scroll-only changes,
   unchanged note-on/off ordering, and no stale pitch after commit/revert.
4. **Make controller policy explicit.** Consolidate per-controller decoding,
   internally consumed controls and forwarded controls as separate policies, ready
   for Bindings. Preserve Exquis sustain, Continuum MPE+/pedals, LinnStrument firmware
   messages and Lumatone soft pickup; do not apply a generic allowlist to raw input.
5. **Split UI/CSS by ownership last.** Move cohesive settings sections out of large
   coordinators and styles into component/workspace groups, maintaining cascade
   order. Verify phone portrait, sidebar collapse, both palettes and tab switching.

Keep persistence TODOs, notation-font offline caching and optional external-script
deduplication as independent low-risk follow-ups. They should not be bundled with
timing-sensitive transport work. Prefer one extraction with real callers switched
over per change, avoiding new parallel implementations that only tests exercise.
