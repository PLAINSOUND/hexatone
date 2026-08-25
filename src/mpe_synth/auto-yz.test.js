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
    expect(releaseRampDuration(100)).toBeCloseTo(1.2);
    expect(releaseRampDuration(71)).toBeCloseTo(3.52);
    expect(releaseRampDuration(0)).toBeCloseTo(9.2);
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
      at: 105,
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

  it("pre-queues the short velocity onset with a timestamped cadence", () => {
    class FakeWorker {
      static instance;

      constructor() {
        FakeWorker.instance = this;
        this.onmessage = null;
      }

      postMessage = vi.fn();
      terminate = vi.fn();

      emit(data) {
        this.onmessage?.({ data });
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    const midiOutput = { send: vi.fn() };
    const scheduler = createAutoMpeYzScheduler(midiOutput, {
      now: () => 300.2,
    });

    scheduler.onset(4, 72);

    expect(midiOutput.send.mock.calls).toEqual([
      [[0xb0 + 3, 74, 32], 314.2],
      [[0xd0 + 3, 41], 314.2],
      [[0xb0 + 3, 74, 55], 315.64],
      [[0xd0 + 3, 71], 315.64],
    ]);
    expect(FakeWorker.instance.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 4, duration: 0, silent: true, generation: 1 }),
    );
  });

  it("resends an identical onset when a member channel is reused for a new note", () => {
    const midiOutput = { send: vi.fn() };
    const scheduler = createAutoMpeYzScheduler(midiOutput, {
      worker: false,
      now: () => 300.2,
    });

    scheduler.onset(4, 72);
    const firstOnset = midiOutput.send.mock.calls.map(([message, timestamp]) => [
      message,
      timestamp,
    ]);
    midiOutput.send.mockClear();

    scheduler.onset(4, 72);

    expect(midiOutput.send.mock.calls).toEqual(firstOnset);
    expect(midiOutput.send.mock.calls).toEqual([
      [[0xb0 + 3, 74, 32], 314.2],
      [[0xd0 + 3, 41], 314.2],
      [[0xb0 + 3, 74, 55], 315.64],
      [[0xd0 + 3, 71], 315.64],
    ]);
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
    now = 1002;
    vi.advanceTimersByTime(2);

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
    expect(calls.every((call) => call.length === 2 && Number.isFinite(call[1]))).toBe(true);
  });

  it("places a timestamped snapshot onset on the MIDI driver timeline", () => {
    const midiOutput = { send: vi.fn() };
    const scheduler = createAutoMpeYzScheduler(midiOutput, {
      worker: false,
      now: () => 1000,
    });

    scheduler.onset(3, 100, 1020);

    expect(midiOutput.send.mock.calls).toEqual([
      [[0xb0 + 2, 74, 69], 1021.2],
      [[0xd0 + 2, 90], 1021.2],
    ]);
  });

  it("coalesces queued legato samples instead of dumping a worker backlog", () => {
    vi.useFakeTimers();
    class FakeWorker {
      static instance;

      constructor() {
        FakeWorker.instance = this;
        this.onmessage = null;
      }

      postMessage = vi.fn();
      terminate = vi.fn();

      emit(data) {
        this.onmessage?.({ data });
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    const midiOutput = { send: vi.fn() };
    const scheduler = createAutoMpeYzScheduler(midiOutput, { now: () => 1000 });

    scheduler.continuation(4, 100, 0, 250);
    const generation = FakeWorker.instance.postMessage.mock.calls.at(-1)[0].generation;
    FakeWorker.instance.emit({ channel: 4, generation, y: 20, z: 30 });
    FakeWorker.instance.emit({ channel: 4, generation, y: 40, z: 50 });
    FakeWorker.instance.emit({ channel: 4, generation, y: 60, z: 70 });

    expect(midiOutput.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(8);
    expect(midiOutput.send.mock.calls).toEqual([
      [[0xb0 + 3, 74, 60], 1012],
      [[0xd0 + 3, 70], 1012],
    ]);
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

  it("waits for pressure to cross the Max patch threshold before taking over", () => {
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
      now: () => 400.2,
    });

    scheduler.onset(4, 112);
    midiOutput.send.mockClear();
    FakeWorker.instance.postMessage.mockClear();
    scheduler.pressure(4, 75, 112);

    expect(midiOutput.send).not.toHaveBeenCalled();
    expect(FakeWorker.instance.postMessage).not.toHaveBeenCalled();

    // Y's velocity base is 75 and Z's is 99. Crossing Y alone must leave Z
    // at its velocity-derived value.
    scheduler.pressure(4, 76, 112);
    expect(FakeWorker.instance.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ channel: 4, y: 76, z: 99 }),
    );

    scheduler.pressure(4, 99, 112);
    expect(FakeWorker.instance.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ channel: 4, y: 99, z: 99 }),
    );

    scheduler.pressure(4, 100, 112);
    expect(FakeWorker.instance.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ channel: 4, y: 100, z: 100 }),
    );
  });

  it("continues processing pressure after activation when it returns to zero", () => {
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
    let now = 400.2;
    const scheduler = createAutoMpeYzScheduler(midiOutput, { now: () => now });

    scheduler.onset(4, 127);
    scheduler.pressure(4, 110, 127);
    midiOutput.send.mockClear();
    now = 410.2;
    scheduler.pressure(4, 0, 127);

    expect(FakeWorker.instance.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ channel: 4, y: 0, z: 34, generation: 3 }),
    );
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
    const yValues = messages.filter((message) => message[1] === 74).map((message) => message[2]);
    expect(yValues).not.toContain(127);
    expect(yValues).toEqual([...yValues].sort((a, b) => b - a));
    expect(messages.at(-2)).toEqual([0xb0 + 4, 74, 0]);
    expect(messages.at(-1)).toEqual([0xd0 + 4, 0]);
  });

  it("starts release from the exact continuous value and cancels the in-flight onset", () => {
    vi.useFakeTimers();
    const midiOutput = { send: vi.fn() };
    let now = 100.25;
    const scheduler = createAutoMpeYzScheduler(midiOutput, { worker: false, now: () => now });

    // Velocity 100 ramps from 0 to Y=69, Z=90 over 1.2 ms.
    scheduler.onset(3, 100);
    midiOutput.send.mockClear();
    now = 100.85;
    scheduler.release(3, 71);
    now = 102.85;
    vi.advanceTimersByTime(2);
    now = 104.85;
    vi.advanceTimersByTime(2);

    const calls = midiOutput.send.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.length === 2 && Number.isFinite(call[1]))).toBe(true);
    expect(calls.at(-2)[0]).toEqual([0xb0 + 2, 74, 0]);
    expect(calls.at(-1)[0]).toEqual([0xd0 + 2, 0]);
  });

  it("keeps the velocity onset when pressure has not crossed the threshold", () => {
    const midiOutput = { send: vi.fn() };
    const scheduler = createAutoMpeYzScheduler(midiOutput, { worker: false, now: () => 0 });

    scheduler.onset(4, 127, 100);
    midiOutput.send.mockClear();
    scheduler.pressure(4, 0, 127, 200);

    expect(midiOutput.send).not.toHaveBeenCalled();
  });

  it("samples release every two milliseconds and preserves its zero endpoint", () => {
    vi.useFakeTimers();
    const midiOutput = { send: vi.fn() };
    let now = 200;
    const scheduler = createAutoMpeYzScheduler(midiOutput, { worker: false, now: () => now });

    scheduler.onset(7, 127);
    midiOutput.send.mockClear();
    now = 200.2;
    scheduler.release(7, 77);
    now = 202.2;
    vi.advanceTimersByTime(2);
    now = 204.2;
    vi.advanceTimersByTime(2);

    expect(midiOutput.send.mock.calls.map(([message]) => message)).toEqual([
      [0xb0 + 6, 74, 28],
      [0xd0 + 6, 37],
      [0xb0 + 6, 74, 0],
      [0xd0 + 6, 0],
    ]);
  });
});
