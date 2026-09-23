import { describe, expect, it, vi } from "vitest";
import { allowsPerformanceCC } from "./performance-cc-policy.js";
import { getControllerState, passthroughCC } from "../input/keys-expression-runtime.js";
import { WebMidi } from "webmidi";

describe("automatic performance CC policy", () => {
  it("enforces the same live policy on MPE manager forwarding", () => {
    const sendControlChange = vi.fn();
    const spy = vi.spyOn(WebMidi, "getOutputById").mockReturnValue({ sendControlChange });
    try {
      const runtime = {
        settings: { output_mpe: true, mpe_device: "mpe", midiin_mpe_manager_ch: 16 },
      };
      for (let cc = 0; cc < 128; cc++) passthroughCC.call(runtime, cc, 64);
      expect(sendControlChange.mock.calls).toEqual(
        [1, 2, 3, 4, 7, 11, 64, 66, 67, 74].map((cc) => [cc, 64, { channels: 16 }]),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("retains the stricter Continuum policy and excludes its assigned pedal", () => {
    const sendControlChange = vi.fn();
    const runtime = {
      controller: { id: "hakenaudio" },
      settings: { midi_device: "out", midi_channel: 0, hakenaudio_glide_flip_cc: 4 },
      midiout_data: { sendControlChange },
      _controllerCCValues: new Map([
        [1, 64],
        [4, 64],
        [64, 127],
        [126, 1],
      ]),
    };
    for (const cc of [4, 64, 66, 67, 87, 126]) passthroughCC.call(runtime, cc, 64);
    expect(sendControlChange).not.toHaveBeenCalled();
    expect(getControllerState.call(runtime).ccValues).toEqual({ 1: 64 });
  });
  it("allows only selected performance controls", () => {
    const allowed = [1, 2, 3, 4, 7, 11, 64, 66, 67, 74];
    for (let cc = 0; cc < 128; cc++) {
      expect(allowsPerformanceCC(cc)).toBe(allowed.includes(cc));
    }
  });
  it("blocks mode forwarding and stale cached commands", () => {
    const sendControlChange = vi.fn();
    const runtime = {
      midiout_data: { sendControlChange },
      settings: { midi_device: "test", midi_channel: 1 },
      _controllerCCValues: new Map([
        [1, 64],
        [126, 1],
        [127, 0],
        [12, 73],
      ]),
    };
    for (const cc of [12, 120, 121, 123, 124, 125, 126, 127]) {
      passthroughCC.call(runtime, cc, 0);
    }
    expect(sendControlChange).not.toHaveBeenCalled();
    passthroughCC.call(runtime, 64, 127);
    expect(sendControlChange).toHaveBeenCalledWith(64, 127, { channels: 2 });
    expect(getControllerState.call(runtime).ccValues).toEqual({ 1: 64 });
  });
});
