# Hexatone app context and transition map

Last reviewed: 2026-10-07. This is a living map of the implementation, not a
roadmap or a claim that every transition has been fully audited. Follow the
linked code and tests when changing behaviour. Extend the relevant entry in the
same change; do not maintain a second description of the same contract elsewhere.

## Read this before changing a transition

1. Identify the boundary below and the state owner on each side.
2. Trace the complete action: input → decision → musical effect → UI commit.
3. Decide what survives, what is released, and what cancels pending work.
4. Check the other callers of the same helpers, including startup and reload.
5. Add an action-sequence regression test, not just a helper test. Update this
   map if ownership, state shape, ordering, or the musical result changes.

Use function names rather than line numbers, which move frequently. Comments at
boundaries should explain the contract and why ordering matters, then link here.
Keep planned behaviour explicitly separate from implemented behaviour. A passing
mock test is not proof of browser audio, MIDI hardware, or private-storage behaviour.

## Owners and shared vocabulary

```text
UI / MIDI events
  → App and transport/input controllers decide the action
  → Keys owns live note objects and keyboard performance state
  → composite output fans each voice out to backend voices
  → engines / external devices render or schedule sound

Saved sequence → derived runtime model → playback decisions
                                      → readout / highlights / editor view
```

- **App** ([app.jsx](../src/app.jsx)) owns workspace/settings state and coordinates
  transport, tuning, input, output wiring and recovery. It is not the audio clock.
- **Keyboard wrapper** ([keyboard/index.js](../src/keyboard/index.js)) owns the
  lifetime of a `Keys` instance. Settings impact determines reconstruction versus
  imperative updates; sequencer voices can outlive a keyboard surface.
- **Keys** ([keys.js](../src/keyboard/keys.js)) owns held input notes, sustain,
  recency, live tuning frames and snapshot voice collections. App owns the manual
  gesture scheduler that calls Keys; backend engines have their own lifetimes.
- **Sequence source** is editable saved data. Display and playback projections
  are derived data, not replacements for the saved source.
- **Pending target** is an armed selection, not necessarily a sounding position.
  `sequencePlayheadRef` is the immediate manual cursor; rendered `sequencePlayhead`
  can lag during a deferred UI commit. Timed playback has its own live position.
- **IDs and indexes differ.** Snapshot IDs are identities; array indexes are
  positions. Display snapshots can include inserted rows, so display, source,
  cue and repeated-timeline indexes are not interchangeable.
- **Pitch units differ.** Sequence `midicents` currently stores fractional MIDI
  note numbers (69 = A440; +1 = a semitone), despite its name. Synth `cents` is
  cents relative to a tuning reference; frequency is Hz. Convert explicitly.
- **Clocks differ.** Browser timestamps use milliseconds, AudioContext time uses
  seconds, and timed playback has musical positions plus elapsed seconds.
  Backend adapters own conversions. Never substitute one clock for another.
  [transport-clock.js](../src/sequencer/transport-clock.js) carries a continuous
  elapsed-time offset when output toggles change the clock-owning child or fall
  back to the browser clock. A new composite wrapper alone is not a new clock.
  Without this handoff, disabling samples during timed playback can jump from
  AudioContext time to the browser epoch and dispatch a burst of overdue cues
  into retained outputs such as SuperSonic. Keep audio-clock suspension intact;
  transport continuity must not alter backend voice-scheduling timestamps.

The detailed [built-in audio mixing contract](built-in-audio-mixing.md) records
output gates, warm versus cold toggles, OSC bridge handoff, shared clocks,
voice reconciliation, recovery and the future DSF integration checklist.
Consult it alongside B12–B16 before changing backend lifecycle behaviour.

## Boundary inventory

