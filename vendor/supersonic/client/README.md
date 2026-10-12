# SuperSonic 0.90.0

> SuperCollider's scsynth in the browser as an AudioWorklet.
>
> Auto-generated from project docs — see [GitHub](https://github.com/samaaron/supersonic) for full documentation.

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
- [scsynth Command Quick Reference](#scsynth-command-quick-reference)
- [Full Method Reference](#full-method-reference)
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
2. Loads the WebAssembly module containing scsynth
3. Starts scsynth running in a dedicated high-priority audio thread

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

|               |                      |                                        |
|---------------|----------------------|----------------------------------------|
| synthdef name | `"sonic-pi-prophet"` | Which synth to create                  |
| node ID       | `-1`                 | Let scsynth assign an ID automatically |
| add action    | `0`                  | Add to the head of the target group    |
| target        | `0`                  | The root group                         |
| params...     | `"note", 28, ...`    | Name/value pairs for synth parameters  |

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

| Member                    | Description                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [`init()`](#init)         | Initialise the engine.                                                                                                      |
| [`shutdown()`](#shutdown) | Shut down the engine.                                                                                                       |
| [`destroy()`](#destroy)   | Destroy the engine completely.                                                                                              |
| [`recover()`](#recover)   | Smart recovery — tries a quick resume first, falls back to full reload.                                                     |
| [`suspend()`](#suspend)   | Suspend the AudioContext and stop the drift timer.                                                                          |
| [`resume()`](#resume)     | Quick resume.                                                                                                               |
| [`reload()`](#reload)     | Full reload — destroys and recreates the worklet and WASM, then restores all previously loaded synthdefs and audio buffers. |
| [`reset()`](#reset)       | Shutdown and immediately re-initialise.                                                                                     |
| [`send()`](#send)         | Send an OSC message to the engine.                                                                                          |
| [`sendOSC()`](#sendosc)   | Send pre-encoded OSC bytes to the engine.                                                                                   |
| [`sync()`](#sync)         | A barrier: resolves once everything sent before it has reached the engine, in order.                                        |
| [`purge()`](#purge)       | Flush all pending scheduled OSC: clears the engine's scheduler and the IN ring so nothing already in flight will fire.      |

**Asset Loading**

| Member                              | Description                                                               |
| ----------------------------------- | ------------------------------------------------------------------------- |
| [`loadSynthDef()`](#loadsynthdef)   | Load a SynthDef into the engine.                                          |
| [`loadSynthDefs()`](#loadsynthdefs) | Load several SynthDefs in parallel, each as loadSynthDef would.           |
| [`loadSample()`](#loadsample)       | Load an audio sample into a buffer slot.                                  |
| [`sampleInfo()`](#sampleinfo)       | Get sample metadata (including content hash) without allocating a buffer. |

**Events**

| Member                                        | Description                                                   |
| --------------------------------------------- | ------------------------------------------------------------- |
| [`on()`](#on)                                 | Subscribe to an event.                                        |
| [`off()`](#off)                               | Unsubscribe from an event.                                    |
| [`once()`](#once)                             | Subscribe to an event once.                                   |
| [`removeAllListeners()`](#removealllisteners) | Remove all listeners for an event, or all listeners entirely. |

**Node Tree**

| Member                          | Description                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| [`getTree()`](#gettree)         | Get the node tree in hierarchical format.                                                |
| [`getRawTree()`](#getrawtree)   | Get the node tree in flat format with linkage pointers.                                  |
| [`getSnapshot()`](#getsnapshot) | Get a diagnostic snapshot with metrics (and their descriptions) and JS heap memory info. |

**Metrics**

| Member                                    | Description                                                    |
| ----------------------------------------- | -------------------------------------------------------------- |
| [`getMetrics()`](#getmetrics)             | Get current metrics as a named object.                         |
| [`getMetricsArray()`](#getmetricsarray)   | Get metrics as a flat Uint32Array for zero-allocation reading. |
| [`getMetricsSchema()`](#getmetricsschema) | Get the metrics schema describing all available metrics.       |

**Properties**

| Member                                | Description                                                           |
| ------------------------------------- | --------------------------------------------------------------------- |
| [`initialized`](#initialized)         | Whether the engine has completed initialisation.                      |
| [`initializing`](#initializing)       | Whether init is currently in progress.                                |
| [`audioContext`](#audiocontext)       | The underlying AudioContext.                                          |
| [`node`](#node)                       | AudioWorkletNode wrapper for custom audio routing.                    |
| [`loadedSynthDefs`](#loadedsynthdefs) | Map of loaded SynthDef names to their binary data — live, not a copy. |

**Advanced**

| Member                                              | Description                                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`getInfo()`](#getinfo)                             | Get engine info: sample rate, memory layout, capabilities, and version.                   |
| [`createOscChannel()`](#createoscchannel)           | Create an OscChannel for direct worker-to-worklet communication.                          |
| [`startCapture()`](#startcapture)                   | Start capturing what the engine sends to the audio device.                                |
| [`stopCapture()`](#stopcapture)                     | Stop capturing and return what was captured.                                              |
| [`getCaptureFrames()`](#getcaptureframes)           | Get number of audio frames captured so far — or, with no capture running, written in all. |
| [`isCaptureEnabled()`](#iscaptureenabled)           | Check if audio capture is currently enabled.                                              |
| [`getMaxCaptureDuration()`](#getmaxcaptureduration) | Get maximum capture duration in seconds: the length of the capture ring.                  |
| [`setClockOffset()`](#setclockoffset)               | Set clock offset for multi-system sync (e.g. against an NTP server).                      |

**Advanced**

| Member                                          | Description                                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`bufferConstants`](#bufferconstants)           | Buffer layout constants from the WASM build.                                                                     |
| [`clock`](#clock)                               | Session-timeline service: tempo, beat origin, transport, NTP "now." See ClockworkClock for the full API surface. |
| [`gamepad`](#gamepad)                           | The gamepad manager, when the gamepad option is on and it came up; otherwise null (gamepadError says why).       |
| [`gamepadError`](#gamepaderror)                 | Why gamepad is null although it was asked for: the error its start-up threw.                                     |
| [`midi`](#midi)                                 | The Web MIDI manager, when MIDI is enabled (the midi option, or enableMidi) and came up.                         |
| [`midiError`](#midierror)                       | Why midi is null although MIDI was asked for: the error its start-up threw.                                      |
| [`mode`](#mode)                                 | Active transport mode ('sab' or 'postMessage').                                                                  |
| [`ringBufferBase`](#ringbufferbase)             | Ring buffer base offset in SharedArrayBuffer.                                                                    |
| [`sharedBuffer`](#sharedbuffer)                 | The SharedArrayBuffer (SAB mode) or null (postMessage mode).                                                     |
| [`allocSample()`](#allocsample)                 | Allocate an empty buffer, as loadSample does for a file: resolves once the engine has it.                        |
| [`enableMidi()`](#enablemidi)                   | Bring Web MIDI up after init.                                                                                    |
| [`getEngineState()`](#getenginestate)           | Returns the current engine lifecycle state.                                                                      |
| [`getLoadedBuffers()`](#getloadedbuffers)       | Get info about all loaded audio buffers.                                                                         |
| [`getScope()`](#getscope)                       | Copy the newest frames frames of a ScopeOut2 scope stream.                                                       |
| [`getScopeActivations()`](#getscopeactivations) | How many times a scope slot has gone live.                                                                       |
| [`getScopes()`](#getscopes)                     | List the scope slots in use.                                                                                     |
| [`getSystemReport()`](#getsystemreport)         | Get a comprehensive system performance report.                                                                   |
| [`isRunning()`](#isrunning)                     | Returns true if the engine has finished booting and is ready to send and receive messages.                       |
| [`nextNodeId()`](#nextnodeid)                   | Get the next unique node ID.                                                                                     |
| [`request()`](#request)                         | Send a message and wait for its reply.                                                                           |
| [`getRawTreeSchema()`](#getrawtreeschema)       | Get schema describing the raw flat node tree structure.                                                          |
| [`getScopeSchema()`](#getscopeschema)           | Scope geometry: slot count, per-slot ring frames, channels.                                                      |
| [`getTreeSchema()`](#gettreeschema)             | Get schema describing the hierarchical node tree structure.                                                      |

### OscChannel

OscChannel — unified dispatch for sending OSC to the AudioWorklet.

Obtain a channel via [SuperSonic.createOscChannel](#createoscchannel) on the main thread,
then transfer it to a Web Worker for direct communication with the AudioWorklet.

| Member                                        | Description                                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`mode`](#mode)                               | Transport mode this channel is using.                                                                                                                       |
| [`transferable`](#transferable)               | Serializable config for transferring this channel to a worker via postMessage.                                                                              |
| [`transferList`](#transferlist)               | Array of transferable objects (MessagePorts) for the postMessage transfer list.                                                                             |
| [`close()`](#close)                           | Close the channel.                                                                                                                                          |
| [`getAndResetMetrics()`](#getandresetmetrics) | Get and reset this channel's local counters (for periodic reporting).                                                                                       |
| [`getMetrics()`](#getmetrics)                 | Get current metrics.                                                                                                                                        |
| [`nextNodeId()`](#nextnodeid)                 | Get the next unique node ID.                                                                                                                                |
| [`now()`](#now)                               | The engine's clock, in NTP seconds: the time its audio thread has reached, readable on any thread the channel is on — a worker cannot see the AudioContext. |
| [`send()`](#send)                             | Send an OSC message: frames it onto the IN ring (SAB) or postMessages it to the worklet (PM).                                                               |
| [`fromTransferable()`](#fromtransferable)     | Reconstruct an OscChannel from data received via postMessage in a worker.                                                                                   |

#### Example

```ts
// Main thread: create and transfer to worker
const channel = sonic.createOscChannel();
myWorker.postMessage(
  { channel: channel.transferable },
  channel.transferList,
);

// Inside worker: reconstruct and send
import { OscChannel } from 'supersonic-scsynth/osc-channel';
const channel = await OscChannel.fromTransferable(event.data.channel);
channel.send(oscBytes);
```

***

#### Constructors

##### Constructor

> **new OscChannel**(): [`OscChannel`](#oscchannel)

###### Returns

[`OscChannel`](#oscchannel)

***

#### Accessors

##### mode

###### Get Signature

> **get** **mode**(): [`TransportMode`](#transportmode)

Transport mode this channel is using.

###### Returns

[`TransportMode`](#transportmode)

##### transferable

###### Get Signature

> **get** **transferable**(): [`OscChannelTransferable`](#oscchanneltransferable-1)

Serializable config for transferring this channel to a worker via postMessage.
In postMessage mode each read hands out a fresh range of node IDs and a port
for more, so read it once per transfer.

###### Example

```ts
worker.postMessage({ ch: channel.transferable }, channel.transferList);
```

###### Returns

[`OscChannelTransferable`](#oscchanneltransferable-1)

##### transferList

###### Get Signature

> **get** **transferList**(): `Transferable`\[]

Array of transferable objects (MessagePorts) for the postMessage transfer list.
Read it after [transferable](#transferable).

###### Example

```ts
worker.postMessage({ ch: channel.transferable }, channel.transferList);
```

###### Returns

`Transferable`\[]

***

#### Methods

##### close()

> **close**(): `void`

Close the channel. In postMessage mode this closes its port; in SAB mode it does nothing.

###### Returns

`void`

##### getAndResetMetrics()

> **getAndResetMetrics**(): [`OscChannelMetrics`](#oscchannelmetrics)

Get and reset this channel's local counters (for periodic reporting).

###### Returns

[`OscChannelMetrics`](#oscchannelmetrics)

##### getMetrics()

> **getMetrics**(): [`OscChannelMetrics`](#oscchannelmetrics)

Get current metrics. In SAB mode these are the shared totals for every sender; in postMessage mode, this channel's own.

###### Returns

[`OscChannelMetrics`](#oscchannelmetrics)

##### nextNodeId()

> **nextNodeId**(): `number`

Get the next unique node ID.

Thread-safe — can be called concurrently from multiple workers and no
two callers will ever receive the same ID. IDs start at 1000: 0 is the
root group and 1–999 are left for the client to assign by hand.

In postMessage mode a worker's channel takes IDs in ranges from the main
thread, asking for the next range before it needs it; it throws if a
tight loop uses a range up before the next has arrived.

###### Returns

`number`

A unique node ID (>= 1000)

##### now()

> **now**(): `number`

The engine's clock, in NTP seconds: the time its audio thread has reached, readable on any thread the channel is
on — a worker cannot see the AudioContext. The clock bundles are stamped on ([SuperSonic.clock](#clock)'s now()),
taken from the audio thread itself once a block: it stands still while the audio does (suspended, interrupted),
and after a reload it is the new engine's from its first block. 0 until the engine has rendered one.

SAB mode reads the sample clock the audio thread publishes into shared memory; postMessage mode hears it from the
audio thread every few blocks and counts on from the last word by the wall clock, a tenth of a second at most.

###### Returns

`number`

NTP seconds, or 0

###### Example

```ts
// Inside a worker: schedule half a second ahead on the engine's own clock
channel.send(osc.encodeBundle(channel.now() + 0.5, [["/s_new", "beep", -1, 0, 0]]));
```

##### send()

> **send**(`oscData`): `boolean`

Send an OSC message: frames it onto the IN ring (SAB) or postMessages it to
the worklet (PM). Classification and scheduling happen on the audio thread
(the engine's OscIngress + BundleScheduler) — the producer never classifies.

###### Parameters

| Parameter | Type         | Description       |
| --------- | ------------ | ----------------- |
| `oscData` | `Uint8Array` | Encoded OSC bytes |

###### Returns

`boolean`

true if sent; false if the IN ring had no room (SAB, counted as
`ringBufferDirectWriteFails`) or the channel is closed (PM)

##### fromTransferable()

> `static` **fromTransferable**(`data`): `Promise`<[`OscChannel`](#oscchannel)>

Reconstruct an OscChannel from data received via postMessage in a worker.
Asynchronous: in SAB mode the worker opens its own instance of the engine
module over the shared memory.

###### Parameters

| Parameter | Type                                                  | Description                                         |
| --------- | ----------------------------------------------------- | --------------------------------------------------- |
| `data`    | [`OscChannelTransferable`](#oscchanneltransferable-1) | The transferable config from `channel.transferable` |

###### Returns

`Promise`<[`OscChannel`](#oscchannel)>

###### Example

```ts
// In a Web Worker:
self.onmessage = async (e) => {
  const channel = await OscChannel.fromTransferable(e.data.ch);
  channel.send(oscBytes);
};
```

## Variables

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

The solution is to create a direct channel from the worker to scsynth running in the AudioWorklet. SuperSonic gives you an `OscChannel` for exactly this.

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

| Method                 | Description                                |
| ---------------------- | ------------------------------------------ |
| `send(oscBytes)`       | Send OSC bytes to the engine; `false` if they could not be sent |
| `nextNodeId()`         | A unique node ID, from the same allocator as `supersonic.nextNodeId()` |
| `now()`                | The engine's clock in NTP seconds (`0` until it has rendered a block) |
| `getMetrics()`         | `{ messagesSent, bytesSent }`: in SAB mode the totals for every sender, in postMessage mode this channel's |
| `close()`              | Release resources                          |

### Properties

| Property        | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| `mode`          | `'sab'` or `'postMessage'`                                    |
| `transferable`  | Data for `postMessage` transfer                               |
| `transferList`  | Transferable objects array                                    |

### Static Methods

| Method                              | Description                   |
| ----------------------------------- | ----------------------------- |
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

**Why `setup` instead of `ready`?** When `recover()` falls through to a full `reload()`, WASM memory is destroyed and recreated, so all nodes are lost. The `setup` event lets you rebuild consistently on both initial boot and after recovery, regardless of transport mode. See [Communication Modes](https://github.com/samaaron/supersonic/blob/main/docs/MODES.md) for more on SAB vs postMessage.

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

| Property                                                | Type                                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                      | Required |
| ------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| <a id="activityevent"></a> `activityEvent?`             | [`ActivityLineConfig`](#activitylineconfig) | Length limits for the text the activity events carry.                                                                                                                                                                                                                                                                                                                                                                            |          |
| <a id="audiocontext-1"></a> `audioContext?`             | `AudioContext`                              | Provide your own AudioContext instead of letting SuperSonic create one. It stays yours: kept across `reload()`, left open by `shutdown()`.                                                                                                                                                                                                                                                                                       |          |
| <a id="audiocontextoptions"></a> `audioContextOptions?` | `AudioContextOptions`                       | Options passed to `new AudioContext()`, over the defaults `{ latencyHint: 'interactive', sampleRate: 48000 }`. Ignored if `audioContext` is provided.                                                                                                                                                                                                                                                                            |          |
| <a id="autoconnect"></a> `autoConnect?`                 | `boolean`                                   | Auto-connect the AudioWorkletNode to the AudioContext destination. Default: true.                                                                                                                                                                                                                                                                                                                                                |          |
| <a id="baseurl"></a> `baseURL?`                         | `string`                                    | Convenience shorthand when all assets (WASM, worklet, workers, synthdefs, samples) are co-located.                                                                                                                                                                                                                                                                                                                               | Yes\*    |
| <a id="buffergrowincrement"></a> `bufferGrowIncrement?` | `number`                                    | Bytes the sample buffer pool grows by each time it grows. Default: 32 MB.                                                                                                                                                                                                                                                                                                                                                        |          |
| <a id="bufferpoolsize"></a> `bufferPoolSize?`           | `number`                                    | Initial size of the sample buffer pool in bytes. Default: 4 MB.                                                                                                                                                                                                                                                                                                                                                                  |          |
| <a id="corebaseurl"></a> `coreBaseURL?`                 | `string`                                    | Base URL for the engine: the WASM and the AudioWorklet (the supersonic-scsynth-core package). Defaults to `baseURL`.                                                                                                                                                                                                                                                                                                             |          |
| <a id="debug-1"></a> `debug?`                           | `boolean`                                   | Enable all debug console logging. Default: false.                                                                                                                                                                                                                                                                                                                                                                                |          |
| <a id="debugengine"></a> `debugEngine?`                 | `boolean`                                   | Log the engine's debug output to the console. Default: false.                                                                                                                                                                                                                                                                                                                                                                    |          |
| <a id="debugoscin"></a> `debugOscIn?`                   | `boolean`                                   | Log incoming OSC messages to console. Default: false.                                                                                                                                                                                                                                                                                                                                                                            |          |
| <a id="debugoscout"></a> `debugOscOut?`                 | `boolean`                                   | Log outgoing OSC messages to console. Default: false.                                                                                                                                                                                                                                                                                                                                                                            |          |
| <a id="fetchmaxretries"></a> `fetchMaxRetries?`         | `number`                                    | Max fetch retries when loading assets. Default: 3.                                                                                                                                                                                                                                                                                                                                                                               |          |
| <a id="fetchretrydelay"></a> `fetchRetryDelay?`         | `number`                                    | Base delay between retries in ms (exponential backoff). Default: 1000.                                                                                                                                                                                                                                                                                                                                                           |          |
| <a id="gamepad-1"></a> `gamepad?`                       | `boolean` \| `Record`<`string`, `unknown`>  | The Gamepad API: `true`, or an object of options for the gamepad manager. Default: false.                                                                                                                                                                                                                                                                                                                                        |          |
| <a id="maxbuffermemory"></a> `maxBufferMemory?`         | `number`                                    | Most the sample buffer pool may grow to, in bytes. The pool grows on demand up to this limit. Default: 768 MB.                                                                                                                                                                                                                                                                                                                   |          |
| <a id="midi-1"></a> `midi?`                             | `boolean` \| `Record`<`string`, `unknown`>  | Web MIDI. Off by default: some browsers ask the user's permission, and a page that never uses MIDI should not ask. `true`, or an object of options for the MIDI manager. Brought up during `init()`; to ask later, from the gesture that wants it, use [SuperSonic.enableMidi](#enablemidi). If it cannot come up the engine boots without it, emits `'error'`, and [SuperSonic.midiError](#midierror) says why. Default: false. |          |
| <a id="mode-5"></a> `mode?`                             | [`TransportMode`](#transportmode)           | Transport mode. - `'postMessage'` — works everywhere, no special headers needed (the default off an isolated page) - `'sab'` — lowest latency, requires the Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers (the default on a cross-origin isolated page) See docs/MODES.md for a full comparison of communication modes.                                                                                    |          |
| <a id="pagelifecycle"></a> `pageLifecycle?`             | `object`                                    | What the page going away, or out of sight, does to the engine. `pagehide`: `'shutdown'` (default — an engine left running after its page is audio with no page to stop it) or `'none'`. `hidden`: `'keep'` (default — a tab behind another plays on) or `'suspend'` (and resume when shown). After a `'shutdown'`, a page restored from the back/forward cache calls `init()` again.                                             |          |
| `pageLifecycle.hidden?`                                 | `"keep"` \| `"suspend"`                     | -                                                                                                                                                                                                                                                                                                                                                                                                                                |          |
| `pageLifecycle.pagehide?`                               | `"shutdown"` \| `"none"`                    | -                                                                                                                                                                                                                                                                                                                                                                                                                                |          |
| <a id="samplebaseurl"></a> `sampleBaseURL?`             | `string`                                    | Base URL for audio sample files (used by [SuperSonic.loadSample](#loadsample)). Defaults to `baseURL + 'samples/'`.                                                                                                                                                                                                                                                                                                              |          |
| <a id="scsynthoptions-1"></a> `scsynthOptions?`         | [`ScsynthOptions`](#server-options)         | The engine's options (see [ScsynthOptions](#server-options)). Validated by the constructor, which throws on a bad one.                                                                                                                                                                                                                                                                                                           |          |
| <a id="snapshotintervalms"></a> `snapshotIntervalMs?`   | `number`                                    | How often to snapshot metrics and the node tree in postMessage mode (ms). Default: 150.                                                                                                                                                                                                                                                                                                                                          |          |
| <a id="synthdefbaseurl"></a> `synthdefBaseURL?`         | `string`                                    | Base URL for synthdef files (used by [SuperSonic.loadSynthDef](#loadsynthdef)). Defaults to `baseURL + 'synthdefs/'`.                                                                                                                                                                                                                                                                                                            |          |
| <a id="wasmbaseurl"></a> `wasmBaseURL?`                 | `string`                                    | Base URL for WASM files. Defaults to `coreBaseURL + 'wasm/'`.                                                                                                                                                                                                                                                                                                                                                                    |          |
| <a id="wasmurl"></a> `wasmUrl?`                         | `string`                                    | Full URL to the WASM binary. Overrides `wasmBaseURL`.                                                                                                                                                                                                                                                                                                                                                                            |          |
| <a id="workerbaseurl"></a> `workerBaseURL?`             | `string`                                    | Base URL for the worker scripts. Defaults to `baseURL + 'workers/'`.                                                                                                                                                                                                                                                                                                                                                             |          |
| <a id="workleturl"></a> `workletUrl?`                   | `string`                                    | Full URL to the AudioWorklet script. Overrides `coreBaseURL`.                                                                                                                                                                                                                                                                                                                                                                    |          |

*Required unless `workerBaseURL` and one of `coreBaseURL` / `wasmBaseURL` are provided.*

***

## Server Options

| Property                                                    | Type       | Description                                                                                                                                                                                       | Default | Range          |
| ----------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------- |
| <a id="buflength"></a> `bufLength?`                         | `128`      | Audio buffer length — must be 128 (WebAudio API constraint).                                                                                                                                      | 128     | 128 (fixed)    |
| <a id="loadgraphdefs"></a> `loadGraphDefs?`                 | `0` \| `1` | Load synth definitions from the synthdef directory at boot: 0 or 1. Default: 0.                                                                                                                   | 0       | 0–1            |
| <a id="maxgraphdefs"></a> `maxGraphDefs?`                   | `number`   | Max synth definitions. Default: 1024.                                                                                                                                                             | 1024    | 1–4194304      |
| <a id="maxnodes"></a> `maxNodes?`                           | `number`   | Max synthesis nodes — synths + groups. Default: 1024.                                                                                                                                             | 1024    | 1–4194304      |
| <a id="maxwirebufs"></a> `maxWireBufs?`                     | `number`   | Max wire buffers for internal UGen routing. Default: 64.                                                                                                                                          | 64      | 1–4194304      |
| <a id="memorylocking"></a> `memoryLocking?`                 | `boolean`  | Memory locking — not applicable in browser. Default: false.                                                                                                                                       | false   | —              |
| <a id="numaudiobuschannels"></a> `numAudioBusChannels?`     | `number`   | Audio bus channels for routing between synths. Default: 1024.                                                                                                                                     | 1024    | 1–4194304      |
| <a id="numbuffers"></a> `numBuffers?`                       | `number`   | Max audio buffers (1–65535). Default: 1024.                                                                                                                                                       | 1024    | 1–65535        |
| <a id="numcontrolbuschannels"></a> `numControlBusChannels?` | `number`   | Control bus channels for control-rate data. Default: 16384.                                                                                                                                       | 16384   | 1–16777216     |
| <a id="numinputbuschannels"></a> `numInputBusChannels?`     | `number`   | Input channels read from the device (0 disables input). Default: 2.                                                                                                                               | 2       | 0+             |
| <a id="numoutputbuschannels"></a> `numOutputBusChannels?`   | `number`   | Output channels opened on the audio graph (1–128). Default: 2.                                                                                                                                    | 2       | 1–128          |
| <a id="numrgens"></a> `numRGens?`                           | `number`   | Random number generators. Default: 64.                                                                                                                                                            | 64      | 1–65536        |
| <a id="preferredsamplerate"></a> `preferredSampleRate?`     | `number`   | Preferred sample rate: 0, or 8000–384000. The rate the engine runs at is the AudioContext's: set it with `audioContextOptions.sampleRate` (default 48000), or by passing your own `audioContext`. | 0       | 0, 8000–384000 |
| <a id="realtime"></a> `realTime?`                           | `boolean`  | scsynth's real-time flag. Always false here: the AudioWorklet drives the engine.                                                                                                                  | false   | —              |
| <a id="realtimememorysize"></a> `realTimeMemorySize?`       | `number`   | Real-time memory pool in KB for synthesis allocations. Default: 8192 (8MB).                                                                                                                       | 8192    | 1–4194304      |
| <a id="verbosity"></a> `verbosity?`                         | `number`   | How much the engine prints, 0–4; 0 is quiet. Default: 0.                                                                                                                                          | 0       | 0–4            |

---

## scsynth Command Quick Reference

On the web, send commands using `send()` which auto-detects types:

```javascript
supersonic.send("/s_new", "sonic-pi-beep", 1000, 0, 0, "note", 60);
```

Or directly send OSC bytes that you have already pre-encoded via `sendOSC()`:

```javascript
supersonic.sendOSC(oscBytes);
```

The examples in this reference use `send()`. Natively, any OSC client can send the same messages to the server's port (UDP 57110 by default), and an Erlang or Elixir process can pass the encoded bytes to the NIF's `send_osc/1`.

| Command                                      | Description                                        |
| -------------------------------------------- | -------------------------------------------------- |
| **Top-Level**                                |                                                    |
| [`/notify`](#notify)                         | Register for node event notifications              |
| [`/status`](#status)                         | Query server status (UGens, synths, CPU)           |
| [`/sync`](#sync)                             | Wait for async commands to complete                |
| [`/version`](#version)                       | Query server version info                          |
| [`/rtMemoryStatus`](#rtmemorystatus)         | Query realtime memory usage                        |
| **Synth Definitions**                        |                                                    |
| [`/d_recv`](#d_recv)                         | Load a synthdef from binary data                   |
| [`/d_free`](#d_free)                         | Free loaded synthdefs by name                      |
| **Nodes**                                    |                                                    |
| [`/n_free`](#n_free)                         | Delete nodes                                       |
| [`/n_run`](#n_run)                           | Turn nodes on or off                               |
| [`/n_set`](#n_set)                           | Set node control values                            |
| [`/n_setn`](#n_setn)                         | Set sequential control values                      |
| [`/n_fill`](#n_fill)                         | Fill controls with a single value                  |
| [`/n_map`](#n_map)                           | Map controls to control buses                      |
| [`/n_mapn`](#n_mapn)                         | Map sequential controls to control buses           |
| [`/n_mapa`](#n_mapa)                         | Map controls to audio buses                        |
| [`/n_mapan`](#n_mapan)                       | Map sequential controls to audio buses             |
| [`/n_before`](#n_before)                     | Move node before another                           |
| [`/n_after`](#n_after)                       | Move node after another                            |
| [`/n_query`](#n_query)                       | Query node info                                    |
| [`/n_trace`](#n_trace)                       | Debug trace node execution                         |
| [`/n_order`](#n_order)                       | Reorder nodes within a group                       |
| **Synths**                                   |                                                    |
| [`/s_new`](#s_new)                           | Create a new synth                                 |
| [`/s_get`](#s_get)                           | Get synth control values                           |
| [`/s_getn`](#s_getn)                         | Get sequential synth control values                |
| [`/s_noid`](#s_noid)                         | Remove synth ID tracking                           |
| **Groups**                                   |                                                    |
| [`/g_new`](#g_new)                           | Create a new group                                 |
| [`/p_new`](#p_new)                           | Create a parallel group                            |
| [`/g_head`](#g_head)                         | Move node to head of group                         |
| [`/g_tail`](#g_tail)                         | Move node to tail of group                         |
| [`/g_freeAll`](#g_freeall)                   | Free all nodes in group                            |
| [`/g_deepFree`](#g_deepfree)                 | Recursively free all synths in group               |
| [`/g_dumpTree`](#g_dumptree)                 | Print group tree (debug)                           |
| [`/g_queryTree`](#g_querytree)               | Query group tree structure                         |
| **Buffers**                                  |                                                    |
| [`/b_alloc`](#b_alloc)                       | Allocate an empty buffer                           |
| [`/b_allocRead`](#b_allocread)               | Allocate buffer and load audio file                |
| [`/b_allocReadChannel`](#b_allocreadchannel) | Allocate buffer and load specific channels         |
| [`/b_free`](#b_free)                         | Free a buffer                                      |
| [`/b_zero`](#b_zero)                         | Zero buffer contents                               |
| [`/b_set`](#b_set)                           | Set individual samples                             |
| [`/b_setn`](#b_setn)                         | Set sequential samples                             |
| [`/b_fill`](#b_fill)                         | Fill samples with a value                          |
| [`/b_gen`](#b_gen)                           | Generate buffer contents (sine, cheby, etc.)       |
| [`/b_query`](#b_query)                       | Query buffer info                                  |
| [`/b_get`](#b_get)                           | Get sample values                                  |
| [`/b_getn`](#b_getn)                         | Get sequential sample values                       |
| **Control Buses**                            |                                                    |
| [`/c_set`](#c_set)                           | Set control bus values                             |
| [`/c_setn`](#c_setn)                         | Set sequential bus values                          |
| [`/c_fill`](#c_fill)                         | Fill buses with a value                            |
| [`/c_get`](#c_get)                           | Get bus values                                     |
| [`/c_getn`](#c_getn)                         | Get sequential bus values                          |
| **SuperSonic Extensions**                    |                                                    |
| [`/b_allocFile`](#b_allocfile)               | Load audio from inline file data (web only)        |

---

### Parameter Types

| Notation | Type    | Description              |
| -------- | ------- | ------------------------ |
| `int`    | Integer | 32-bit signed integer    |
| `float`  | Float   | 32-bit floating point    |
| `double` | Double  | 64-bit floating point    |
| `string` | String  | Null-terminated string   |
| `bytes`  | Blob    | Binary data (byte array) |

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

| Value | Action  | Description                 |
| ----- | ------- | --------------------------- |
| 0     | head    | Add to head of target group |
| 1     | tail    | Add to tail of target group |
| 2     | before  | Add before target node      |
| 3     | after   | Add after target node       |
| 4     | replace | Replace target node         |

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

| Command       | Reason                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `/quit`       | Native server: answers `/done /quit` and shuts down, as scsynth does. NIF: fails; stop the engine with `clockwork:stop/0`. Web: fails; use `destroy()` to shut down the SuperSonic instance |

### Plugin Commands

| Command  | Status                                                               |
| -------- | -------------------------------------------------------------------- |
| `/cmd`   | Only upstream's demo command, `pluginCmdDemo`, is registered         |
| `/u_cmd` | Only upstream's demo UGen, `UnitCmdDemo`, defines commands           |

These commands allow plugins to register custom functionality beyond the standard OSC API. None of the built-in UGens use them apart from those demos, but the mechanism exists if compelling use cases emerge. If you have a need for custom plugin commands, [open an issue](https://github.com/samaaron/supersonic/issues) describing your use case.

### Filesystem Commands

The engine has no files on any host. On the web these commands are not available; use the alternatives below. On the native server and the NIF, `supersonic::Commands` serves all of them except `/b_close`, reading and writing the files itself: see [SCSYNTH_DIFFERENCES.md](https://github.com/samaaron/supersonic/blob/main/docs/SCSYNTH_DIFFERENCES.md#filesystem-commands).

| Command              | Alternative on the web                                                    |
| -------------------- | ------------------------------------------------------------------------- |
| `/d_load`            | `loadSynthDef()` or `/d_recv` with bytes                                  |
| `/d_loadDir`         | `loadSynthDefs()`                                                         |
| `/b_read`            | `loadSample()`                                                            |
| `/b_readChannel`     | `loadSample()`                                                            |
| `/b_write`           | Not available                                                             |
| `/b_close`           | Not available (on any host)                                               |

### Buffer Commands

| Command           | Reason                                                                           |
| ----------------- | -------------------------------------------------------------------------------- |
| `/b_setSampleRate`| Not a command of the engine on any host                                          |

On the web, use the JavaScript API to load assets - it fetches via HTTP and sends the data to scsynth:

```javascript
await supersonic.loadSynthDef("sonic-pi-beep");
await supersonic.loadSample(0, "loop_amen.flac");
```

For full details on every command (parameters, replies, examples), see the [scsynth Command Reference](https://github.com/samaaron/supersonic/blob/main/docs/SCSYNTH_COMMAND_REFERENCE.md).

---

## Full Method Reference

#### Methods

##### allocSample()

> **allocSample**(`bufnum`, `numFrames`, `numChannels?`, `sampleRate?`): `Promise`<{ `bufnum`: `number`; `numChannels`: `number`; `numFrames`: `number`; `sampleRate`: `number`; }>

Allocate an empty buffer, as [loadSample](#loadsample) does for a file: resolves
once the engine has it.

###### Parameters

| Parameter      | Type     | Description                                     |
| -------------- | -------- | ----------------------------------------------- |
| `bufnum`       | `number` | Buffer slot number (0 to numBuffers-1)          |
| `numFrames`    | `number` | Frames to allocate                              |
| `numChannels?` | `number` | Channels (default 1)                            |
| `sampleRate?`  | `number` | Sample rate in Hz (default: the AudioContext's) |

###### Returns

`Promise`<{ `bufnum`: `number`; `numChannels`: `number`; `numFrames`: `number`; `sampleRate`: `number`; }>

The buffer's number and shape

###### Example

```ts
const buf = await sonic.allocSample(1, 48000, 2);
```

##### createOscChannel()

> **createOscChannel**(`options?`): [`OscChannel`](#oscchannel)

Create an OscChannel for direct worker-to-worklet communication.

The returned channel can be transferred to a Web Worker, allowing that
worker to send OSC directly to the AudioWorklet without going through
the main thread. Works in both SAB and postMessage modes.

For AudioWorkletProcessor use, import from `'supersonic-scsynth/osc-channel'`
which avoids DOM APIs unavailable in the worklet scope.

See docs/WORKERS.md for the full workers guide.

###### Parameters

| Parameter           | Type                       | Description                                                                                                       |
| ------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `options?`          | { `sourceId?`: `number`; } | Channel options                                                                                                   |
| `options.sourceId?` | `number`                   | The channel's numeric source ID, shown on `'out:osc'` (0 is the main thread's). Default: the next unused, from 1. |

###### Returns

[`OscChannel`](#oscchannel)

###### Throws

If the engine is not initialised

###### Example

```ts
const channel = sonic.createOscChannel();
myWorker.postMessage(
  { channel: channel.transferable },
  channel.transferList,
);
```

##### destroy()

> **destroy**(): `Promise`<`void`>

Destroy the engine completely. The instance cannot be re-used.

Emits `'destroy'`, calls [shutdown](#shutdown), then clears the WASM cache and
all event listeners.

###### Returns

`Promise`<`void`>

##### enableMidi()

> **enableMidi**(`options?`): `Promise`<`object`>

Bring Web MIDI up after [init](#init).

For a page that asks for MIDI when the player does: some browsers prompt
for it, so ask from the gesture that wants it. Rebuilds the MIDI and
gamepad managers, so calling it again re-acquires MIDI.

###### Parameters

| Parameter  | Type                                       | Description                                                  |
| ---------- | ------------------------------------------ | ------------------------------------------------------------ |
| `options?` | `boolean` \| `Record`<`string`, `unknown`> | `true`, or the MIDI manager's options (as the `midi` option) |

###### Returns

`Promise`<`object`>

The MIDI manager ([midi](#midi)), or null if it could not come up
([midiError](#midierror) says why)

##### getCaptureFrames()

> **getCaptureFrames**(): `number`

Get number of audio frames captured so far — or, with no capture running, written in all.

###### Returns

`number`

##### getEngineState()

> **getEngineState**(): [`EngineState`](#enginestate)

Returns the current engine lifecycle state.

One of:

* `'stopped'` — before `init()` or after `shutdown()`/`destroy()`.
* `'booting'` — while `init()` is in progress.
* `'running'` — up. Whether the audio itself is running is the AudioContext's (see the `audiocontext:*` events).
* `'restarting'` — while `reload()` rebuilds the worklet and engine.
* `'error'` — the last `init()` or `reload()` failed; `init()` or `reset()` tries again.

The same states, in the same words, as the C++ `ClockworkEngine::engineState()`. Every change is emitted as
`statechange`.

###### Returns

[`EngineState`](#enginestate)

##### getInfo()

> **getInfo**(): [`SuperSonicInfo`](#supersonicinfo)

Get engine info: sample rate, memory layout, capabilities, and version.

###### Returns

[`SuperSonicInfo`](#supersonicinfo)

###### Throws

If the engine is not initialised

###### Example

```ts
const info = sonic.getInfo();
console.log(`Sample rate: ${info.sampleRate}Hz`);
console.log(`Boot time: ${info.bootTimeMs}ms`);
console.log(`Version: ${info.version}`);
```

##### getLoadedBuffers()

> **getLoadedBuffers**(): [`LoadedBufferInfo`](#loadedbufferinfo)\[]

Get info about all loaded audio buffers.

###### Returns

[`LoadedBufferInfo`](#loadedbufferinfo)\[]

###### Example

```ts
const buffers = sonic.getLoadedBuffers();
for (const buf of buffers) {
  console.log(`Buffer ${buf.bufnum}: ${buf.duration.toFixed(1)}s, ${buf.source}`);
}
```

##### getMaxCaptureDuration()

> **getMaxCaptureDuration**(): `number`

Get maximum capture duration in seconds: the length of the capture ring.

###### Returns

`number`

##### getMetrics()

> **getMetrics**(): [`SuperSonicMetrics`](#supersonicmetrics)

Get current metrics as a named object.

A local memory read in both SAB and postMessage modes — no IPC. Safe to
call from `requestAnimationFrame`. For reading without allocating, see
[getMetricsArray](#getmetricsarray).

See docs/METRICS.md for the full metrics guide.

###### Returns

[`SuperSonicMetrics`](#supersonicmetrics)

###### Example

```ts
const m = sonic.getMetrics();
console.log(`Messages sent: ${m.oscOutMessagesSent}`);
console.log(`Scheduler depth: ${m.engineSchedulerDepth}`);
```

##### getMetricsArray()

> **getMetricsArray**(): `Uint32Array`

Get metrics as a flat Uint32Array for zero-allocation reading.

Returns the same array reference every call — values are updated in-place.
Use [SuperSonic.getMetricsSchema](#getmetricsschema) for offset mappings.

###### Returns

`Uint32Array`

###### Example

```ts
const schema = SuperSonic.getMetricsSchema();
const arr = sonic.getMetricsArray();
const sent = arr[schema.metrics.oscOutMessagesSent.offset];
```

##### getRawTree()

> **getRawTree**(): [`RawTree`](#rawtree)

Get the node tree in flat format with linkage pointers.

More efficient than [getTree](#gettree) for serialization or custom rendering.

###### Returns

[`RawTree`](#rawtree)

##### getScope()

> **getScope**(`scopeNum`, `frames?`): `object`

Copy the newest `frames` frames of a ScopeOut2 scope stream.

Scope slots are lossless interleaved rings with a monotonic write
cursor (see docs/scope-streams-sample-clock.md); this returns the
window ending at the current cursor, zero-filled at the start when
fewer frames are available. Allocates the output per call.
SAB mode only; returns null when uninitialised, out of range, the
slot is inactive, or nothing has been written to it yet.

###### Parameters

| Parameter  | Type     | Description                                                       |
| ---------- | -------- | ----------------------------------------------------------------- |
| `scopeNum` | `number` | Scope slot index, from 0                                          |
| `frames?`  | `number` | Window length in frames (default 1024; at most the ring's length) |

###### Returns

`object`

| Name            | Type           |
| --------------- | -------------- |
| `channels`      | `number`       |
| `frames`        | `number`       |
| `interleaved`   | `Float32Array` |
| `writePosition` | `bigint`       |

##### getScopeActivations()

> **getScopeActivations**(`scopeNum`): `number`

How many times a scope slot has gone live. A reader polls, and a slot can
be claimed and released between two polls (a loop started and stopped in
a moment); a reader that noted this and sees another number knows the
slot went live in between. Wraps: compare for change only.
SAB mode only; returns null when uninitialised or out of range.

###### Parameters

| Parameter  | Type     | Description              |
| ---------- | -------- | ------------------------ |
| `scopeNum` | `number` | Scope slot index, from 0 |

###### Returns

`number`

##### getScopes()

> **getScopes**(): `object`\[]

List the scope slots in use. SAB mode only; empty otherwise.

###### Returns

`object`\[]

##### getSnapshot()

> **getSnapshot**(): [`Snapshot`](#snapshot)

Get a diagnostic snapshot with metrics (and their descriptions) and JS heap memory info.

Useful for capturing state for bug reports or debugging timing issues.

###### Returns

[`Snapshot`](#snapshot)

##### getSystemReport()

> **getSystemReport**(): [`SystemReport`](#systemreport)

Get a comprehensive system performance report.

Includes hardware info, audio configuration, Chrome playbackStats (if available),
a cross-browser audio health percentage, and a human-readable health assessment.
Useful for diagnosing audio crackling on constrained hardware.

###### Returns

[`SystemReport`](#systemreport)

###### Throws

If the engine is not initialised

###### Example

```ts
const report = sonic.getSystemReport();
console.log(report.health.summary);
if (report.health.audioHealthPct < 95) {
  console.warn('Audio thread struggling:', report.health.issues);
}
```

##### getTree()

> **getTree**(): [`Tree`](#tree)

Get the node tree in hierarchical format.

The mirror has a default capacity of 1024 nodes. If exceeded,
`droppedCount` will be non-zero and the tree may be incomplete,
but audio continues normally.

###### Returns

[`Tree`](#tree)

###### Example

```ts
const tree = sonic.getTree();
function printTree(node, indent = 0) {
  const prefix = '  '.repeat(indent);
  const label = node.type === 'synth' ? node.defName : 'group';
  console.log(`${prefix}[${node.id}] ${label}`);
  for (const child of node.children) printTree(child, indent + 1);
}
if (tree.root) printTree(tree.root);
```

##### init()

> **init**(): `Promise`<`void`>

Initialise the engine.

Loads the WASM binary, creates the AudioContext and AudioWorklet,
starts IO workers, and syncs timing. Emits `'setup'` then `'ready'`
when complete.

Safe to call multiple times: a call while booting gets the same boot,
and a call once booted does nothing.
Call it from a user gesture (click/tap): browsers let audio start only inside one.

###### Returns

`Promise`<`void`>

###### Throws

If required browser features are missing or WASM fails to load.
What was built is taken down again, the engine state becomes `'error'`,
`'error'` is emitted, and `init()` can be called again.

###### Example

```ts
await sonic.init();
// Engine is now ready to send/receive OSC
```

##### isCaptureEnabled()

> **isCaptureEnabled**(): `boolean`

Check if audio capture is currently enabled.

###### Returns

`boolean`

##### isRunning()

> **isRunning**(): `boolean`

Returns true if the engine has finished booting and is ready to send
and receive messages.

Mirrors the C++ `ClockworkEngine::isRunning()` accessor; returns the
same value as the `initialized` getter, exposed as a method to match
the C++ API shape.

###### Returns

`boolean`

##### loadSample()

> **loadSample**(`bufnum`, `source`, `startFrame?`, `numFrames?`): `Promise`<[`LoadSampleResult`](#loadsampleresult)>

Load an audio sample into a buffer slot.

Decodes the audio file (WAV, AIFF, etc.) and copies the samples into
the sample buffer pool. Resolves once the engine has the buffer, which is
then available for use with `PlayBuf`, `BufRd`, etc. A bare filename is
resolved against `sampleBaseURL`.

###### Parameters

| Parameter     | Type                                                                        | Description                                 |
| ------------- | --------------------------------------------------------------------------- | ------------------------------------------- |
| `bufnum`      | `number`                                                                    | Buffer slot number (0 to numBuffers-1)      |
| `source`      | `string` \| `ArrayBuffer` \| `ArrayBufferView`<`ArrayBufferLike`> \| `Blob` | Sample path/URL, raw bytes, or File/Blob    |
| `startFrame?` | `number`                                                                    | First frame to read (default: 0)            |
| `numFrames?`  | `number`                                                                    | Number of frames to read (default: 0 = all) |

###### Returns

`Promise`<[`LoadSampleResult`](#loadsampleresult)>

Buffer info including frame count, channels, and sample rate

###### Example

```ts
// Load from URL:
await sonic.loadSample(0, '/samples/kick.wav');

// Use in a synth:
sonic.send('/s_new', 'sampler', 1001, 0, 0, 'bufnum', 0);
```

##### loadSynthDef()

> **loadSynthDef**(`source`): `Promise`<[`LoadSynthDefResult`](#loadsynthdefresult)>

Load a SynthDef into the engine.

Accepts multiple source types:

* **Name string** — fetched from `synthdefBaseURL` (e.g. `'beep'` → `synthdefBaseURL/beep.scsyndef`)
* **Path/URL string** — fetched directly (one containing `/` or `\`, starting with `http`, or ending in `.scsyndef`)
* **ArrayBuffer / Uint8Array** — raw synthdef bytes
* **File / Blob** — e.g. from a file input

The definition is sent as `/d_recv` through [send](#send-1), so it is recorded
in [loadedSynthDefs](#loadedsynthdefs) and restored after a reload. Resolves once it
has been sent; [sync](#sync) after it waits for the engine to reach it.

###### Parameters

| Parameter | Type                                                                        | Description                                      |
| --------- | --------------------------------------------------------------------------- | ------------------------------------------------ |
| `source`  | `string` \| `ArrayBuffer` \| `ArrayBufferView`<`ArrayBufferLike`> \| `Blob` | SynthDef name, path/URL, raw bytes, or File/Blob |

###### Returns

`Promise`<[`LoadSynthDefResult`](#loadsynthdefresult)>

The extracted name and byte size

###### Throws

If the source type is invalid, the synthdef can't be parsed, a
name is given with no `synthdefBaseURL`, or the fetch fails

###### Example

```ts
// By name (uses synthdefBaseURL):
await sonic.loadSynthDef('beep');

// By URL:
await sonic.loadSynthDef('/assets/synthdefs/pad.scsyndef');

// From raw bytes:
const bytes = await fetch('/my-synth.scsyndef').then(r => r.arrayBuffer());
await sonic.loadSynthDef(bytes);

// From file input:
fileInput.onchange = async (e) => {
  await sonic.loadSynthDef(e.target.files[0]);
};
```

##### loadSynthDefs()

> **loadSynthDefs**(`names`): `Promise`<[`LoadSynthDefResult`](#loadsynthdefresult)\[]>

Load several SynthDefs in parallel, each as [loadSynthDef](#loadsynthdef) would.

###### Parameters

| Parameter | Type        | Description                    |
| --------- | ----------- | ------------------------------ |
| `names`   | `string`\[] | SynthDef names (or paths/URLs) |

###### Returns

`Promise`<[`LoadSynthDefResult`](#loadsynthdefresult)\[]>

Each one's name and byte size, in the order given. Rejects with
the first failure; the others may still have loaded.

###### Example

```ts
const loaded = await sonic.loadSynthDefs(['beep', 'pad', 'kick']);
console.log(loaded.map((d) => d.name));
```

##### nextNodeId()

> **nextNodeId**(): `number`

Get the next unique node ID.

Thread-safe — can be called concurrently from multiple workers and no
two callers will ever receive the same ID. IDs start at 1000: 0 is the
root group and 1–999 are left for the client to assign by hand.

Also available on [OscChannel](#oscchannel) for use in Web Workers.

###### Returns

`number`

A unique node ID (>= 1000)

###### Throws

If the engine is not initialised

###### Example

```ts
const id = sonic.nextNodeId();
sonic.send('/s_new', 'beep', id, 0, 0, 'freq', 440);
```

##### off()

> **off**<`E`>(`event`, `callback`): `this`

Unsubscribe from an event.

###### Type Parameters

| Type Parameter                                           |
| -------------------------------------------------------- |
| `E` *extends* keyof [`SuperSonicEventMap`](#event-types) |

###### Parameters

| Parameter  | Type                                       | Description                                     |
| ---------- | ------------------------------------------ | ----------------------------------------------- |
| `event`    | `E`                                        | Event name                                      |
| `callback` | [`SuperSonicEventMap`](#event-types)\[`E`] | The same function reference passed to [on](#on) |

###### Returns

`this`

##### on()

> **on**<`E`>(`event`, `callback`): () => `void`

Subscribe to an event.

###### Type Parameters

| Type Parameter                                           |
| -------------------------------------------------------- |
| `E` *extends* keyof [`SuperSonicEventMap`](#event-types) |

###### Parameters

| Parameter  | Type                                       | Description                               |
| ---------- | ------------------------------------------ | ----------------------------------------- |
| `event`    | `E`                                        | Event name                                |
| `callback` | [`SuperSonicEventMap`](#event-types)\[`E`] | Handler function (type-checked per event) |

###### Returns

Unsubscribe function — call it to remove the listener

() => `void`

###### Example

```ts
const unsub = sonic.on('in', (msg) => {
  console.log(msg[0], msg.slice(1));
});

// Later:
unsub();
```

##### once()

> **once**<`E`>(`event`, `callback`): () => `void`

Subscribe to an event once. The handler is automatically removed after the first call.
Returns an unsubscribe function (matching [on](#on)).

###### Type Parameters

| Type Parameter                                           |
| -------------------------------------------------------- |
| `E` *extends* keyof [`SuperSonicEventMap`](#event-types) |

###### Parameters

| Parameter  | Type                                       | Description      |
| ---------- | ------------------------------------------ | ---------------- |
| `event`    | `E`                                        | Event name       |
| `callback` | [`SuperSonicEventMap`](#event-types)\[`E`] | Handler function |

###### Returns

Unsubscribe function — call it to remove the listener before it fires

() => `void`

##### purge()

> **purge**(): `Promise`<`void`>

Flush all pending scheduled OSC: clears the engine's scheduler and the IN
ring so nothing already in flight will fire. Resolves when the worklet
confirms — or after a second without an answer, when it emits `'warning'`
(the worklet may be gone).

###### Returns

`Promise`<`void`>

##### recover()

> **recover**(): `Promise`<`boolean`>

Smart recovery — tries a quick resume first, falls back to full reload.

Use when you're not sure if the worklet is still alive (e.g. returning
from a long background period).

Call it from a user gesture (click/tap). Before anything else it makes a
spare AudioContext — browsers let audio start only inside a gesture, and a
context that iOS hands back after an interruption may never render again.
If the quick resume fails, the reload moves onto the spare; otherwise the
spare is closed.

###### Returns

`Promise`<`boolean`>

true if audio is running after recovery; false if the engine was
not initialised or the reload failed

###### Example

```ts
sonic.on('audiocontext:suspended', () => showResumeButton());
resumeButton.onclick = async () => {
  if (await sonic.recover()) hideResumeButton();
};
```

##### reload()

> **reload**(`options?`): `Promise`<`boolean`>

Full reload — destroys and recreates the worklet and WASM, then restores
all previously loaded synthdefs and audio buffers.

Emits `'reload:start'`, then `'setup'` (so you can rebuild groups, FX
chains, and bus routing), `'ready'` and `'reload:complete'`. On failure
it takes down what it built, emits `'reload:failed'` and
`'reload:complete'` with `success: false`, and resolves to false.
A call while a reload is under way gets that reload.
Use when the worklet was killed (e.g. long background, browser reclaimed memory).

###### Parameters

| Parameter               | Type                                 | Description                                                                                                                                 |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `options?`              | { `audioContext?`: `AudioContext`; } | Reload options                                                                                                                              |
| `options.audioContext?` | `AudioContext`                       | A context to reload onto instead of the current one (what [recover](#recover) passes). It becomes SuperSonic's own, closed with the engine. |

###### Returns

`Promise`<`boolean`>

true if reload succeeded; false if it failed or the engine was not initialised

##### removeAllListeners()

> **removeAllListeners**(`event?`): `this`

Remove all listeners for an event, or all listeners entirely.

###### Parameters

| Parameter | Type                                       | Description                              |
| --------- | ------------------------------------------ | ---------------------------------------- |
| `event?`  | keyof [`SuperSonicEventMap`](#event-types) | Event name, or omit to remove everything |

###### Returns

`this`

***

#### Event Types

| Event                                                           | Description                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="audiocontextinterrupted"></a> `audiocontext:interrupted` | AudioContext was interrupted (iOS-specific). Another app or system event took audio focus. Similar to suspended but triggered externally.                                                                                                                                           |
| <a id="audiocontextresumed"></a> `audiocontext:resumed`         | AudioContext changed to the 'running' state.                                                                                                                                                                                                                                        |
| <a id="audiocontextstatechange"></a> `audiocontext:statechange` | AudioContext state changed. State is one of: `'running'`, `'suspended'`, `'closed'`, or `'interrupted'`.                                                                                                                                                                            |
| <a id="audiocontextsuspended"></a> `audiocontext:suspended`     | AudioContext was suspended (e.g. tab backgrounded, autoplay policy, iOS audio interruption). Show a restart UI and call `recover()` when the user interacts.                                                                                                                        |
| <a id="bufferpoolgrown"></a> `buffer:pool:grown`                | The sample buffer pool grew on demand: a new segment was added.                                                                                                                                                                                                                     |
| <a id="debug"></a> `debug`                                      | A line of the engine's debug output. Not also emitted as `'in'`.                                                                                                                                                                                                                    |
| <a id="destroy-1"></a> `destroy`                                | `destroy()` has been called. Fired first — before the shutdown, and before every listener is removed: the last chance to clean up. Not fired by `shutdown()` or `reset()`.                                                                                                          |
| <a id="error"></a> `error`                                      | Error from any component (worklet, transport, workers), a failed boot, a queued buffer command that failed, a `'setup'` listener that threw, or a MIDI or gamepad subsystem that could not come up.                                                                                 |
| <a id="in"></a> `in`                                            | Decoded OSC message received from the engine. Messages are plain arrays: `[address, ...args]`.                                                                                                                                                                                      |
| <a id="inhtml"></a> `in:html`                                   | Pre-formatted HTML representation of an incoming OSC message with CSS classes for colourisation. Only emitted when listeners are attached.                                                                                                                                          |
| <a id="inosc"></a> `in:osc`                                     | Raw OSC bytes received (before decoding), with when they arrived and the bundle's time tag (`scheduledTime`, null for a message). `sequence` is -1 for a reply the page made itself (MIDI, gamepad).                                                                                |
| <a id="intext"></a> `in:text`                                   | Pre-formatted text representation of an incoming OSC message. Only emitted when listeners are attached or debug logging is enabled.                                                                                                                                                 |
| <a id="loadingcomplete"></a> `loading:complete`                 | An asset finished loading. Size is in bytes.                                                                                                                                                                                                                                        |
| <a id="loadingstart"></a> `loading:start`                       | An asset started loading. Type is `'wasm'`, `'synthdef'`, or `'sample'`. `size` (bytes) is given when known in advance.                                                                                                                                                             |
| <a id="out"></a> `out`                                          | Decoded OSC message sent to the engine. Messages are plain arrays: `[address, ...args]`. Mirrors the `'in'` event for outgoing messages.                                                                                                                                            |
| <a id="outhtml"></a> `out:html`                                 | Pre-formatted HTML representation of an outgoing OSC message with CSS classes for colourisation. Only emitted when listeners are attached.                                                                                                                                          |
| <a id="outosc"></a> `out:osc`                                   | Raw OSC bytes sent to the engine. Includes the sending channel's source ID (0 for the main thread), sequence number, NTP timestamp and the bundle's time tag (null for a message).                                                                                                  |
| <a id="outtext"></a> `out:text`                                 | Pre-formatted text representation of an outgoing OSC message (a bundle as its messages, one per line). Only emitted when listeners are attached or debug logging is enabled.                                                                                                        |
| <a id="ready"></a> `ready`                                      | Fired when the engine is fully booted and ready to receive messages, after `'setup'` (also after a reload). Payload includes browser capabilities and boot timing.                                                                                                                  |
| <a id="reloadcomplete"></a> `reload:complete`                   | Full reload completed, or failed (`success: false`, with the error).                                                                                                                                                                                                                |
| <a id="reloadfailed"></a> `reload:failed`                       | A reload failed. What it built has been taken down; `reload()` and `recover()` answer false.                                                                                                                                                                                        |
| <a id="reloadstart"></a> `reload:start`                         | Full reload started (worklet and WASM will be recreated).                                                                                                                                                                                                                           |
| <a id="resumed"></a> `resumed`                                  | Audio resumed after a suspend: `resume()` restarted the AudioContext and the audio thread is running. Not fired when the context was already running.                                                                                                                               |
| <a id="setup"></a> `setup`                                      | Fired after init completes, before `'ready'`. Use for setting up groups, FX chains, and bus routing. Can be async — init waits for all setup handlers to resolve; one that throws is reported on `'error'`. Also fires after a `reload()`, including one `recover()` falls back to. |
| <a id="shutdown-1"></a> `shutdown`                              | Engine is shutting down. Fired by `shutdown()`, `reset()`, and `destroy()`, when the engine was running or booting.                                                                                                                                                                 |
| <a id="statechange"></a> `statechange`                          | The engine's state changed (see `getEngineState()`), as native sends `/clockwork/statechange`. `error` is set on `'error'`.                                                                                                                                                         |
| <a id="warning"></a> `warning`                                  | Something a host should hear of in every build, for its own log (`{ message }`) — for instance `purge()` getting no answer from the worklet.                                                                                                                                        |

##### request()

> **request**(`address`, `args`, `options`): `Promise`<[`OscMessage`](#oscmessage)>

Send a message and wait for its reply.

Resolves with the decoded reply: the first incoming message at `reply`
(for which `match` is true, when given). Rejects when a `/fail` arrives
first — scsynth's word for a refusal; name another address with `error`,
or pass `error: null` to wait only for the reply — and on the timeout.
The rejection's Error carries the refusal as `reply`.

###### Parameters

| Parameter            | Type                                                                                               | Description                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `address`            | `string`                                                                                           | The command to send                                               |
| `args`               | [`OscArg`](#osc-argument-types)\[]                                                                 | Its arguments                                                     |
| `options`            | { `error?`: `string`; `match?`: (`msg`) => `boolean`; `reply`: `string`; `timeoutMs?`: `number`; } | What to wait for                                                  |
| `options.error?`     | `string`                                                                                           | The address a refusal comes on (default `'/fail'`; null for none) |
| `options.match?`     | (`msg`) => `boolean`                                                                               | Narrows the reply and the refusal, e.g. by an ID                  |
| `options.reply`      | `string`                                                                                           | The address the answer comes on                                   |
| `options.timeoutMs?` | `number`                                                                                           | How long to wait (default 10000)                                  |

###### Returns

`Promise`<[`OscMessage`](#oscmessage)>

###### Throws

If the engine is not initialised, or `reply` is missing (thrown, not a rejection)

###### Example

```ts
const [, , numUGens, numSynths] = await sonic.request('/status', [], { reply: '/status.reply' });
```

##### reset()

> **reset**(): `Promise`<`void`>

Shutdown and immediately re-initialise.

Equivalent to `await sonic.shutdown(); await sonic.init();`

###### Returns

`Promise`<`void`>

##### resume()

> **resume**(): `Promise`<`boolean`>

Quick resume. If the AudioContext is already running, only checks that the
audio thread is alive: nothing is purged, resynced or emitted. Otherwise it
starts the context, calls [purge](#purge) to drop what queued while it slept,
restarts the drift timer and, if the audio thread is running, resyncs timing
and emits `'resumed'`.

Memory, node tree, and loaded synthdefs are preserved. Does not emit `'setup'`.
Use when you know the worklet is still running (e.g. tab was briefly backgrounded).
Call it from a user gesture: browsers let audio start only inside one.

###### Returns

`Promise`<`boolean`>

true if the audio thread is running after resume; false if not, or if the engine is not initialised

##### sampleInfo()

> **sampleInfo**(`source`, `startFrame?`, `numFrames?`): `Promise`<[`SampleInfo`](#sampleinfo-1)>

Get sample metadata (including content hash) without allocating a buffer.

Fetches, decodes, and hashes the audio, returning the same info that
would appear in the [loadSample](#loadsample) result if the content were loaded.
No buffer slot is consumed and no OSC is sent to the engine.

Use this to inspect content or check for duplicates before loading.

###### Parameters

| Parameter     | Type                                                                        | Description                                 |
| ------------- | --------------------------------------------------------------------------- | ------------------------------------------- |
| `source`      | `string` \| `ArrayBuffer` \| `ArrayBufferView`<`ArrayBufferLike`> \| `Blob` | Sample path/URL, raw bytes, or File/Blob    |
| `startFrame?` | `number`                                                                    | First frame to read (default: 0)            |
| `numFrames?`  | `number`                                                                    | Number of frames to read (default: 0 = all) |

###### Returns

`Promise`<[`SampleInfo`](#sampleinfo-1)>

Sample metadata including hash, frame count, channels, sample rate, and duration

###### Example

```ts
const info = await sonic.sampleInfo('kick.wav');
console.log(info.hash, info.duration, info.numChannels);

const loaded = sonic.getLoadedBuffers();
if (loaded.some(b => b.hash === info.hash)) {
  console.log('Already loaded');
}
```

##### send()

###### Call Signature

> **send**(`address`): `void`

Query server status. Replies with `/status.reply`: unused, numUGens, numSynths, numGroups, numSynthDefs, avgCPU%, peakCPU%, nominalSampleRate, actualSampleRate.

###### Parameters

| Parameter | Type        |
| --------- | ----------- |
| `address` | `"/status"` |

###### Returns

`void`

###### Call Signature

> **send**(`address`): `void`

Query server version. Replies with `/version.reply`: programName, majorVersion, minorVersion, patchVersion, gitBranch, commitHash.

###### Parameters

| Parameter | Type         |
| --------- | ------------ |
| `address` | `"/version"` |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `flag`, `clientID?`): `void`

Register (1) or unregister (0) for server notifications (`/n_go`, `/n_end`, `/n_on`, `/n_off`, `/n_move`). Replies with `/done /notify clientID [maxLogins]`.

###### Parameters

| Parameter   | Type        |
| ----------- | ----------- |
| `address`   | `"/notify"` |
| `flag`      | `0` \| `1`  |
| `clientID?` | `number`    |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `flag`): `void`

Enable/disable OSC message dumping to debug output. 0=off, 1=parsed, 2=hex, 3=both.

###### Parameters

| Parameter | Type                     |
| --------- | ------------------------ |
| `address` | `"/dumpOSC"`             |
| `flag`    | `0` \| `1` \| `2` \| `3` |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `syncID`): `void`

Async. Wait for all prior async commands to complete. Replies with `/synced syncID`.

###### Parameters

| Parameter | Type      |
| --------- | --------- |
| `address` | `"/sync"` |
| `syncID`  | `number`  |

###### Returns

`void`

###### Call Signature

> **send**(`address`): `void`

Query realtime memory usage. Replies with `/rtMemoryStatus.reply`: freeBytes, largestFreeBlockBytes.

###### Parameters

| Parameter | Type                |
| --------- | ------------------- |
| `address` | `"/rtMemoryStatus"` |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `bytes`, `completionMessage?`): `void`

Async. Load a compiled synthdef from bytes. Optional completionMessage is an encoded OSC message executed after loading. Replies with `/done /d_recv`.

###### Parameters

| Parameter            | Type                                             |
| -------------------- | ------------------------------------------------ |
| `address`            | `"/d_recv"`                                      |
| `bytes`              | `ArrayBuffer` \| `Uint8Array`<`ArrayBufferLike`> |
| `completionMessage?` | `ArrayBuffer` \| `Uint8Array`<`ArrayBufferLike`> |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`names`): `void`

Free one or more loaded synthdefs by name.

###### Parameters

| Parameter  | Type                       |
| ---------- | -------------------------- |
| `address`  | `"/d_free"`                |
| ...`names` | \[`string`, `...string[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`): `void`

Free all loaded synthdefs. Not in the official SC reference but supported by scsynth.

###### Parameters

| Parameter | Type           |
| --------- | -------------- |
| `address` | `"/d_freeAll"` |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `defName`, `nodeID`, `addAction`, `targetID`, ...`controls`): `void`

Create a new synth from a loaded synthdef. addAction: 0=head, 1=tail, 2=before, 3=after, 4=replace. Controls are alternating name/index and value pairs. Values can be numbers or bus mapping strings like `"c0"` (control bus 0) or `"a0"` (audio bus 0). Use nodeID=-1 for auto-assign.

###### Parameters

| Parameter     | Type                      |
| ------------- | ------------------------- |
| `address`     | `"/s_new"`                |
| `defName`     | `string`                  |
| `nodeID`      | `number`                  |
| `addAction`   | [`AddAction`](#addaction) |
| `targetID`    | `number`                  |
| ...`controls` | (`string` \| `number`)\[] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `nodeID`, ...`controls`): `void`

Get synth control values. Controls can be indices or names. Replies with `/n_set nodeID control value ...`.

###### Parameters

| Parameter     | Type                      |
| ------------- | ------------------------- |
| `address`     | `"/s_get"`                |
| `nodeID`      | `number`                  |
| ...`controls` | (`string` \| `number`)\[] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `nodeID`, `control`, `count`): `void`

Get sequential synth control values. Control can be an index or name. Replies with `/n_setn nodeID control count values...`. For multiple ranges, use the catch-all overload.

###### Parameters

| Parameter | Type                 |
| --------- | -------------------- |
| `address` | `"/s_getn"`          |
| `nodeID`  | `number`             |
| `control` | `string` \| `number` |
| `count`   | `number`             |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`nodeIDs`): `void`

Release client-side synth ID tracking. Synths continue running but are reassigned to reserved negative IDs. Use when you no longer need to communicate with the synth and want to reuse the ID.

###### Parameters

| Parameter    | Type                       |
| ------------ | -------------------------- |
| `address`    | `"/s_noid"`                |
| ...`nodeIDs` | \[`number`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`nodeIDs`): `void`

Free (delete) one or more nodes.

###### Parameters

| Parameter    | Type                       |
| ------------ | -------------------------- |
| `address`    | `"/n_free"`                |
| ...`nodeIDs` | \[`number`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `nodeID`, ...`controls`): `void`

Set node control values. Controls are alternating name/index and value pairs. If the node is a group, sets the control on all nodes in the group.

###### Parameters

| Parameter     | Type                      |
| ------------- | ------------------------- |
| `address`     | `"/n_set"`                |
| `nodeID`      | `number`                  |
| ...`controls` | (`string` \| `number`)\[] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `nodeID`, `control`, `count`, ...`values`): `void`

Set sequential control values starting at the given control index/name. For multiple ranges, use the catch-all overload.

###### Parameters

| Parameter   | Type                 |
| ----------- | -------------------- |
| `address`   | `"/n_setn"`          |
| `nodeID`    | `number`             |
| `control`   | `string` \| `number` |
| `count`     | `number`             |
| ...`values` | `number`\[]          |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `nodeID`, `control`, `count`, `value`): `void`

Fill sequential controls with a single value. For multiple ranges, use the catch-all overload.

###### Parameters

| Parameter | Type                 |
| --------- | -------------------- |
| `address` | `"/n_fill"`          |
| `nodeID`  | `number`             |
| `control` | `string` \| `number` |
| `count`   | `number`             |
| `value`   | `number`             |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`pairs`): `void`

Turn nodes on (1) or off (0). Args are repeating \[nodeID, flag] pairs.

###### Parameters

| Parameter  | Type                                   |
| ---------- | -------------------------------------- |
| `address`  | `"/n_run"`                             |
| ...`pairs` | \[`number`, `0` \| `1`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`pairs`): `void`

Move nodeA to execute immediately before nodeB. Args are repeating \[nodeA, nodeB] pairs.

###### Parameters

| Parameter  | Type                                 |
| ---------- | ------------------------------------ |
| `address`  | `"/n_before"`                        |
| ...`pairs` | \[`number`, `number`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`pairs`): `void`

Move nodeA to execute immediately after nodeB. Args are repeating \[nodeA, nodeB] pairs.

###### Parameters

| Parameter  | Type                                 |
| ---------- | ------------------------------------ |
| `address`  | `"/n_after"`                         |
| ...`pairs` | \[`number`, `number`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `addAction`, `targetID`, ...`nodeIDs`): `void`

Reorder nodes within a group. addAction: 0=head, 1=tail, 2=before target, 3=after target. Does not support 4 (replace).

###### Parameters

| Parameter    | Type                       |
| ------------ | -------------------------- |
| `address`    | `"/n_order"`               |
| `addAction`  | `0` \| `1` \| `2` \| `3`   |
| `targetID`   | `number`                   |
| ...`nodeIDs` | \[`number`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`nodeIDs`): `void`

Query node info. Replies with `/n_info` for each node: nodeID, parentGroupID, prevNodeID, nextNodeID, isGroup, \[headNodeID, tailNodeID].

###### Parameters

| Parameter    | Type                       |
| ------------ | -------------------------- |
| `address`    | `"/n_query"`               |
| ...`nodeIDs` | \[`number`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`nodeIDs`): `void`

Print control values and calculation rates for each node to debug output. No reply message.

###### Parameters

| Parameter    | Type                       |
| ------------ | -------------------------- |
| `address`    | `"/n_trace"`               |
| ...`nodeIDs` | \[`number`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `nodeID`, ...`mappings`): `void`

Map controls to read from control buses. Mappings are repeating \[control, busIndex] pairs. Set busIndex to -1 to unmap.

###### Parameters

| Parameter     | Type                      |
| ------------- | ------------------------- |
| `address`     | `"/n_map"`                |
| `nodeID`      | `number`                  |
| ...`mappings` | (`string` \| `number`)\[] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `nodeID`, ...`mappings`): `void`

Map a range of sequential controls to sequential control buses. Mappings are repeating \[control, busIndex, count] triplets.

###### Parameters

| Parameter     | Type                      |
| ------------- | ------------------------- |
| `address`     | `"/n_mapn"`               |
| `nodeID`      | `number`                  |
| ...`mappings` | (`string` \| `number`)\[] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `nodeID`, ...`mappings`): `void`

Map controls to read from audio buses. Mappings are repeating \[control, busIndex] pairs. Set busIndex to -1 to unmap.

###### Parameters

| Parameter     | Type                      |
| ------------- | ------------------------- |
| `address`     | `"/n_mapa"`               |
| `nodeID`      | `number`                  |
| ...`mappings` | (`string` \| `number`)\[] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `nodeID`, ...`mappings`): `void`

Map a range of sequential controls to sequential audio buses. Mappings are repeating \[control, busIndex, count] triplets.

###### Parameters

| Parameter     | Type                      |
| ------------- | ------------------------- |
| `address`     | `"/n_mapan"`              |
| `nodeID`      | `number`                  |
| ...`mappings` | (`string` \| `number`)\[] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`args`): `void`

Create new groups. Args are repeating \[groupID, addAction, targetID] triplets. addAction: 0=head, 1=tail, 2=before, 3=after, 4=replace.

###### Parameters

| Parameter | Type                                                            |
| --------- | --------------------------------------------------------------- |
| `address` | `"/g_new"`                                                      |
| ...`args` | \[`number`, [`AddAction`](#addaction), `number`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`args`): `void`

Create new parallel groups (children evaluated in unspecified order). Same signature as /g\_new.

###### Parameters

| Parameter | Type                                                            |
| --------- | --------------------------------------------------------------- |
| `address` | `"/p_new"`                                                      |
| ...`args` | \[`number`, [`AddAction`](#addaction), `number`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`groupIDs`): `void`

Free all immediate children of one or more groups (groups themselves remain).

###### Parameters

| Parameter     | Type                       |
| ------------- | -------------------------- |
| `address`     | `"/g_freeAll"`             |
| ...`groupIDs` | \[`number`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`groupIDs`): `void`

Recursively free all synths inside one or more groups and their nested sub-groups.

###### Parameters

| Parameter     | Type                       |
| ------------- | -------------------------- |
| `address`     | `"/g_deepFree"`            |
| ...`groupIDs` | \[`number`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`pairs`): `void`

Move node to head of group. Args are repeating \[groupID, nodeID] pairs.

###### Parameters

| Parameter  | Type                                 |
| ---------- | ------------------------------------ |
| `address`  | `"/g_head"`                          |
| ...`pairs` | \[`number`, `number`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`pairs`): `void`

Move node to tail of group. Args are repeating \[groupID, nodeID] pairs.

###### Parameters

| Parameter  | Type                                 |
| ---------- | ------------------------------------ |
| `address`  | `"/g_tail"`                          |
| ...`pairs` | \[`number`, `number`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`groupFlagPairs`): `void`

Print group's node tree to debug output. Args are repeating \[groupID, flag] pairs. flag: 0=structure only, non-zero=include control values. No reply message.

###### Parameters

| Parameter           | Type                                 |
| ------------------- | ------------------------------------ |
| `address`           | `"/g_dumpTree"`                      |
| ...`groupFlagPairs` | \[`number`, `number`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`groupFlagPairs`): `void`

Query group tree structure. Args are repeating \[groupID, flag] pairs. flag: 0=structure only, non-zero=include control values. Replies with `/g_queryTree.reply`.

###### Parameters

| Parameter           | Type                                 |
| ------------------- | ------------------------------------ |
| `address`           | `"/g_queryTree"`                     |
| ...`groupFlagPairs` | \[`number`, `number`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `nodeID`, `ugenIndex`, `command`, ...`args`): `void`

Send a command to a specific UGen instance within a synth. The command name and args are UGen-specific.

###### Parameters

| Parameter   | Type                               |
| ----------- | ---------------------------------- |
| `address`   | `"/u_cmd"`                         |
| `nodeID`    | `number`                           |
| `ugenIndex` | `number`                           |
| `command`   | `string`                           |
| ...`args`   | [`OscArg`](#osc-argument-types)\[] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `bufnum`, `numFrames`, `numChannels?`, `sampleRate?`): `void`

Async. Allocate an empty buffer. Queued and rewritten to /b\_allocPtr internally. Use sync() after to ensure completion. Replies with `/done /b_allocPtr bufnum`. Note: completion messages are not supported (dropped during rewrite).

###### Parameters

| Parameter      | Type         |
| -------------- | ------------ |
| `address`      | `"/b_alloc"` |
| `bufnum`       | `number`     |
| `numFrames`    | `number`     |
| `numChannels?` | `number`     |
| `sampleRate?`  | `number`     |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `bufnum`, `path`, `startFrame?`, `numFrames?`): `void`

Async. Allocate a buffer and read an audio file into it. The path is fetched via the configured sampleBaseURL. Queued and rewritten internally. Replies with `/done /b_allocPtr bufnum`.

###### Parameters

| Parameter     | Type             |
| ------------- | ---------------- |
| `address`     | `"/b_allocRead"` |
| `bufnum`      | `number`         |
| `path`        | `string`         |
| `startFrame?` | `number`         |
| `numFrames?`  | `number`         |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `bufnum`, `path`, `startFrame`, `numFrames`, ...`channels`): `void`

Async. Allocate a buffer and read specific channels from an audio file. Queued and rewritten internally. Replies with `/done /b_allocPtr bufnum`.

###### Parameters

| Parameter     | Type                    |
| ------------- | ----------------------- |
| `address`     | `"/b_allocReadChannel"` |
| `bufnum`      | `number`                |
| `path`        | `string`                |
| `startFrame`  | `number`                |
| `numFrames`   | `number`                |
| ...`channels` | `number`\[]             |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `bufnum`, `data`): `void`

Async. SuperSonic extension: allocate a buffer from inline audio file bytes (WAV, FLAC, OGG, etc.) without URL fetch. Queued and rewritten internally. Replies with `/done /b_allocPtr bufnum`.

###### Parameters

| Parameter | Type                                             |
| --------- | ------------------------------------------------ |
| `address` | `"/b_allocFile"`                                 |
| `bufnum`  | `number`                                         |
| `data`    | `ArrayBuffer` \| `Uint8Array`<`ArrayBufferLike`> |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `bufnum`, `completionMessage?`): `void`

Async. Free a buffer. Optional completionMessage is an encoded OSC message executed after freeing. Replies with `/done /b_free bufnum`.

###### Parameters

| Parameter            | Type                                             |
| -------------------- | ------------------------------------------------ |
| `address`            | `"/b_free"`                                      |
| `bufnum`             | `number`                                         |
| `completionMessage?` | `ArrayBuffer` \| `Uint8Array`<`ArrayBufferLike`> |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `bufnum`, `completionMessage?`): `void`

Async. Zero a buffer's sample data. Optional completionMessage is an encoded OSC message executed after zeroing. Replies with `/done /b_zero bufnum`.

###### Parameters

| Parameter            | Type                                             |
| -------------------- | ------------------------------------------------ |
| `address`            | `"/b_zero"`                                      |
| `bufnum`             | `number`                                         |
| `completionMessage?` | `ArrayBuffer` \| `Uint8Array`<`ArrayBufferLike`> |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`bufnums`): `void`

Query buffer info. Replies with `/b_info` for each buffer: bufnum, numFrames, numChannels, sampleRate.

###### Parameters

| Parameter    | Type                       |
| ------------ | -------------------------- |
| `address`    | `"/b_query"`               |
| ...`bufnums` | \[`number`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `bufnum`, ...`sampleIndices`): `void`

Get individual sample values. Replies with `/b_set bufnum index value ...`.

###### Parameters

| Parameter          | Type                       |
| ------------------ | -------------------------- |
| `address`          | `"/b_get"`                 |
| `bufnum`           | `number`                   |
| ...`sampleIndices` | \[`number`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `bufnum`, ...`indexValuePairs`): `void`

Set individual buffer samples. Args are repeating \[index, value] pairs after bufnum.

###### Parameters

| Parameter            | Type        |
| -------------------- | ----------- |
| `address`            | `"/b_set"`  |
| `bufnum`             | `number`    |
| ...`indexValuePairs` | `number`\[] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `bufnum`, `startIndex`, `count`, ...`values`): `void`

Set sequential buffer samples starting at startIndex. For multiple ranges, use the catch-all overload.

###### Parameters

| Parameter    | Type        |
| ------------ | ----------- |
| `address`    | `"/b_setn"` |
| `bufnum`     | `number`    |
| `startIndex` | `number`    |
| `count`      | `number`    |
| ...`values`  | `number`\[] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `bufnum`, `startIndex`, `count`): `void`

Get sequential sample values. Replies with `/b_setn bufnum startIndex count values...`. For multiple ranges, use the catch-all overload.

###### Parameters

| Parameter    | Type        |
| ------------ | ----------- |
| `address`    | `"/b_getn"` |
| `bufnum`     | `number`    |
| `startIndex` | `number`    |
| `count`      | `number`    |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `bufnum`, `startIndex`, `count`, `value`): `void`

Fill sequential buffer samples with a single value. For multiple ranges, use the catch-all overload.

###### Parameters

| Parameter    | Type        |
| ------------ | ----------- |
| `address`    | `"/b_fill"` |
| `bufnum`     | `number`    |
| `startIndex` | `number`    |
| `count`      | `number`    |
| `value`      | `number`    |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `bufnum`, `command`, ...`args`): `void`

Async. Generate buffer contents. Commands: "sine1", "sine2", "sine3", "cheby", "copy". Flags (for sine/cheby): 1=normalize, 2=wavetable, 4=clear (OR together, e.g. 7=all). Replies with `/done /b_gen bufnum`.

###### Parameters

| Parameter | Type                               |
| --------- | ---------------------------------- |
| `address` | `"/b_gen"`                         |
| `bufnum`  | `number`                           |
| `command` | `string`                           |
| ...`args` | [`OscArg`](#osc-argument-types)\[] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`busIndexValuePairs`): `void`

Set control bus values. Args are repeating \[busIndex, value] pairs.

###### Parameters

| Parameter               | Type        |
| ----------------------- | ----------- |
| `address`               | `"/c_set"`  |
| ...`busIndexValuePairs` | `number`\[] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`busIndices`): `void`

Get control bus values. Replies with `/c_set index value ...`.

###### Parameters

| Parameter       | Type                       |
| --------------- | -------------------------- |
| `address`       | `"/c_get"`                 |
| ...`busIndices` | \[`number`, `...number[]`] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `startIndex`, `count`, ...`values`): `void`

Set sequential control bus values starting at startIndex. For multiple ranges, use the catch-all overload.

###### Parameters

| Parameter    | Type        |
| ------------ | ----------- |
| `address`    | `"/c_setn"` |
| `startIndex` | `number`    |
| `count`      | `number`    |
| ...`values`  | `number`\[] |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `startIndex`, `count`): `void`

Get sequential control bus values. Replies with `/c_setn startIndex count values...`. For multiple ranges, use the catch-all overload.

###### Parameters

| Parameter    | Type        |
| ------------ | ----------- |
| `address`    | `"/c_getn"` |
| `startIndex` | `number`    |
| `count`      | `number`    |

###### Returns

`void`

###### Call Signature

> **send**(`address`, `startIndex`, `count`, `value`): `void`

Fill sequential control buses with a single value. For multiple ranges, use the catch-all overload.

###### Parameters

| Parameter    | Type        |
| ------------ | ----------- |
| `address`    | `"/c_fill"` |
| `startIndex` | `number`    |
| `count`      | `number`    |
| `value`      | `number`    |

###### Returns

`void`

###### Call Signature

> **send**(`address`, ...`args`): `void`

Send an OSC message to the engine.

This is the primary way to communicate with the engine. Arguments are
automatically encoded to OSC format. The typed overloads cover scsynth's
commands; this one takes any other address, and the multi-range forms of
commands like `/n_setn`, `/b_fill` and `/c_getn`.

Sent at once, except buffer allocation (`/b_alloc`, `/b_allocRead`,
`/b_allocReadChannel`, `/b_allocFile`): those are queued, in the order
written, while their material is fetched and decoded, then reach the
engine as `/b_allocPtr`. A queued command that fails is reported on
`'error'`. [sync](#sync) waits for the queue before its barrier.

Nothing is refused here: a command the browser cannot serve (a file-path
load, a file write) gets the engine's own `/fail`. A `/d_recv`, `/d_free`
or `/d_freeAll` sent this way also updates [loadedSynthDefs](#loadedsynthdefs).

###### Parameters

| Parameter | Type                               | Description                                       |
| --------- | ---------------------------------- | ------------------------------------------------- |
| `address` | `string`                           | OSC address pattern (e.g. `'/s_new'`, `'/n_set'`) |
| ...`args` | [`OscArg`](#osc-argument-types)\[] | Message arguments                                 |

###### Returns

`void`

###### Throws

If the engine is not initialised

###### Throws

If a buffer allocation command is malformed (checked before it is queued)

###### Throws

If the message is larger than the IN ring

###### Example

```ts
// Create a synth
sonic.send('/s_new', 'beep', 1001, 0, 0, 'freq', 440);

// Set a control
sonic.send('/n_set', 1001, 'freq', 880);

// Free a synth
sonic.send('/n_free', 1001);

// Send a synthdef as raw bytes
sonic.send('/d_recv', synthdefBytes);

// Buffer commands are queued; sync() waits for them, then for the engine:
sonic.send('/b_alloc', 0, 44100, 1);
await sonic.sync();
```

***

#### OSC Argument Types

OSC argument types that can be sent in a message.

Plain JS values are mapped to OSC types automatically:

* `number` (integer) → `i` (int32)
* `number` (float) → `f` (float32)
* `string` → `s`
* `boolean` → `T` / `F`
* `Uint8Array` / `ArrayBuffer` → `b` (blob)
* an array → an OSC array (`[` … `]`)

For 64-bit, timetag or UUID types, use the tagged object form:

```ts
{ type: 'int', value: 42 }
{ type: 'float', value: 440 }     // force float32 for whole numbers
{ type: 'string', value: 'hello' }
{ type: 'blob', value: new Uint8Array([1,2,3]) }
{ type: 'bool', value: true }
{ type: 'int64', value: 9007199254740992n }
{ type: 'double', value: 3.141592653589793 }
{ type: 'timetag', value: ntpTimestamp }
{ type: 'uuid', value: uuidBytes } // 16 bytes, OSC tag `u`
```

##### sendOSC()

> **sendOSC**(`oscData`): `void`

Send pre-encoded OSC bytes to the engine.

Use this when you've already encoded the message (e.g. via `SuperSonic.osc.encodeMessage`)
or when sending from a worker that produces raw OSC. Sends bytes as-is without
rewriting — buffer allocation commands (`/b_alloc*`) are not transformed.
Use [send](#send-1) for buffer commands so they are handled correctly. A
`/d_recv` sent this way is not recorded in [loadedSynthDefs](#loadedsynthdefs), so it
is not restored after a reload.

###### Parameters

| Parameter | Type                                             | Description                         |
| --------- | ------------------------------------------------ | ----------------------------------- |
| `oscData` | `ArrayBuffer` \| `Uint8Array`<`ArrayBufferLike`> | Encoded OSC message or bundle bytes |

###### Returns

`void`

###### Throws

If the engine is not initialised

###### Throws

If the message exceeds the IN ring size

###### Example

```ts
const msg = SuperSonic.osc.encodeMessage('/n_set', [1001, 'freq', 880]);
sonic.sendOSC(msg);
```

##### setClockOffset()

> **setClockOffset**(`offsetS`): `void`

Set clock offset for multi-system sync (e.g. against an NTP server).

Shifts all scheduled bundle execution times by the specified offset.
Positive values mean the shared/server clock is ahead of local time.

###### Parameters

| Parameter | Type     | Description                                           |
| --------- | -------- | ----------------------------------------------------- |
| `offsetS` | `number` | Offset in seconds (stored rounded to the millisecond) |

###### Returns

`void`

###### Throws

If the engine is not initialised

##### shutdown()

> **shutdown**(): `Promise`<`void`>

Shut down the engine. The instance can be re-initialised with [init](#init).

Terminates workers and releases memory, and closes the AudioContext if
SuperSonic made it (one passed as the `audioContext` option is left open).
Forgets the loaded synthdefs and buffers. Emits `'shutdown'` when the
engine was running or booting.

###### Returns

`Promise`<`void`>

##### startCapture()

> **startCapture**(): `void`

Start capturing what the engine sends to the audio device. SAB mode only.

###### Returns

`void`

###### Throws

If the engine is not initialised, or not in SAB mode

##### stopCapture()

> **stopCapture**(): `object`

Stop capturing and return what was captured. A capture longer than the
ring ([getMaxCaptureDuration](#getmaxcaptureduration)) keeps the newest ring's worth.

###### Returns

| Name          | Type                                 | Description                                      |
| ------------- | ------------------------------------ | ------------------------------------------------ |
| `channelData` | `Float32Array`<`ArrayBufferLike`>\[] | One array per channel.                           |
| `channels`    | `number`                             | -                                                |
| `frames`      | `number`                             | -                                                |
| `left`        | `Float32Array`                       | The first channel.                               |
| `lost`        | `number`                             | Frames the ring overwrote before they were read. |
| `right`       | `Float32Array`<`ArrayBufferLike`>    | The second channel, or null.                     |
| `sampleRate`  | `number`                             | -                                                |

###### Throws

If the engine is not initialised, or not in SAB mode

##### suspend()

> **suspend**(): `Promise`<`void`>

Suspend the AudioContext and stop the drift timer.

The worklet remains loaded but audio processing stops.
Use [resume](#resume) or [recover](#recover) to restart.

###### Returns

`Promise`<`void`>

##### sync()

> **sync**(`syncId?`, `timeoutMs?`): `Promise`<`void`>

A barrier: resolves once everything sent before it has reached the engine, in order.

Waits for the buffer commands [send](#send-1) has queued, then sends
`/clockwork/sync` and waits for the matching `/clockwork/synced`, which the
audio thread answers when it reaches the message. (Not scsynth's `/sync`:
send that yourself, or use [request](#request), for scsynth's own barrier.)
In postMessage mode it then waits two snapshot intervals, so metrics and
the node tree have caught up. Use after loading synthdefs or buffers,
before creating synths that use them.

###### Parameters

| Parameter    | Type     | Description                                     |
| ------------ | -------- | ----------------------------------------------- |
| `syncId?`    | `number` | Optional custom sync ID (random if omitted)     |
| `timeoutMs?` | `number` | How long to wait for the answer (default 10000) |

###### Returns

`Promise`<`void`>

###### Throws

Rejects on the timeout, or if the engine shuts down first.

###### Example

```ts
await sonic.loadSynthDef('beep');
await sonic.sync();
sonic.send('/s_new', 'beep', 1001, 0, 0);
```

##### getMetricsSchema()

> `static` **getMetricsSchema**(): [`MetricsSchema`](#metricsschema)

Get the metrics schema describing all available metrics.

Includes array offsets for zero-allocation reading via [getMetricsArray](#getmetricsarray),
metric types/units/descriptions, and a declarative UI layout used by the
`<clockwork-metrics>` web component.

See docs/METRICS\_COMPONENT.md for the metrics component guide.

###### Returns

[`MetricsSchema`](#metricsschema)

##### getRawTreeSchema()

> `static` **getRawTreeSchema**(): `Record`<`string`, `unknown`>

Get schema describing the raw flat node tree structure.

###### Returns

`Record`<`string`, `unknown`>

##### getScopeSchema()

> `static` **getScopeSchema**(): `object`

Scope geometry: slot count, per-slot ring frames, channels. These are the
web build's compiled-in defaults, not read from the running engine.

###### Returns

`object`

| Name         | Type     |
| ------------ | -------- |
| `channels`   | `number` |
| `maxScopes`  | `number` |
| `ringFrames` | `number` |

##### getTreeSchema()

> `static` **getTreeSchema**(): `Record`<`string`, `unknown`>

Get schema describing the hierarchical node tree structure.

###### Returns

`Record`<`string`, `unknown`>

***

### OscChannel

OscChannel — unified dispatch for sending OSC to the AudioWorklet.

Obtain a channel via [SuperSonic.createOscChannel](#createoscchannel) on the main thread,
then transfer it to a Web Worker for direct communication with the AudioWorklet.

| Member                                        | Description                                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`mode`](#mode)                               | Transport mode this channel is using.                                                                                                                       |
| [`transferable`](#transferable)               | Serializable config for transferring this channel to a worker via postMessage.                                                                              |
| [`transferList`](#transferlist)               | Array of transferable objects (MessagePorts) for the postMessage transfer list.                                                                             |
| [`close()`](#close)                           | Close the channel.                                                                                                                                          |
| [`getAndResetMetrics()`](#getandresetmetrics) | Get and reset this channel's local counters (for periodic reporting).                                                                                       |
| [`getMetrics()`](#getmetrics)                 | Get current metrics.                                                                                                                                        |
| [`nextNodeId()`](#nextnodeid)                 | Get the next unique node ID.                                                                                                                                |
| [`now()`](#now)                               | The engine's clock, in NTP seconds: the time its audio thread has reached, readable on any thread the channel is on — a worker cannot see the AudioContext. |
| [`send()`](#send)                             | Send an OSC message: frames it onto the IN ring (SAB) or postMessages it to the worklet (PM).                                                               |
| [`fromTransferable()`](#fromtransferable)     | Reconstruct an OscChannel from data received via postMessage in a worker.                                                                                   |

#### Example

```ts
// Main thread: create and transfer to worker
const channel = sonic.createOscChannel();
myWorker.postMessage(
  { channel: channel.transferable },
  channel.transferList,
);

// Inside worker: reconstruct and send
import { OscChannel } from 'supersonic-scsynth/osc-channel';
const channel = await OscChannel.fromTransferable(event.data.channel);
channel.send(oscBytes);
```

***

#### Constructors

##### Constructor

> **new OscChannel**(): [`OscChannel`](#oscchannel)

###### Returns

[`OscChannel`](#oscchannel)

***

#### Accessors

##### mode

###### Get Signature

> **get** **mode**(): [`TransportMode`](#transportmode)

Transport mode this channel is using.

###### Returns

[`TransportMode`](#transportmode)

##### transferable

###### Get Signature

> **get** **transferable**(): [`OscChannelTransferable`](#oscchanneltransferable-1)

Serializable config for transferring this channel to a worker via postMessage.
In postMessage mode each read hands out a fresh range of node IDs and a port
for more, so read it once per transfer.

###### Example

```ts
worker.postMessage({ ch: channel.transferable }, channel.transferList);
```

###### Returns

[`OscChannelTransferable`](#oscchanneltransferable-1)

##### transferList

###### Get Signature

> **get** **transferList**(): `Transferable`\[]

Array of transferable objects (MessagePorts) for the postMessage transfer list.
Read it after [transferable](#transferable).

###### Example

```ts
worker.postMessage({ ch: channel.transferable }, channel.transferList);
```

###### Returns

`Transferable`\[]

***

#### Methods

##### close()

> **close**(): `void`

Close the channel. In postMessage mode this closes its port; in SAB mode it does nothing.

###### Returns

`void`

##### getAndResetMetrics()

> **getAndResetMetrics**(): [`OscChannelMetrics`](#oscchannelmetrics)

Get and reset this channel's local counters (for periodic reporting).

###### Returns

[`OscChannelMetrics`](#oscchannelmetrics)

##### getMetrics()

> **getMetrics**(): [`OscChannelMetrics`](#oscchannelmetrics)

Get current metrics. In SAB mode these are the shared totals for every sender; in postMessage mode, this channel's own.

###### Returns

[`OscChannelMetrics`](#oscchannelmetrics)

##### nextNodeId()

> **nextNodeId**(): `number`

Get the next unique node ID.

Thread-safe — can be called concurrently from multiple workers and no
two callers will ever receive the same ID. IDs start at 1000: 0 is the
root group and 1–999 are left for the client to assign by hand.

In postMessage mode a worker's channel takes IDs in ranges from the main
thread, asking for the next range before it needs it; it throws if a
tight loop uses a range up before the next has arrived.

###### Returns

`number`

A unique node ID (>= 1000)

##### now()

> **now**(): `number`

The engine's clock, in NTP seconds: the time its audio thread has reached, readable on any thread the channel is
on — a worker cannot see the AudioContext. The clock bundles are stamped on ([SuperSonic.clock](#clock)'s now()),
taken from the audio thread itself once a block: it stands still while the audio does (suspended, interrupted),
and after a reload it is the new engine's from its first block. 0 until the engine has rendered one.

SAB mode reads the sample clock the audio thread publishes into shared memory; postMessage mode hears it from the
audio thread every few blocks and counts on from the last word by the wall clock, a tenth of a second at most.

###### Returns

`number`

NTP seconds, or 0

###### Example

```ts
// Inside a worker: schedule half a second ahead on the engine's own clock
channel.send(osc.encodeBundle(channel.now() + 0.5, [["/s_new", "beep", -1, 0, 0]]));
```

##### send()

> **send**(`oscData`): `boolean`

Send an OSC message: frames it onto the IN ring (SAB) or postMessages it to
the worklet (PM). Classification and scheduling happen on the audio thread
(the engine's OscIngress + BundleScheduler) — the producer never classifies.

###### Parameters

| Parameter | Type         | Description       |
| --------- | ------------ | ----------------- |
| `oscData` | `Uint8Array` | Encoded OSC bytes |

###### Returns

`boolean`

true if sent; false if the IN ring had no room (SAB, counted as
`ringBufferDirectWriteFails`) or the channel is closed (PM)

##### fromTransferable()

> `static` **fromTransferable**(`data`): `Promise`<[`OscChannel`](#oscchannel)>

Reconstruct an OscChannel from data received via postMessage in a worker.
Asynchronous: in SAB mode the worker opens its own instance of the engine
module over the shared memory.

###### Parameters

| Parameter | Type                                                  | Description                                         |
| --------- | ----------------------------------------------------- | --------------------------------------------------- |
| `data`    | [`OscChannelTransferable`](#oscchanneltransferable-1) | The transferable config from `channel.transferable` |

###### Returns

`Promise`<[`OscChannel`](#oscchannel)>

###### Example

```ts
// In a Web Worker:
self.onmessage = async (e) => {
  const channel = await OscChannel.fromTransferable(e.data.ch);
  channel.send(oscBytes);
};
```

---

## Support + License

- [GitHub](https://github.com/samaaron/supersonic) — source, issues, discussions
- [npm](https://www.npmjs.com/package/supersonic-scsynth) — package registry
- License: **MIT** (main library) / **GPL-3.0** (WASM/AudioWorklet core)
