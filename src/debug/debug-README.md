# debug README

Hexatone currently exposes four kinds of debug controls:

1. Log-category flags via `localStorage` / `sessionStorage`
2. Diagnostics toggles via `localStorage` or URL query params
3. Console globals for reading persisted diagnostics
4. MIDI restore diagnostics

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

## 4. MIDI Restore Diagnostics

Enable with either:

```js
localStorage.setItem("hexatone_debug_midi_restore", "true")
```

or URL:

```txt
?debugMidiRestore=1
```

These diagnostics persist structured WebMIDI restore / reconnect / input-rebind
events into `sessionStorage` under:

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

- This is the dedicated tracer for restore-on-reload / Activate Audio Context / WebMIDI reconnect failures.
- It records `ensure`, `reconnect`, and `input-ensure` / `input-rebind` events.
- The console global is only installed when the debug flag is enabled. After changing the flag, reload the page.
- When the flag is off, any persisted MIDI restore trace is cleared on load.

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

Enable MIDI restore diagnostics:

```js
localStorage.setItem("hexatone_debug_midi_restore", "true")
```

Read the last persisted MIDI restore summary:

```js
globalThis.__hexatoneMidiRestoreDiagnostics?.getPersisted()
```
