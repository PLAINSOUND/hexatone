import { expect, it, vi } from "vitest";
import { createRecoveryGate } from "./recovery-gate.js";
import { createAudioRecovery } from "./recovery.js";

it("mutes and ramps a separate output gain without changing musical volume", () => {
  const gain = {
    value: 1,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
  const node = { gain, connect: vi.fn(), disconnect: vi.fn() };
  const silentSink = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    currentTime: 5,
    destination: {},
    createGain: vi.fn().mockReturnValueOnce(node).mockReturnValueOnce(silentSink),
  };
  const gate = createRecoveryGate(context, true);
  expect(gain.value).toBe(0);
  expect(node.connect).toHaveBeenCalledWith(silentSink);
  expect(silentSink.gain.value).toBe(0);
  gate.mute();
  expect(node.disconnect).toHaveBeenCalledOnce();
  gate.fadeIn();
  expect(node.connect).toHaveBeenLastCalledWith(context.destination);
  expect(node.disconnect).toHaveBeenCalledTimes(2);
  expect(gain.setValueAtTime).toHaveBeenCalledWith(0, 5);
  expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 5.08);
  gate.disconnect();
  expect(silentSink.disconnect).toHaveBeenCalledOnce();
});

it("reverses a toggle fade from its current level without a gain discontinuity", () => {
  vi.useFakeTimers();
  const gain = { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn() };
  const node = { gain, connect: vi.fn(), disconnect: vi.fn() };
  const sink = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
  const context = { state: "running", currentTime: 5, destination: {},
    createGain: vi.fn().mockReturnValueOnce(node).mockReturnValueOnce(sink) };
  const gate = createRecoveryGate(context);
  gate.mute(30);
  context.currentTime = 5.015;
  gate.fadeIn({ fromCurrent: true, durationMs: 30 });
  expect(gain.setValueAtTime.mock.calls.at(-1)[0]).toBeCloseTo(0.5);
  expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 5.045);
  vi.advanceTimersByTime(40);
  expect(node.disconnect).not.toHaveBeenCalled();
  gate.disconnect();
  vi.useRealTimers();
});

it("mutes before releasing notes and waits for cleanup before fading", async () => {
  const order = [];
  let finishClear;
  const synth = {
    audioBackend: "fluidsynth",
    muteForRecovery: () => order.push("mute"),
    allSoundOff: () => order.push("silence"),
    forceAudioRebuild: async () => {
      order.push("restart");
    },
    clearRecoveryEvents: () =>
      new Promise((resolve) => {
        finishClear = resolve;
      }),
    fadeAfterRecovery: () => order.push("fade"),
  };
  const log = createAudioRecovery();
  const work = log.restore(synth, { releaseNotes: () => order.push("release") });
  await vi.waitFor(() => expect(finishClear).toBeTypeOf("function"));
  expect(order).toEqual(["mute", "release", "silence", "restart"]);
  finishClear({ droppedEvents: 4 });
  await work;
  expect(order.at(-1)).toBe("fade");
  expect(log.report(synth).events).toContainEqual(
    expect.objectContaining({
      name: "recovery-events-cleared",
      droppedEvents: 4,
    }),
  );
});

it("does not unmute a failed engine", async () => {
  const fade = vi.fn();
  const synth = {
    audioBackend: "fluidsynth",
    muteForRecovery: vi.fn(),
    forceAudioRebuild: async () => {
      throw new Error("failed");
    },
    fadeAfterRecovery: fade,
  };
  expect((await createAudioRecovery().restore(synth))[0].ok).toBe(false);
  expect(fade).not.toHaveBeenCalled();
});
