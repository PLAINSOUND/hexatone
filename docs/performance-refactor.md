# Performance refactor

Implemented from the workspace and live-sequencer performance reviews.

| Area | Change |
| --- | --- |
| Settings | Restore URL/storage state once on mount; skip unchanged localStorage values and identical URL replacements. |
| Presets | Memoize dirty-state serialization; remove the second normalization pass over built-in tuning records. |
| Canvas | Cull offscreen hexes from painting while retaining input geometry; cache label measurements with bounded caches and font-load invalidation. |
| Scale editor | Isolate tuning editors from unrelated table rerenders using stable event callbacks and degree-local preview inputs. |
| Rationalisation | Run the existing two-pass whole-scale search in a worker; expose progress and cancellation; reject results after changes to the scale, search settings or pitch context. |
| Sequence scrolling | Cache cumulative row sizes and binary-search the viewport start instead of rebuilding and scanning all offsets on scroll. |
| Sequence persistence | Avoid the intermediate JSON clone and duplicate handler/effect saves for an unchanged immutable workspace revision. |
| Sequence derivation | Share pitch remapping between display and playback; reuse playback events, timelines and timed triggers across display-only changes. |
| SPEED | Convert remaining musical time into wall-clock delay using the current speed multiplier; preserve the musical position during live speed changes. |
| Live controls | Coalesce slider display and preview updates to animation frames; cancel pending previews on reset/commit; avoid duplicate Enter/blur commits; always dispatch the final pitch commit. |
| Chord output | Share sample-engine audio timestamps and OSC retune bundle timestamps. Batch MPE recovery ledger reads/writes within synchronous chord operations, flushing before return. Note-off dispatch remains immediate. |

## Verification

Regression coverage checks speed-adjusted deadlines, musical-position continuity, playback cache invalidation, variable-height viewport boundaries, label cache invalidation, storage write counts, MPE chord recovery, worker completion/cancellation/errors, the two-pass candidate search, and slider preview/final-commit behavior.

A three-note MPE chord now has one recovery-ledger read and one write, rather than a read/write pair per note. An identical sequence workspace revision produces one save across repeated persistence calls. These are operation-count checks, not measured latency claims for a particular Windows computer.

Run `yarn test`, `yarn lint`, and `yarn build`. The production build includes a separate rationalisation worker bundle. Environments without Worker retain a synchronous compatibility fallback.

## Follow-up profiling and larger design work

The reviews also raised timestamped transport lookahead, changing live tempo-marker edit semantics, raw MIDI/MTS packet batching, full scale-table virtualization, lazy preset JSON loading, and preset/keyboard reset scheduling. These require separate profiling or behavior design. This refactor retains current transport ownership, tempo-marker restart behavior, MIDI ordering, and deferred preset-reset sequencing.

On the slower Windows machine, compare preset load time and large-grid interaction, drag pitch and SPEED while chords sound through the actual outputs, and cancel a whole-scale rationalisation during playback. Verify edge hexes at different rotations and note release after touch, sequence stop and MPE reload. Hardware/browser latency has not been measured as part of this refactor.
