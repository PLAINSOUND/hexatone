import { afterEach, describe, expect, it, vi } from "vitest";
import { createSuperSonicOutput } from "./index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function setup() {
  const contexts = [];
  const engines = [];
  class Context {
    createGain() {
      return {
        gain: {
          value: 1,
          cancelScheduledValues: vi.fn(),
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    }
    constructor() {
      contexts.push(this);
      this.state = "suspended";
      this.resume = vi.fn(async () => {
        this.state = "running";
      });
      this.close = vi.fn(async () => {
        this.state = "closed";
      });
    }
  }
  class Sonic {
    static osc = { encodeBundle: vi.fn(() => new Uint8Array()) };
    constructor({ audioContext }) {
      engines.push(this);
      this.audioContext = audioContext;
      this.node = { connect: vi.fn(), disconnect: vi.fn() };
      this.clock = { now: () => 1 };
      this.init = vi.fn(async () => {});
      this.loadSynthDef = vi.fn(async () => {});
      this.sync = vi.fn(async () => {});
      this.send = vi.fn();
      this.sendOSC = vi.fn();
      this.on = vi.fn();
      this.destroy = vi.fn(async () => {});
      this.purge = vi.fn(async () => {});
    }
  }
  vi.stubGlobal("AudioContext", Context);
  return {
    contexts,
    engines,
    Sonic,
    create: () =>
      createSuperSonicOutput(Sonic, "https://test/", [
        undefined,
        undefined,
        undefined,
        0,
        0.1,
        false,
        440,
        0,
        [0],
        1,
        {},
      ]),
  };
}

describe("recoverable SuperSonic engine", () => {
  it("creates and resumes a replacement in the gesture, keeping the synth and transport usable", async () => {
    const { create, contexts, engines } = setup();
    const synth = await create();
    const restoring = synth.forceAudioRebuild();
    expect(contexts).toHaveLength(2);
    expect(contexts[1].resume).toHaveBeenCalledOnce();
    expect(synth.forceAudioRebuild()).toBe(restoring);
    await restoring;
    expect(engines[0].destroy).toHaveBeenCalledOnce();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(engines[1].loadSynthDef).toHaveBeenCalledTimes(4);
    synth.applyZoneModwheel(127);
    expect(engines[1].send).toHaveBeenCalledWith("/n_set", 9100, "mod", 2);
    synth.shutdown({ panic: true });
    await Promise.resolve();
    expect(engines[1].destroy).toHaveBeenCalledOnce();
  });
  it("rejects a stalled replacement and permits a retry", async () => {
    vi.useFakeTimers();
    const { create, engines, contexts } = setup();
    const synth = await create();
    const restoring = synth.forceAudioRebuild();
    const rejection = expect(restoring).rejects.toThrow("timed out");
    // Construction is synchronous; init yields before the first upload.
    engines[1].loadSynthDef = vi.fn(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(30001);
    await rejection;
    expect(contexts[1].close).toHaveBeenCalled();
    await synth.forceAudioRebuild();
    synth.shutdown({ panic: true });
  });
});
