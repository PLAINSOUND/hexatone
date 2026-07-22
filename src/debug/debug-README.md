# debug README

Hexatone currently exposes three kinds of debug controls:

1. Log-category flags via `localStorage` / `sessionStorage`
2. Diagnostics toggles via `localStorage` or URL query params
3. Console globals for reading persisted diagnostics
4. Crash-oriented sequencer commit tracing

## 1. Log Categories

These are controlled by the storage key:

```js
localStorage.setItem("hexatone_debug", "midi")
```

You can enable multiple categories with commas:

```js
localStorage.setItem("hexatone_debug", "midi,MIDImonitoring,osc")
```

Or everything:

```js
localStorage.setItem("hexatone_debug", "all")
```

To clear:

```js
localStorage.removeItem("hexatone_debug")
sessionStorage.removeItem("hexatone_debug")
```

### Available categories

- `audio`
  Sample-synth / `AudioContext` lifecycle logging.

- `controllers`
  Controller-specific lifecycle logging such as Exquis App Mode recovery.

- `lifecycle`
  App lifecycle and service-worker style events.

- `midi`
  WebMIDI access / enable / restore path logging.

- `MIDImonitoring`
  Incoming MIDI event logging from controller inputs.

- `midijitter`
  Input-to-output timing trace logs.

- `osc`
  OSC synth, live hex, and voice-pool transport logging.

- `oscjitter`
  OSC jitter-specific logging.

## 2. Timed Transport Diagnostics

Enable with either:

```js
localStorage.setItem("hexatone_debug_timed_transport", "true")
```

or URL:

```txt
?debugTimedTransport=1
```

These diagnostics persist structured timing samples into `sessionStorage` under:

```txt
hexatone_timed_transport_diagnostics
```

### Console global

```js
globalThis.__hexatoneTimedTransportDiagnostics
```

Available methods:

```js
globalThis.__hexatoneTimedTransportDiagnostics?.get()
globalThis.__hexatoneTimedTransportDiagnostics?.getPersisted()
globalThis.__hexatoneTimedTransportDiagnostics?.reset()
```

Notes:

- `get()` returns the in-memory summary for the current page session.
- `getPersisted()` flushes pending buffered entries and returns the persisted session snapshot.
- `reset()` clears the current diagnostics buffer and persisted copy.
- While timed playback is running, `ui-commit` and `ui-frame-sample` entries
  sample sequencer commit latency, frame intervals, mounted row counts, scroll
  position, and the cost of taking the measurement.
- Live sampling does not traverse the DOM or read row geometry. Consequently,
  `visibleRowCount` and `mountedNodeCount` remain null until viewport rendering
  can provide those values directly without forcing layout.
- `runtime-rebuild` entries identify playback runtime-instance changes that
  occur while the transport is running. The summary exposes these under
  `ui` and `runtimeRebuildCount` in the same TimedTransport report.
- Lateness summaries exclude entries without a lateness measurement and expose
  the number of actual measurements as `latenessSampleCount`.
- Healthy UI sampling is capped at once per second; commits of at least 16 ms
  and frame intervals of at least 50 ms are retained immediately.
- Hot-path entries are buffered and written to `sessionStorage` at most once every two seconds.
- Pending entries are also flushed on `pagehide`; a renderer crash may lose at most the newest two-second window.
- When disabled, the persisted snapshot and console global are removed.

## 3. MIDI Restore Diagnostics

Enable with either:

```js
localStorage.setItem("hexatone_debug_midi_restore", "true")
```

or URL:

```txt
?debugMidiRestore=1
```

These diagnostics persist structured MIDI restore / rebind events into `sessionStorage` under:

```txt
hexatone_midi_restore_diagnostics
```

### Console global

```js
globalThis.__hexatoneMidiRestoreDiagnostics
```

Available methods:

```js
globalThis.__hexatoneMidiRestoreDiagnostics?.getPersisted()
globalThis.__hexatoneMidiRestoreDiagnostics?.reset()
```

Notes:

- This is intended only for reload / restore / device-rebind tracing.
- The global exists only when explicitly enabled.
- When disabled, stale persisted MIDI-restore data is removed automatically.

## 4. Sequence Runtime Diagnostics

Enable with either:

```js
localStorage.setItem("hexatone_debug_sequence_runtime", "true")
```

or URL:

```txt
?debugSequenceRuntime=1
```

These diagnostics persist structured sequencer runtime build timings into `sessionStorage` under:

```txt
hexatone_sequence_runtime_diagnostics
```

### Console global

```js
globalThis.__hexatoneSequenceRuntimeDiagnostics
```

Available methods:

```js
globalThis.__hexatoneSequenceRuntimeDiagnostics?.getPersisted()
globalThis.__hexatoneSequenceRuntimeDiagnostics?.getRebuildReport()
globalThis.__hexatoneSequenceRuntimeDiagnostics?.reset()
```

Notes:

- This tracks expensive sequencer derivation steps such as event, cue, timeline, and repeat-section building.
- `getRebuildReport()` provides compact changed-dependency counts and playback-token transitions without requiring DevTools objects to be expanded manually.
- Runtime entries are buffered and persisted once per synchronous build burst to avoid synchronous storage churn during playback.
- It also records total runtime build durations, first-frame latency after sequencer edit commits, and first-scroll response timing in the sequencer list.
- It is intended to stay off during normal use.

## Typical examples

Enable MIDI input tracing:

```js
localStorage.setItem("hexatone_debug", "midi,MIDImonitoring")
```

Enable transport timing diagnostics:

```js
localStorage.setItem("hexatone_debug_timed_transport", "true")
```

Read the last persisted timed-transport summary:

```js
globalThis.__hexatoneTimedTransportDiagnostics?.getPersisted()
```

Enable sequencer runtime profiling:

```js
localStorage.setItem("hexatone_debug_sequence_runtime", "true")
```

Enable MIDI restore diagnostics:

```js
localStorage.setItem("hexatone_debug_midi_restore", "true")
```

Read the persisted sequence-runtime summary:

```js
globalThis.__hexatoneSequenceRuntimeDiagnostics?.getPersisted()
```

## 5. Sequencer Crash Diagnostics

Enable with either:

```js
localStorage.setItem("hexatone_debug_sequencer_crash", "true")
```

or URL:

```txt
?debugSequencerCrash=1
```

These diagnostics persist the last few sequencer bar-relative event commits plus
any uncaught browser `error` / `unhandledrejection` that follows into
`sessionStorage` under:

```txt
hexatone_sequencer_crash_diagnostics
```

### Console global

```js
globalThis.__hexatoneSequencerCrashDiagnostics
```

Available methods:

```js
globalThis.__hexatoneSequencerCrashDiagnostics?.getPersisted()
globalThis.__hexatoneSequencerCrashDiagnostics?.reset()
```

Typical workflow:

```js
localStorage.setItem("hexatone_debug_sequencer_crash", "true")
location.reload()
```

After an `Aw, Snap` or reload, inspect:

```js
globalThis.__hexatoneSequencerCrashDiagnostics?.getPersisted()
```

Notes:

- This is aimed at sequencer timing edits, especially Bar/Beat/Num/Den commits.
- For note events it records the committed draft fields plus resolved absolute time.
- Entries are buffered and persisted at most once every two seconds, and empty context fields are omitted.
- Uncaught errors and unhandled rejections bypass the buffer and persist immediately.
- If an uncaught runtime error or rejection happens after that, the persisted log should show both the last commit context and the exception details.
