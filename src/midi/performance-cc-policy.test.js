import { describe, expect, it, vi } from "vitest";
import { allowsPerformanceCC } from "./performance-cc-policy.js";
import { getControllerState, passthroughCC } from "../input/keys-expression-runtime.js";

describe("automatic performance CC policy", () => {
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
      _controllerCCValues: new Map([[1, 64], [126, 1], [127, 0], [12, 73]]),
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
