/** Explicit iOS recovery must escape a running-but-silent context even if its
 * close promise never resolves, without blocking replacement on old teardown.
 */
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("creates and resumes a replacement synchronously despite a stalled close", async () => {
  vi.resetModules();
  const contexts = [];
  class Context {
    constructor() {
      contexts.push(this);
      this.state = "suspended";
      this.currentTime = 0;
      this.destination = {};
      this.resume = vi.fn(() => { this.state = "running"; return Promise.resolve(); });
      this.close = vi.fn(() => new Promise(() => {}));
    }
    createGain() {
      return { gain: { value: 0, setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
    }
    createConstantSource() {
      return { offset: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
    }
    decodeAudioData() { return Promise.resolve({}); }
  }
  vi.stubGlobal("navigator", { userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 1 });
  vi.stubGlobal("window", { AudioContext: Context, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })));
  const { create_sample_synth } = await import("./index.js");
  const synth = await create_sample_synth("WMRIByzantineST", 440, 0, [0, 100, 200]);
  await synth.prepare();
  await synth.ensureAwake();
  expect(contexts).toHaveLength(1);
  const rebuilding = synth.forceAudioRebuild();
  expect(contexts).toHaveLength(2);
  expect(contexts[0].close).toHaveBeenCalledOnce();
  expect(contexts[1].resume).toHaveBeenCalledOnce();
  await rebuilding;
  await synth.prepare();
  expect(contexts).toHaveLength(2);
});
