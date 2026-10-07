import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

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
