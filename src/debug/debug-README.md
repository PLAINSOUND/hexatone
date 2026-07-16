# debug README

Hexatone currently exposes three kinds of debug controls:

1. Log-category flags via `localStorage` / `sessionStorage`
2. Diagnostics toggles via `localStorage` or URL query params
3. Console globals for reading persisted diagnostics

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
- `getPersisted()` returns the persisted session snapshot.
- `reset()` clears the current diagnostics buffer and persisted copy.

## 3. Sequence Runtime Diagnostics

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
globalThis.__hexatoneSequenceRuntimeDiagnostics?.reset()
```

Notes:

- This tracks expensive sequencer derivation steps such as event, cue, timeline, and repeat-section building.
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

Read the persisted sequence-runtime summary:

```js
globalThis.__hexatoneSequenceRuntimeDiagnostics?.getPersisted()
```
