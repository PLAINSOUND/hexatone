# Built-in audio mixing and lifecycle contract

Last reviewed: 2026-10-07. Companion to the [app transition map](app-context.md),
especially B12–B16. The first sections describe current behaviour; the DSF
checklist is an integration target, not a claim that DSF already implements it.
Update this contract with lifecycle changes. Mock tests verify ordering, not
the absence of audible glitches on a particular browser or phone.

## Three independent layers

1. Keys and the composite own musical notes, expression and backend membership.
2. Each backend owns rendering, queues, voice allocation and musical envelopes.
3. A separate output gain gate controls startup, toggle and recovery fades.

The output gate must not overwrite a user's volume fader, a layer mix, pressure,
or a musical attack/release envelope. Multiple enabled backends sound together;
enabling one is not permission to mute, panic or rearticulate another.

Local routing is engine output → output gate → speakers. When muted, the gate
disconnects from the speakers and feeds a permanently silent sink instead.
This keeps worklets rendering while draining stale audio. Do not introduce a
parallel direct connection around the gate. SuperSonic sets `autoConnect: false`.

See [recovery-gate.js](../src/audio/recovery-gate.js) and
[output-toggle.js](../src/audio/output-toggle.js).

## Current backend policies

| Backend / control | Enable | Disable / retained resources |
| --- | --- | --- |
| Built-in sample sounds | Decode under a silent gate; first attack fades up over 40 ms. | Sample voice lifecycle handles release/tails; retired instrument voices can remain until release. This is not the SuperSonic warm-parking policy. |
| FluidSynth | New worklets start gated silent. Prepare the 40 ms output fade before publishing the voice wrapper, preserving its first attack. | Fade down over 30 ms, then wrapper/channel cleanup after the 40 ms window. Worklet and loaded SoundFont remain available. |
| Use SuperCollider Sounds, with local SuperSonic selected | Reuse the parked engine; reverse the fade for retained voices, or fade on the first joined attack after voices were cleared. | Fade down over 30 ms and disconnect speakers. Retain voices for five seconds for quick A–B comparisons, then clear voices/queued events. Engine and SynthDefs stay warm indefinitely. No bridge fallback. |
| SuperSonic 0.88 engine selector | Leave the OSC bridge by releasing its notes. Reclaim a local engine within its five-second retirement window, otherwise construct a new engine. | Fade local output down over 30 ms and route new/current logical voices to the bridge. Stop the local engine after five seconds unless reclaimed. |
| External OSC bridge | Uses the external SynthDefs' envelopes, not a browser audio gate. | Ordinary handoff/shutdown releases owned notes gently. Only Panic frees nodes/groups immediately. |

Normal local fade-in is 40 ms. Cold SuperSonic startup alone holds output silent
for 500 ms before a 40 ms fade; warm reclaim has no 500 ms delay. Cold startup
completes this silent drain and fade before publishing the engine as ready,
so the first musical attack does not pay the startup delay.
The initial banner offers **Start Audio** after a sequence is selected (or a
restored tuning awaits activation), only when enabled engines are not already
running. Activation runs on a completed tap; pending SuperSonic startup also
listens for touch-end gestures. **Restore Audio** is
the same entry point after startup when interruption recovery is needed.
Configuration replacement, unmount and hard recovery are distinct from toggles
and can dispose an engine. Warm retention saves startup work but retains memory
and idle rendering cost.

FluidSynth's first-start gate must be silent even before an output wrapper exists.
Starting at gain 1 and requesting a fade "from current" would produce a 1 → 1
ramp, leaving the first toggle unprotected. Rebuilt worklets also start silent.
Replacement FluidSynth wrappers wait for the previous owner's cleanup before
allocating channels: an old delayed all-sound-off must not kill new voices on
the same persistent worklet.

Implementation: [sample backend](../src/sample_synth/index.js),
[FluidSynth engine](../src/fluidsynth_synth/index.js),
[FluidSynth output wiring](../src/midi_synth/index.js),
[SuperSonic adapter](../src/supersonic_synth/index.js),
[OSC adapter](../src/osc_synth/index.js).

## Graph handoff and mutual interaction

[use-synth-wiring.js](../src/hooks/use-synth-wiring.js) owns caches and publishes
only the current asynchronous build through
[output-build.js](../src/audio/output-build.js). Loading is appropriate for cold
construction, not a warm mute/unmute. Initial gesture-waiting engines must not
produce an endless foreground loading indicator or a premature recovery warning.

Keys reconciles existing composite voices when membership changes. Newly joined
outputs receive controller/onset state before attacks and join currently held
notes. Retained outputs keep their voice identities and per-note expression;
do not replay the whole chord or global expression into them. Disabled wrappers
block further attacks immediately, even before the replacement graph publishes.
Keep backend pitch references stable: unrelated preset changes must not retune
raw sequence playback or stranded voices in another engine.

The composite is a logical fan-out, not a single persistent engine or clock.
External MTS retirement preserves note-off timestamps and blocks further attacks
from the retired wrapper. Web MIDI cannot cancel by output owner: a release for
an already queued future attack is scheduled at least 1 ms after that attack.
Do not clear the entire shared MIDI port to cancel one channel's work, because
that also removes unrelated outputs' events. Internal FluidSynth instead has
owner-specific queue cancellation. A retired external attack can therefore
sound briefly before its release; it must not become an orphaned held note.

