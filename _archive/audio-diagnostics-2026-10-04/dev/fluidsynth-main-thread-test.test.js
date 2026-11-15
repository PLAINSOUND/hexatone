import { afterEach, expect, it, vi } from "vitest";
import { startFluidSynthMainThreadTest } from "./fluidsynth-main-thread-test.js";

afterEach(() => vi.useRealTimers());

it("delivers notes, MTS and bends through MIDI send and stops after 30 seconds", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  const output = { send: vi.fn() };
  const stop = startFluidSynthMainThreadTest(output);
  vi.advanceTimersByTime(30003);
  const events = output.send.mock.calls.map(([data]) => data);
  const notes = events.filter(data => data[0] === 0x90);
  expect(notes).toHaveLength(480);
  expect(notes.every(data => data[1] === 60)).toBe(true);
  const retunes = events.filter(data => data[0] === 0xf0 && data[1] === 0x7f);
  expect(retunes).toHaveLength(480);
  expect(retunes.every(data => data[7] === 60 && data[8] >= 47 && data[8] <= 72)).toBe(true);
  expect(new Set(retunes.map(data => data[8])).size).toBeGreaterThan(1);
  expect(events.some(data => data[0] === 0xe0 && (data[1] | data[2] << 7) !== 8192)).toBe(true);
  const count = events.length;
  stop();
  vi.advanceTimersByTime(1000);
  expect(output.send).toHaveBeenCalledTimes(count);
});
