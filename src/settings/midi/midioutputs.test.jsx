import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { beforeEach, vi } from "vitest";
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
    sessionStorage.setItem("hexatone_midi_output_collapsed", "false");
  });

  it("defaults to collapsed in a fresh session", () => {
    sessionStorage.removeItem("hexatone_midi_output_collapsed");
    render(<MidiOutputs {...makeProps()} />);
    expect(screen.getByRole("button", { name: "Show MIDI Output settings" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("checkbox", { name: "MTS Real-Time Tuning" })).toBeTruthy();
  });

  it("keeps all four output switches actionable while configuration is collapsed", () => {
    sessionStorage.removeItem("hexatone_midi_output_collapsed");
    const props = makeProps();
    props.onChange = vi.fn();
    render(<MidiOutputs {...props} />);
    for (const [name, key] of [
      ["Monophonic Single-Channel MIDI", "output_mono"],
      ["MTS Real-Time Tuning", "output_mts"],
      ["MTS Bulk Dump Tuning Maps", "output_mts_bulk"],
      ["MPE", "output_mpe"],
    ]) {
      const toggle = screen.getByRole("checkbox", { name, exact: true });
      expect(toggle.closest("label").classList.contains("midi-output-toggle-row")).toBe(true);
      fireEvent.click(toggle);
      expect(props.onChange).toHaveBeenCalledWith(key, !props.settings[key]);
    }
  });

  it.each([
    ["Monophonic Single-Channel MIDI", "output_mono"],
    ["MTS Real-Time Tuning", "output_mts"],
    ["MTS Bulk Dump Tuning Maps", "output_mts_bulk"],
    ["MPE", "output_mpe"],
  ])("opens settings when enabling %s", (name, key) => {
    sessionStorage.removeItem("hexatone_midi_output_collapsed");
    const props = makeProps({ [key]: false });
    props.onChange = vi.fn();
    const view = render(<MidiOutputs {...props} />);
    fireEvent.click(screen.getByRole("checkbox", { name, exact: true }));
    expect(props.onChange).toHaveBeenCalledWith(key, true);
    view.rerender(<MidiOutputs {...props} settings={{ ...props.settings, [key]: true }} />);
    expect(screen.getByRole("button", { name: "Hide MIDI Output settings" })).toBeTruthy();
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
    expect(sessionStorage.getItem("hexatone_midi_output_collapsed")).toBe("false");
    fireEvent.click(screen.getByRole("checkbox", { name, exact: true }));
    expect(props.onChange).toHaveBeenCalledWith(key, false);
    expect(screen.getByRole("button", { name: "Hide MIDI Output settings" })).toBeTruthy();
    view.unmount();
    render(<MidiOutputs {...props} />);
    expect(screen.getByRole("button", { name: "Hide MIDI Output settings" })).toBeTruthy();
  });

  it("keeps settings collapsed when disabling an output", () => {
    sessionStorage.removeItem("hexatone_midi_output_collapsed");
    const props = makeProps({ output_mts: true });
    props.onChange = vi.fn();
    render(<MidiOutputs {...props} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "MTS Real-Time Tuning" }));
    expect(props.onChange).toHaveBeenCalledWith("output_mts", false);
    expect(screen.getByRole("button", { name: "Show MIDI Output settings" })).toBeTruthy();
  });

  it("does not reveal initially enabled output configuration until the fieldset is expanded", () => {
    sessionStorage.removeItem("hexatone_midi_output_collapsed");
    const props = makeProps({ output_mono: true, output_mts: true, output_mts_bulk: true, output_mpe: true });
    render(<MidiOutputs {...props} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Show MIDI Output settings" }));
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Hide MIDI Output settings" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  it("labels the section as MIDI Output", () => {
    render(<MidiOutputs {...makeProps()} />);

    expect(screen.getByText("MIDI Output")).not.toBeNull();
  });
  it("collapses routing controls without changing output settings and remembers the disclosure", () => {
    const props = makeProps();
    props.onChange = vi.fn();
    const view = render(<MidiOutputs {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide MIDI Output settings" }));
    expect(screen.getByRole("button", { name: "Show MIDI Output settings" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("checkbox", { name: "MTS Real-Time Tuning" })).toBeTruthy();
    expect(props.onChange).not.toHaveBeenCalled();
    view.unmount();
    render(<MidiOutputs {...props} />);
    expect(screen.getByRole("button", { name: "Show MIDI Output settings" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show MIDI Output settings" }));
    expect(screen.getByRole("checkbox", { name: "MTS Real-Time Tuning" }).checked).toBe(true);
  });

  it("disables the monophonic output toggle without Web MIDI access", () => {
    render(<MidiOutputs {...makeProps()} midi={null} />);
    expect(screen.getByRole("checkbox", { name: "Monophonic Single-Channel MIDI" }).disabled).toBe(true);
  });

  it("disables MPE without MIDI access and enables it when access becomes available", () => {
    const props = makeProps();
    const { rerender } = render(<MidiOutputs {...props} midi={null} />);
    expect(screen.getByRole("checkbox", { name: "MPE", exact: true }).disabled).toBe(true);
    rerender(<MidiOutputs {...props} />);
    expect(screen.getByRole("checkbox", { name: "MPE", exact: true }).disabled).toBe(false);
  });

  it("offers named expressionY CC destinations excluding special messages", () => {
    const props = makeProps({ output_mono: true, mono_device: "main-1" });
    props.onChange = vi.fn();
    render(<MidiOutputs {...props} />);
    const select = screen.getByRole("combobox", { name: "Map MPE ExpressionY (CC74) to" });
    expect(select.value).toBe("74");
    expect(Array.from(select.options, (option) => Number(option.value))).toEqual(
      Array.from({ length: 120 }, (_, i) => i).filter(
        (cc) => ![0, 6, 32, 38, 84, 88, 96, 97, 98, 99, 100, 101].includes(cc),
      ),
    );
    expect(select.selectedOptions[0].textContent).toBe("74 — Brightness");
    fireEvent.change(select, { target: { value: "1" } });
    expect(props.onChange).toHaveBeenCalledWith("mono_expression_y_cc", 1);
    expect(sessionStorage.getItem("mono_expression_y_cc")).toBe("1");
  });

  it("resends monophonic pitch-bend RPN on the selected channel", () => {
    const props = makeProps({
      output_mono: true,
      mono_device: "main-1",
      mono_channel: 3,
      mono_bend_range: 12,
    });
    const send = vi.fn();
    props.midi.outputs.get("main-1").send = send;
    render(<MidiOutputs {...props} />);
    const button = screen.getByRole("button", { name: "Send Pitch Bend Range" });
    fireEvent.click(button);
    expect(send.mock.calls.map(([bytes]) => bytes)).toEqual([
      [0xb3, 101, 0],
      [0xb3, 100, 0],
      [0xb3, 6, 12],
      [0xb3, 38, 0],
      [0xb3, 101, 127],
      [0xb3, 100, 127],
    ]);
    fireEvent.click(button);
    expect(send).toHaveBeenCalledTimes(12);
  });

  it.each([undefined, "", "OFF"])("hides monophonic configuration when Port is off (%s)", (device) => {
    const props = makeProps({ output_mono: true, mono_device: device, mono_channel: 3 });
    props.onChange = vi.fn();
    const view = render(<MidiOutputs {...props} />);
    expect(screen.getByRole("combobox", { name: "Monophonic MIDI Port" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Monophonic MIDI Channel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send Pitch Bend Range" })).toBeNull();
    expect(screen.queryByLabelText("Map MPE ExpressionY (CC74) to")).toBeNull();
    expect(screen.queryByRole("slider", { name: "Monophonic MIDI Portamento Time" })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Monophonic MIDI Port" }),
      { target: { value: "main-1" } });
    expect(props.onChange).toHaveBeenCalledWith("mono_device", "main-1");
    view.rerender(<MidiOutputs {...props} settings={{ ...props.settings, mono_device: "main-1" }} />);
    expect(screen.getByRole("combobox", { name: "Monophonic MIDI Channel" }).value).toBe("3");
    expect(screen.getByRole("button", { name: "Send Pitch Bend Range" })).toBeTruthy();
    view.rerender(<MidiOutputs {...props} settings={{ ...props.settings, mono_device: "OFF" }} />);
    expect(screen.queryByRole("combobox", { name: "Monophonic MIDI Channel" })).toBeNull();
  });

  it.each([false, true])(
    "places monophonic routing first with mode spacing (enabled: %s)",
    (enabled) => {
      const { container } = render(<MidiOutputs {...makeProps({ output_mono: enabled })} />);
      expect(container.querySelector('input[type="checkbox"]').name).toBe("output_mono");
      const mtsLabel = screen.getByText("MTS Real-Time Tuning").closest("label");
      expect(mtsLabel.previousElementSibling.tagName).toBe("BR");
    },
  );

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
    expect(screen.getByLabelText("MPE+ 21-bit PB (LSB on CC87)").checked).toBe(false);
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

    fireEvent.click(screen.getByLabelText("MPE+ 21-bit PB (LSB on CC87)"));

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

    fireEvent.click(screen.getByLabelText("Pedal/Wheel → Brightness + Tilt EQ"));
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
