import { fireEvent, render, screen } from "@testing-library/preact";
import MIDIio from "./index.js";
import { deactivateLinnstrumentUserFirmware } from "../../controllers/linnstrument-user-firmware.js";

vi.mock("../../input/controller-anchor.js", () => ({
  saveControllerPref: vi.fn(),
}));

vi.mock("../../controllers/linnstrument-user-firmware.js", () => ({
  deactivateLinnstrumentUserFirmware: vi.fn(),
  isLinnstrumentUserFirmwareEligible: ({ controllerId, scaleMode, midiPassthrough, midiinDevice }) =>
    controllerId === "linnstrument" &&
    !scaleMode &&
    !midiPassthrough &&
    !!midiinDevice &&
    midiinDevice !== "OFF",
}));

const makeProps = (settings = {}) => ({
  settings: {
    midiin_device: "input-1",
    midiin_controller_override: "linnstrument",
    midiin_mapping_target: "hex_layout",
    midi_passthrough: false,
    midiin_mpe_input: false,
    midiin_steps_per_channel: 0,
    midiin_scale_tolerance: 25,
    midiin_scale_fallback: "accept",
    midiin_pitchbend_mode: "recency",
    midiin_pressure_mode: "all",
    midiin_bend_range: "64/63",
    midi_wheel_semitones: 2,
    wheel_to_recent: false,
    wheel_scale_aware: false,
    linnstrument_led_sync: true,
    linnstrument_channel_allocation: "single_channel",
    ...settings,
  },
  onChange: vi.fn(),
  midi: {
    inputs: new Map([["input-1", { id: "input-1", name: "Roger Linn Design LinnStrument 128" }]]),
    outputs: new Map(),
  },
  midiAccess: "basic",
  keysRef: { current: {} },
  linnstrumentRawPorts: { output: { id: "out-1" } },
  enableWebMidi: vi.fn(),
  disableWebMidi: vi.fn(),
  onVolumeChange: vi.fn(),
  midiLearnActive: false,
  onAnchorLearn: vi.fn(),
  onTakeSnapshot: vi.fn(),
  lumatoneRawPorts: null,
  exquisRawPorts: null,
});

describe("MIDIio LinnStrument controller selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps UF active when switching from manual LinnStrument to Auto Detect on a detected LinnStrument", () => {
    const props = makeProps();
    render(<MIDIio {...props} />);

    fireEvent.change(screen.getByLabelText("Controller Geometry"), {
      target: { value: "auto" },
    });

    expect(deactivateLinnstrumentUserFirmware).not.toHaveBeenCalled();
    expect(props.onChange).toHaveBeenCalledWith("midiin_controller_override", "auto");
  });

  it("deactivates UF when switching from LinnStrument to a non-LinnStrument geometry", () => {
    const props = makeProps();
    render(<MIDIio {...props} />);

    fireEvent.change(screen.getByLabelText("Controller Geometry"), {
      target: { value: "generic" },
    });

    expect(deactivateLinnstrumentUserFirmware).toHaveBeenCalledTimes(1);
    expect(props.onChange).toHaveBeenCalledWith("midiin_controller_override", "generic");
  });
});
