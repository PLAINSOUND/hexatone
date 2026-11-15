import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

it("assigns the first 128 internal channels independent matching tuning maps", () => {
  let Processor;
  runInNewContext(readFileSync("vendor/fluidsynth/processor.js", "utf8").replace(/^import .*\n/, ""), {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } },
    registerProcessor: (_name, implementation) => { Processor = implementation; },
    createFluidSynth: () => new Promise(() => {}), sampleRate: 48000,
  });
  const processor = new Processor({ processorOptions: { wasmBytes: null } });
  const calls = [];
  processor.synth = 42;
  processor.module = { _ps_activate_tuning: (...args) => { calls.push(args); return 0; } };
  processor.initializeChannelTunings();
  expect(calls).toEqual(Array.from({ length: 128 }, (_, channel) => [42, channel, 0, channel, 0]));
});

it("generates the audio test on the render thread without live MIDI or diagnostics", () => {
  let Processor;
  const calls = [];
  const context = {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } },
    registerProcessor: (_name, implementation) => { Processor = implementation; },
    createFluidSynth: () => new Promise(() => {}),
    sampleRate: 48000, currentFrame: 0, currentTime: 0,
  };
  runInNewContext(readFileSync("vendor/fluidsynth/processor.js", "utf8").replace(/^import .*\n/, ""), context);
  const processor = new Processor({ processorOptions: { wasmBytes: null } });
  processor.synth = 1;
  processor.module = {
    HEAPF32: new Float32Array(256), _ps_cc() {},
    HEAPU8: new Uint8Array(8192), HEAP32: new Int32Array(1),
    _ps_sysex: () => calls.push(["mts"]),
    _ps_pitch_bend: (_synth, _channel, value) => calls.push(["bend", value]),
    _ps_note_on: (_synth, _channel, note) => calls.push(["on", note]),
    _ps_note_off: (_synth, _channel, note) => calls.push(["off", note]),
    _ps_render: () => 0,
  };
  processor.leftPointer = 0;
  processor.rightPointer = 512;
  processor.sysexPointer = 0;
  processor.handledPointer = 0;
  processor.handleMessage({ type: "audio-test", enabled: true });
  processor.handleMessage({ type: "midi", data: [0x90, 99, 72] });
  expect(processor.midiQueue).toHaveLength(0);
  const outputs = [[new Float32Array(128), new Float32Array(128)]];
  for (let frame = 0; frame <= 48000 * 30; frame += 128) {
    context.currentFrame = frame;
    processor.process([], outputs);
  }
  const noteOns = calls.filter(call => call[0] === "on");
  expect(noteOns).toHaveLength(720);
  expect(calls.filter(call => call[0] === "mts")).toHaveLength(745);
  expect(calls.filter(call => call[0] === "bend").some(([, value]) => value !== 8192)).toBe(true);
  expect(noteOns.every(([, note]) => note >= 48 && note <= 72)).toBe(true);
  expect(new Set(noteOns.map(([, note]) => note)).size).toBeGreaterThan(1);
  expect(calls.filter(call => call[0] === "off").slice(0, 720).map(([, note]) => note))
    .toEqual(noteOns.map(([, note]) => note));
  expect(processor.audioTest).toBeNull();
  expect(processor.diagnostics).toBe(false);
});

it("collects FluidSynth render counters only while diagnostics are enabled", () => {
  const messages = [];
  let Processor;
  const source = readFileSync("vendor/fluidsynth/processor.js", "utf8").replace(/^import .*\n/, "");
  runInNewContext(source, {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: data => messages.push(data) }; } },
    registerProcessor: (_name, implementation) => { Processor = implementation; },
    createFluidSynth: () => new Promise(() => {}),
    sampleRate: 48000, currentFrame: 48000, currentTime: 1,
    performance: { now: (() => { let time = 0; return () => (time += 4); })() },
  });
  const processor = new Processor({ processorOptions: { wasmBytes: null } });
  processor.synth = 1;
  processor.module = { _ps_render: () => 0, HEAPF32: new Float32Array(256).fill(0.5) };
  processor.leftPointer = 0;
  processor.rightPointer = 512;
  const outputs = [[new Float32Array(128), new Float32Array(128)]];
  processor.process([], outputs);
  expect(processor.stats.blocks).toBe(0);
  processor.handleMessage({ type: "diagnostics", enabled: true });
  processor.nextReportFrame = 0;
  processor.process([], outputs);
  expect(messages[0]).toMatchObject({ type: "diagnostics", blocks: 1,
    overBudgetBlocks: 1, peak: 0.5, renderTimingAvailable: true });
  processor.handleMessage({ type: "audio-mark", detail: { elapsedMs: 1000 } });
  expect(messages[1].type).toBe("audio-clip");
  expect(messages[1].left).toHaveLength(128);
  expect([...messages[1].left]).toEqual(Array(128).fill(0.5));
  // Force a wrapped ring and verify chronological export without mutating it.
  processor.audioRing = [new Float32Array([3, 4, 1, 2]), new Float32Array([7, 8, 5, 6])];
  processor.audioWrite = 2;
  processor.audioFrames = 4;
  processor.handleMessage({ type: "audio-mark", detail: { elapsedMs: 1100 } });
  expect([...messages[2].left]).toEqual([1, 2, 3, 4]);
  expect([...messages[2].right]).toEqual([5, 6, 7, 8]);
  processor.handleMessage({ type: "diagnostics", enabled: false });
  expect(processor.audioRing).toBeNull();
  processor.process([], outputs);
  expect(processor.stats.blocks).toBe(1);
});

it("queues MIDI in stable timestamp order and decodes 14-bit pitch bend", () => {
  let Processor;
  const calls = [];
  const context = {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } },
    registerProcessor: (_name, implementation) => { Processor = implementation; },
    createFluidSynth: () => new Promise(() => {}),
    sampleRate: 48000, currentFrame: 0, currentTime: 0,
  };
  runInNewContext(readFileSync("vendor/fluidsynth/processor.js", "utf8").replace(/^import .*\n/, ""), context);
  const processor = new Processor({ processorOptions: { wasmBytes: null } });
  processor.synth = 1;
  processor.module = {
    HEAPF32: new Float32Array(256),
    _ps_note_off: (_synth, channel, note) => calls.push(["off", channel, note]),
    _ps_note_on: (_synth, channel, note, velocity) => calls.push(["on", channel, note, velocity]),
    _ps_pitch_bend: (_synth, channel, value) => calls.push(["bend", channel, value]),
    _ps_render: () => { calls.push(["render"]); return 0; },
  };
  processor.leftPointer = 0;
  processor.rightPointer = 512;
  processor.handleMessage({ type: "midi-batch", events: [
    { data: [0x90, 62, 72], frame: 128 },
    { data: [0x80, 60, 0], frame: 0 },
    { data: [0xe2, 0, 64], frame: 0 },
    { data: [0xe2, 127, 127], frame: 0 },
  ] });
  expect(calls).toEqual([]);
  const outputs = [[new Float32Array(128), new Float32Array(128)]];
  processor.process([], outputs);
  expect(calls).toEqual([["off", 0, 60], ["bend", 2, 8192], ["bend", 2, 16383], ["render"]]);
  context.currentFrame = 128;
  processor.process([], outputs);
  expect(calls.slice(-2)).toEqual([["on", 0, 62, 72], ["render"]]);
  expect(processor.midiQueue).toHaveLength(0);
});
