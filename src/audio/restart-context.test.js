import { afterEach, expect, it, vi } from "vitest";
import { restartAudioContext, verifyAudioClock } from "./restart-context.js";
import { createAudioRecovery } from "./recovery.js";

afterEach(() => vi.useRealTimers());

function context({ frozen = false } = {}) {
  let running = true;
  return {
    get state() {
      return running ? "running" : "suspended";
    },
    get currentTime() {
      return frozen || !running ? 0 : Date.now() / 1000;
    },
    suspend: vi.fn(async () => {
      running = false;
    }),
    resume: vi.fn(async () => {
      running = true;
    }),
  };
}

it("cycles an existing running context and verifies clock progress", async () => {
  vi.useFakeTimers();
  const audio = context();
  const work = restartAudioContext(audio);
  expect(audio.suspend).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(100);
  await work;
  expect(audio.resume).toHaveBeenCalledOnce();
});

it("rejects a frozen clock even when the context claims running", async () => {
  vi.useFakeTimers();
  const work = verifyAudioClock(context({ frozen: true }));
  const assertion = expect(work).rejects.toThrow("clock did not advance");
  await vi.advanceTimersByTimeAsync(1300);
  await assertion;
});

it("bounds a stalled suspend and does not resume it after abandonment", async () => {
  vi.useFakeTimers();
  const audio = context();
  let complete;
  audio.suspend.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const work = restartAudioContext(audio, 100);
  const assertion = expect(work).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(101);
  await assertion;
  complete();
  await vi.advanceTimersByTimeAsync(1);
  expect(audio.resume).not.toHaveBeenCalled();
});

it("cycles a shared context once, preserving healthy engines instead of rebuilding", async () => {
  vi.useFakeTimers();
  const audio = context();
  const samples = {
    family: "sample",
    getAudioContext: () => audio,
    ensureAwake: vi.fn(async () => {}),
    forceAudioRebuild: vi.fn(),
  };
  const fluid = {
    audioBackend: "fluidsynth",
    getAudioContext: () => audio,
    resumeAfterAudioRestart: vi.fn(async () => {}),
    forceAudioRebuild: vi.fn(),
  };
  const work = createAudioRecovery().restore({ childSynths: () => [samples, fluid] });
  await vi.advanceTimersByTimeAsync(300);
  expect((await work).every((result) => result.ok)).toBe(true);
  expect(audio.suspend).toHaveBeenCalledOnce();
  expect(audio.resume).toHaveBeenCalledOnce();
  expect(samples.forceAudioRebuild).not.toHaveBeenCalled();
  expect(fluid.forceAudioRebuild).not.toHaveBeenCalled();
});

it("does not report a frozen replacement as successful recovery", async () => {
  vi.useFakeTimers();
  const audio = context({ frozen: true });
  const synth = {
    audioBackend: "fluidsynth",
    getAudioContext: () => audio,
    forceAudioRebuild: vi.fn(async () => {}),
  };
  const work = createAudioRecovery().restore(synth);
  await vi.advanceTimersByTimeAsync(3000);
  expect((await work)[0]).toMatchObject({ ok: false });
  expect(synth.forceAudioRebuild).toHaveBeenCalledOnce();
});

it("reports missing engines as a failure, not restored audio", async () => {
  expect((await createAudioRecovery().restore(null))[0]).toMatchObject({ ok: false });
});
