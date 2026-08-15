import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { beforeEach } from "vitest";
import { EAGAN_BRIGHTNESS_EVENT, EAGAN_TILT_EQ_EVENT } from "../../mpe_synth/eagan-matrix.js";
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
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("labels the section as output routing", () => {
    render(<MidiOutputs {...makeProps()} />);

    expect(screen.getByText("Output Routing")).not.toBeNull();
  });

  it("selects the complete tuning map number on first pointer focus", () => {
    render(<MidiOutputs {...makeProps({ midi_device: "main-1" })} />);
    const input = screen.getByLabelText("Tuning Map Number");

    fireEvent.pointerDown(input);

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
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

  it("shows the channel-derived FluidSynth tuning map number below the channel selector", () => {
    render(
      <MidiOutputs
        {...makeProps({
          fluidsynth_device: "fluid-1",
          fluidsynth_channel: 6,
        })}
      />,
    );

    expect(screen.getByText("Tuning Map Number = 7")).not.toBeNull();
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

  it("updates OSC layer volume through the custom slider and persists locally on commit", () => {
    const onChange = vi.fn();
    const onOscLayerVolumeChange = vi.fn();

    render(
      <MidiOutputs
        {...makeProps({
          output_osc: true,
          osc_volume_pluck: 0.72,
        })}
        onChange={onChange}
        onOscLayerVolumeChange={onOscLayerVolumeChange}
      />,
    );

    const slider = screen.getByRole("slider", { name: "Pluck volume" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });

    expect(onOscLayerVolumeChange).toHaveBeenCalledWith(0, 0.73);
    expect(onChange).not.toHaveBeenCalledWith("osc_volume_pluck", 0.73);

    expect(onChange).not.toHaveBeenCalledWith("osc_volume_pluck", 0.73);
    expect(localStorage.getItem("osc_volume_pluck")).toBe("0.73");
    expect(sessionStorage.getItem("osc_volume_pluck")).toBe("0.73");
  });

  it("uses one Sustain toggle and one Retrigger toggle for Buzz and Formant", () => {
    const onChange = vi.fn();
    render(
      <MidiOutputs
        {...makeProps({
          output_osc: true,
          osc_sustain_buzz_formant: false,
          osc_retrigger_buzz_formant: false,
        })}
        onChange={onChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Sustain Buzz + Formant until note-off" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Retrigger Buzz + Formant while held" }));

    expect(onChange).toHaveBeenCalledWith("osc_sustain_buzz_formant", true);
    expect(onChange).toHaveBeenCalledWith("osc_retrigger_buzz_formant", true);
    expect(localStorage.getItem("osc_sustain_buzz_formant")).toBe("true");
    expect(localStorage.getItem("osc_retrigger_buzz_formant")).toBe("true");
  });

  it("offers the renamed Release Time control up to 2500 ms", () => {
    render(
      <MidiOutputs
        {...makeProps({
          output_osc: true,
          osc_quick_release_time: 0.25,
        })}
      />,
    );

    const releaseTime = screen.getByLabelText("Release Time");
    expect(releaseTime.getAttribute("aria-valuemax")).toBe("2.5");
    expect(screen.queryByLabelText("Quick Release Time")).toBeNull();
  });

  it("labels the release envelope as a release-time override blend", () => {
    render(
      <MidiOutputs
        {...makeProps({
          output_osc: true,
          osc_quick_release: 0.5,
        })}
      />,
    );

    expect(screen.getByLabelText("Release Override Amount")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("Blend between velocity-based release and Release Time")).toBeTruthy();
    expect(screen.queryByLabelText("Quick Release")).toBeNull();
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
    expect(screen.getByLabelText("MPE+ PB").checked).toBe(false);
    expect(screen.getByText("MPE standard: nearest notes & user PB")).not.toBeNull();
  });

  it("lets the user enable MPE+ pitch-bend CC87 output explicitly", () => {
    const onChange = vi.fn();
    render(
      <MidiOutputs
        {...makeProps({
          output_mpe: true,
          mpe_device: "main-1",
          mpe_mode: "standard",
          mpe_plus_output: false,
        })}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByLabelText("MPE+ PB"));

    expect(onChange).toHaveBeenCalledWith("mpe_plus_output", true);
  });

  it("offers automatic Y/Z generation only inside configured MPE output routing", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MidiOutputs
        {...makeProps({
          output_mpe: false,
          mpe_device: "OFF",
          mpe_auto_generate_yz: false,
        })}
        onChange={onChange}
      />,
    );

    expect(screen.queryByLabelText("Auto-Generate MPE YZ")).toBeNull();

    rerender(
      <MidiOutputs
        {...makeProps({
          output_mpe: true,
          mpe_device: "main-1",
          mpe_auto_generate_yz: false,
        })}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Auto-Generate MPE YZ"));

    expect(screen.getByRole("group", { name: "Eagan Matrix" })).not.toBeNull();
    expect(onChange).toHaveBeenCalledWith("mpe_auto_generate_yz", true);
  });

  it("sends and persists Eagan Matrix controls on the MPE manager channel", () => {
    const onChange = vi.fn();
    const mpeOutput = {
      id: "main-1",
      name: "Main Port",
      send: vi.fn(),
    };
    render(
      <MidiOutputs
        {...makeProps({
          output_mpe: true,
          mpe_device: "main-1",
          midiin_mpe_manager_ch: "16",
          mpe_eagan_brightness: 64,
          mpe_eagan_tilt_eq: 65,
          mpe_eagan_pre_level: 66,
          mpe_eagan_post_level: 67,
        })}
        onChange={onChange}
        midi={{
          outputs: new Map([
            ["main-1", mpeOutput],
            ["fluid-1", { id: "fluid-1", name: "FluidSynth Virtual Port" }],
          ]),
        }}
      />,
    );

    const controls = [
      ["Brightness", 13, 65, "mpe_eagan_brightness"],
      ["Tilt EQ", 83, 66, "mpe_eagan_tilt_eq"],
      ["Pre Level", 26, 67, "mpe_eagan_pre_level"],
      ["Post Level", 18, 68, "mpe_eagan_post_level"],
    ];

    for (const [label, cc, value, key] of controls) {
      const slider = screen.getByRole("slider", { name: label });
      fireEvent.keyDown(slider, { key: "ArrowRight" });

      expect(mpeOutput.send).toHaveBeenCalledWith([0xbf, cc, value]);
      expect(onChange).toHaveBeenCalledWith(key, value);
      expect(sessionStorage.getItem(key)).toBe(String(value));
      expect(slider.getAttribute("aria-valuenow")).toBe(String(value));
    }

    expect(mpeOutput.send.mock.calls).toEqual([
      [[0xbf, 13, 65]],
      [[0xbf, 83, 66]],
      [[0xbf, 26, 67]],
      [[0xbf, 18, 68]],
    ]);
  });

  it("defaults Eagan Matrix controls to 64 and sends them when Auto-Generate is enabled", () => {
    const onChange = vi.fn();
    const mpeOutput = {
      id: "main-1",
      name: "Main Port",
      send: vi.fn(),
    };
    render(
      <MidiOutputs
        {...makeProps({
          output_mpe: true,
          mpe_device: "main-1",
          midiin_mpe_manager_ch: "1",
          mpe_auto_generate_yz: false,
        })}
        onChange={onChange}
        midi={{
          outputs: new Map([
            ["main-1", mpeOutput],
            ["fluid-1", { id: "fluid-1", name: "FluidSynth Virtual Port" }],
          ]),
        }}
      />,
    );

    for (const label of ["Brightness", "Tilt EQ", "Pre Level", "Post Level"]) {
      expect(screen.getByRole("slider", { name: label }).getAttribute("aria-valuenow")).toBe("64");
    }

    fireEvent.click(screen.getByLabelText("Auto-Generate MPE YZ"));

    expect(mpeOutput.send.mock.calls).toEqual([
      [[0xb0, 13, 64]],
      [[0xb0, 83, 64]],
      [[0xb0, 26, 64]],
      [[0xb0, 18, 64]],
    ]);
    expect(onChange).toHaveBeenCalledWith("mpe_auto_generate_yz", true);
  });

  it("enables Mod Wheel to Brightness and Tilt EQ and follows incoming CC1 values", async () => {
    const onChange = vi.fn();
    render(
      <MidiOutputs
        {...makeProps({
          output_mpe: true,
          mpe_device: "main-1",
          mpe_eagan_modwheel_brightness: false,
          mpe_eagan_brightness: 64,
        })}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByLabelText("Mod Wheel → Brightness + Tilt EQ"));
    expect(onChange).toHaveBeenCalledWith("mpe_eagan_modwheel_brightness", true);

    fireEvent(window, new CustomEvent(EAGAN_BRIGHTNESS_EVENT, { detail: { value: 103 } }));
    fireEvent(window, new CustomEvent(EAGAN_TILT_EQ_EVENT, { detail: { value: 103 } }));

    await waitFor(() => {
      expect(screen.getByRole("slider", { name: "Brightness" }).getAttribute("aria-valuenow")).toBe(
        "103",
      );
      expect(screen.getByRole("slider", { name: "Tilt EQ" }).getAttribute("aria-valuenow")).toBe(
        "103",
      );
    });
    expect(onChange).not.toHaveBeenCalledWith("mpe_eagan_brightness", 103);
  });
});
