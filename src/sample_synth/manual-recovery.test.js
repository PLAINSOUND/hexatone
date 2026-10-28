/** Explicit iOS recovery must escape a running-but-silent context even if its
 * close promise never resolves, without blocking replacement on old teardown.
 */
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it.each(["iPhone", "Desktop"])("creates and resumes a replacement on %s despite a stalled close", async platform => {
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
      return { gain: { value: 0, setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
    }
    createConstantSource() {
      return { offset: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
    }
    decodeAudioData() { return Promise.resolve({}); }
  }
  vi.stubGlobal("navigator", { userAgent: platform, platform, maxTouchPoints: 1 });
  vi.stubGlobal("window", { AudioContext: Context, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })));
  const { create_sample_synth } = await import("./index.js");
  const synth = await create_sample_synth("WMRIByzantineST", 440, 0, [0, 100, 200]);
  await synth.prepare();
  await synth.ensureAwake();
  expect(contexts).toHaveLength(1);
  contexts[0].state = "interrupted";
  let resumeOld;
  contexts[0].resume.mockImplementation(() => new Promise(resolve => { resumeOld = resolve; }));
  const stalledPrepare = synth.prepare();
  const superseded = expect(stalledPrepare).rejects.toThrow("superseded");
  const rebuilding = synth.forceAudioRebuild({ forceRecreate: true });
  expect(contexts).toHaveLength(2);
  expect(contexts[0].close).toHaveBeenCalledOnce();
  expect(contexts[1].resume).toHaveBeenCalledOnce();
  await rebuilding;
  await synth.prepare();
  expect(contexts).toHaveLength(2);
  // A late reply from the old resume cannot publish old preparation state.
  resumeOld();
  await superseded;
  await synth.prepare();
  expect(contexts).toHaveLength(2);

  // Simulate the coordinator replacing the shared context first.
const { recoverSharedAudioContext } = await import("./index.js");

const previous = synth.getAudioContext();

const replacement = await recoverSharedAudioContext({
  forceRecreate: true,
});

expect(replacement).not.toBe(previous);
expect(contexts).toHaveLength(3);

const createGain = vi.spyOn(replacement, "createGain");
const contextCount = contexts.length;

// The sample engine must reconnect, not replace the context again.
await synth.forceAudioRebuild({
  sharedContext: replacement,
});

expect(contexts).toHaveLength(contextCount);
expect(synth.getAudioContext()).toBe(replacement);
expect(createGain).toHaveBeenCalled();
expect(previous.close).toHaveBeenCalledOnce();
expect(replacement.close).not.toHaveBeenCalled();

// An older recovery must not reconnect to an obsolete context.
await expect(
  synth.forceAudioRebuild({ sharedContext: previous }),
).rejects.toThrow("Sample recovery received a stale context");

expect(synth.getAudioContext()).toBe(replacement);

  // The real coordinator must replace the context once for multiple adapters,
  // even when the old close promise never resolves.
  const sibling = await create_sample_synth("WMRIByzantineST", 440, 0, [0, 100, 200]);
  await sibling.prepare();
  const { createAudioRecovery } = await import("../audio/recovery.js");
  const recoverSharedContext = vi.fn(async options => {
    const context = await recoverSharedAudioContext(options);
    Object.defineProperty(context, "currentTime", { get: () => performance.now() / 1000 });
    return context;
  });
  const rebuild = vi.spyOn(synth, "forceAudioRebuild");
  const rebuildSibling = vi.spyOn(sibling, "forceAudioRebuild");
  const log = createAudioRecovery({ recoverSharedContext });
  const results = await log.restore({ childSynths: () => [synth, sibling] }, { forceRecreate: true });
  expect(results).toHaveLength(2);
  expect(results.every(result => result.ok)).toBe(true);
  expect(recoverSharedContext).toHaveBeenCalledExactlyOnceWith({ forceRecreate: true });
  expect(contexts).toHaveLength(contextCount + 1);
  const coordinated = contexts.at(-1);
  expect(rebuild).toHaveBeenCalledExactlyOnceWith({ sharedContext: coordinated });
  expect(rebuildSibling).toHaveBeenCalledExactlyOnceWith({ sharedContext: coordinated });
  expect(replacement.close).toHaveBeenCalledOnce();
  expect(coordinated.close).not.toHaveBeenCalled();
});
