import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it("discards old-bank events and restores reverb before acknowledging SoundFont replacement", () => {
  let Processor;
  runInNewContext(readFileSync("vendor/fluidsynth/processor.js", "utf8").replace(/^import[^\n]*\n/, ""), {
    sampleRate: 48000, AudioWorkletProcessor: class {},
    registerProcessor: (_, processor) => { Processor = processor; },
  });
  const processor = Object.create(Processor.prototype);
  const cc = vi.fn();
  Object.assign(processor, { synth: 1, soundfontId: 1, reverbSend: 100,
    midiQueue: [{ frame: 999999, command: { channel: 0, op: "cc", a: 91, b: 127 } }],
    heldKeys: new Map([[0, new Set([60])]]), usedChannels: new Set([0]),
    readPresets: () => [{ bank: 0, program: 0, name: "Organ" }],
    module: { _ps_destroy: vi.fn(), _ps_create: () => 2, _ps_activate_tuning: () => 0,
      _ps_select_program: () => 0, _ps_load_soundfont: () => 3, _ps_cc: cc,
      stringToNewUTF8: () => 4, _free: vi.fn(), FS: { unlink: vi.fn(), writeFile: vi.fn() } },
    port: { postMessage: vi.fn(message => {
      if (message.type === "soundfont-loaded") {
        expect(cc).toHaveBeenCalledTimes(128);
        expect(cc).toHaveBeenLastCalledWith(2, 127, 91, 0);
      }
    }) } });
  processor.handleMessage({ type: "replace-soundfont", bytes: new ArrayBuffer(8), reverbSend: 0 });
  expect(processor.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "soundfont-loaded" }));
  expect(processor.midiQueue).toEqual([]);
  expect(processor.heldKeys.size).toBe(0);
  expect(processor.usedChannels.size).toBe(0);
  processor.handleMessage({ type: "set-reverb", value: 23 });
  expect(cc).toHaveBeenLastCalledWith(2, 127, 91, 23);
  expect(processor.reverbSend).toBe(23);
});

it("provides an elapsed clock only when the worklet has no Performance API", () => {
  const source = readFileSync("vendor/fluidsynth/processor.js", "utf8").replace(/^import[^\n]*\n/, "");
  let wallTime = 1000;
  const scope = { Date: { now: () => wallTime }, AudioWorkletProcessor: class {}, registerProcessor() {} };
  runInNewContext(source, scope);
  expect(scope.performance.now()).toBe(0);
  wallTime = 1050;
  expect(scope.performance.now()).toBe(50);
  wallTime = 900;
  expect(scope.performance.now()).toBe(50);
  const nativeClock = { now: vi.fn(() => 123) };
  const nativeScope = { ...scope, performance: nativeClock };
  runInNewContext(source, nativeScope);
  expect(nativeScope.performance).toBe(nativeClock);
});

it("applies independent bounded smoothing times and retains them for synth recreation", () => {
  let Processor;
  runInNewContext(readFileSync("vendor/fluidsynth/processor.js", "utf8").replace(/^import[^\n]*\n/, ""), {
    AudioWorkletProcessor: class {}, registerProcessor: (_, processor) => { Processor = processor; },
  });
  const processor = Object.create(Processor.prototype);
  Object.assign(processor, { synth: 1, module: { _ps_set_smoothing: vi.fn(() => 0) },
    port: { postMessage: vi.fn() } });
  processor.handleMessage({ type: "set-smoothing", pressureMs: 600, expressionMs: 25 });
  expect(processor.module._ps_set_smoothing).not.toHaveBeenCalled();
  processor.applySmoothing();
  expect(processor.module._ps_set_smoothing).toHaveBeenLastCalledWith(1, 500, 25, 0);
  processor.synth = 2;
  processor.applySmoothing();
  expect(processor.module._ps_set_smoothing).toHaveBeenLastCalledWith(2, 500, 25, 0);
  processor.handleMessage({ type: "set-smoothing", pressureMs: 0, expressionMs: NaN });
  processor.applySmoothing();
  expect(processor.module._ps_set_smoothing).toHaveBeenLastCalledWith(2, 0, 0, 0);
  expect(processor.port.postMessage).not.toHaveBeenCalled();
});

