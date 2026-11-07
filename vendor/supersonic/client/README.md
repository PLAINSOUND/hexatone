# SuperSonic 0.94.0

> A scsynth-compatible synth powered by Clockwork, for the browser as an AudioWorklet and natively as a server.
>
> Generated from the project docs. The full method reference and the scsynth command reference are on [GitHub](https://github.com/samaaron/supersonic).

## Table of Contents

- [Quick Start](#quick-start)
- [API Overview](#api-overview)
- [Patterns](#patterns)
  - [Scheduling with OSC Bundles](#scheduling-with-osc-bundles)
  - [Sending OSC from Workers](#sending-osc-from-workers)
  - [Lifecycle & Recovery](#lifecycle--recovery)
  - [Audio Routing](#audio-routing)
  - [Samples](#samples)
- [Constructor Options](#constructor-options)
- [Server Options](#server-options)
- [Sending scsynth Commands](#sending-scsynth-commands)
- [Full Reference](#full-reference)
- [Support + License](#support--license)

---

## Quick Start

You've installed SuperSonic - now let's make some sound.

We'll create a simple page with two buttons: one to boot the audio engine, and one to trigger a synth.

```html
<button id="boot-btn">boot</button>
<button id="trig-btn">trigger</button>
```

```javascript
import { SuperSonic } from "https://unpkg.com/supersonic-scsynth@latest/dist/supersonic.js";

const supersonic = new SuperSonic({
  baseURL: "https://unpkg.com/supersonic-scsynth@latest/dist/",
  coreBaseURL: "https://unpkg.com/supersonic-scsynth-core@latest/",
  synthdefBaseURL: "https://unpkg.com/supersonic-scsynth-synthdefs@latest/synthdefs/",
});

const bootBtn = document.getElementById("boot-btn");
const trigBtn = document.getElementById("trig-btn");

bootBtn.onclick = async () => {
  await supersonic.init();
  await supersonic.loadSynthDef("sonic-pi-prophet");
};

trigBtn.onclick = () => {
  supersonic.send("/s_new", "sonic-pi-prophet", -1, 0, 0, "note", 28, "release", 8, "cutoff", 70);
};
```

Let's break down what's happening here.


## User Interaction

Web browsers have an autoplay policy that prevents websites from making sound without user consent. Audio can only start after a user interaction like a click, tap, or keypress.

This is why we use a boot button - calling `init()` from a button handler satisfies the browser's autoplay policy and allows audio to begin.


## Creating a SuperSonic Instance

```javascript
const supersonic = new SuperSonic({
  baseURL: "https://unpkg.com/supersonic-scsynth@latest/dist/",
  coreBaseURL: "https://unpkg.com/supersonic-scsynth-core@latest/",
  synthdefBaseURL: "https://unpkg.com/supersonic-scsynth-synthdefs@latest/synthdefs/",
});
```

This creates a new SuperSonic instance configured to load its files from a CDN. SuperSonic is split into packages, so it needs to know where each one is:

- `baseURL` - the client package, `supersonic-scsynth`, which holds the workers
- `coreBaseURL` - the core package, `supersonic-scsynth-core`, which holds the WebAssembly engine and its AudioWorklet. The client package ships neither, so without this `init()` fails.
- `synthdefBaseURL` - where to find synthdef files when you call `loadSynthDef()`

The instance doesn't start the audio engine yet - it just sets up the configuration. You can pass additional options to configure the transport mode, debug output, and scsynth engine settings (see [API Reference](https://github.com/samaaron/supersonic/blob/main/docs/API.md)). For anything you deploy, pin a version rather than using `@latest` (see [Installation](https://github.com/samaaron/supersonic/blob/main/docs/INSTALLATION_WEB.md)).


## Booting the Engine

```javascript
await supersonic.init();
```

Calling `init()` boots the scsynth audio engine. Behind the scenes this:

1. Creates an AudioContext and AudioWorklet
2. Loads the WebAssembly module containing the synth
3. Starts the synth in a dedicated high-priority audio thread

This is an async operation - the `await` ensures we don't proceed until the engine is ready.


## Loading a Synth Definition

```javascript
await supersonic.loadSynthDef("sonic-pi-prophet");
```

Before you can play a synth, you need to send its design to scsynth. This design is called a **synth definition** (or "synthdef") and is a recipe that describes a synth's audio graph - what oscillators, filters, and effects it uses and how they're connected.

The `supersonic-scsynth-synthdefs` package holds ready-to-use synthdefs from [Sonic Pi](https://sonic-pi.net). Here we're loading `sonic-pi-prophet`, a warm polyphonic synth inspired by the Prophet-5.

__Note: you can also use SuperCollider's Desktop app to design your own synthdefs and directly import them live at runtime into your SuperSonic session.__


## Triggering a Synth

```javascript
supersonic.send("/s_new", "sonic-pi-prophet", -1, 0, 0, "note", 28, "release", 8, "cutoff", 70);
```

Now for the fun part - making sound! The `send()` method sends OSC (Open Sound Control) messages to scsynth. The `/s_new` command creates a new synth instance.

The arguments are:

||||
|---|---|---|
| synthdef name | `"sonic-pi-prophet"` | Which synth to create |
| node ID | `-1` | Let scsynth assign an ID automatically |
| add action | `0` | Add to the head of the target group |
| target | `0` | The root group |
| params... | `"note", 28, ...` | Name/value pairs for synth parameters |

The synth parameters control the sound. Here we set `note` to 28 (a low E), `release` to 8 seconds, and `cutoff` to 70 (filter brightness). Each synthdef has its own parameters - see the synthdef documentation for available options.

We used `-1` for the node ID here to let scsynth pick one for us. That's fine for fire-and-forget sounds, but if you need to control a synth after creating it - change its parameters, stop it, query it - you need to know its ID. That's where `nextNodeId()` comes in:

```javascript
const id = supersonic.nextNodeId();
supersonic.send("/s_new", "sonic-pi-prophet", id, 0, 0, "note", 28, "release", 8, "cutoff", 70);

// Later — change the cutoff while it's playing
supersonic.send("/n_set", id, "cutoff", 100);
```

`nextNodeId()` is thread-safe - if you have multiple Web Workers sending OSC (see the [Workers Guide](https://github.com/samaaron/supersonic/blob/main/docs/WORKERS.md)), each one can allocate IDs independently, guaranteed unique with no clashes.


## Working Example

See `example/simple.html` for a complete working example you can run locally, or `example/simple_metrics.html` for the same example with a live metrics dashboard.


## Adding a Metrics Dashboard

SuperSonic includes a web component that renders a full metrics dashboard from the schema:

```html
<link rel="stylesheet" href="https://unpkg.com/supersonic-scsynth@latest/dist/metrics-dark.css" />
<script type="module" src="https://unpkg.com/supersonic-scsynth@latest/dist/metrics_component.js"></script>

<clockwork-metrics id="metrics"></clockwork-metrics>
```

Connect it after boot to start live updates:

```javascript
bootBtn.onclick = async () => {
  await supersonic.init();
  await supersonic.loadSynthDef("sonic-pi-prophet");
  document.getElementById("metrics").connect(supersonic, { refreshRate: 10 });
};
```

See [Metrics Component](https://github.com/samaaron/supersonic/blob/main/docs/METRICS_COMPONENT.md) for theming, layout control, and customisation.

---

## API Overview

Coordinates WASM, AudioWorklet, SharedArrayBuffer, and IO Workers to run
scsynth with low latency inside a web page.

**Core**

| Member | Description |
|---|---|
| [`init()`](#init) | Initialise the engine. |
| [`shutdown()`](#shutdown) | Shut down the engine. |
| [`destroy()`](#destroy) | Destroy the engine completely. |
| [`recover()`](#recover) | Smart recovery — tries a quick resume first, falls back to full reload. |
| [`suspend()`](#suspend) | Suspend the AudioContext and stop the drift timer. |
| [`resume()`](#resume) | Quick resume. |
| [`reload()`](#reload) | Full reload — recreates the worklet and WASM, and brings the engine back doing as little as it can. |
| [`reset()`](#reset) | Shutdown and immediately re-initialise. |
| [`send()`](#send) | Send an OSC message to the engine. |
| [`sendOSC()`](#sendosc) | Send pre-encoded OSC bytes to the engine. |
| [`sync()`](#sync) | A barrier: resolves once everything sent before it has reached the engine, in order. |
| [`purge()`](#purge) | Drop everything the engine is holding: the bundles in its scheduler, and the messages waiting in the IN ring, which are refused to their senders as stale rather than played. |

**Asset Loading**

| Member | Description |
|---|---|
| [`loadSynthDef()`](#loadsynthdef) | Load a SynthDef into the engine. |
| [`loadSynthDefs()`](#loadsynthdefs) | Load several SynthDefs in parallel, each as loadSynthDef would. |
| [`loadSample()`](#loadsample) | Load an audio sample into a buffer slot. |
| [`sampleInfo()`](#sampleinfo) | Get sample metadata (including content hash) without allocating a buffer. |

**Events**

| Member | Description |
|---|---|
| [`on()`](#on) | Subscribe to an event. |
| [`off()`](#off) | Unsubscribe from an event. |
| [`once()`](#once) | Subscribe to an event once. |
| [`removeAllListeners()`](#removealllisteners) | Remove all listeners for an event, or all listeners entirely. |

**Node Tree**

| Member | Description |
|---|---|
| [`getTree()`](#gettree) | Get the node tree in hierarchical format. |
| [`getRawTree()`](#getrawtree) | Get the node tree in flat format with linkage pointers. |
| [`getSnapshot()`](#getsnapshot) | Get a diagnostic snapshot with metrics (and their descriptions) and JS heap memory info. |

**Metrics**

| Member | Description |
|---|---|
| [`getMetrics()`](#getmetrics) | Get current metrics as a named object. |
| [`getMetricsArray()`](#getmetricsarray) | Get metrics as a flat Uint32Array for zero-allocation reading. |
| [`getMetricsSchema()`](#getmetricsschema) | Get the metrics schema describing all available metrics. |

**Properties**

| Member | Description |
|---|---|
| [`initialized`](#initialized) | Whether the engine has completed initialisation. |
| [`initializing`](#initializing) | Whether init is currently in progress. |
| [`audioContext`](#audiocontext) | The underlying AudioContext. |
| [`node`](#node) | AudioWorkletNode wrapper for custom audio routing. |
| [`loadedSynthDefs`](#loadedsynthdefs) | Map of loaded SynthDef names to their binary data — live, not a copy. |

**Advanced**

| Member | Description |
|---|---|
| [`getInfo()`](#getinfo) | Get engine info: sample rate, memory layout, capabilities, and version. |
| [`createOscChannel()`](#createoscchannel) | Create an OscChannel for direct worker-to-worklet communication. |
| [`startCapture()`](#startcapture) | Start capturing what the engine sends to the audio device. |
| [`stopCapture()`](#stopcapture) | Stop capturing and return what was captured. |
| [`getCaptureFrames()`](#getcaptureframes) | Get number of audio frames captured so far — or, with no capture running, written in all. |
| [`isCaptureEnabled()`](#iscaptureenabled) | Check if audio capture is currently enabled. |
| [`getMaxCaptureDuration()`](#getmaxcaptureduration) | Get maximum capture duration in seconds: the length of the capture ring. |
| [`setClockOffset()`](#setclockoffset) | Set clock offset for multi-system sync (e.g. against an NTP server). |

**Advanced**

| Member | Description |
|---|---|
| [`arenaBase`](#arenabase) | Ring buffer base offset in SharedArrayBuffer. |
| [`bufferConstants`](#bufferconstants) | Buffer layout constants from the WASM build. |
| [`clock`](#clock) | Session-timeline service: tempo, beat origin, transport, NTP "now." See ClockworkClock for the full API surface. |
| [`gamepad`](#gamepad) | The gamepad manager, when the gamepad option is on and it came up; otherwise null (gamepadError says why). |
| [`gamepadError`](#gamepaderror) | Why gamepad is null although it was asked for: the error its start-up threw. |
| [`midi`](#midi) | The Web MIDI manager, when MIDI is enabled (the midi option, or enableMidi) and came up. |
| [`midiError`](#midierror) | Why midi is null although MIDI was asked for: the error its start-up threw. |
| [`mode`](#mode) | Active transport mode ('sab' or 'postMessage'). |
| [`sharedBuffer`](#sharedbuffer) | The SharedArrayBuffer (SAB mode) or null (postMessage mode). |
| [`allocSample()`](#allocsample) | Allocate an empty buffer, as loadSample does for a file: resolves once the engine has it. |
| [`enableMidi()`](#enablemidi) | Bring Web MIDI up after init. |
| [`getEngineState()`](#getenginestate) | Returns the current engine lifecycle state. |
| [`getLoadedBuffers()`](#getloadedbuffers) | Get info about all loaded audio buffers. |
| [`getMetricsHistory()`](#getmetricshistory) | What every counter and gauge did over the last hour, kept by the engine (so it survives a reload): for each metric with a history — every one but the constants — the windows s1, s10, m1 (the last second, ten seconds and minute), m10 and h1. |
| [`getScope()`](#getscope) | Copy the newest frames frames of a ScopeOut2 scope stream. |
| [`getScopeActivations()`](#getscopeactivations) | How many times a scope slot has gone live. |
| [`getScopes()`](#getscopes) | List the scope slots in use. |
| [`getSystemReport()`](#getsystemreport) | Get a comprehensive system performance report. |
| [`isRunning()`](#isrunning) | Returns true if the engine has finished booting and is ready to send and receive messages. |
| [`nextNodeId()`](#nextnodeid) | Get the next unique node ID. |
| [`request()`](#request) | Send a message and wait for its reply. |
| [`getRawTreeSchema()`](#getrawtreeschema) | Get schema describing the raw flat node tree structure. |
| [`getScopeSchema()`](#getscopeschema) | Scope geometry: slot count, per-slot ring frames, channels. |
| [`getTreeSchema()`](#gettreeschema) | Get schema describing the hierarchical node tree structure. |

Every method, with its parameters and examples: [API.md](https://github.com/samaaron/supersonic/blob/main/docs/API.md). The OscChannel class, for sending from a worker: [API.md#oscchannel](https://github.com/samaaron/supersonic/blob/main/docs/API.md#oscchannel).

---

## Patterns

### Scheduling with OSC Bundles

### Full-Precision NTP Timestamps

When scheduling bundles, a plain JavaScript number loses sub-microsecond precision because IEEE 754 float64 only has 52 mantissa bits — not enough for NTP's full 64-bit range. Use a `[seconds, fraction]` uint32 pair for lossless timestamps:

```javascript
// Float — easy but loses precision at large NTP values
const ntpTime = SuperSonic.osc.ntpNow();
SuperSonic.osc.encodeBundle(ntpTime + 0.5, [
  ["/s_new", "sonic-pi-beep", 1001, 0, 0],
]);

// Uint32 pair — full 64-bit precision, no float loss
SuperSonic.osc.encodeBundle([3913056000, 2147483648], [
  ["/s_new", "sonic-pi-beep", 1001, 0, 0],
  ["/n_set", 1001, "amp", 0.5],
]);
```

**TimeTag formats accepted by `encodeBundle()`:**

| Value | Meaning |
|---|---|
| `1`, `null`, `undefined` | Execute immediately |
| `[seconds, fraction]` | NTP uint32 pair — preserves full 64-bit precision |
| Number (e.g. `3913056000.5`) | NTP float — seconds since 1900 (fractional part encoded) |

### Sending OSC from Workers

## Avoiding the Main Thread

When you send OSC from the main thread, it has to compete with everything else happening there - DOM updates, event handlers, animations, your application logic. For simple cases this is fine, but if you're running a sequencer, processing MIDI input, or doing other timing-sensitive work, you can end up with jitter or UI stuttering.

Web Workers let you move work off the main thread. The challenge is getting OSC from a worker to the AudioWorklet efficiently. You could send messages back to the main thread and have it forward them - but that adds latency and defeats the purpose of using a worker in the first place.

SuperSonic solves this with `OscChannel` - a transferable object that gives workers a direct line to the AudioWorklet.

## OscChannel

Normally you'd just call `supersonic.send()` - but workers are separate threads with no access to your main thread's objects. The `supersonic` instance doesn't exist in the worker's world.

You could have the worker send messages back to the main thread via `postMessage`, and have the main thread forward them to scsynth. But that puts the main thread back in the middle of every message - defeating the purpose of using a worker.

The solution is to create a direct channel from the worker to the synth in the AudioWorklet. SuperSonic gives you an `OscChannel` for exactly this.

You create an `OscChannel` with `createOscChannel` (after `init()`) and then you need to **transfer** it to the worker.

Note: Transferring is critical because the core internal comms mechanisms cannot be copied to the worker with a standard `postMessage`, they must be explicitly transferred. This enables the worker to have full and unique ownership of the newly created `OscChannel`.

Here's how you create an `OscChannel` and transfer it to a worker:

```javascript
// Main thread - create and transfer
const channel = supersonic.createOscChannel();
worker.postMessage(
  { type: "init", channel: channel.transferable },
  channel.transferList
);
```

The second argument to `postMessage` is optional - when provided, it lists which objects to transfer rather than copy.

In your worker, handle this as an init message and reconstruct the channel. `OscChannel.fromTransferable()` returns a promise, so await it:

```javascript
// Worker thread
import { OscChannel } from "supersonic-scsynth";

let channel = null;

self.onmessage = async (event) => {
  if (event.data.type === "init") {
    channel = await OscChannel.fromTransferable(event.data.channel);

    // Now you can send OSC directly to the AudioWorklet
    channel.send(oscBytes);
  }
};
```

Using a `type` field lets you handle different message types cleanly - for example `init`, `start`, `stop` (see the [sequencer example](#example-sequencer-worker) below).


## Multiple Workers

Each call to `createOscChannel()` returns a new channel with a unique source ID. This means you can have multiple workers all sending OSC independently - they don't need to coordinate with each other, and their messages can be traced back to their source in metrics and logs.

```javascript
const sequencerChannel = supersonic.createOscChannel(); // sourceId: 1
const lfoChannel = supersonic.createOscChannel(); // sourceId: 2
const midiChannel = supersonic.createOscChannel(); // sourceId: 3

sequencerWorker.postMessage({ channel: sequencerChannel.transferable }, sequencerChannel.transferList);
lfoWorker.postMessage({ channel: lfoChannel.transferable }, lfoChannel.transferList);
midiWorker.postMessage({ channel: midiChannel.transferable }, midiChannel.transferList);
```

In SAB mode there is a limit. Each channel a worker reconstructs takes one of the engine's eight client slots, and the main thread, the reply worker and the traffic-logging worker hold three of them, which leaves five. `fromTransferable()` rejects when none is free.

## SAB vs PM Mode

`OscChannel` works identically in both modes - it detects the active mode and uses the appropriate communication method automatically. Your worker code doesn't need to know or care which mode is active.

See [Communication Modes](https://github.com/samaaron/supersonic/blob/main/docs/MODES.md) for details on choosing between SAB and postMessage modes.

## Message Routing

`OscChannel.send()` does no routing of its own. It hands the bytes to the engine - into the ring buffer in SAB mode, down a `MessagePort` in postMessage mode - and the engine's audio thread does the rest. Messages run as they arrive; a bundle with a future timetag waits in the engine's scheduler until its time.

`send()` returns `false` when the message could not be sent. In SAB mode that means the ring buffer was full: the message is dropped and counted in the `ringBufferDirectWriteFails` metric.

## OscChannel API

### Methods

| Method | Description |
|---|---|
| `send(oscBytes)` | Send OSC bytes to the engine; `false` if they could not be sent |
| `nextNodeId()` | A unique node ID, from the same allocator as `supersonic.nextNodeId()` |
| `now()` | The engine's clock in NTP seconds (`0` until it has rendered a block) |
| `getMetrics()` | `{ messagesSent, bytesSent }`: in SAB mode the totals for every sender, in postMessage mode this channel's |
| `close()` | Release resources |

### Properties

| Property | Description |
|---|---|
| `mode` | `'sab'` or `'postMessage'` |
| `transferable` | Data for `postMessage` transfer |
| `transferList` | Transferable objects array |

### Static Methods

| Method | Description |
|---|---|
| `OscChannel.fromTransferable(data)` | Reconstruct channel in worker (returns a promise) |

## Example: Sequencer Worker

Here's a worker that runs a simple step sequencer:

```javascript
// sequencer-worker.js
import { OscChannel, osc } from "supersonic-scsynth";

let channel = null;
let running = false;
let step = 0;
let bpm = 120;

const pattern = [60, 62, 64, 65, 67, 65, 64, 62]; // Notes to play

self.onmessage = async (event) => {
  const { type, data } = event.data;

  if (type === "init") {
    channel = await OscChannel.fromTransferable(data.channel);
    self.postMessage({ type: "ready" });
  } else if (type === "start") {
    running = true;
    step = 0;
    tick();
  } else if (type === "stop") {
    running = false;
  } else if (type === "bpm") {
    bpm = data.bpm;
  }
};

function tick() {
  if (!running || !channel) return;

  const note = pattern[step % pattern.length];
  const msg = osc.encodeMessage("/s_new", [
    "sonic-pi-beep", -1, 0, 0,
    "note", note,
    "amp", 0.5
  ]);
  channel.send(msg);

  step++;
  const msPerBeat = 60000 / bpm;
  setTimeout(tick, msPerBeat / 4); // 16th notes
}
```

The main thread loads the synthdef, hands the worker its channel, and starts it once the worker says the channel is ready. Starting it straight away would race the `await` in the worker:

```javascript
await supersonic.loadSynthDef("sonic-pi-beep");

const worker = new Worker("sequencer-worker.js", { type: "module" });
worker.onmessage = (event) => {
  if (event.data.type === "ready") worker.postMessage({ type: "start" });
};

const channel = supersonic.createOscChannel();
worker.postMessage({ type: "init", data: { channel: channel.transferable } }, channel.transferList);
```

### Lifecycle & Recovery

### Setup vs Ready

The `setup` event fires after init/recover completes, before `ready`. Async handlers are awaited. Use it for any persistent audio infrastructure that needs to exist on both initial boot and after recovery:

- **Groups** — node tree organization
- **FX chains** — reverb, filters, compressors
- **Bus routing** — synths that read/write to audio buses
- **Persistent synths** — always-on nodes like analyzers or mixers

```javascript
supersonic.on("setup", async () => {
  // Create group structure
  supersonic.send("/g_new", 100, 0, 0); // synths group
  supersonic.send("/g_new", 101, 1, 0); // fx group (after synths)

  // Create FX chain
  supersonic.send("/s_new", "sonic-pi-fx_reverb", 2000, 0, 101,
    "in_bus", 20, "out_bus", 0, "mix", 0.3);

  await supersonic.sync();
});
```

**Why `setup` instead of `ready`?** When `recover()` falls through to a full `reload()`, the engine may come back new, with no nodes: always in postMessage mode, whose worklet takes its memory with it, and in SAB mode when the new audio context runs at another sample rate. `setup` fires whenever the engine is new — the initial boot included — and not when a reload carried the engine on with everything built on it, so rebuilding in `setup` is right on every path, in either transport mode. See [Communication Modes](https://github.com/samaaron/supersonic/blob/main/docs/MODES.md) for more on SAB vs postMessage.

### Tab Visibility & Recovery

Use `visibilitychange` to recover when the user switches back to your tab:

```javascript
document.addEventListener("visibilitychange", async () => {
  if (!document.hidden) {
    await supersonic.recover();
  }
});
```

### Resume vs Reload

`resume()` is fast but only works if the worklet is still alive — when the AudioContext is not running, it calls `purge()` to flush stale scheduled messages, resumes the AudioContext, and resyncs timing. If the context is already running it changes nothing and only reports whether the worklet is alive. `reload()` is a full restart. When you don't know which is needed, use `recover()` — or handle it manually:

```javascript
if (await supersonic.resume()) {
  console.log("Quick resume worked, nodes preserved");
} else {
  console.log("Worklet was killed, need full reload");
  await supersonic.reload();
}
```

---

### Audio Routing

### Connecting Microphone Input

```javascript
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const micSource = audioContext.createMediaStreamSource(stream);

// Connect mic to SuperSonic input
micSource.connect(supersonic.node.input);

// Audio flows through scsynth's input buses (bus 2+ by default)
// Use In.ar(2) in a synthdef to read the mic signal
```

### Connecting to an Analyser

```javascript
const analyser = supersonic.audioContext.createAnalyser();

// Connect SuperSonic output to analyser (in addition to speakers)
supersonic.node.connect(analyser);

// Read frequency data
const data = new Uint8Array(analyser.frequencyBinCount);
analyser.getByteFrequencyData(data);
```

---

### Samples

### Loading from Different Sources

```javascript
// By name (uses sampleBaseURL)
await supersonic.loadSample(0, "loop_amen.flac");

// By full path/URL
await supersonic.loadSample(0, "./custom/my-sample.wav");

// From user-selected file
const file = document.querySelector('input[type="file"]').files[0];
await supersonic.loadSample(0, file);

// From ArrayBuffer (e.g., fetched manually)
const response = await fetch("./audio/sample.wav");
const arrayBuffer = await response.arrayBuffer();
await supersonic.loadSample(0, arrayBuffer);

// Load partial sample (frames 1000-2000)
await supersonic.loadSample(0, "long-sample.flac", 1000, 1000);
```

### Deduplication with `sampleInfo()`

Use `sampleInfo()` to get a SHA-256 content hash without allocating a buffer, then check before loading:

```javascript
const info = await supersonic.sampleInfo("kick.wav");
console.log(info.duration, info.numChannels, info.sampleRate);

// Check for duplicates
const loaded = supersonic.getLoadedBuffers();
if (loaded.some(b => b.hash === info.hash)) {
  console.log("Already loaded, skipping");
} else {
  await supersonic.loadSample(nextBufnum, "kick.wav");
}
```

---

---

## Constructor Options

| Property | Type | Description | Required |
|---|---|---|---|
| <a id="activityevent"></a> `activityEvent?` | [`ActivityLineConfig`](#activitylineconfig) | Length limits for the text the activity events carry. | |
| <a id="audiocontext-1"></a> `audioContext?` | `AudioContext` | Provide your own AudioContext instead of letting SuperSonic create one. It stays yours: kept across `reload()`, left open by `shutdown()`. | |
| <a id="audiocontextoptions"></a> `audioContextOptions?` | `AudioContextOptions` | Options passed to `new AudioContext()`, over the defaults `{ latencyHint: 'interactive', sampleRate: 48000 }`. Ignored if `audioContext` is provided. | |
| <a id="autoconnect"></a> `autoConnect?` | `boolean` | Auto-connect the AudioWorkletNode to the AudioContext destination. Default: true. | |
| <a id="baseurl"></a> `baseURL?` | `string` | Convenience shorthand when all assets (WASM, worklet, workers, synthdefs, samples) are co-located. | Yes\* |
| <a id="buffergrowincrement"></a> `bufferGrowIncrement?` | `number` | Bytes the sample buffer pool grows by each time it grows. Default: 32 MB. | |
| <a id="bufferpoolsize"></a> `bufferPoolSize?` | `number` | Initial size of the sample buffer pool in bytes. Default: 4 MB. | |
| <a id="corebaseurl"></a> `coreBaseURL?` | `string` | Base URL for the engine: the WASM and the AudioWorklet (the supersonic-scsynth-core package). Defaults to `baseURL`. | |
| <a id="debug-1"></a> `debug?` | `boolean` | Enable all debug console logging. Default: false. | |
| <a id="debugengine"></a> `debugEngine?` | `boolean` | Log the engine's debug output to the console. Default: false. | |
| <a id="debugoscin"></a> `debugOscIn?` | `boolean` | Log incoming OSC messages to console. Default: false. | |
| <a id="debugoscout"></a> `debugOscOut?` | `boolean` | Log outgoing OSC messages to console. Default: false. | |
| <a id="fetchmaxretries"></a> `fetchMaxRetries?` | `number` | Max fetch retries when loading assets. Default: 3. | |
| <a id="fetchretrydelay"></a> `fetchRetryDelay?` | `number` | Base delay between retries in ms (exponential backoff). Default: 1000. | |
| <a id="gamepad-1"></a> `gamepad?` | `boolean` \| `Record`<`string`, `unknown`> | The Gamepad API: `true`, or an object of options for the gamepad manager. Default: false. | |
| <a id="maxbuffermemory"></a> `maxBufferMemory?` | `number` | Most the sample buffer pool may grow to, in bytes. The pool grows on demand up to this limit. Default: 768 MB. | |
| <a id="midi-1"></a> `midi?` | `boolean` \| `Record`<`string`, `unknown`> | Web MIDI. Off by default: some browsers ask the user's permission, and a page that never uses MIDI should not ask. `true`, or an object of options for the MIDI manager. Brought up during `init()`; to ask later, from the gesture that wants it, use [SuperSonic.enableMidi](#enablemidi). If it cannot come up the engine boots without it, emits `'error'`, and [SuperSonic.midiError](#midierror) says why. Default: false. | |
| <a id="mode-5"></a> `mode?` | [`TransportMode`](#transportmode) | Transport mode. - `'postMessage'` — works everywhere, no special headers needed (the default off an isolated page) - `'sab'` — lowest latency, requires the Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers (the default on a cross-origin isolated page) See docs/MODES.md for a full comparison of communication modes. | |
| <a id="pagelifecycle"></a> `pageLifecycle?` | `object` | What the page going away, or out of sight, does to the engine. `pagehide`: `'shutdown'` (default — an engine left running after its page is audio with no page to stop it) or `'none'`. `hidden`: `'keep'` (default — a tab behind another plays on) or `'suspend'` (and resume when shown). After a `'shutdown'`, a page restored from the back/forward cache calls `init()` again. | |
| `pageLifecycle.hidden?` | `"keep"` \| `"suspend"` | - | |
| `pageLifecycle.pagehide?` | `"shutdown"` \| `"none"` | - | |
| <a id="samplebaseurl"></a> `sampleBaseURL?` | `string` | Base URL for audio sample files (used by [SuperSonic.loadSample](#loadsample)). Defaults to `baseURL + 'samples/'`. | |
| <a id="schedulerlatelimitms"></a> `schedulerLateLimitMs?` | `number` | The latest a timed event may play, in ms: one that comes due later is dropped and counted (`engineSchedulerLateDropped`). Default 0: everything plays, however late. A page that can be flooded sets a limit. | |
| <a id="scsynthoptions-1"></a> `scsynthOptions?` | [`ScsynthOptions`](#server-options) | The engine's options (see [ScsynthOptions](#server-options)). Validated by the constructor, which throws on a bad one. | |
| <a id="snapshotintervalms"></a> `snapshotIntervalMs?` | `number` | How often to snapshot metrics and the node tree in postMessage mode (ms). Default: 150. | |
| <a id="synthdefbaseurl"></a> `synthdefBaseURL?` | `string` | Base URL for synthdef files (used by [SuperSonic.loadSynthDef](#loadsynthdef)). Defaults to `baseURL + 'synthdefs/'`. | |
| <a id="wasmbaseurl"></a> `wasmBaseURL?` | `string` | Base URL for WASM files. Defaults to `coreBaseURL + 'wasm/'`. | |
| <a id="wasmurl"></a> `wasmUrl?` | `string` | Full URL to the WASM binary. Overrides `wasmBaseURL`. | |
| <a id="workerbaseurl"></a> `workerBaseURL?` | `string` | Base URL for the worker scripts. Defaults to `baseURL + 'workers/'`. | |
| <a id="workleturl"></a> `workletUrl?` | `string` | Full URL to the AudioWorklet script. Overrides `coreBaseURL`. | |

*Required unless `workerBaseURL` and one of `coreBaseURL` / `wasmBaseURL` are provided.*

***

## Server Options

| Property | Type | Description | Default | Range |
|---|---|---|---|---|
| <a id="buflength"></a> `bufLength?` | `128` | Audio buffer length — must be 128 (WebAudio API constraint). | 128 | 128 (fixed) |
| <a id="loadgraphdefs"></a> `loadGraphDefs?` | `0` \| `1` | Load synth definitions from the synthdef directory at boot: 0 or 1. Default: 0. | 0 | 0–1 |
| <a id="maxgraphdefs"></a> `maxGraphDefs?` | `number` | Max synth definitions. Default: 1024. | 1024 | 1–4194304 |
| <a id="maxnodes"></a> `maxNodes?` | `number` | Max synthesis nodes — synths + groups. Default: 1024. | 1024 | 1–4194304 |
| <a id="maxwirebufs"></a> `maxWireBufs?` | `number` | Max wire buffers for internal UGen routing. Default: 64. | 64 | 1–4194304 |
| <a id="memorylocking"></a> `memoryLocking?` | `boolean` | Memory locking — not applicable in browser. Default: false. | false | — |
| <a id="numaudiobuschannels"></a> `numAudioBusChannels?` | `number` | Audio bus channels for routing between synths. Default: 1024. | 1024 | 1–4194304 |
| <a id="numbuffers"></a> `numBuffers?` | `number` | Max audio buffers (1–65535). Default: 1024. | 1024 | 1–65535 |
| <a id="numcontrolbuschannels"></a> `numControlBusChannels?` | `number` | Control bus channels for control-rate data. Default: 16384. | 16384 | 1–16777216 |
| <a id="numinputbuschannels"></a> `numInputBusChannels?` | `number` | Input channels read from the device (0 disables input). Default: 2. | 2 | 0+ |
| <a id="numoutputbuschannels"></a> `numOutputBusChannels?` | `number` | Output channels opened on the audio graph (1–128). Default: 2. | 2 | 1–128 |
| <a id="numrgens"></a> `numRGens?` | `number` | Random number generators. Default: 64. | 64 | 1–65536 |
| <a id="preferredsamplerate"></a> `preferredSampleRate?` | `number` | Preferred sample rate: 0, or 8000–384000. The rate the engine runs at is the AudioContext's: set it with `audioContextOptions.sampleRate` (default 48000), or by passing your own `audioContext`. | 0 | 0, 8000–384000 |
| <a id="realtime"></a> `realTime?` | `boolean` | scsynth's real-time flag. Always false here: the AudioWorklet drives the engine. | false | — |
| <a id="realtimememorysize"></a> `realTimeMemorySize?` | `number` | Real-time memory pool in KB for synthesis allocations. Default: 8192 (8MB). | 8192 | 1–4194304 |
| <a id="verbosity"></a> `verbosity?` | `number` | How much the engine prints, 0–4; 0 is quiet. Default: 0. | 0 | 0–4 |

---

## Sending scsynth Commands

On the web, send commands using `send()` which auto-detects types:

```javascript
supersonic.send("/s_new", "sonic-pi-beep", 1000, 0, 0, "note", 60);
```

Or directly send OSC bytes that you have already pre-encoded via `sendOSC()`:

```javascript
supersonic.sendOSC(oscBytes);
```

The examples in this reference use `send()`. Natively, any OSC client can send the same messages to the server's port (UDP 57110 by default), and an Erlang or Elixir process can pass the encoded bytes to the NIF's `send_osc/1`.

| Command | Description |
|---|---|
| **Top-Level** | |
| [`/notify`](#notify) | Register for node event notifications |
| [`/status`](#status) | Query server status (UGens, synths, CPU) |
| [`/sync`](#sync) | Wait for async commands to complete |
| [`/version`](#version) | Query server version info |
| [`/rtMemoryStatus`](#rtmemorystatus) | Query realtime memory usage |
| **Synth Definitions** | |
| [`/d_recv`](#d_recv) | Load a synthdef from binary data |
| [`/d_free`](#d_free) | Free loaded synthdefs by name |
| **Nodes** | |
| [`/n_free`](#n_free) | Delete nodes |
| [`/n_run`](#n_run) | Turn nodes on or off |
| [`/n_set`](#n_set) | Set node control values |
| [`/n_setn`](#n_setn) | Set sequential control values |
| [`/n_fill`](#n_fill) | Fill controls with a single value |
| [`/n_map`](#n_map) | Map controls to control buses |
| [`/n_mapn`](#n_mapn) | Map sequential controls to control buses |
| [`/n_mapa`](#n_mapa) | Map controls to audio buses |
| [`/n_mapan`](#n_mapan) | Map sequential controls to audio buses |
| [`/n_before`](#n_before) | Move node before another |
| [`/n_after`](#n_after) | Move node after another |
| [`/n_query`](#n_query) | Query node info |
| [`/n_trace`](#n_trace) | Debug trace node execution |
| [`/n_order`](#n_order) | Reorder nodes within a group |
| **Synths** | |
| [`/s_new`](#s_new) | Create a new synth |
| [`/s_get`](#s_get) | Get synth control values |
| [`/s_getn`](#s_getn) | Get sequential synth control values |
| [`/s_noid`](#s_noid) | Remove synth ID tracking |
| **Groups** | |
| [`/g_new`](#g_new) | Create a new group |
| [`/p_new`](#p_new) | Create a parallel group |
| [`/g_head`](#g_head) | Move node to head of group |
| [`/g_tail`](#g_tail) | Move node to tail of group |
| [`/g_freeAll`](#g_freeall) | Free all nodes in group |
| [`/g_deepFree`](#g_deepfree) | Recursively free all synths in group |
| [`/g_dumpTree`](#g_dumptree) | Print group tree (debug) |
| [`/g_queryTree`](#g_querytree) | Query group tree structure |
| **Buffers** | |
| [`/b_alloc`](#b_alloc) | Allocate an empty buffer |
| [`/b_allocRead`](#b_allocread) | Allocate buffer and load audio file |
| [`/b_allocReadChannel`](#b_allocreadchannel) | Allocate buffer and load specific channels |
| [`/b_free`](#b_free) | Free a buffer |
| [`/b_zero`](#b_zero) | Zero buffer contents |
| [`/b_set`](#b_set) | Set individual samples |
| [`/b_setn`](#b_setn) | Set sequential samples |
| [`/b_fill`](#b_fill) | Fill samples with a value |
| [`/b_gen`](#b_gen) | Generate buffer contents (sine, cheby, etc.) |
| [`/b_query`](#b_query) | Query buffer info |
| [`/b_get`](#b_get) | Get sample values |
| [`/b_getn`](#b_getn) | Get sequential sample values |
| **Control Buses** | |
| [`/c_set`](#c_set) | Set control bus values |
| [`/c_setn`](#c_setn) | Set sequential bus values |
| [`/c_fill`](#c_fill) | Fill buses with a value |
| [`/c_get`](#c_get) | Get bus values |
| [`/c_getn`](#c_getn) | Get sequential bus values |
| **SuperSonic Extensions** | |
| [`/b_allocFile`](#b_allocfile) | Load audio from inline file data (web only) |

---

### Parameter Types

| Notation | Type | Description |
|---|---|---|
| `int` | Integer | 32-bit signed integer |
| `float` | Float | 32-bit floating point |
| `double` | Double | 64-bit floating point |
| `string` | String | Null-terminated string |
| `bytes` | Blob | Binary data (byte array) |

### Repetition

`N ×` indicates the parameter can be repeated N times. For example:

```javascript
// /n_free takes N node IDs
supersonic.send("/n_free", 1000, 1001, 1002);
```

### Node IDs

- Use `-1` to have the server auto-generate a unique node ID
- Node ID `0` is the root group (always exists)
- Positive integers are user-assigned IDs

### Add Actions

Used when creating or moving nodes:

| Value | Action | Description |
|---|---|---|
| 0 | head | Add to head of target group |
| 1 | tail | Add to tail of target group |
| 2 | before | Add before target node |
| 3 | after | Add after target node |
| 4 | replace | Replace target node |

### Control Values

Controls can be set by index (integer) or name (string). Values can be:

- `float` or `int` - Direct value
- `"cN"` - Map to control bus N (e.g., `"c0"`)
- `"aN"` - Map to audio bus N (e.g., `"a0"`)

### Asynchronous Commands

Commands marked **Async** reply with `/done` on success or `/fail` on error. In the original scsynth they run partly on a background thread; in SuperSonic they run all their stages inline, on the audio thread, on every host. Use `/sync` to wait for all async commands to complete.

---

These commands don't work in SuperSonic, or work only on some hosts.

> For a complete guide to all differences between SuperSonic and scsynth—including unsupported UGens, architectural differences, and error handling—see [SCSYNTH_DIFFERENCES.md](https://github.com/samaaron/supersonic/blob/main/docs/SCSYNTH_DIFFERENCES.md).

`/clearSched` and `/error` work on every host. `/clearSched` drops the bundles clockwork holds for scsynth (up to v0.89.0 it left them to fire), and on the web `purge()` clears the rest of what is waiting too. `/error` works as in scsynth.

### Scheduling and Debug Commands

| Command | Reason |
|---|---|
| `/quit` | Native server: answers `/done /quit` and shuts down, as scsynth does. NIF: fails; stop the engine with `clockwork:stop/0`. Web: fails; use `destroy()` to shut down the SuperSonic instance |

### Plugin Commands

| Command | Status |
|---|---|
| `/cmd` | Only upstream's demo command, `pluginCmdDemo`, is registered |
| `/u_cmd` | Only upstream's demo UGen, `UnitCmdDemo`, defines commands |

These commands allow plugins to register custom functionality beyond the standard OSC API. None of the built-in UGens use them apart from those demos, but the mechanism exists if compelling use cases emerge. If you have a need for custom plugin commands, [open an issue](https://github.com/samaaron/supersonic/issues) describing your use case.

### Filesystem Commands

The engine has no files on any host. On the web these commands are not available; use the alternatives below. On the native server and the NIF, `supersonic::Commands` serves all of them except `/b_close`, reading and writing the files itself: see [SCSYNTH_DIFFERENCES.md](https://github.com/samaaron/supersonic/blob/main/docs/SCSYNTH_DIFFERENCES.md#filesystem-commands).

| Command | Alternative on the web |
|---|---|
| `/d_load` | `loadSynthDef()` or `/d_recv` with bytes |
| `/d_loadDir` | `loadSynthDefs()` |
| `/b_read` | `loadSample()` |
| `/b_readChannel` | `loadSample()` |
| `/b_write` | Not available |
| `/b_close` | Not available (on any host) |

### Buffer Commands

| Command | Reason |
|---|---|
| `/b_setSampleRate`| Not a command of the engine on any host |

On the web, use the JavaScript API to load assets - it fetches via HTTP and sends the data to scsynth:

```javascript
await supersonic.loadSynthDef("sonic-pi-beep");
await supersonic.loadSample(0, "loop_amen.flac");
```

Every command's parameters, replies and examples: [scsynth Command Reference](https://github.com/samaaron/supersonic/blob/main/docs/SCSYNTH_COMMAND_REFERENCE.md).

---

## Full Reference

- [API.md](https://github.com/samaaron/supersonic/blob/main/docs/API.md) — every class, method, option, event and type, with examples
- [scsynth Command Reference](https://github.com/samaaron/supersonic/blob/main/docs/SCSYNTH_COMMAND_REFERENCE.md) — every command, its parameters and replies
- [Guide](https://github.com/samaaron/supersonic/blob/main/docs/GUIDE.md), [Workers](https://github.com/samaaron/supersonic/blob/main/docs/WORKERS.md), [Metrics](https://github.com/samaaron/supersonic/blob/main/docs/METRICS.md) — the longer reads

---

## Support + License

- [GitHub](https://github.com/samaaron/supersonic) — source, issues, discussions
- [npm](https://www.npmjs.com/package/supersonic-scsynth) — package registry
- License: AGPL-3.0-or-later; the components' own licences are listed in [LICENSE](https://github.com/samaaron/supersonic/blob/main/LICENSE)
