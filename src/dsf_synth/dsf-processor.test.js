import { afterEach, beforeEach, expect, it, vi } from "vitest";

let Processor;

beforeEach(async () => {
  vi.resetModules();

  vi.stubGlobal("sampleRate", 48000);

  vi.stubGlobal("AudioWorkletProcessor", class {
    constructor() {
      this.port = { onmessage: null };
    }
  });

  vi.stubGlobal("registerProcessor", (name, processorClass) => {
    if (name === "hexatone-dsf") {
      Processor = processorClass;
    }
  });

  await import("./dsf-processor.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("starts silent", () => {
  const processor = new Processor();
  const channels = [
    new Float32Array(128),
    new Float32Array(128),
  ];

  const running = processor.process([], [channels]);

  expect(running).toBe(true);
  expect(channels[0].every(sample => sample === 0)).toBe(true);
  expect(channels[1].every(sample => sample === 0)).toBe(true);
});

it("reaches its target gain after the attack duration", () => {
  const processor = new Processor();

  processor.port.onmessage({
    data: { command: "start", frequency: 440 },
  });

  const render = (frames) => {
    const channels = [
      new Float32Array(frames),
      new Float32Array(frames),
    ];

    processor.process([], [channels]);
  };

  render(288);

  expect(processor.gain).toBeCloseTo(0.025, 10);
  expect(processor.gainStepsRemaining).toBe(288);

  render(288);

  expect(processor.gain).toBeCloseTo(0.05, 10);
  expect(processor.gainStepsRemaining).toBe(0);

  render(128);

  expect(processor.gain).toBeCloseTo(0.05, 10);
});

it("releases to silence over 80 ms", () => {
  const processor = new Processor();
  processor.gain = 0.05;

  processor.port.onmessage({
    data: { command: "stop" },
  });

  expect(processor.gain).toBe(0.05);
  expect(processor.gainStepsRemaining).toBe(3840);

  const render = (frames) => {
    processor.process([], [[new Float32Array(frames)]]);
  };

  render(1920);
  expect(processor.gain).toBeCloseTo(0.025, 10);

  render(1920);
  expect(processor.gain).toBe(0);
  expect(processor.gainStepsRemaining).toBe(0);
});

it("starts a replacement ramp from the current gain", () => {
  const processor = new Processor();

  processor.ramp(0.012, 0.05);
  processor.process([], [[new Float32Array(288)]]);

  const currentGain = processor.gain;

  processor.ramp(0.08, 0);

  expect(processor.gain).toBe(currentGain);

  processor.process([], [[new Float32Array(1)]]);

  expect(processor.gain).toBeCloseTo(
    currentGain - currentGain / 3840,
    10,
  );
});

it("applies a zero-duration ramp immediately and clamps gain", () => {
  const processor = new Processor();

  processor.ramp(0.08, 0.05);
  processor.ramp(0, 2);

  expect(processor.gain).toBe(1);
  expect(processor.targetGain).toBe(1);
  expect(processor.gainStep).toBe(0);
  expect(processor.gainStepsRemaining).toBe(0);

  processor.process([], [[new Float32Array(128)]]);

  expect(processor.gain).toBe(1);
});