[transport-clock.js](../src/sequencer/transport-clock.js) preserves continuous
elapsed time when the clock-owning child changes or playback falls back to the
browser clock. A new wrapper is not a new clock. Without continuity, toggling
samples during timed playback can dispatch a burst of overdue notes into
SuperSonic. Do not resume a shared AudioContext by suspending/closing it during
an ordinary backend toggle: samples and FluidSynth share that context.

Simultaneous attacks use shared output transactions. Backend adapters still own
conversion from browser milliseconds to audio seconds/engine timestamps. Preserve
actual audio-clock suspension; do not conceal it with a fabricated advancing clock.

See [composite_synth](../src/composite_synth/index.js),
[output-lifecycle.js](../src/audio/output-lifecycle.js) and
[output-transaction.js](../src/midi/output-transaction.js).

## Recovery, Stop and Panic are different

Stop follows musical note release. A toggle changes output membership/gain.
Panic cancels musical schedulers and Keys ownership, then hard-clears outputs,
including fading, parked and persistent engines absent from the active composite.
External OSC release tails are intentional during normal handoff, not stuck notes.

Recovery mutes/disconnects first, resumes or rebuilds the engine, verifies clock
advancement, clears obsolete scheduled events, drains silently, then fades up.
Its default gate fade is 80 ms, separate from normal 40 ms toggle fade-in.
`AudioContext.state === "running"` alone does not prove a working renderer.
Shared-context restart must be coordinated once, not independently by each child.
Loading and initial suspension are not automatically failures. iOS may cut sound
outside app control and replay a small buffered artefact on restore.

See [recovery.js](../src/audio/recovery.js),
[restart-context.js](../src/audio/restart-context.js) and
[use-audio-recovery.js](../src/hooks/use-audio-recovery.js).

## DSF integration checklist (planned)

The current [DSF test adapter](../src/dsf_synth/index.js) connects its worklet
directly to the destination and exposes start/frequency/stop. It is not yet a
full composite backend. Before publishing it as one:

- Replace the direct speaker connection with a silent-at-construction output
  gate. Fade up 40 ms on the first real note, not during module loading.
  Do not copy SuperSonic's 500 ms cold delay unless DSF testing demonstrates a need.
- Implement the composite voice contract: independent note identity, note-on/off,
  in-place pitch/expression updates, musical release, and hard clearing. Smooth
  XYZ inside the audio renderer; output fades are not expression smoothing.
- Separate persistent engine ownership from enabled output wrappers. Choose and
  document the retention policy explicitly; a warm worklet must reject stale
  attacks, clear its own queues/voices safely, and remain reachable by Panic.
- Use the shared context where appropriate without closing/suspending it on
  toggles. Register DSF with transport clock selection and recovery coordination.
- Add wiring/cache identity, current-build checks and held-note reconciliation.
  Late initialization or an old cleanup callback must never replace or silence
  a newer output owner. Seed controller state before joining held notes.
- Expose prepare/wake, context, diagnostics, mute/fade, queue clearing and rebuild
  hooks consistent with the other backends. Rebuild behind a silent gate; retain
  user settings, not stale sounding notes. Keep gesture-required wake synchronous
  before awaiting unrelated work.
- Test first enable, rapid off/on, long off/on, off during loading, Panic while
  parked, recovery and unmount. During timed/arpeggiated playback with other
  backends enabled, assert no retrigger/burst, stable pitch/expression, continuous
  transport time and no old cleanup killing newly joined voices.

### Lesson bookmark

The current processor is a single sine oscillator with continuous phase,
validated frequency commands, and sample-by-sample linear gain ramps: 12 ms
attack, 80 ms release, gain 0.05. Its adapter exposes start/frequency/stop.
Resume teaching from here, keeping small audible experiments separate from
full backend integration. A suitable next step is a finite sideband sum before
the closed-form DSF expression, then parameter control and spectral limiting.
The routing/ownership checklist above applies when the experiment becomes a
selectable backend; it need not all be implemented in the next lesson.

## Regression anchors

- [output-toggle.test.js](../src/audio/output-toggle.test.js): fades, five-second
  retention, cancellation, warm reclaim and Panic.
- [use-synth-wiring-lifecycle.test.jsx](../src/hooks/use-synth-wiring-lifecycle.test.jsx):
  asynchronous graph publication, warm enable and OSC/local handoff.
- [SuperSonic tests](../src/supersonic_synth/index.test.js): gated cold startup.
- [FluidSynth recovery tests](../src/fluidsynth_synth/recovery.test.js): silent
  first/rebuilt gate and recovery state retention.
- [MTS adapter tests](../src/midi_synth/index.test.js): preserve release
  timestamps, release pending attacks after onset on the old channel, and reject
  attacks from retired wrappers without clearing a shared MIDI port.
- [sample tests](../src/sample_synth/index.test.js): first-attack gating.
- [transport clock tests](../src/sequencer/transport-clock.test.js): continuous
  time across output-owner changes.
- [recovery gate tests](../src/audio/recovery-gate.test.js) and
  [context restart tests](../src/audio/restart-context.test.js): silent drain,
  fade cancellation and coordinated context recovery.
