import { fireEvent, render, screen } from "@testing-library/preact";
import MidiOutputs from "./midioutputs.js";

const makeProps = (overrides = {}) => ({
  settings: {
    output_mts: true,
    midi_device: "OFF",
    midi_channel: 0,
    midi_mapping: "MTS1",
    sysex_type: 127,
    device_id: 127,
    tuning_map_number: 0,
    midiin_anchor_note: 60,
    midi_wheel_semitones: 2,
    fluidsynth_device: "",
    fluidsynth_channel: -1,
    output_mts_bulk: false,
    output_osc: false,
    ...overrides,
  },
  onChange: () => {},
  midi: {
    outputs: new Map([
      ["main-1", { id: "main-1", name: "Main Port" }],
      ["fluid-1", { id: "fluid-1", name: "FluidSynth Virtual Port" }],
    ]),
  },
  midiAccess: "sysex",
  onOscLayerVolumeChange: () => {},
});

describe("MidiOutputs FluidSynth independence", () => {
  it("labels the section as output routing", () => {
    render(<MidiOutputs {...makeProps()} />);

    expect(screen.getByText("Output Routing")).not.toBeNull();
  });

  it("shows 127 as the default FluidSynth volume when no preference is stored", () => {
    localStorage.removeItem("fluidsynth_volume_pref");

    render(
      <MidiOutputs
        {...makeProps({
          fluidsynth_device: "fluid-1",
          fluidsynth_channel: 0,
        })}
      />,
    );

    expect(screen.getByText("127")).not.toBeNull();
  });

  it("shows the channel-derived FluidSynth tuning map ID below the channel selector", () => {
    render(
      <MidiOutputs
        {...makeProps({
          fluidsynth_device: "fluid-1",
          fluidsynth_channel: 6,
        })}
      />,
    );

    expect(screen.getByText("Tuning Map ID = 7")).not.toBeNull();
  });

  it("pushes the stored FluidSynth volume to the newly selected FluidSynth channel", () => {
    localStorage.setItem("fluidsynth_volume_pref", "92");
    const fluidOutput = {
      id: "fluid-1",
      name: "FluidSynth Virtual Port",
      send: vi.fn(),
    };
    render(
      <MidiOutputs
        {...makeProps({
          fluidsynth_device: "fluid-1",
          fluidsynth_channel: 0,
        })}
        midi={{
          outputs: new Map([
            ["main-1", { id: "main-1", name: "Main Port" }],
            ["fluid-1", fluidOutput],
          ]),
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText("FluidSynth Channel"), {
      target: { value: "3" },
    });

    expect(fluidOutput.send).toHaveBeenCalledWith([0xb0 | 3, 7, 92]);
  });

  it("disconnects the FluidSynth mirror when FluidSynth is selected as the main MTS port", () => {
    const onChange = vi.fn();
    render(
      <MidiOutputs
        {...makeProps({
          midi_device: "main-1",
          fluidsynth_device: "fluid-1",
          fluidsynth_channel: 0,
        })}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "fluid-1" } });

    expect(onChange).toHaveBeenCalledWith("midi_device", "fluid-1");
    expect(onChange).toHaveBeenCalledWith("fluidsynth_device", "");
    expect(onChange).toHaveBeenCalledWith("fluidsynth_channel", -1);
  });

  it("blocks the FluidSynth mirror connect button when FluidSynth is already the main MTS port", () => {
    render(
      <MidiOutputs
        {...makeProps({
          midi_device: "fluid-1",
          fluidsynth_device: "",
          fluidsynth_channel: -1,
        })}
      />,
    );

    const button = screen.getByRole("button", { name: "In use via Port" });
    expect(button.disabled).toBe(true);
  });

  it("updates OSC layer volume imperatively during drag and persists locally on commit", () => {
    const onChange = vi.fn();
    const onOscLayerVolumeChange = vi.fn();

    render(
      <MidiOutputs
        {...makeProps({
          output_osc: true,
          osc_volume_pluck: 0.5,
        })}
        onChange={onChange}
        onOscLayerVolumeChange={onOscLayerVolumeChange}
      />,
    );

    const slider = screen.getAllByRole("slider")[0];
    fireEvent.input(slider, { target: { value: "0.73" } });

    expect(onOscLayerVolumeChange).toHaveBeenCalledWith(0, 0.73);
    expect(onChange).not.toHaveBeenCalledWith("osc_volume_pluck", 0.73);

    fireEvent.change(slider, { target: { value: "0.73" } });

    expect(onChange).not.toHaveBeenCalledWith("osc_volume_pluck", 0.73);
    expect(localStorage.getItem("osc_volume_pluck")).toBe("0.73");
    expect(sessionStorage.getItem("osc_volume_pluck")).toBe("0.73");
  });

  it("shows Haken Continuum MPE output defaults as standard mode with 96-semitone bend range", () => {
    render(
      <MidiOutputs
        {...makeProps({
          output_mpe: true,
          mpe_device: "main-1",
          midiin_controller_override: "hakenaudio",
          mpe_mode: "standard",
          mpe_pitchbend_range: 96,
        })}
      />,
    );

    expect(screen.getByLabelText("Message Style").value).toBe("standard");
    expect(screen.getByLabelText("MPE PB Range (semitones)").value).toBe("96");
    expect(screen.getByText("MPE standard: nearest notes & user PB")).not.toBeNull();
  });
});
