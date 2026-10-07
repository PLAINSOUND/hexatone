import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("../sample_synth/prime-shared-audio.js");
  vi.resetModules();
});

it("replaces a worklet in a running context and restores its bank, preset and volume", async () => {
  vi.resetModules();
  const context = {
    state: "running",
    currentTime: 1,
    sampleRate: 48000,
    destination: {},
    createGain: () => ({
      gain: {
        value: 1,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    audioWorklet: { addModule: vi.fn(async () => {}) },
  };
  const recover = vi.fn(() => Promise.resolve(context));
  vi.doMock("../sample_synth/prime-shared-audio.js", () => ({
    primeSharedSampleAudio: () => Promise.resolve(context),
    recoverSharedAudioContext: recover,
    peekSharedAudioContextNow: () => context,
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
  );
  const nodes = [];
  class Node {
    constructor() {
      nodes.push(this);
      const listeners = new Set();
      const emit = (data) => listeners.forEach((listener) => listener({ data }));
      this.port = {
        addEventListener: (_, listener) => listeners.add(listener),
        removeEventListener: (_, listener) => listeners.delete(listener),
        start: vi.fn(),
        close: vi.fn(),
        postMessage: vi.fn((message) => {
          if (["load-soundfont", "replace-soundfont"].includes(message.type))
            queueMicrotask(() =>
              emit({
                type: "soundfont-loaded",
                soundfontId: nodes.length,
                presets: [
                  { bank: 0, program: 0 },
                  { bank: 2, program: 7 },
                ],
              }),
            );
        }),
      };
      queueMicrotask(() => emit({ type: "ready" }));
      this.connect = vi.fn();
      this.disconnect = vi.fn();
    }
  }
  vi.stubGlobal("AudioWorkletNode", Node);
  const {
    getFluidSynthEngine,
    loadFluidSynthSoundFont,
    forceFluidSynthEngineRebuild,
    getFluidSynthAudioDiagnostics,
  } = await import("./index.js");
  const engine = await getFluidSynthEngine();
  const source = { name: "retained.sf2", arrayBuffer: vi.fn(async () => new ArrayBuffer(8)) };
  await loadFluidSynthSoundFont(source, { preferredPreset: "2:7" });
  engine.setVolume(81);
  nodes[0].onprocessorerror();
  expect(getFluidSynthAudioDiagnostics().processorFailed).toBe(true);
  const restoring = forceFluidSynthEngineRebuild();
  expect(recover).toHaveBeenCalledOnce(); // no await before the context wake
  await restoring;
  expect(nodes).toHaveLength(2);
  expect(engine.node).toBe(nodes[1]);
  expect(nodes[0].disconnect).toHaveBeenCalledOnce();
  expect(nodes[0].port.close).toHaveBeenCalledOnce();
  expect(source.arrayBuffer).toHaveBeenCalledTimes(2);
  expect(engine.selectedPreset).toEqual({ bank: 2, program: 7 });
  expect(engine.volume).toBe(81);
  expect(getFluidSynthAudioDiagnostics().processorFailed).toBe(false);
  expect(nodes[1].port.postMessage).toHaveBeenCalledWith({
    type: "select-program",
    soundfontId: 2,
    bank: 2,
    program: 7,
  });
});
