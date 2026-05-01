import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create_sample_synth } from "./index.js";

class MockAudioContext {
  constructor() {
    this.state = "running";
    this.currentTime = 0;
    this.destination = {};
  }

  async resume() {}

  async close() {
    this.state = "closed";
  }

  async decodeAudioData(buffer) {
    return { decoded: buffer.byteLength };
  }

  createGain() {
    return {
      gain: {
        value: 0,
        setTargetAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
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
    vi.stubGlobal("fetch", vi.fn(async () => ({
      arrayBuffer: async () => new ArrayBuffer(8),
    })));
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
    expect(hex.filterNode.frequency.setTargetAtTime.mock.calls[0][0]).toBeGreaterThan(initialFrequency);
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
});