it("coalesces rapid and idle-backlogged smoothing updates without skipping audio rendering", () => {
  let Processor;
  const scope = { sampleRate: 48000, currentFrame: 0, AudioWorkletProcessor: class {},
    registerProcessor: (_, processor) => { Processor = processor; } };
  runInNewContext(readFileSync("vendor/fluidsynth/processor.js", "utf8").replace(/^import[^\n]*\n/, ""), scope);
  const processor = Object.create(Processor.prototype);
  Object.assign(processor, { synth: 1, blockSize: 128, leftPointer: 0, rightPointer: 512,
    midiQueue: [], port: { postMessage: vi.fn() }, module: {
      _ps_set_smoothing: vi.fn(() => 0), _ps_render: vi.fn(() => 0), HEAPF32: new Float32Array(256),
    } });
  const outputs = [[new Float32Array(128), new Float32Array(128)]];
  for (let i = 0; i < 1000; i++) processor.handleMessage({ type: "set-smoothing", pressureMs: i % 251, expressionMs: 40 });
  expect(processor.module._ps_set_smoothing).not.toHaveBeenCalled();
  processor.process([], outputs);
  expect(processor.module._ps_set_smoothing).toHaveBeenCalledExactlyOnceWith(1, 246, 40, 0);
  for (let i = 1; i < 13; i++) {
    scope.currentFrame = i * 128;
    processor.handleMessage({ type: "set-smoothing", pressureMs: i, expressionMs: 40 });
    processor.process([], outputs);
  }
  expect(processor.module._ps_set_smoothing).toHaveBeenCalledTimes(1);
  // A long-idle return applies the latest value, without replaying the drag.
  scope.currentFrame = 48000 * 3600;
  processor.handleMessage({ type: "set-smoothing", pressureMs: 0, expressionMs: 40 });
  processor.process([], outputs);
  expect(processor.module._ps_set_smoothing).toHaveBeenLastCalledWith(1, 0, 40, 0);
  expect(processor.module._ps_set_smoothing).toHaveBeenCalledTimes(2);
  expect(processor.module._ps_render).toHaveBeenCalledTimes(14);
  // Configuration errors are reported while rendering continues.
  scope.currentFrame += 48000;
  processor.module._ps_set_smoothing.mockImplementationOnce(() => { throw new Error("control failed"); });
  processor.handleMessage({ type: "set-smoothing", pressureMs: 20, expressionMs: 40 });
  expect(processor.process([], outputs)).toBe(true);
  expect(processor.module._ps_render).toHaveBeenCalledTimes(15);
  expect(processor.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
});

it("naturally releases all channels and waits for rendered silence before shutdown acknowledgement", () => {
  let Processor;
  runInNewContext(readFileSync("vendor/fluidsynth/processor.js", "utf8").replace(/^import[^\n]*\n/, ""), {
    sampleRate: 512, currentFrame: 0, AudioWorkletProcessor: class {},
    registerProcessor: (_, processor) => { Processor = processor; },
  });
  const processor = Object.create(Processor.prototype);
  const heap = new Float32Array(256);
  heap.fill(0.1);
  Object.assign(processor, { synth: 1, blockSize: 128, leftPointer: 0, rightPointer: 512,
    heldKeys: new Map([[127, new Set([127])]]), usedChannels: new Set([127]),
    midiQueue: [{ frame: 0 }], port: { postMessage: vi.fn() },
    module: { _ps_cc: vi.fn(), _ps_note_off: vi.fn(), _ps_render: vi.fn(() => 0), HEAPF32: heap } });
  processor.handleMessage({ type: "release-for-shutdown" });
  expect(processor.midiQueue).toEqual([]);
  expect(processor.module._ps_cc).toHaveBeenCalledWith(1, 127, 66, 0);
  expect(processor.module._ps_cc).toHaveBeenCalledTimes(2);
  expect(processor.module._ps_note_off).toHaveBeenCalledWith(1, 127, 127);
  expect(processor.module._ps_note_off).toHaveBeenCalledOnce();
  expect(processor.module._ps_cc.mock.calls.some(call => call[2] === 120)).toBe(false);
  const outputs = [[new Float32Array(128), new Float32Array(128)]];
  processor.process([], outputs);
  expect(processor.port.postMessage).not.toHaveBeenCalled();
  heap.fill(0);
  processor.process([], outputs);
  expect(processor.port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "release-complete" });
});