| Boundary | Owner / implementation entry | Main contract |
| --- | --- | --- |
| B01 Settings → runtime impact | [settings-impact-registry.js](../src/settings/settings-impact-registry.js), [use-settings-change.js](../src/hooks/use-settings-change.js) | Cosmetic/live edits must not accidentally reconstruct audio or Keys. |
| B02 Preset → tuning workspace / live frame | [use-presets.js](../src/hooks/use-presets.js), [workspace.js](../src/tuning/workspace.js), [keys-frame-runtime.js](../src/keyboard/keys-frame-runtime.js) | Stored tuning, normalized tuning and effective modulation frame are distinct. |
| B03 Keyboard reconstruction → voice transfer | [keyboard/index.js](../src/keyboard/index.js), App `onKeysReady` | Transfer sequencer ownership before deconstructing the old surface; do not replay adopted voices. |
| B04 Sequence source → display / playback model | [runtime-model.js](../src/sequencer/runtime-model.js), [runtime-pitch-map.js](../src/sequencer/runtime-pitch-map.js) | Playback transformations must not overwrite source pitches or confuse display indexes with source identities. |
| B05 Target selection → manual playback | [transport-intent-runtime.js](../src/sequencer/transport-intent-runtime.js), App `onCueSequenceSnapshot`, `onPlaySequence` | Consume the selected pending target before falling back to a bar or old playhead. |
| B06 Snapshot ↔ cue ↔ timed playback | [transport-actions.js](../src/sequencer/transport-actions.js), [timed-transport-controller.js](../src/sequencer/timed-transport-controller.js), App transport handlers | Capture the sounding timed position before stopping; transfer control without replaying the origin. |
| B07 Edit commit → playback / presentation | [edit-commit-transport-controller.js](../src/sequencer/edit-commit-transport-controller.js), [timed-playback-visual-presenter.js](../src/sequencer/timed-playback-visual-presenter.js) | Commit edited data before playback; presentation must not overwrite a newer sounding cursor. |
| B08 Legato / arpeggiation → voice lifetime | [legato.js](../src/sequencer/legato.js), [snapshots.js](../src/sequencer/snapshots.js), [manual-snapshot-gesture-runtime.js](../src/sequencer/manual-snapshot-gesture-runtime.js) | Retaining a common tone, scheduling attacks and releasing ownership are different operations. |
| B09 Snap / playback pitch → sounding notes | [runtime-pitch-map.js](../src/sequencer/runtime-pitch-map.js), App Snap effect, [snapshots.js](../src/sequencer/snapshots.js) | Resolve immutable source pitch through current tuning, then global transposition; retune owned voices in place. |
| B10 MIDI permission / device → input binding | [use-synth-wiring.js](../src/hooks/use-synth-wiring.js), [keys-midi-listeners.js](../src/input/keys-midi-listeners.js) | Binding and mapping changes must not leave duplicate listeners or stale note addresses. |
| B11 MIDI expression → voice / controller state | [keys-midi-input.js](../src/keyboard/keys-midi-input.js), [keys-expression-runtime.js](../src/input/keys-expression-runtime.js) | Distinguish MPE per-note expression, poly pressure, channel pressure and global wheel state. |
| B12 Output configuration → async graph publication | [use-synth-wiring.js](../src/hooks/use-synth-wiring.js), [output-build.js](../src/audio/output-build.js), [output-lifecycle.js](../src/audio/output-lifecycle.js) | Only a current build may publish; graph replacement is not engine destruction. |
| B13 Composite voice → backend scheduling | [composite_synth/index.js](../src/composite_synth/index.js), [output-transaction.js](../src/midi/output-transaction.js) | Preserve each child voice's pitch reference; group simultaneous attacks and respect backend clocks. |
| B14 SoundFont file / storage → loaded bank / UX | [soundfont-storage.js](../src/fluidsynth_synth/soundfont-storage.js), [restore-local-soundfont.js](../src/fluidsynth_synth/restore-local-soundfont.js), [supercollider-settings.jsx](../src/settings/supercollider-settings.jsx) | Loaded, temporarily available and saved offline are separate states. |
| B15 Startup / interruption → recovery | [use-audio-recovery.js](../src/hooks/use-audio-recovery.js), [recovery.js](../src/audio/recovery.js), [restart-context.js](../src/audio/restart-context.js) | Loading and initial suspension are not automatically failures; verify clocks, clear stale work, then reconnect audio. |
| B16 Stop / Panic / teardown → cancellation | App `onStopSnapshot`, `guardianPanic`, [panic-runtime.js](../src/keyboard/panic-runtime.js), backend transports | Stop musical schedulers before hard output clearing; disabled outputs can still own queued work. |
| B17 Session / saved library → restored workspace | [settings-registry.js](../src/persistence/settings-registry.js), [io-reload-policy.js](../src/persistence/io-reload-policy.js), [session-persistence.js](../src/sequencer/session-persistence.js) | Restoring documents/settings must not restore sounding notes or imply unavailable assets are loaded. |
| B18 Workspace / palette / controller feedback → UI | App, [autoscroll-controller.js](../src/sequencer/autoscroll-controller.js), [keys-controller-leds.js](../src/keyboard/keys-controller-leds.js) | Tab visibility, highlights, scroll and LEDs are projections, not independent playback authorities. |

