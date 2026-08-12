import { describe, expect, it, vi } from "vitest";
import { WebMidi } from "webmidi";
import { applyTimbreCC74, passthroughCC } from "./keys-expression-runtime.js";

describe("input/keys-expression-runtime timbre routing", () => {
  it("routes MPE-input CC74 through polyTimbre instead of generic cc74", () => {
    const polyTimbre = vi.fn();
    const cc74 = vi.fn();
    const hex = {
      release: false,
      polyTimbre,
      cc74,
    };

    applyTimbreCC74.call({ inputRuntime: { mpeInput: true } }, hex, 91, 12000);

    expect(hex._lastCC74).toBe(91);
    expect(hex._lastCC7414).toBe(12000);
    expect(polyTimbre).toHaveBeenCalledWith(91, 12000);
    expect(cc74).not.toHaveBeenCalled();
  });

  it("keeps non-MPE CC74 on the generic cc74 path", () => {
    const polyTimbre = vi.fn();
    const cc74 = vi.fn();
    const hex = {
      release: false,
      polyTimbre,
      cc74,
    };

    applyTimbreCC74.call({ inputRuntime: { mpeInput: false } }, hex, 72);

    expect(hex._lastCC74).toBe(72);
    expect(hex._lastCC7414).toBeNull();
    expect(polyTimbre).not.toHaveBeenCalled();
    expect(cc74).toHaveBeenCalledWith(72);
  });
});

describe("input/keys-expression-runtime Eagan Matrix routing", () => {
  it("mirrors incoming CC1 to Brightness CC13 on the MPE manager channel", () => {
    const mpeOutput = { sendControlChange: vi.fn() };
    const getOutputSpy = vi.spyOn(WebMidi, "getOutputById").mockReturnValue(mpeOutput);

    passthroughCC.call(
      {
        midiout_data: null,
        settings: {
          output_mpe: true,
          mpe_device: "mpe-output",
          midiin_mpe_manager_ch: "16",
          mpe_eagan_modwheel_brightness: true,
        },
      },
      1,
      91,
    );

    expect(mpeOutput.sendControlChange).toHaveBeenCalledWith(1, 91, { channels: 16 });
    expect(mpeOutput.sendControlChange).toHaveBeenCalledWith(13, 91, { channels: 16 });
    expect(sessionStorage.getItem("mpe_eagan_brightness")).toBe("91");

    getOutputSpy.mockRestore();
  });
});