it("disposes the synth and render buffers and stops audio processing", () => {
  let Processor;
  runInNewContext(readFileSync("vendor/fluidsynth/processor.js", "utf8").replace(/^import[^\n]*\n/, ""), {
    currentFrame: 128, AudioWorkletProcessor: class {}, registerProcessor: (_, processor) => { Processor = processor; },
  });
  const processor = Object.create(Processor.prototype);
  Object.assign(processor, { synth: 1, leftPointer: 4, rightPointer: 8, sysexPointer: 12, handledPointer: 16,
    midiQueue: [{ frame: 128 }], port: { close: vi.fn(), postMessage: vi.fn() },
    module: { _ps_destroy: vi.fn(), _free: vi.fn() } });
  const module = processor.module;
  module.HEAPU8 = new Uint8Array(1024);
  module.FS = { unlink: vi.fn() };
  processor.soundfontFileBytes = 512;
  processor.handleMessage({ type: "dispose" });
  processor.handleMessage({ type: "dispose" });
  expect(module._ps_destroy).toHaveBeenCalledExactlyOnceWith(1);
  expect(module._free.mock.calls.flat()).toEqual([4, 8, 12, 16]);
  expect(module.FS.unlink).toHaveBeenCalledExactlyOnceWith("/hexatone-soundfont.sf2");
  expect(processor.module).toBeNull();
  expect(processor.midiQueue).toEqual([]);
  expect(processor.port.postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    type: "processor-disposed", frame: 128, memory: expect.objectContaining({
      before: { wasmHeapCapacityBytes: 1024, soundfontFileBytes: 512 },
      afterFree: { wasmHeapCapacityBytes: 1024, soundfontFileBytes: 0 },
      moduleReferenceReleased: true, soundfontFileRemoved: true,
    }),
  }));
  expect(processor.process([], [])).toBe(false);
  expect(processor.port.postMessage).toHaveBeenLastCalledWith({ type: "processing-stopped", frame: 128 });
  expect(processor.port.close).toHaveBeenCalledOnce();
});

it("acknowledges traced attacks only after a successful render block", () => {
  let Processor;
  runInNewContext(readFileSync("vendor/fluidsynth/processor.js", "utf8").replace(/^import[^\n]*\n/, ""), {
    currentFrame: 128, sampleRate: 48000, AudioWorkletProcessor: class {},
    registerProcessor: (_, processor) => { Processor = processor; },
  });
  const processor = Object.create(Processor.prototype);
  Object.assign(processor, { synth: 1, blockSize: 128, leftPointer: 0, rightPointer: 512,
    port: { postMessage: vi.fn() }, module: { _ps_render: vi.fn(() => 0),
      _ps_note_on: vi.fn(), HEAPF32: new Float32Array(256) },
    midiQueue: [], midiSequence: 0 });
  processor.handleMessage({ type: "midi-batch", events: [
    { frame: 64, touchTrace: 9, command: { channel: 0, op: "on", a: 60, b: 80 } },
  ] });
  expect(processor.midiQueue[0].touchTrace).toBe(9);
  processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
  expect(processor.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "touch-rendered", id: 9,
    lateFrames: 64, sampleRate: 48000, audioTime: 128 / 48000, renderedAtEpochMs: expect.any(Number) }));
  processor.port.postMessage.mockClear();
  processor.module._ps_render.mockReturnValue(-1);
  processor.handleMessage({ type: "midi-batch", events: [
    { frame: 64, touchTrace: 10, command: { channel: 0, op: "on", a: 60, b: 80 } },
  ] });
  processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
  expect(processor.port.postMessage).not.toHaveBeenCalled();
});