## Transport transitions (B05–B08)

Sequence note rows stay open regardless of the Edit & Play or Copy & Insert
disclosure preferences. These toggles hide controls only and do not reanchor
the viewport. Virtualization still bounds mounted rows; newly mounted rows
receive highlights in a layout effect before paint, not on another animation
frame. Audio dispatch must not synchronously render the editor.
The pre-cleanup implementation is preserved in the
[sequencer archive](../_archive/sequencer-before-open-layout-cleanup-2026-10-07.md).
Manual cue triggering revalidates the scroll position captured when a selected
cue's viewport was prepared. An unchanged viewport remains fixed; scrolling
away invalidates that shortcut. Missing event rows use bounded presenter retries
after virtualization mounts them, rather than relying on the deferred App
playhead commit. Autoscroll-off continues to suppress viewport movement.

The shared state builders return `{ playhead, selection fields, ... }`.
`playhead` contains `barIndex`, `stepIndex`, `markerIndex`, `stopped` and optional
`preStart`. `pendingTransportSelection` contains snapshot/cue indexes. App's
`applyStoppedSequenceTransportState` accepts the builder result as well as flat
arguments from direct actions; preserve the nested cursor rather than silently
replacing it with default fields.

| Action | Musical decision / ordering |
| --- | --- |
| Select a snapshot or cue | Arm a target; selection alone is not an attack. |
| Manual PLAY | Use the explicit target first; bar inference is a fallback, not a replacement for selection. |
| Snapshot trigger | Play that snapshot using its manual articulation and current playback modifiers. |
| Cue trigger | Play the event-defined notes at that cue; a cue is not necessarily an entire snapshot. |
| Timed → manual `>` / `<` | Read the live timed cue before stopping, then move forward/back from it. Do not retrigger the origin. Cue arrow handoff can preserve sounding notes independently of ordinary Legato selection. |
| Manual → timed | Start from the current transport intent; an already manually triggered cue must not be attacked again merely to resume timing. See timed controller start-target logic. |
| Stop / rewind / end | Keep these distinct: stopping sound, arming a position, explicit pre-start, and terminal position have different navigation meanings. |

`legato.js` derives continuation flags for Off, Per Note and All Common Tones.
It does not itself retain or release audio voices. `snapshots.js` and the gesture
scheduler apply those decisions. Per-note continuation includes slot identity;
common-tone continuation uses pitch matching and touching boundaries. Do not
replace these rules with a blanket “always retrigger” or “always preserve”.

Arpeggios may own only part of a snapshot, and gestures can overlap. Release
using the owning gesture/voice collections, not just the current cue or visible
snapshot row. A delayed callback must not revive a cancelled gesture.

