import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

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
    AudioWorkletProcessor: class {}, registerProcessor: (_, processor) => { Processor = processor; },
  });
  const processor = Object.create(Processor.prototype);
  Object.assign(processor, { synth: 1, leftPointer: 4, rightPointer: 8, sysexPointer: 12, handledPointer: 16,
    midiQueue: [{ frame: 128 }], port: { close: vi.fn() },
    module: { _ps_destroy: vi.fn(), _free: vi.fn() } });
  processor.handleMessage({ type: "dispose" });
  processor.handleMessage({ type: "dispose" });
  expect(processor.module._ps_destroy).toHaveBeenCalledExactlyOnceWith(1);
  expect(processor.module._free.mock.calls.flat()).toEqual([4, 8, 12, 16]);
  expect(processor.midiQueue).toEqual([]);
  expect(processor.port.close).toHaveBeenCalledOnce();
  expect(processor.process([], [])).toBe(false);
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
  expect(processor.port.postMessage).toHaveBeenCalledWith({ type: "touch-rendered", id: 9,
    lateFrames: 64, sampleRate: 48000, audioTime: 128 / 48000 });
  processor.port.postMessage.mockClear();
  processor.module._ps_render.mockReturnValue(-1);
  processor.handleMessage({ type: "midi-batch", events: [
    { frame: 64, touchTrace: 10, command: { channel: 0, op: "on", a: 60, b: 80 } },
  ] });
  processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
  expect(processor.port.postMessage).not.toHaveBeenCalled();
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