it("observes first non-silent output only for traced attacks from silence", () => {
  let Processor;
  const scope = { currentFrame: 0, sampleRate: 48000, Date: { now: () => 5000 },
    AudioWorkletProcessor: class {}, registerProcessor: (_, processor) => { Processor = processor; } };
  runInNewContext(readFileSync("vendor/fluidsynth/processor.js", "utf8").replace(/^import[^\n]*\n/, ""), scope);
  const processor = Object.create(Processor.prototype);
  const heap = new Float32Array(256);
  const postMessage = vi.fn();
  Object.assign(processor, { synth: 1, blockSize: 128, leftPointer: 0, rightPointer: 512,
    port: { postMessage }, module: { _ps_render: () => 0, _ps_note_on: vi.fn(), HEAPF32: heap },
    midiQueue: [], midiSequence: 0 });
  processor.handleMessage({ type: "latency-diagnostics", enabled: true });
  const render = () => {
    processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
    scope.currentFrame += 128;
  };
  for (let i = 0; i < 8; i++) render();
  processor.handleMessage({ type: "midi-batch", events: [
    { frame: scope.currentFrame, touchTrace: 31, command: { channel: 0, op: "on", a: 60, b: 80 } },
  ] });
  render();
  expect(postMessage.mock.calls.some(([message]) => message.type === "touch-first-signal")).toBe(false);
  heap[4] = 0.1;
  render();
  expect(postMessage).toHaveBeenCalledWith({ type: "touch-first-signal", id: 31,
    renderedAtEpochMs: 5000, audioTime: (1152 + 4) / 48000, threshold: 0.00001 });
  postMessage.mockClear();
  processor.handleMessage({ type: "midi-batch", events: [
    { frame: scope.currentFrame, touchTrace: 32, command: { channel: 0, op: "on", a: 61, b: 80 } },
  ] });
  render(); // Already sounding output cannot identify the new note's onset.
  expect(postMessage.mock.calls.some(([message]) => message.type === "touch-first-signal")).toBe(false);
  processor.handleMessage({ type: "latency-diagnostics", enabled: false });
  expect(processor.diagnosticOnsets).toEqual([]);
  expect(processor.diagnosticSilentFrames).toBe(0);
});

it("preserves equal-frame setup order and cancels only the requested sequence generation", () => {
  let Processor;
  const source = readFileSync("vendor/fluidsynth/processor.js", "utf8");
  runInNewContext(source.replace(/^import[^\n]*\n/, ""), {
    currentFrame: 0, AudioWorkletProcessor: class {},
    registerProcessor: (_, processor) => { Processor = processor; },
  });
  const processor = Object.create(Processor.prototype);
  processor.module = {}; processor.synth = 1; processor.midiQueue = []; processor.midiSequence = 0;
  processor.handleMessage({ type: "midi-batch", events: ["off", "reset", "tune", "pressure", "on"]
    .map(op => ({ frame: 128, command: { op }, owner: 1, scope: "sequence", generation: 0 })) });
  expect(processor.midiQueue.map(e => e.command.op)).toEqual(["off", "reset", "tune", "pressure", "on"]);
  processor.handleMessage({ type: "midi-batch", events: [
    { frame: 128, owner: 1, scope: "live", generation: 0 },
    { frame: 256, owner: 1, scope: "sequence", generation: 1 },
  ] });
  processor.handleMessage({ type: "cancel-owner-events", owner: 1, scope: "sequence", generation: 0 });
  expect(processor.midiQueue.map(e => [e.scope, e.generation])).toEqual([["sequence", 0], ["live", 0], ["sequence", 1]]);
  expect(processor.midiQueue[0].command.op).toBe("off");
});

it("cancels only the obsolete output graph's queued MIDI", () => {
  let Processor;
  const source = readFileSync("vendor/fluidsynth/processor.js", "utf8");
  runInNewContext(source.replace(/^import[^\n]*\n/, ""), {
    AudioWorkletProcessor: class {}, registerProcessor: (_, processor) => { Processor = processor; },
  });
  const processor = Object.create(Processor.prototype);
  processor.module = {}; processor.synth = 1;
  processor.midiQueue = [{ owner: 1, frame: 100 }, { owner: 2, frame: 200 }];
  processor.handleMessage({ type: "cancel-owner-events", owner: 1 });
  expect(processor.midiQueue).toEqual([{ owner: 2, frame: 200 }]);
});

it("clears queued worklet MIDI and silences channels before acknowledging recovery", () => {
  let Processor;
  const source = readFileSync("vendor/fluidsynth/processor.js", "utf8");
  runInNewContext(source.replace(/^import[^\n]*\n/, ""), {
    AudioWorkletProcessor: class {},
    registerProcessor: (_, processor) => { Processor = processor; },
  });
  const processor = Object.create(Processor.prototype);
  processor.module = { _ps_cc: vi.fn() };
  processor.synth = 1;
  processor.midiQueue = [{ frame: 100 }, { frame: 200 }];
  processor.port = { postMessage: vi.fn() };
  processor.handleMessage({ type: "clear-recovery-events" });
  expect(processor.midiQueue).toHaveLength(0);
  expect(processor.module._ps_cc).toHaveBeenCalledTimes(128);
  expect(processor.module._ps_cc).toHaveBeenLastCalledWith(1, 127, 120, 0);
  expect(processor.port.postMessage).toHaveBeenCalledWith({ type: "recovery-cleared", droppedEvents: 2 });
});