Editing and presentation have separate queues: event edits must commit before
the action reads their data; manual audio can advance immediately while App's
editor presentation is coalesced on the next animation frame. Immediate row
highlights/readouts and bounded viewport preparation do not wait for that
commit; audio scheduling remains separate. Never read a stale rendered
playhead to decide the next rapid attack.

Tests: [transport-intent-runtime.test.js](../src/sequencer/transport-intent-runtime.test.js),
[manual-timed-handoff.test.jsx](../src/sequencer/manual-timed-handoff.test.jsx),
[edit-commit-transport-controller.test.jsx](../src/sequencer/edit-commit-transport-controller.test.jsx),
[legato.test.js](../src/sequencer/legato.test.js),
[snapshots.test.js](../src/sequencer/snapshots.test.js), and
[app.test.js](../src/app.test.js) for the cross-component action sequences.

## Tuning and preset transitions (B01–B04, B09)

Loading a tuning can replace the keyboard surface without changing the musical
ownership of a sequencer voice. The wrapper detaches snapshot collections before
old Keys teardown, adopts them into new Keys, and publishes `onKeysReady`.
App's preset replay fallback must not replay voices already transferred.

Sequences can play with no tuning preset: App creates a hidden playback surface.
Selecting the first preset crosses the same ownership boundary as replacing an
existing preset. Test both; testing a chord already created in the destination
tuning misses this transition.

Without Snap, saved sequence pitches are independent of canvas tuning. With
Snap, resolve from `sequenceOriginalPitch`, choose a current-tuning pitch, then
apply the sequence PITCH offset. Disabling Snap must resolve from the original
again, not from the previous snapped result. Source storage stays unchanged.

The chord prototype is App-owned (`chordDrift`) and
shared by palette and Sequencer; these experimental controls are not persisted.
[chord-snap.js](../src/sequencer/chord-snap.js) searches shared source shifts on a
one-cent grid, bounded to 0–66 cents (default 33), scoring original interval
errors with extra weight for simple intervals and held continuation pairs.
The fader appears whenever Snap is active; positive drift enables chord search,
while zero uses the existing nearest-degree mapper. The mean destination displacement
from ordinary Snap is also bounded by the fader; this is not an independent
per-note tolerance or a guarantee of exact uniform displacement in a discrete scale.
`sequenceSnapGroup` carries the complete immutable snapshot pitch set and note
index through partial/arpeggiated attacks. App reattaches it after cue projection,
which otherwise strips custom metadata. Resolve owned voices and queued attacks
with the same live options; never remap a previous snapped result.
App passes [chord-snap-scheduler.js](../src/sequencer/chord-snap-scheduler.js) as
the solver. Cold playback optimisation runs in one module Worker, never in an
attack callback; explicit drift-fader edits are the bounded live-retune exception
below. Preparation is debounced 40 ms and visits the current snapshot,
eight forward and two backward; display projection only reads ready results and
does not enqueue the whole score. Equal tuning runtimes keep stable identities
so ordinary timed UI ticks do not rebuild every projection or restart warmup.
The queue holds at most 32 jobs, with demand-triggered jobs ahead of background
work, and an LRU cache holds at most 128 decisions. Eligibility is capped at
32 notes, 512 degrees and 250,000 estimated degree-scan/pair-scoring operations.
A 250 ms worker deadline, construction/runtime errors or unavailable workers
fall back to ordinary Snap without delaying playback. Tuning/drift, legato or
source changes discard obsolete queued work; replies from terminated workers
are ignored. Unmount terminates the worker and clears its timer/queue/cache.

Each formation memoises one complete mapping, including a cold fallback. A late
reply may benefit a new formation but cannot change later attacks of the current
arpeggio. Explicit Snap/tuning/drift transactions create a new decision token and
can adopt a ready result atomically through the owned-voice retune path. Explicit
drift-fader edits resolve the sounding formation synchronously within the same
search budget, retaining live feedback even with a cold worker cache. Ordinary
note attacks still use background decisions or nearest-note fallback. There
is no completion-triggered background retune. Pure offline callers retain a
bounded 256-entry synchronous cache; oversized fallback arrays are not retained.
This remains snapshot-level optimisation, not overlapping-cue chord analysis.

