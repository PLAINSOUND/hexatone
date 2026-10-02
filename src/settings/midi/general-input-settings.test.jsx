import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import GeneralInputSettings from "./general-input-settings.js";

const props = {
  hasBasicMidi: false,
  settings: { midiin_device: "OFF", midiin_mapping_target: "hex_layout", midi_passthrough: false },
  controllerOverrideId: "auto",
  manualControllerOptions: [],
  linnstrumentUserFirmwareEligible: false,
  deactivateLinnstrumentUserFirmwareNow: () => {},
  resolveControllerSelection: () => null,
  isLinnstrumentUserFirmwareEligible: () => false,
  scaleMode: false,
  saveControllerPref: () => {},
  onChange: () => {},
};

describe("General MIDI input settings", () => {
  it("disables controller geometry and input mode when MIDI is unavailable", () => {
    render(<GeneralInputSettings {...props} />);
    expect(screen.getByLabelText("Controller Geometry").disabled).toBe(true);
    expect(screen.getByLabelText("Input Mode").disabled).toBe(true);
  });
});
