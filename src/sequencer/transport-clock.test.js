import { expect, it } from "vitest";
import { createTransportClock } from "./transport-clock.js";
import { advanceTimedTransport, startTimedTransport } from "./timed-transport-runtime.js";

it("does not dispatch a catch-up explosion when samples are toggled during timed playback", () => {
  const clock = createTransportClock();
  let audio = 10;
  const sample = { currentTime: () => audio };
  const supersonic = {}; // No AudioContext clock exposed by this backend.
  const graph = children => ({ childSynths: () => children });
  const bursts = [0, 1, 2, 3, 4].map(elapsedSeconds => ({ elapsedSeconds }));
  let state = startTimedTransport(null, bursts, { clockSeconds: clock(graph([sample, supersonic]), 1000) });
  let result = advanceTimedTransport(state, bursts, clock(graph([sample, supersonic]), 1000));
  expect(result.dueBursts).toEqual([bursts[0]]);
  state = result.state;
  result = advanceTimedTransport(state, bursts, clock(graph([supersonic]), 1000.25));
  expect(result.dueBursts).toEqual([]);
  audio = 10.5;
  result = advanceTimedTransport(result.state, bursts, clock(graph([sample, supersonic]), 1000.5));
  expect(result.dueBursts).toEqual([]);
  audio = 11;
  result = advanceTimedTransport(result.state, bursts, clock(graph([sample, supersonic]), 1001));
  expect(result.dueBursts).toEqual([bursts[1]]);
});

it("retains audio-clock suspension and handles a clock restart without rewinding", () => {
  const clock = createTransportClock();
  let audio = 20;
  const engine = { currentTime: () => audio };
  expect(clock(engine, 100)).toBe(20);
  expect(clock(engine, 101)).toBe(20);
  audio = 0;
  expect(clock(engine, 101.1)).toBeCloseTo(20.1);
  audio = 0.1;
  expect(clock(engine, 101.2)).toBeCloseTo(20.2);
});

it("keeps the same clock across new composite wrappers and handles joining engines", () => {
  const clock = createTransportClock();
  const engine = { currentTime: () => 0 };
  expect(clock(null, 50)).toBe(50);
  expect(clock({ childSynths: () => [engine] }, 50.2)).toBeCloseTo(50.2);
  expect(clock({ childSynths: () => [engine] }, 51)).toBeCloseTo(50.2);
  expect(clock(null, 51.1)).toBeCloseTo(50.3);
});
