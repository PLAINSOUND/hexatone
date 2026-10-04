import { afterEach, expect, it, vi } from "vitest";
import { registerWindowsBackend, startWindowsCapture, stopWindowsCapture,
  recordWindowsEvent } from "./windows-performance.js";

afterEach(() => { stopWindowsCapture(); vi.useRealTimers(); });

it("captures backend progress, input cancellation and timed silence/recovery markers", () => {
  vi.useFakeTimers();
  const read = vi.fn(() => ({ metrics: { underruns: 3 }, nodes: { count: 12 },
    audioContext: { state: "running", currentTime: 10 } }));
  const unregister = registerWindowsBackend(read);
  startWindowsCapture({ localSuperSonic: true });
  const canvas = document.createElement("canvas"); canvas.className = "keyboard";
  document.body.append(canvas);
  canvas.dispatchEvent(new Event("pointercancel", { bubbles: true }));
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "F8", shiftKey: true }));
  vi.advanceTimersByTime(500);
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "F9", shiftKey: true }));
  recordWindowsEvent("osc:/s_new");
  const report = stopWindowsCapture();
  expect(report.events.map(event => event.name)).toEqual([
    "canvas:pointercancel", "audible-silence", "audible-recovery",
  ]);
  expect(report.counts["osc:/s_new"]).toBe(1);
  expect(report.samples[0].backends[0].metrics.underruns).toBe(3);
  const calls = read.mock.calls.length;
  vi.advanceTimersByTime(1000);
  expect(read).toHaveBeenCalledTimes(calls);
  unregister(); canvas.remove();
});

it("does not poll engines or retain events when disabled", () => {
  const read = vi.fn();
  const unregister = registerWindowsBackend(read);
  recordWindowsEvent("osc:/s_new");
  expect(stopWindowsCapture()).toBeNull();
  expect(read).not.toHaveBeenCalled(); unregister();
});