Whole-snapshot evaluation is an intentional musical choice: a snapshot is one
formation even when its notes enter at different times or replace one another.
Later notes can influence the placement of the opening chord, preserving a
shared tuning plan across the gesture rather than optimising each instant in
isolation. Keep this context for future retuning work; do not silently replace
it with simultaneous-notes-only scoring. Any future time-local mode should be
an explicit alternative, with held-note continuity considered separately.

Future considerations include the notes actually sounding (including held or
overlapping voices) and melodic differentiation between successive formations.
Continuity is not always the only musical goal: retuning can make a chord change
audible as a melodic step rather than merging neighbouring placements. In the
FALL example below, testing at 47 cents revealed the benefit of an audible
melodic step on a chord change a few cues later. Preserve this listening
observation when evaluating future scoring; do not assume that minimising
movement between cues is always preferable.

Reference example: FALL snapshot 1, 53-tone Extended Pythagorean layout at its
stored 440 Hz reference, Chord Drift 47 cents. Whole-snapshot search moves four
notes upward by about 46.92 cents and one by 43.30 cents relative to ordinary
Snap, improving the combined interval fit. Searching only the opening notes
does not select that upward shift. The fader permits displacement in either
direction; it does not request a positive transposition. These figures describe
the current prototype and reference frame, not a fixed expected musical result
for all future scoring revisions.

Tests: [chord-snap.test.js](../src/sequencer/chord-snap.test.js),
[chord-snap-scheduler.test.js](../src/sequencer/chord-snap-scheduler.test.js),
and App's shared-controls / warm-worker / unavailable-worker tests.

App can render new settings before Keys has applied them. `resolveSequenceSnapRuntime`
handles that reference handoff; the effective live frame also includes modulation.
Do not equate a preset's nominal fundamental with every sounding voice's reference.
Composite voices retain child references captured when created, so an old voice
can be correctly retuned after the engine's reference for future attacks changes.

Tests: [settings-impact-registry.test.js](../src/settings/settings-impact-registry.test.js),
[keyboard/index.test.jsx](../src/keyboard/index.test.jsx),
[sequence-preset-handoff.test.js](../src/sequencer/sequence-preset-handoff.test.js),
[runtime-pitch-map.test.js](../src/sequencer/runtime-pitch-map.test.js), and
[composite_synth/index.test.js](../src/composite_synth/index.test.js).

## MIDI and expression transitions (B10–B11)

WebMIDI permission/port ownership, listener binding, controller geometry,
address mapping and voice expression are separate layers. Controller detection
does not by itself grant SysEx access. Rebinding must remove obsolete listeners;
mapping must retain enough input identity to release the note actually attacked.

For non-MPE wheel-to-most-recent mode, recency decides the target. Apply existing
wheel deviation at onset; optional target-handoff portamento is not an onset
scoop. This is distinct from monophonic output portamento and MPE member-channel
bending. Pressure and expressionY can be per-note; global wheel/controller state
must not overwrite captured per-note expression during an unrelated graph change.
The scsynth Brightness control mirrors the designated global wheel/pedal route,
not every MPE timbre message.

Smoothing belongs to a particular layer (input shaping, target glide, SynthDef,
or renderer). Do not silently add synthetic MIDI traffic or assume smoothing is
implemented identically in all backends. The planned FluidSynth XYZ smoothing
and DSF worklet are not a completed shared backend contract.

Tests: [keys-midi-input.test.js](../src/keyboard/keys-midi-input.test.js),
[keys-expression-runtime.test.js](../src/input/keys-expression-runtime.test.js),
[use-synth-wiring.test.js](../src/hooks/use-synth-wiring.test.js), and
[supercollider-settings.test.jsx](../src/settings/supercollider-settings.test.jsx).

