import { afterEach, describe, expect, it, vi } from "vitest";
import { createAudioRecovery, saveAudioReport, verifyEngineProgress } from "./recovery.js";

afterEach(() => vi.useRealTimers());
const graph = (...children) => ({ childSynths: () => children });
const backend = (name, forceAudioRebuild = vi.fn(async () => {})) => ({
  family: name === "samples" ? "sample" : "osc",
  usesSharedAudioContext: name === "samples" || name === "fluidsynth",
  audioBackend: name === "samples" ? undefined : name,
  forceAudioRebuild,
  getDiagnostics: () => ({ audioContext: { state: "running", currentTime: 1 } }),
});

describe("built-in audio recovery", () => {
  it("rejects a frozen engine even when its context reports running", async () => {
    vi.useFakeTimers();
    const synth = { getDiagnostics: () => ({ engine: { metrics: { engineProcessCount: 84519 } } }) };
    const result = expect(verifyEngineProgress(synth)).rejects.toThrow("processing did not advance");
    await vi.advanceTimersByTimeAsync(1250);
    await result;
  });

  it("accepts an engine only after its processing counter advances", async () => {
    vi.useFakeTimers();
    let count = 1;
    const synth = { getDiagnostics: () => ({ engine: { metrics: { engineProcessCount: count } } }) };
    const result = verifyEngineProgress(synth);
    count++;
    await vi.advanceTimersByTimeAsync(50);
    await result;
  });

  it("rebuilds when a worklet fails cleanup despite a moving context clock", async () => {
    vi.useFakeTimers();
    const context = {
      state: "running", get currentTime() { return Date.now() / 1000; },
      suspend: vi.fn(async () => {}), resume: vi.fn(async () => {}),
    };
    const synth = backend("fluidsynth");
    synth.getAudioContext = () => context;
    synth.clearRecoveryEvents = vi.fn().mockRejectedValueOnce(new Error("Worklet unresponsive")).mockResolvedValue({ droppedEvents: 0 });
    const work = createAudioRecovery().restore(synth);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await work).toEqual([{ backend: "fluidsynth", ok: true }]);
    expect(synth.forceAudioRebuild).toHaveBeenCalledOnce();
    expect(synth.clearRecoveryEvents).toHaveBeenCalledTimes(2);
  });
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
    const dsf = { ...backend("dsf"), usesSharedAudioContext: true, };
    const external = { family: "mts", forceAudioRebuild: vi.fn() };
    const log = createAudioRecovery();
    const recovering = log.restore(graph(samples, sonic, fluid, dsf, external));
    expect(samples.forceAudioRebuild).toHaveBeenCalledOnce();
    expect(sonic.forceAudioRebuild).toHaveBeenCalledOnce();
    expect(fluid.forceAudioRebuild).not.toHaveBeenCalled();
    expect(dsf.forceAudioRebuild).not.toHaveBeenCalled();
    finishSamples();
    expect((await recovering).every((result) => result.ok)).toBe(true);
    expect(fluid.forceAudioRebuild).toHaveBeenCalledOnce();
    expect(dsf.forceAudioRebuild).toHaveBeenCalled();
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
  it("replaces the shared context once before rebuilding its engines", async () => {
    let finishContextRecovery;
    const recoverSharedContext = vi.fn(() => new Promise(resolve => { finishContextRecovery = resolve; }));
    const samples = backend("samples");
    const fluid = backend("fluidsynth");
    const dsf = { ...backend("dsf"), usesSharedAudioContext: true };
    const sonic = backend("supersonic");
    const log = createAudioRecovery({ recoverSharedContext });
    const synth = graph(samples, fluid, dsf, sonic);
    const recovering = log.restore(synth, { forceRecreate: true });
    expect(log.restore(synth, { forceRecreate: true })).toBe(recovering);
    expect(recoverSharedContext).toHaveBeenCalledExactlyOnceWith({ forceRecreate: true });
    expect(sonic.forceAudioRebuild).toHaveBeenCalledExactlyOnceWith({ forceRecreate: true });
    for (const child of [samples, fluid, dsf]) expect(child.forceAudioRebuild).not.toHaveBeenCalled();
    const context = { state: "running" };
    finishContextRecovery(context);
    const results = await recovering;
    for (const child of [samples, fluid, dsf])
      expect(child.forceAudioRebuild).toHaveBeenCalledExactlyOnceWith({ sharedContext: context });
    expect(results).toHaveLength(4);
    expect(results.every(result => result.ok)).toBe(true);
  });
  it("recovers a shared worklet without a sample backend", async () => {
    const context = { state: "running" };
    const recoverSharedContext = vi.fn(() => Promise.resolve(context));
    const fluid = backend("fluidsynth");
    const log = createAudioRecovery({ recoverSharedContext });
    expect(await log.restore(fluid, { forceRecreate: true })).toEqual([{ backend: "fluidsynth", ok: true }]);
    expect(recoverSharedContext).toHaveBeenCalledOnce();
    expect(fluid.forceAudioRebuild).toHaveBeenCalledExactlyOnceWith({ sharedContext: context });
  });
  it("rejects an engine that retains a stale context", async () => {
    vi.useFakeTimers();
    const fluid = backend("fluidsynth");
    fluid.getAudioContext = () => ({ state: "running" });
    fluid.fadeAfterRecovery = vi.fn();
    const results = await createAudioRecovery({ recoverSharedContext: async () => ({ state: "running" }) })
      .restore(fluid, { forceRecreate: true });
    expect(results).toEqual([{ backend: "fluidsynth", ok: false,
      error: "Audio engine did not adopt the recovered shared context" }]);
    expect(fluid.fadeAfterRecovery).not.toHaveBeenCalled();
  });
  it.each(["reject", "throw", "interrupted"])("keeps shared engines muted on context failure: %s", async failure => {
    const error = new Error("Context unavailable");
    const recoverSharedContext = vi.fn(() => {
      if (failure === "throw") throw error;
      return failure === "reject" ? Promise.reject(error) : Promise.resolve({ state: "interrupted" });
    });
    const samples = backend("samples"), fluid = backend("fluidsynth"), sonic = backend("supersonic");
    samples.fadeAfterRecovery = vi.fn();
    fluid.fadeAfterRecovery = vi.fn();
    const results = await createAudioRecovery({ recoverSharedContext })
      .restore(graph(samples, fluid, sonic), { forceRecreate: true });
    expect(results.filter(result => !result.ok).map(result => result.backend)).toEqual(["samples", "fluidsynth"]);
    expect(results.find(result => result.backend === "supersonic").ok).toBe(true);
    for (const child of [samples, fluid]) {
      expect(child.forceAudioRebuild).not.toHaveBeenCalled();
      expect(child.fadeAfterRecovery).not.toHaveBeenCalled();
    }
  });
  it("bounds shared-context recovery and ignores a late completion after retry", async () => {
    vi.useFakeTimers();
    let finishOld;
    const replacement = { state: "running" };
    const recoverSharedContext = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockResolvedValueOnce(replacement);
    const fluid = backend("fluidsynth");
    const log = createAudioRecovery({ timeoutMs: 50, recoverSharedContext });
    const first = log.restore(fluid, { forceRecreate: true });
    await vi.advanceTimersByTimeAsync(51);
    expect(await first).toEqual([{ backend: "fluidsynth", ok: false, error: "Shared audio context recovery timed out" }]);
    expect(fluid.forceAudioRebuild).not.toHaveBeenCalled();
    expect(await log.restore(fluid, { forceRecreate: true })).toEqual([{ backend: "fluidsynth", ok: true }]);
    finishOld({ state: "running" });
    await vi.advanceTimersByTimeAsync(1);
    expect(fluid.forceAudioRebuild).toHaveBeenCalledExactlyOnceWith({ sharedContext: replacement });
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
  it("includes parked engines in recovery without adding them to the live note graph", async () => {
    const parked = backend("supersonic");
    const synth = { childSynths: () => [], getRecoveryOutputs: () => [parked] };
    const log = createAudioRecovery();
    expect(log.snapshot(synth)).toHaveLength(1);
    expect((await log.restore(synth))[0]).toMatchObject({ backend: "supersonic", ok: true });
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
