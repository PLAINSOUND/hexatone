import { afterEach, describe, expect, it, vi } from "vitest";
import { createAudioRecovery, saveAudioReport } from "./recovery.js";

afterEach(() => vi.useRealTimers());
const graph = (...children) => ({ childSynths: () => children });
const backend = (name, forceAudioRebuild = vi.fn(async () => {})) => ({
  family: name === "samples" ? "sample" : "osc",
  audioBackend: name === "samples" ? undefined : name,
  forceAudioRebuild,
  getDiagnostics: () => ({ audioContext: { state: "running", currentTime: 1 } }),
});

describe("built-in audio recovery", () => {
  it("tracks hide-time muting even when clocks still run and clears it on recovery", async () => {
    const synth = backend("supersonic");
    synth.muteForRecovery = vi.fn();
    synth.fadeAfterRecovery = vi.fn();
    const log = createAudioRecovery();
    log.hide(synth);
    expect(log.needsRestore(synth)).toBe(true);
    await log.restore(synth);
    expect(log.needsRestore(synth)).toBe(false);
  });
  it("fades on hiding before clearing voices and pending events", async () => {
    vi.useFakeTimers();
    const synth = backend("supersonic");
    synth.muteForRecovery = vi.fn();
    synth.allSoundOff = vi.fn();
    synth.clearRecoveryEvents = vi.fn(async () => ({ droppedEvents: 3 }));
    const log = createAudioRecovery();
    log.hide(synth);
    expect(synth.muteForRecovery).toHaveBeenCalledWith(40);
    expect(synth.allSoundOff).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(40);
    expect(synth.allSoundOff).toHaveBeenCalledOnce();
    expect(synth.clearRecoveryEvents).toHaveBeenCalledOnce();
    expect(log.report(synth).events).toContainEqual(
      expect.objectContaining({ name: "hide-events-cleared", droppedEvents: 3 }),
    );
  });
  it("cancels deferred hide cleanup when recovery starts", async () => {
    vi.useFakeTimers();
    const synth = backend("supersonic");
    synth.allSoundOff = vi.fn();
    const log = createAudioRecovery();
    log.hide(synth);
    await log.restore(synth);
    await vi.advanceTimersByTimeAsync(40);
    expect(synth.allSoundOff).toHaveBeenCalledOnce();
  });
  it("starts independent engines immediately and rebinds FluidSynth after samples", async () => {
    let finishSamples;
    const samples = backend(
      "samples",
      vi.fn(
        () =>
          new Promise((resolve) => {
            finishSamples = resolve;
          }),
      ),
    );
    const sonic = backend("supersonic");
    const fluid = backend("fluidsynth");
    const external = { family: "mts", forceAudioRebuild: vi.fn() };
    const log = createAudioRecovery();
    const recovering = log.restore(graph(samples, sonic, fluid, external));
    expect(samples.forceAudioRebuild).toHaveBeenCalledOnce();
    expect(sonic.forceAudioRebuild).toHaveBeenCalledOnce();
    expect(fluid.forceAudioRebuild).not.toHaveBeenCalled();
    finishSamples();
    expect((await recovering).every((result) => result.ok)).toBe(true);
    expect(fluid.forceAudioRebuild).toHaveBeenCalledOnce();
    expect(external.forceAudioRebuild).not.toHaveBeenCalled();
  });
  it("bounds hanging work, continues other engines, and allows another attempt", async () => {
    vi.useFakeTimers();
    const stuck = backend(
      "samples",
      vi.fn(() => new Promise(() => {})),
    );
    const fluid = backend("fluidsynth");
    const log = createAudioRecovery({ timeoutMs: 50 });
    const synth = graph(stuck, fluid);
    const first = log.restore(synth);
    expect(log.restore(synth)).toBe(first);
    await vi.advanceTimersByTimeAsync(51);
    expect(await first).toEqual([
      { backend: "samples", ok: false, error: "Audio recovery timed out" },
      { backend: "fluidsynth", ok: true },
    ]);
    const second = log.restore(synth);
    await vi.advanceTimersByTimeAsync(51);
    await second;
    expect(stuck.forceAudioRebuild).toHaveBeenCalledTimes(2);
  });
  it("reports failures even when resuming resolves without a running context", async () => {
    const synth = backend("fluidsynth");
    synth.getDiagnostics = () => ({ audioContext: { state: "interrupted" } });
    expect((await createAudioRecovery().restore(synth))[0]).toMatchObject({ ok: false });
  });
  it("does not let a silence error block other engines", async () => {
    const synth = backend("supersonic");
    synth.allSoundOff = () => {
      throw new Error("Stale port");
    };
    expect((await createAudioRecovery().restore(synth))[0].ok).toBe(true);
  });
  it("bounds history and captures serialisable engine state without font bytes", () => {
    const log = createAudioRecovery({ historyLimit: 3 });
    for (let n = 0; n < 10; n++) log.record("visibility", { n });
    const report = log.report(graph(backend("samples")), { output_sample: true });
    expect(report.events).toHaveLength(3);
    expect(report.events[0].n).toBe(7);
    expect(JSON.parse(JSON.stringify(report)).schema).toBe("hexatone-audio-recovery/v1");
    expect(report.settings.output_sample).toBe(true);
  });
  it("downloads a JSON report and releases its temporary URL", async () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:report");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      saveAudioReport({ schema: "test" });
      expect(create.mock.calls[0][0].type).toBe("application/json");
      expect(click).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(30000);
      expect(revoke).toHaveBeenCalledWith("blob:report");
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
