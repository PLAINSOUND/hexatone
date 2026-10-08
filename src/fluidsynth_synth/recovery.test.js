import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("../sample_synth/prime-shared-audio.js");
  vi.resetModules();
});

it("replaces a worklet in a running context and restores its bank, preset and volume", async () => {
  vi.resetModules();
  const gains = [];
  const context = {
    state: "running",
    currentTime: 1,
    sampleRate: 48000,
    destination: {},
    createGain: () => {
      const gainNode = {
      gain: {
        value: 1,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
      };
      gains.push(gainNode);
      return gainNode;
    },
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
    panicFluidSynth,
    fadeFluidSynthAfterRecovery,
  } = await import("./index.js");
  const engine = await getFluidSynthEngine();
  expect(gains[0].gain.value).toBe(0);
  expect(gains[0].connect).not.toHaveBeenCalledWith(context.destination);
  fadeFluidSynthAfterRecovery({ fromCurrent: true, durationMs: 40 });
  expect(gains[0].gain.setValueAtTime).toHaveBeenCalledWith(0, 1);
  expect(gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 1.04);
  // Panic reaches the retained engine directly, without a currently selected
  // FluidSynth synth in the composite, and drops main-thread pending attacks.
  nodes[0].port.postMessage.mockClear();
  engine.output.sendCommand({ channel: 7, op: "on", a: 60, b: 72 }, performance.now() + 1000, 42);
  panicFluidSynth();
  await Promise.resolve();
  expect(nodes[0].port.postMessage).toHaveBeenCalledWith({ type: "clear-recovery-events" });
  expect(nodes[0].port.postMessage.mock.calls.filter(([message]) => message.type === "midi-batch")
    .flatMap(([message]) => message.events)).toEqual([]);
  const source = { name: "retained.sf2", arrayBuffer: vi.fn(async () => new ArrayBuffer(8)) };
  await loadFluidSynthSoundFont(source, { preferredPreset: "2:7" });
  const { create_midi_synth } = await import("../midi_synth/index.js");
  const synth = await create_midi_synth({
    outputMode: { output: engine.output, velocity: 72 },
    tuningContext: { fundamental: 261.6255653 },
  });
  // The wrapper is only available after its startup fade was scheduled.
  expect(gains[0].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 1.04);
  context.currentTime = 1.04;
  nodes[0].port.postMessage.mockClear();
  synth.makeHex("first", 0, 0, 0, 12, -100, 100, 60, 72, 0, 1).noteOn();
  await Promise.resolve();
  expect(gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(1, 1.04);
  expect(nodes[0].port.postMessage.mock.calls.filter(([message]) => message.type === "midi-batch")
    .flatMap(([message]) => message.events).some(event => event.command?.op === "on")).toBe(true);
  synth.shutdown({ panic: true });
  engine.setVolume(81);
  nodes[0].onprocessorerror();
  expect(getFluidSynthAudioDiagnostics().processorFailed).toBe(true);
  const restoring = forceFluidSynthEngineRebuild();
  expect(recover).toHaveBeenCalledOnce(); // no await before the context wake
  await restoring;
  expect(nodes).toHaveLength(2);
  expect(gains[2].gain.value).toBe(0);
  expect(gains[2].connect).not.toHaveBeenCalledWith(context.destination);
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
