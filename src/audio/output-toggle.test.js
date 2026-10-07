import { afterEach, expect, it, vi } from "vitest";
import { smoothOutputToggle, stopFadingOutputToggles } from "./output-toggle.js";
import { clearOutputRef, reclaimFadingOutput } from "./output-lifecycle.js";

afterEach(() => vi.useRealTimers());
function setup(keepWarm = false) {
  vi.useFakeTimers();
  const attack = vi.fn();
  const shutdown = vi.fn();
  const mute = vi.fn();
  const fadeIn = vi.fn();
  const synth = smoothOutputToggle({ makeHex: () => ({ noteOn: attack }), shutdown,
    allSoundOff: vi.fn(), clearRecoveryEvents: vi.fn(), prepare: vi.fn() },
    { mute, fadeIn, cutOnShutdown: true, reuseWindowMs: 5000, keepWarm });
  return { synth, attack, shutdown, mute, fadeIn };
}
it("fades before teardown and blocks queued attacks while off", async () => {
  const { synth, attack, shutdown, mute, fadeIn } = setup();
  const hex = synth.makeHex();
  hex.noteOn();
  expect(fadeIn).toHaveBeenCalledOnce();
  const done = synth.shutdown();
  expect(mute).toHaveBeenCalledWith(30);
  expect(shutdown).not.toHaveBeenCalled();
  hex.noteOn();
  expect(attack).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(4999);
  expect(shutdown).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await done;
  expect(shutdown).toHaveBeenCalledWith({ panic: true });
  expect(synth.cancelShutdown()).toBe(false);
});
it("keeps voices for quick A–B toggles, then clears them without disposing the warm engine", async () => {
  const { synth, shutdown, fadeIn } = setup(true);
  synth.makeHex().noteOn();
  synth.pauseOutput();
  await vi.advanceTimersByTimeAsync(4999);
  expect(synth.allSoundOff).not.toHaveBeenCalled();
  await synth.resumeOutput();
  expect(fadeIn).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(6000);
  expect(synth.allSoundOff).not.toHaveBeenCalled();
  const cleared = synth.pauseOutput();
  await vi.advanceTimersByTimeAsync(5000);
  await cleared;
  expect(synth.allSoundOff).toHaveBeenCalledOnce();
  expect(synth.clearRecoveryEvents).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60000);
  expect(shutdown).not.toHaveBeenCalled();
  await synth.resumeOutput();
  synth.makeHex().noteOn();
  expect(fadeIn).toHaveBeenCalledTimes(3);
  synth.shutdown({ panic: true });
});
it("quick off/on reclaims the same engine and cancels pending cleanup", async () => {
  const { synth, shutdown, fadeIn } = setup();
  synth.makeHex().noteOn();
  const ref = { current: { key: "local", synth } };
  clearOutputRef(ref);
  await vi.advanceTimersByTimeAsync(4500);
  const reused = reclaimFadingOutput(ref, "local");
  expect(reused).toBe(synth);
  expect(fadeIn).toHaveBeenCalledTimes(2);
  reused.makeHex().noteOn();
  await vi.advanceTimersByTimeAsync(6000);
  expect(shutdown).not.toHaveBeenCalled();
  expect(fadeIn).toHaveBeenCalledTimes(2);
  await reused.shutdown({ panic: true });
  expect(shutdown).toHaveBeenCalledOnce();
});
it("expired or differently keyed engines cannot be reclaimed", async () => {
  const { synth, shutdown } = setup();
  const ref = { current: { key: "local", synth } };
  clearOutputRef(ref);
  expect(reclaimFadingOutput(ref, "different")).toBeNull();
  await vi.advanceTimersByTimeAsync(5000);
  expect(reclaimFadingOutput(ref, "local")).toBeNull();
  expect(shutdown).toHaveBeenCalledOnce();
});
it("panic bypasses the fade delay and prevents cancellation", async () => {
  const { synth, shutdown, mute } = setup();
  synth.shutdown();
  stopFadingOutputToggles();
  expect(mute).toHaveBeenLastCalledWith();
  expect(shutdown).toHaveBeenCalledOnce();
  expect(synth.cancelShutdown()).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  expect(shutdown).toHaveBeenCalledOnce();
});
it("engine switching retires after five seconds and fades immediately when reclaimed warm", async () => {
  const { synth, shutdown, fadeIn } = setup(true);
  const ref = { current: { key: "local", synth } };
  synth.makeHex().noteOn();
  clearOutputRef(ref, { engineSwitch: true });
  await vi.advanceTimersByTimeAsync(4000);
  expect(shutdown).not.toHaveBeenCalled();
  expect(reclaimFadingOutput(ref, "local")).toBe(synth);
  expect(fadeIn).toHaveBeenLastCalledWith({ delayMs: 0 });
  ref.current = { key: "local", synth };
  clearOutputRef(ref, { engineSwitch: true });
  await vi.advanceTimersByTimeAsync(5000);
  expect(shutdown).toHaveBeenCalledWith({ panic: true });
});
