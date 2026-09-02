import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create_sample_synth } from "./index.js";

class MockAudioContext {
  constructor() {
    this.state = "running";
    this.currentTime = 0;
    this.destination = {};
    this.createdGains = [];
    this.createdConstantSources = [];
    this.resume = vi.fn(async () => {
      this.state = "running";
    });
  }

  async close() {
    this.state = "closed";
  }

  async decodeAudioData(buffer) {
    return { decoded: buffer.byteLength };
  }

  createGain() {
    const node = {
      gain: {
        value: 0,
        setTargetAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
    this.createdGains.push(node);
    return node;
  }

  createConstantSource() {
    const node = {
      offset: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
    };
    this.createdConstantSources.push(node);
    return node;
  }

  createBufferSource() {
    return {
      buffer: null,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      playbackRate: {
        value: 1,
        setTargetAtTime: vi.fn(),
        setValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      start: vi.fn(),
    };
  }

  createBiquadFilter() {
    return {
      type: "lowpass",
      Q: { value: 0 },
      frequency: {
        value: 0,
        setTargetAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
  }
}

describe("sample_synth modwheel", () => {
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );
    vi.stubGlobal("window", {
      AudioContext: MockAudioContext,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("navigator", {
      userAgent: "test",
      platform: "test",
      maxTouchPoints: 0,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalNavigator) {
      vi.stubGlobal("navigator", originalNavigator);
    }
  });

  it("applies CC1 to the active voice filter on filter-capable instruments", async () => {
    const synth = await create_sample_synth("WMRIByzantineST", 440, 0, [0, 100, 200]);
    await synth.prepare();

    const hex = synth.makeHex(null, 0, 0, 0, 12, null, null, 60, 96, 0, 1);
    hex.noteOn();
    const initialFrequency = hex.filterNode.frequency.value;

    hex.modwheel(127);

    expect(hex.filterNode.frequency.setTargetAtTime).toHaveBeenCalledTimes(1);
    expect(hex.filterNode.frequency.setTargetAtTime.mock.calls[0][0]).toBeGreaterThan(
      initialFrequency,
    );
  });

  it("applies one zone-wide CC1 dispatch to every active sample voice", async () => {
    const synth = await create_sample_synth("WMRIByzantineST", 440, 0, [0, 100, 200]);
    await synth.prepare();

    const first = synth.makeHex(null, 0, 0, 0, 12, null, null, 60, 96, 0, 1);
    const second = synth.makeHex(null, 100, 0, 0, 12, null, null, 61, 96, 0, 1);
    first.noteOn();
    second.noteOn();

    synth.applyZoneModwheel(100);

    expect(first.filterNode.frequency.setTargetAtTime).toHaveBeenCalledOnce();
    expect(second.filterNode.frequency.setTargetAtTime).toHaveBeenCalledOnce();
  });

  it("pitch-tracks the Reed filter around its unchanged 400 Hz reference", async () => {
    const synth = await create_sample_synth("WMRIByzantineST", 400, 0, [0, 100, 200]);
    await synth.prepare();
    const referenceVoice = synth.makeHex(null, 0, 0, 0, 12, null, null, 60, 96, 0, 1);
    const octaveVoice = synth.makeHex(null, 1200, 0, 0, 12, null, null, 72, 96, 0, 1);
    referenceVoice.noteOn();
    octaveVoice.noteOn();

    synth.applyZoneModwheel(64);

    const referenceCutoff = referenceVoice.filterNode.frequency.setTargetAtTime.mock.calls[0][0];
    const octaveCutoff = octaveVoice.filterNode.frequency.setTargetAtTime.mock.calls[0][0];
    expect(referenceCutoff).toBeCloseTo(2200, 8);
    expect(octaveCutoff).toBeCloseTo(4400, 8);
  });

  it.each([
    ["WMRI3LST", 1],
    ["WMRI5LST", 1],
    ["WMRI7LST", 1],
    ["WMRI11LST", 1],
    ["WMRI13LST", 1],
    ["hammond", 1],
    ["sruti", 0.25],
  ])(
    "applies %s pitch tracking without changing its 400 Hz wheel curve",
    async (fileName, tracking) => {
      const synth = await create_sample_synth(fileName, 400, 0, [0, 100, 200]);
      await synth.prepare();
      const referenceVoice = synth.makeHex(null, 0, 0, 0, 12, null, null, 60, 96, 0, 1);
      const octaveVoice = synth.makeHex(null, 1200, 0, 0, 12, null, null, 72, 96, 0, 1);
      referenceVoice.noteOn();
      octaveVoice.noteOn();

      synth.applyZoneModwheel(64);

      const referenceCutoff = referenceVoice.filterNode.frequency.setTargetAtTime.mock.calls[0][0];
      const octaveCutoff = octaveVoice.filterNode.frequency.setTargetAtTime.mock.calls[0][0];
      expect(octaveCutoff / referenceCutoff).toBeCloseTo(2 ** tracking, 8);
    },
  );

  it("distributes the Hammond wheel across its audible harmonic range", async () => {
    const synth = await create_sample_synth("hammond", 400, 0, [0, 100, 200]);
    await synth.prepare();
    const hex = synth.makeHex(null, 0, 0, 0, 12, null, null, 60, 96, 0, 1);
    hex.noteOn();

    expect(hex.filterNode.frequency.value).toBeCloseTo(1000, 8);
    hex.cc74(64);
    hex.cc74(127);

    expect(hex.filterNode.frequency.setTargetAtTime.mock.calls[0][0]).toBeCloseTo(2400, 8);
    expect(hex.filterNode.frequency.setTargetAtTime.mock.calls[1][0]).toBeCloseTo(6000, 8);
  });

  it("keeps the Srutibox wheel top while using a brighter minimum", async () => {
    const synth = await create_sample_synth("sruti", 400, 0, [0, 100, 200]);
    await synth.prepare();
    const hex = synth.makeHex(null, 0, 0, 0, 12, null, null, 60, 96, 0, 1);
    hex.noteOn();

    expect(hex.filterNode.frequency.value).toBeCloseTo(2000, 8);
    hex.cc74(64);
    hex.cc74(127);

    expect(hex.filterNode.frequency.setTargetAtTime.mock.calls[0][0]).toBeCloseTo(3336, 8);
    expect(hex.filterNode.frequency.setTargetAtTime.mock.calls[1][0]).toBeCloseTo(12591, 8);
  });

  it("updates the Reed cutoff when a held voice is retuned", async () => {
    const synth = await create_sample_synth("WMRIByzantineST", 400, 0, [0, 100, 200]);
    await synth.prepare();
    const hex = synth.makeHex(null, 0, 0, 0, 12, null, null, 60, 96, 0, 1);
    hex.noteOn();
    hex.cc74(64);
    hex.filterNode.frequency.setTargetAtTime.mockClear();

    hex.retune(1200);

    expect(hex.filterNode.frequency.setTargetAtTime).toHaveBeenCalledOnce();
    expect(hex.filterNode.frequency.setTargetAtTime.mock.calls[0][0]).toBeCloseTo(4400, 8);
    expect(hex.filterNode.frequency.setTargetAtTime.mock.calls[0][2]).toBe(0.005);
  });

  it("retunes the active voice playback rate for standard wheel bend", async () => {
    const synth = await create_sample_synth("WMRIByzantineST", 440, 0, [0, 100, 200]);
    await synth.prepare();

    const hex = synth.makeHex(null, 0, 0, 0, 12, null, null, 60, 96, 0, 1);
    hex.noteOn();

    hex.standardWheelRetune(700);

    expect(hex.source.playbackRate.setValueAtTime).toHaveBeenCalledTimes(1);
    expect(hex.source.playbackRate.setValueAtTime.mock.calls[0][0]).toBeGreaterThan(1);
  });

  it("uses the unshifted cue layer so absolute live retune matches retrigger", async () => {
    const synth = await create_sample_synth("WMRIByzantineST", 440, 0, [0, 100, 200]);
    await synth.prepare();
    const sourceCents = 550;
    const targetCents = sourceCents + 147;
    const sourceOptions = { playbackSourceCents: sourceCents };

    const held = synth.makeHex(
      null,
      sourceCents,
      0,
      0,
      12,
      null,
      null,
      60,
      96,
      0,
      1,
      sourceOptions,
    );
    held.noteOn();
    held.sequenceRetune(targetCents);
    const heldRate = held.source.playbackRate.setTargetAtTime.mock.calls.at(-1)[0];

    const retriggered = synth.makeHex(
      null,
      targetCents,
      0,
      0,
      12,
      null,
      null,
      60,
      96,
      0,
      1,
      sourceOptions,
    );
    retriggered.noteOn();

    expect(held.sampleFreq).toBe(440);
    expect(retriggered.sampleFreq).toBe(440);
    expect(retriggered.source.playbackRate.value).toBeCloseTo(heldRate, 12);
  });

  it("wakes a suspended audio context without rebuilding decoded buffers", async () => {
    const synth = await create_sample_synth("WMRIByzantineST", 440, 0, [0, 100, 200]);
    await synth.prepare();

    const stateBefore = globalThis.window.AudioContext.prototype;
    void stateBefore;

    const context = synth.makeHex(null, 0, 0, 0, 12, null, null, 60, 96, 0, 1).audioContext;
    context.state = "suspended";

    await synth.ensureAwake();

    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.state).toBe("running");
  });

  it("creates a non-zero keepalive signal so the context stays active while idle", async () => {
    const synth = await create_sample_synth("WMRIByzantineST", 440, 0, [0, 100, 200]);
    await synth.prepare();

    const context = synth.makeHex(null, 0, 0, 0, 12, null, null, 60, 96, 0, 1).audioContext;
    expect(context.createdGains.some((node) => node.gain.value === 0.000001)).toBe(true);
    expect(context.createdConstantSources.some((node) => node.offset.value === 1)).toBe(true);
  });
});
