// Lifecycle contract tests: ordinary teardown is not channel-wide panic.
import { describe, expect, it, vi } from "vitest";
import { clearOutputSynthRefs, releaseSynthInstance } from "./output-lifecycle.js";

describe("output lifecycle", () => {
  it("prefers shutdown, falls back to owned release, and never invokes panic", () => {
    const full = { shutdown: vi.fn(), releaseAll: vi.fn(), allSoundOff: vi.fn(), panic: vi.fn() };
    releaseSynthInstance(full);
    expect(full.shutdown).toHaveBeenCalledOnce();
    expect(full.releaseAll).not.toHaveBeenCalled();
    expect(full.allSoundOff).not.toHaveBeenCalled();
    expect(full.panic).not.toHaveBeenCalled();
    const fallback = { releaseAll: vi.fn() };
    releaseSynthInstance(fallback);
    expect(fallback.releaseAll).toHaveBeenCalledOnce();
    expect(() => releaseSynthInstance(null)).not.toThrow();
    expect(() => releaseSynthInstance({})).not.toThrow();
  });

  it("clears every cache, silences only retired local samples and tolerates a second clear", () => {
    const order = [];
    const names = ["sample", "osc", "mpe", "mono"];
    const activeRefs = names.map((name) => ({
      current: {
        key: name,
        synth: { shutdown: vi.fn(() => order.push(name)), allSoundOff: vi.fn() },
      },
    }));
    const active = activeRefs.map((ref) => ref.current.synth);
    const mts = { releaseAll: vi.fn(() => order.push("mts")) };
    const tail = { allSoundOff: vi.fn(() => order.push("tail")) };
    const refs = {
      activeRefs,
      mtsRef: { current: new Map([["port", mts]]) },
      retiringSamplesRef: { current: new Set([tail]) },
    };
    clearOutputSynthRefs(refs);
    clearOutputSynthRefs(refs);
    expect(order).toEqual(["tail", ...names, "mts"]);
    expect(activeRefs.every((ref) => ref.current.key === null && ref.current.synth === null)).toBe(
      true,
    );
    expect(active.every((synth) => synth.allSoundOff.mock.calls.length === 0)).toBe(true);
    expect(refs.mtsRef.current.size).toBe(0);
    expect(refs.retiringSamplesRef.current.size).toBe(0);
  });
});
