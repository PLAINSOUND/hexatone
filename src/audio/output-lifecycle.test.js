// Lifecycle contract tests: ordinary teardown is not channel-wide panic.
import { describe, expect, it, vi } from "vitest";
import {
  adoptSampleOutput, clearOutputRef, clearOutputSynthRefs, clearSampleOutputs,
  pruneOutputMap, releaseSynthInstance,
} from "./output-lifecycle.js";

describe("output lifecycle", () => {
  it("attempts every graph release and empties caches despite backend failures", () => {
    const broken = { shutdown: vi.fn(() => { throw new Error("shutdown"); }) };
    const good = { shutdown: vi.fn() };
    const tail = { allSoundOff: vi.fn(() => { throw new Error("tail"); }) };
    const activeRefs = [broken, good].map(synth => ({ current: { key: "key", synth } }));
    const refs = { activeRefs, retiringSamplesRef: { current: new Set([tail]) },
      mtsRef: { current: new Map([["bad", broken], ["good", good]]) } };
    expect(() => clearOutputSynthRefs(refs)).toThrow(AggregateError);
    expect(good.shutdown).toHaveBeenCalledTimes(2);
    expect(refs.mtsRef.current.size).toBe(0);
    expect(refs.retiringSamplesRef.current.size).toBe(0);
    expect(activeRefs.every(ref => ref.current.synth === null)).toBe(true);
    expect(() => clearOutputSynthRefs(refs)).not.toThrow();
    expect(good.shutdown).toHaveBeenCalledTimes(2);
  });

  it("releases the active sample even if a retired sample throws", () => {
    const old = { shutdown() { throw new Error("old"); } };
    const active = { shutdown: vi.fn() };
    const ref = { current: { key: "sample", synth: active } };
    const retired = { current: new Set([old]) };
    expect(() => clearSampleOutputs(ref, retired)).toThrow(AggregateError);
    expect(active.shutdown).toHaveBeenCalledOnce();
    expect(retired.current.size).toBe(0);
    expect(ref.current.synth).toBeNull();
  });

  it("forwards disconnect shutdown options and detaches even if teardown throws", () => {
    const synth = { shutdown: vi.fn(() => { throw new Error("port closed"); }) };
    const ref = { current: { key: "port", synth, output: {} } };
    expect(() => clearOutputRef(ref, { disconnected: true })).toThrow("port closed");
    expect(ref.current).toEqual({ key: null, synth: null });
    expect(() => clearOutputRef(ref)).not.toThrow();
    expect(synth.shutdown).toHaveBeenCalledExactlyOnceWith({ disconnected: true });
  });

  it("prunes only obsolete MIDI outputs", () => {
    const keep = { shutdown: vi.fn() };
    const obsolete = { releaseAll: vi.fn() };
    const ref = { current: new Map([["keep", keep], ["old", obsolete]]) };
    pruneOutputMap(ref, new Set(["keep"]));
    expect(keep.shutdown).not.toHaveBeenCalled();
    expect(obsolete.releaseAll).toHaveBeenCalledOnce();
    expect([...ref.current.keys()]).toEqual(["keep"]);
    pruneOutputMap(ref);
    expect(keep.shutdown).toHaveBeenCalledOnce();
    expect(ref.current.size).toBe(0);
  });

  it("retains sounding sample tails on replacement but forgets them when disabled", () => {
    const old = { shutdown: vi.fn(), hasVoices: () => true };
    const next = { shutdown: vi.fn() };
    const finished = { hasVoices: () => false };
    const ref = { current: { key: "old", synth: old } };
    const retired = { current: new Set([finished]) };
    adoptSampleOutput(ref, retired, "new", next);
    expect(old.shutdown).not.toHaveBeenCalled();
    expect([...retired.current]).toEqual([old]);
    expect(ref.current).toEqual({ key: "new", synth: next });
    clearSampleOutputs(ref, retired);
    clearSampleOutputs(ref, retired);
    expect(old.shutdown).toHaveBeenCalledOnce();
    expect(next.shutdown).toHaveBeenCalledOnce();
    expect(retired.current.size).toBe(0);
  });

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