## Backend, storage and recovery transitions (B12–B16)

Wiring owns engine/output caches and asynchronous publication. `completeOutputBuild`
checks whether a build is still current before installing it and balances loading
even on failure. It must not dispose a cached engine merely because an obsolete
build finishes. Cleanup detaches ownership and attempts all releases.

Keys reconciles the output graph into existing composite voices. Joining outputs
receive controller state before attacks; retained outputs must not receive a
global expression replay that overwrites per-note state. Held sample voices may
retain their instrument until release. Backend shutdown and graph exclusion are
not interchangeable with Panic. FluidSynth transport events carry output-owner
identity so obsolete wrappers can cancel their own queued work.

Simultaneous chord attacks use output transactions to share timestamps/attack
groups. Backend conversion and worklet queues remain responsible for delivery.
Scheduling an event is not proof it sounded, nor is AudioContext `running` proof
its audio clock or renderer is advancing.

SoundFont UX distinguishes selected file, loaded bank/preset, temporary working
copy, saved offline copy and in-flight operation. Removing the offline copy does
not unload the bank. Save/Keep use available working bytes; loaded engine memory
is not automatically an exportable copy of the original file. Private storage
is best-effort. Reload restoration uses available offline data and its saved
preset, with no automatic network fallback.

Recovery observes loading/startup separately from interruption. A gesture must
reach engine resume/initialization before asynchronous work loses activation.
Recovery may reuse or rebuild engines: mute/disconnect, restart and verify clocks,
clear stale scheduled events, drain silently, then reconnect/fade. Browser lock
can cut sound outside the app's control; small buffered restore artefacts remain
a known platform limitation, not proof of an app retrigger.

Panic cancels App-level manual/timed work and clears Keys ownership before hard
backend clearing. Note-off handlers can schedule release expression, so the hard
clear is last. Reach persistent FluidSynth even when absent from the current
composite. External MIDI/OSC and local engines require different cleanup paths.

Tests: [use-synth-wiring-lifecycle.test.jsx](../src/hooks/use-synth-wiring-lifecycle.test.jsx),
[output-build.test.js](../src/audio/output-build.test.js),
[output-lifecycle.test.js](../src/audio/output-lifecycle.test.js),
[output-transaction.test.js](../src/midi/output-transaction.test.js),
[soundfont-storage.test.js](../src/fluidsynth_synth/soundfont-storage.test.js),
[restore-local-soundfont.test.js](../src/fluidsynth_synth/restore-local-soundfont.test.js),
[voices.test.js](../src/fluidsynth_synth/voices.test.js),
[processor-recovery.test.js](../src/fluidsynth_synth/processor-recovery.test.js),
[recovery.test.js](../src/audio/recovery.test.js), and
[restart-context.test.js](../src/audio/restart-context.test.js).

## Growing the map

The inventory enumerates boundaries; it does not yet fully specify every branch.
Next useful additions are detailed state/transition tables for:

- Timed start, pause, resume, repeat boundaries and terminal/pre-start navigation.
- Per-controller MIDI reconnect, address release and expression reset policies.
- SoundFont cancellation, replacement, unavailable storage and failed bank loads.
- Backend-specific panic, teardown, startup failure and stale-build cancellation.
- Modulation/frame changes, preview tuning and notation versus sounding pitch.
- Session restoration and saved-library replacement while playback is active.
- Tab/palette/LED projection lifetimes and their cleanup on navigation/unmount.

For each addition record: trigger, owner, precondition, next state, retained
voices, cancelled work, UI result, implementation entry and regression tests.
Include both action orders when they can differ (preset → snapshot versus
snapshot → preset), and first-run/no-preset cases. Use actual browser/controller
checks for platform-dependent behaviour and record their limits.

This map is maintained manually. Review it with transition-affecting changes;
keep dates local to the sections actually rechecked if the document grows.
