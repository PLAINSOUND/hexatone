import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAutoMpeYzRampEngine,
  createAutoMpeYzScheduler,
  pressureTarget,
  releaseRampDuration,
  velocityRampDuration,
  velocityTarget,
} from "./auto-yz.js";

describe("automatic MPE Y/Z shaping", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("matches the established Max patch defaults", () => {
    expect(velocityTarget(100, 0.5, 38)).toBe(69);
    expect(velocityTarget(100, 0.69, 69)).toBe(90);
    expect(pressureTarget(127, 69, 1)).toBe(127);
    expect(pressureTarget(127, 90, 0.69)).toBe(116);
    expect(velocityRampDuration(100)).toBeCloseTo(1.2);
    expect(velocityRampDuration(127)).toBe(0);
    expect(releaseRampDuration(100)).toBe(0);
    expect(releaseRampDuration(71)).toBeCloseTo(1.52);
    expect(releaseRampDuration(0)).toBeCloseTo(7.2);
  });

  it("catches a delayed worker command up without emitting its stale initial value", () => {
    const emit = vi.fn();
    const engine = createAutoMpeYzRampEngine(emit);

    engine.schedule(4, 100, 80, 10, 100, 1, 105);

    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith({
      channel: 4,
      generation: 1,
      y: 50,
      z: 40,
    });
  });

  it("never emits a silent synchronization ramp when another channel keeps ticking", () => {
    const emit = vi.fn();
    const engine = createAutoMpeYzRampEngine(emit);

    engine.schedule(2, 100, 80, 40, 100, 1);
    engine.schedule(4, 0, 0, 5, 100, 1, 100, false, true);
    emit.mockClear();
    engine.tick(102);
    engine.tick(106);

    expect(emit.mock.calls.every(([values]) => values.channel !== 4)).toBe(true);
  });

  it("timestamps the short velocity onset immediately instead of waiting for the worker", () => {
    class FakeWorker {
      static instance;

      constructor() {
        FakeWorker.instance = this;
        this.onmessage = null;
      }

      postMessage = vi.fn();
      terminate = vi.fn();
    }
    vi.stubGlobal("Worker", FakeWorker);
    const midiOutput = { send: vi.fn() };
    const scheduler = createAutoMpeYzScheduler(midiOutput, {
      now: () => 300.2,
    });

    scheduler.onset(4, 99);

    expect(midiOutput.send.mock.calls.slice(0, 2)).toEqual([
      [[0xb0 + 3, 74, 16], 300.5],
      [[0xd0 + 3, 21], 300.5],
    ]);
    expect(midiOutput.send.mock.calls.at(-2)[0]).toEqual([0xb0 + 3, 74, 69]);
    expect(midiOutput.send.mock.calls.at(-1)[0]).toEqual([0xd0 + 3, 90]);
    expect(midiOutput.send.mock.calls.at(-2)[1]).toBeCloseTo(301.48);
    expect(FakeWorker.instance.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ silent: true }),
    );
  });

  it("emits Y and Z together for the same member channel", () => {
    vi.useFakeTimers();
    const midiOutput = { send: vi.fn() };
    let now = 1000;
    const scheduler = createAutoMpeYzScheduler(midiOutput, {
      worker: false,
      now: () => now,
    });

    scheduler.onset(3, 100);
    for (let elapsed = 1; elapsed <= 2; elapsed += 1) {
      now = 1000 + elapsed;
      vi.advanceTimersByTime(1);
    }

    const calls = midiOutput.send.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length % 2).toBe(0);
    for (let index = 0; index < calls.length; index += 2) {
      expect(calls[index][0][0]).toBe(0xb0 + 2);
      expect(calls[index][0][1]).toBe(74);
      expect(calls[index + 1][0][0]).toBe(0xd0 + 2);
    }
    expect(calls.at(-2)[0]).toEqual([0xb0 + 2, 74, 69]);
    expect(calls.at(-1)[0]).toEqual([0xd0 + 2, 90]);
    expect(calls.every((call) => call.length === 2)).toBe(true);
    expect(calls.every((call) => Number.isFinite(call[1]))).toBe(true);
  });

  it("cancels a superseded pressure ramp instead of interleaving its tail", () => {
    vi.useFakeTimers();
    const midiOutput = { send: vi.fn() };
    let now = 2000;
    const scheduler = createAutoMpeYzScheduler(midiOutput, {
      worker: false,
      now: () => now,
    });
    scheduler.pressure(2, 127, 100);
    for (let elapsed = 1; elapsed <= 10; elapsed += 1) {
      now = 2000 + elapsed;
      vi.advanceTimersByTime(1);
    }

    scheduler.pressure(2, 0, 100);
    const firstReplacementCall = midiOutput.send.mock.calls.length;
    for (let elapsed = 11; elapsed <= 50; elapsed += 1) {
      now = 2000 + elapsed;
      vi.advanceTimersByTime(1);
    }

    const replacement = midiOutput.send.mock.calls.slice(firstReplacementCall);
    expect(replacement.length).toBeGreaterThan(0);
    const yValues = replacement
      .map(([message]) => message)
      .filter((message) => message[1] === 74)
      .map((message) => message[2]);
    expect(yValues).toEqual([...yValues].sort((a, b) => b - a));
    expect(replacement.at(-2)[0]).toEqual([0xb0 + 1, 74, 0]);
    expect(replacement.at(-1)[0]).toEqual([0xd0 + 1, 28]);
  });

  it("timestamps the first pressure sample without waiting for worker delivery", () => {
    class FakeWorker {
      constructor() {
        this.onmessage = null;
      }

      postMessage = vi.fn();
      terminate = vi.fn();
    }
    vi.stubGlobal("Worker", FakeWorker);
    const midiOutput = { send: vi.fn() };
    const scheduler = createAutoMpeYzScheduler(midiOutput, {
      now: () => 400.2,
    });

    scheduler.onset(4, 127);
    midiOutput.send.mockClear();
    scheduler.pressure(4, 0, 127);

    expect(midiOutput.send.mock.calls).toEqual([
      [[0xb0 + 3, 74, 82], 400.5],
      [[0xd0 + 3, 108], 400.5],
    ]);
  });

  it("drops already-posted worker values from a superseded generation", () => {
    class FakeWorker {
      static instance;

      constructor() {
        FakeWorker.instance = this;
      }

      postMessage = vi.fn();
      terminate = vi.fn();
      onmessage = null;

      emit(data) {
        this.onmessage?.({ data });
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    const midiOutput = { send: vi.fn() };
    let now = 1000;
    const scheduler = createAutoMpeYzScheduler(midiOutput, { now: () => now });

    scheduler.pressure(5, 127, 100);
    FakeWorker.instance.emit({ channel: 5, generation: 1, y: 127, z: 116 });
    midiOutput.send.mockClear();
    now = 1010;
    scheduler.release(5, 44);
    FakeWorker.instance.emit({ channel: 5, generation: 1, y: 127, z: 116 });
    FakeWorker.instance.emit({ channel: 5, generation: 2, y: 0, z: 0 });

    const messages = midiOutput.send.mock.calls.map(([message]) => message);
    const yValues = messages
      .filter((message) => message[1] === 74)
      .map((message) => message[2]);
    expect(yValues).not.toContain(127);
    expect(yValues).toEqual([...yValues].sort((a, b) => b - a));
    expect(messages.at(-2)).toEqual([0xb0 + 4, 74, 0]);
    expect(messages.at(-1)).toEqual([0xd0 + 4, 0]);
  });

  it("starts release from the exact continuous value of an in-flight ramp", () => {
    class FakeWorker {
      constructor() {
        this.onmessage = null;
      }

      postMessage = vi.fn();
      terminate = vi.fn();
    }
    vi.stubGlobal("Worker", FakeWorker);
    const midiOutput = { send: vi.fn() };
    let now = 100.25;
    const scheduler = createAutoMpeYzScheduler(midiOutput, { now: () => now });

    // Velocity 100 ramps from 0 to Y=69, Z=90 over 1.2 ms.
    scheduler.onset(3, 100);
    midiOutput.send.mockClear();
    now = 100.85;
    scheduler.release(3, 71);

    const calls = midiOutput.send.mock.calls;
    expect(calls[0]).toEqual([[0xb0 + 2, 74, 34], 101]);
    expect(calls[1]).toEqual([[0xd0 + 2, 45], 101]);
    expect(calls.at(-2)[0]).toEqual([0xb0 + 2, 74, 0]);
    expect(calls.at(-1)[0]).toEqual([0xd0 + 2, 0]);
    expect(calls.at(-2)[1]).toBeCloseTo(102.52);
    expect(calls.at(-1)[1]).toBeCloseTo(102.52);
  });

  it("starts release from the expression state three milliseconds earlier", () => {
    class FakeWorker {
      constructor() {
        this.onmessage = null;
      }

      postMessage = vi.fn();
      terminate = vi.fn();
    }
    vi.stubGlobal("Worker", FakeWorker);
    const midiOutput = { send: vi.fn() };
    const scheduler = createAutoMpeYzScheduler(midiOutput, { now: () => 0 });

    scheduler.onset(4, 127, 100);
    scheduler.pressure(4, 0, 127, 200);
    midiOutput.send.mockClear();
    scheduler.release(4, 71, 210);

    expect(midiOutput.send.mock.calls.slice(0, 2)).toEqual([
      [[0xb0 + 3, 74, 68], 210.5],
      [[0xd0 + 3, 96], 210.5],
    ]);
  });

  it("samples release on the absolute millisecond grid without a near-zero extra step", () => {
    class FakeWorker {
      constructor() {
        this.onmessage = null;
      }

      postMessage = vi.fn();
      terminate = vi.fn();
    }
    vi.stubGlobal("Worker", FakeWorker);
    const midiOutput = { send: vi.fn() };
    let now = 200;
    const scheduler = createAutoMpeYzScheduler(midiOutput, { now: () => now });

    scheduler.onset(7, 127);
    midiOutput.send.mockClear();
    now = 200.65;
    scheduler.release(7, 77);

    const calls = midiOutput.send.mock.calls;
    expect(calls.slice(0, 4)).toEqual([
      [[0xb0 + 6, 74, 83], 201],
      [[0xd0 + 6, 109], 201],
      [[0xb0 + 6, 74, 43], 201.5],
      [[0xd0 + 6, 57], 201.5],
    ]);
    expect(calls.at(-2)[0]).toEqual([0xb0 + 6, 74, 0]);
    expect(calls.at(-1)[0]).toEqual([0xd0 + 6, 0]);
    expect(calls.at(-2)[1]).toBeCloseTo(202.04);
    expect(calls.at(-1)[1]).toBeCloseTo(202.04);
  });
});
