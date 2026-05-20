import { fireEvent, render, screen } from "@testing-library/preact";
import HakenContinuumSettings from "./haken-continuum-settings.js";

describe("HakenContinuumSettings", () => {
  it("stores the Continuum output port override for the current session only", () => {
    const onChange = vi.fn();
    const saveControllerPref = vi.fn();
    const settings = {
      hakenaudio_out_port: null,
      hakenaudio_x_glide_mode: "pitch_bending",
      hakenaudio_glide_flip_cc: 67,
    };
    const midiOutputs = new Map([
      ["umone-out", { id: "umone-out", name: "UM-ONE" }],
      ["other-out", { id: "other-out", name: "Other Port" }],
    ]);

    render(
      <HakenContinuumSettings
        ctrl={{ id: "hakenaudio" }}
        settings={settings}
        rawPorts={{ output: { id: "umone-out", name: "UM-ONE" } }}
        midiOutputs={midiOutputs}
        onChange={onChange}
        saveControllerPref={saveControllerPref}
        hakenPedalLearnActive={false}
      />,
    );

    fireEvent.click(screen.getByText("Continuum Control Port"));
    fireEvent.change(screen.getByDisplayValue("Auto detect"), {
      target: { value: "other-out" },
    });

    expect(onChange).toHaveBeenCalledWith("hakenaudio_out_port", "other-out");
    expect(saveControllerPref).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("hakenaudio_out_port")).toBe("other-out");
  });
});
