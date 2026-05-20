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
  hakenPedalLearnActive: false,
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

  it("offers Haken Continuum as a manual controller geometry option", () => {
    const props = makeProps();
    render(<MIDIio {...props} />);

    expect(screen.getByRole("option", { name: "Haken Continuum" })).toBeTruthy();
  });

  it("shows controller registry text when a known controller geometry is auto-detected", () => {
    const props = makeProps({
      midiin_controller_override: "auto",
    });
    render(<MIDIio {...props} />);

    expect(screen.getByText("Roger Linn Design LinnStrument")).toBeTruthy();
    expect(screen.getByText(/Hexatone activates User Firmware Mode to colour pads and assign geometry/)).toBeTruthy();
    expect(screen.queryByText("Detected: Roger Linn Design LinnStrument")).toBeNull();
  });

  it("does not show auto-detect status text when no known controller geometry is recognised", () => {
    const props = makeProps({
      midiin_controller_override: "auto",
    });
    props.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "USB MIDI Interface" }]]),
      outputs: new Map(),
    };

    render(<MIDIio {...props} />);

    expect(screen.queryByText("No known geometry detected")).toBeNull();
    expect(screen.queryByText("Waiting for MIDI input")).toBeNull();
  });

  it("keeps the same controller registry text visible in nearest-scale input mode", () => {
    const props = makeProps({
      midiin_controller_override: "auto",
      midiin_mapping_target: "scale",
    });

    render(<MIDIio {...props} />);

    expect(screen.getByText("Roger Linn Design LinnStrument")).toBeTruthy();
    expect(screen.getByText(/Hexatone activates User Firmware Mode to colour pads and assign geometry/)).toBeTruthy();
  });

  it("constrains Haken Continuum MPE member-channel selectors to 2-14", () => {
    const props = makeProps({
      midiin_controller_override: "hakenaudio",
      midiin_mpe_input: false,
    });
    props.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "Haken Audio Continuum" }]]),
      outputs: new Map(),
    };

    render(<MIDIio {...props} />);

    const selects = screen.getAllByLabelText(/Member Channel/);
    const option14 = screen.getAllByRole("option", { name: "14" });
    expect(selects).toHaveLength(2);
    expect(option14.length).toBeGreaterThan(0);
    expect(screen.queryByRole("option", { name: "15" })).toBeNull();
    expect(screen.queryByRole("option", { name: "16" })).toBeNull();
  });

  it("hides the MPE toggle for Haken Continuum while keeping member-channel controls visible", () => {
    const props = makeProps({
      midiin_controller_override: "hakenaudio",
      midiin_mpe_input: false,
    });
    props.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "Haken Audio Continuum" }]]),
      outputs: new Map(),
    };

    render(<MIDIio {...props} />);

    expect(screen.queryByRole("checkbox", { name: "Enable MPE Input" })).toBeNull();
    expect(screen.getAllByLabelText(/Member Channel/)).toHaveLength(2);
  });

  it("shows Continuum nearest-scale follow-scale controls and hides generic bend controls", () => {
    const props = makeProps({
      midiin_controller_override: "hakenaudio",
      midiin_mapping_target: "scale",
      midiin_mpe_input: true,
    });
    props.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "Haken Audio Continuum" }]]),
      outputs: new Map(),
    };

    render(<MIDIio {...props} />);

    expect(screen.getByText("X Glide Shaping")).toBeTruthy();
    expect(screen.queryByText("Pitch Bending Scale Factor")).toBeNull();
    expect(screen.queryByLabelText("Pitch Bending Interval (Scala)")).toBeNull();
    expect(screen.queryByLabelText("Reverse Bend Direction")).toBeNull();
  });

  it("shows a default 96-semitone incoming MPE bend range for Haken Continuum", () => {
    const props = makeProps({
      midiin_controller_override: "hakenaudio",
      midiin_mapping_target: "scale",
      midiin_mpe_input: true,
      midiin_scale_bend_range: undefined,
    });
    props.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "Haken Audio Continuum" }]]),
      outputs: new Map(),
    };

    render(<MIDIio {...props} />);

    expect(screen.getByLabelText("MPE Pitch Bend Range").value).toBe("96");
  });

  it("keeps the shared Continuum performance controls visible in Raster to Notes mode", () => {
    const props = makeProps({
      midiin_controller_override: "hakenaudio",
      midiin_mapping_target: "scale",
      midiin_mpe_input: true,
      hakenaudio_x_glide_mode: "raster_to_notes",
    });
    props.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "Haken Audio Continuum" }]]),
      outputs: new Map(),
    };

    render(<MIDIio {...props} />);

    expect(screen.getByText("Pressure → Velocity")).toBeTruthy();
    expect(screen.getByText("Minimum Note Duration")).toBeTruthy();
    expect(screen.getByText("Minimum Retrigger Interval")).toBeTruthy();
    expect(screen.getByText("Raster Stability")).toBeTruthy();
    expect(screen.queryByText("Pitch Bending Scale Factor")).toBeNull();
    expect(screen.getByText("X Glide Shaping")).toBeTruthy();
  });

  it("shows Continuum Raster to Notes controls in geometry-aware hex layout as well as scale mode", () => {
    const props = makeProps({
      midiin_controller_override: "hakenaudio",
      midiin_mapping_target: "hex_layout",
      midiin_mpe_input: true,
      midi_passthrough: false,
      hakenaudio_x_glide_mode: "raster_to_notes",
    });
    props.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "Haken Audio Continuum" }]]),
      outputs: new Map(),
    };

    render(<MIDIio {...props} />);

    expect(screen.getByText("Pressure → Velocity")).toBeTruthy();
    expect(screen.getByText("Minimum Note Duration")).toBeTruthy();
    expect(screen.getByText("Minimum Retrigger Interval")).toBeTruthy();
    expect(screen.getByText("Raster Stability")).toBeTruthy();
  });

  it("hides the generic 2D geometry status line for Haken Continuum", () => {
    const props = makeProps({
      midiin_controller_override: "hakenaudio",
      midiin_mapping_target: "hex_layout",
      midiin_mpe_input: true,
      hakenaudio_x_glide_mode: "pitch_bending",
    });
    props.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "Haken Audio Continuum" }]]),
      outputs: new Map(),
    };

    render(<MIDIio {...props} />);

    expect(screen.queryByText("always active")).toBeNull();
    expect(screen.queryByText("2D Geometry")).toBeNull();
    expect(screen.queryByLabelText("Sequential mode (bypass 2D geometry)")).toBeNull();
    expect(screen.queryByText("Pitch Bending Scale Factor")).toBeNull();
    expect(screen.getByText("X Glide Shaping")).toBeTruthy();
    expect(screen.getByText("Pressure → Velocity")).toBeTruthy();
    expect(screen.getByText("Minimum Note Duration")).toBeTruthy();
  });

  it("shows CC67 as the default Continuum glide flip pedal and resets to it", () => {
    const props = makeProps({
      midiin_controller_override: "hakenaudio",
      midiin_mapping_target: "hex_layout",
      midiin_mpe_input: true,
      hakenaudio_glide_flip_cc: 74,
    });
    props.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "Haken Audio Continuum" }]]),
      outputs: new Map(),
    };

    render(<MIDIio {...props} />);

    expect(screen.getByText("CC 74")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(props.onChange).toHaveBeenCalledWith("hakenaudio_glide_flip_cc", 67);
  });

  it("offers manager and member channel controls for undetected controllers when MPE input is enabled", () => {
    const props = makeProps({
      midiin_controller_override: "auto",
      midiin_mpe_input: true,
    });
    props.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "USB MIDI Interface" }]]),
      outputs: new Map(),
    };

    render(<MIDIio {...props} />);

    expect(screen.getByLabelText("Manager Channel")).toBeTruthy();
    const memberSelects = screen.getAllByLabelText(/Member Channel/);
    expect(memberSelects).toHaveLength(2);
    expect(screen.getByDisplayValue("Channel 1")).toBeTruthy();
    expect(screen.getByDisplayValue("2")).toBeTruthy();
    expect(screen.getByDisplayValue("8")).toBeTruthy();
    expect(screen.getByLabelText("MPE Pitch Bend Range")).toBeTruthy();
    expect(screen.getByDisplayValue("48")).toBeTruthy();
  });

  it("shows Pitch Wheel → Most Recent Note with the unknown-controller options when MPE input is off", () => {
    const props = makeProps({
      midiin_controller_override: "auto",
      midiin_mpe_input: false,
    });
    props.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "USB MIDI Interface" }]]),
      outputs: new Map(),
    };

    render(<MIDIio {...props} />);

    expect(screen.getByRole("checkbox", { name: "Pitch Wheel → Most Recent Note" })).toBeTruthy();
  });

  it("keeps the unknown-controller anchor row highlighted as the center degree row in MIDI to Hex Layout", () => {
    const props = makeProps({
      midiin_controller_override: "auto",
      midiin_mapping_target: "hex_layout",
    });
    props.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "USB MIDI Interface" }]]),
      outputs: new Map(),
    };

    const { container } = render(<MIDIio {...props} />);
    const label = Array.from(container.querySelectorAll("label")).find((node) =>
      node.textContent?.includes("Anchor Note → Central Degree"),
    );

    expect(label?.classList.contains("center-degree-row")).toBe(true);
    expect(label?.classList.contains("center-degree-label")).toBe(true);
  });

  it("hides the unknown-controller anchor channel field when MPE input is enabled in MIDI to Hex Layout", () => {
    const props = makeProps({
      midiin_controller_override: "auto",
      midiin_mapping_target: "hex_layout",
      midiin_mpe_input: true,
    });
    props.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "USB MIDI Interface" }]]),
      outputs: new Map(),
    };

    render(<MIDIio {...props} />);

    expect(screen.queryByTitle("MIDI channel of anchor note (other channels shift by stepsPerChannel)")).toBeNull();
  });

  it("reseeds unknown-controller MPE defaults to member channels 2-8 when enabling from the generic 2-15 session default", () => {
    const props = makeProps({
      midiin_controller_override: "auto",
      midiin_mpe_input: false,
      midiin_mpe_lo_ch: 2,
      midiin_mpe_hi_ch: 15,
    });
    props.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "USB MIDI Interface" }]]),
      outputs: new Map(),
    };

    render(<MIDIio {...props} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Enable MPE Input" }));

    expect(props.onChange).toHaveBeenCalledWith("midiin_mpe_input", true);
    expect(props.onChange).toHaveBeenCalledWith("midiin_mpe_hi_ch", 8);
  });

  it("keeps Controller Geometry visible in nearest-scale input mode", () => {
    const props = makeProps({
      midiin_mapping_target: "scale",
    });

    render(<MIDIio {...props} />);

    expect(screen.getByLabelText("Controller Geometry")).toBeTruthy();
  });

  it("renders Generic Keyboard from its dedicated controller module", () => {
    const props = makeProps({
      midiin_controller_override: "generic",
    });
    props.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "USB MIDI Interface" }]]),
      outputs: new Map(),
    };

    render(<MIDIio {...props} />);

    expect(screen.getByText("2D geometry is bypassed")).toBeTruthy();
    expect(screen.getByTitle("Single-channel controller (ch 1)")).toBeTruthy();
  });

  it("renders Tonal Plexus from its dedicated controller module", () => {
    const props = makeProps({
      midiin_controller_override: "tonalplexus",
    });
    props.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "Tonal Plexus" }]]),
      outputs: new Map(),
    };

    render(<MIDIio {...props} />);

    expect(screen.getByLabelText("Tonal Plexus Mode")).toBeTruthy();
    expect(screen.getByRole("option", { name: "41 notes per block" })).toBeTruthy();
  });

  it("renders Lumatone LED controls from its dedicated controller module", () => {
    const props = makeProps({
      midiin_controller_override: "lumatone",
      midi_passthrough: false,
    });
    props.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "Lumatone" }]]),
      outputs: new Map(),
    };
    props.lumatoneRawPorts = { output: { id: "lumatone-out", name: "Lumatone MIDI" } };
    props.midiAccess = "sysex";

    render(<MIDIio {...props} />);

    expect(screen.getByText("Send Blank Key Layout")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Automatically Send LED Colours/ })).toBeTruthy();
  });

  it("renders Exquis LED controls from its dedicated controller module", () => {
    const props = makeProps({
      midiin_controller_override: "exquis",
      midi_passthrough: false,
    });
    props.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "Exquis" }]]),
      outputs: new Map(),
    };
    props.exquisRawPorts = { output: { id: "exquis-out", name: "Exquis MIDI" } };
    props.midiAccess = "sysex";

    render(<MIDIio {...props} />);

    expect(screen.getByText("LED Brightness")).toBeTruthy();
    expect(screen.getByText("LED Saturation")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Auto Send Colours/ })).toBeTruthy();
  });
});
