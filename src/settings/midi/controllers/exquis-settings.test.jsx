import { render, screen, fireEvent, act } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import ExquisSettings from "./exquis-settings.js";

describe("ExquisSettings", () => {
  const baseProps = {
    settings: {
      exquis_out_port: null,
      exquis_led_sync: true,
      exquis_led_luminosity: 15,
      exquis_led_saturation: 1.3,
    },
    keysRef: { current: { settings: {} } },
    hasSysexMidi: true,
    appModeEnabled: true,
    onChange: vi.fn(),
  };

  it("shows orientation without an LED output row", () => {
    render(
      <ExquisSettings
        {...baseProps}
        rawPorts={{ output: { id: "exquis", name: "Exquis MIDI" } }}
        ledStatus={{ ok: true }}
      />,
    );

    expect(screen.queryByText("LED Output (App Mode)")).toBeNull();
    expect(screen.getByLabelText("Orientation").value).toBe("90");
    expect(screen.getByLabelText("Orientation").className).toBe("sidebar-input");
  });

  it("learns input CCs and resets defaults without requiring App mode", () => {
    const keys = { settings: {}, midiin_data: {}, setMidiCcLearnMode: vi.fn() };
    keys.setMidiCcLearnMode.mockImplementation((active, callback) => {
      keys._midiLearnCcCallback = active ? callback : null;
    });
    const onChange = vi.fn();
    const { unmount } = render(
      <ExquisSettings
        {...baseProps}
        appModeEnabled={false}
        keysRef={{ current: keys }}
        onChange={onChange}
      />,
    );
    expect(screen.queryByText("Mod/Timbre")).toBeNull();
    expect(screen.getByText("CC 33")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Listen for Sustain CC" }));
    act(() => keys._midiLearnCcCallback(22));
    expect(onChange).toHaveBeenCalledWith("exquis_sustain_cc", 22);
    fireEvent.click(screen.getByRole("button", { name: "Reset Sustain CC" }));
    expect(onChange).toHaveBeenCalledWith("exquis_sustain_cc", 33);
    fireEvent.click(screen.getByRole("button", { name: "Listen for Sustain CC" }));
    unmount();
    expect(keys._midiLearnCcCallback).toBeNull();
  });

  it("commits and saves orientation only after the driver allows it", () => {
    const setOrientation = vi.fn();
    const onChange = vi.fn();
    render(
      <ExquisSettings
        {...baseProps}
        onChange={onChange}
        keysRef={{ current: { exquisLEDs: { ready: true, setOrientation } } }}
        rawPorts={{ output: { id: "exquis", name: "Exquis MIDI" } }}
        ledStatus={{ ok: true }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Orientation"), { target: { value: "0" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("Release keys");
    const commit = setOrientation.mock.calls[0][1];
    commit(0);
    expect(onChange).toHaveBeenCalledWith("exquis_orientation", 0);
    expect(localStorage.getItem("exquis_orientation")).toBe("0");
  });

  it("warns only when a too-old firmware version response is received", () => {
    render(
      <ExquisSettings
        {...baseProps}
        rawPorts={{ output: { id: "exquis", name: "Exquis MIDI" } }}
        ledStatus={{ ok: false, reason: "firmware 2.9.9" }}
      />,
    );

    expect(screen.getByText("Please update the firmware on your Exquis")).toBeTruthy();
    expect(screen.queryByText("Auto Send Colours")).toBeNull();
  });

  it("does not show the firmware warning on timeout without a version response", () => {
    render(
      <ExquisSettings
        {...baseProps}
        rawPorts={{ output: { id: "exquis", name: "Exquis MIDI" } }}
        ledStatus={{ ok: false, reason: "timeout" }}
      />,
    );

    expect(screen.queryByText("Please update the firmware on your Exquis")).toBeNull();
  });

  it("hides App Mode status and LED controls in nearest-scale mode", () => {
    render(
      <ExquisSettings
        {...baseProps}
        appModeEnabled={false}
        rawPorts={{ output: { id: "exquis", name: "Exquis MIDI" } }}
        ledStatus={{ ok: true }}
      />,
    );

    expect(screen.queryByText("App Mode")).toBeNull();
    expect(screen.queryByText("disabled")).toBeNull();
    expect(screen.queryByText("Auto Send Colours")).toBeNull();
    expect(screen.queryByText("LED Brightness")).toBeNull();
    expect(screen.queryByText("LED Saturation")).toBeNull();
  });
  it("keeps the layout override separate from saved tuning steps and restores them when switched off", () => {
    const onChange = vi.fn();
    const settings = { ...baseProps.settings, rSteps: 9, drSteps: 4 };
    const view = render(<ExquisSettings {...baseProps} settings={settings} onChange={onChange} />);
    const toggle = screen.getByLabelText("Hexatone Layout Override");
    expect(toggle.checked).toBe(false);
    expect(screen.queryByLabelText("Right-Facing Steps")).toBeNull();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith("exquis_layout_override", true);
    view.rerender(<ExquisSettings {...baseProps} settings={{ ...settings, exquis_layout_override: true }} onChange={onChange} />);
    const right = screen.getByLabelText("Right-Facing Steps");
    expect(right.value).toBe("7");
    expect(screen.getByLabelText("Right-Downward Steps").value).toBe("4");
    fireEvent.input(right, { target: { value: "3" } });
    fireEvent.blur(right);
    expect(onChange).toHaveBeenCalledWith("exquis_rSteps", 3);
    expect(localStorage.getItem("exquis_rSteps")).toBe("3");
    expect(onChange).not.toHaveBeenCalledWith("rSteps", expect.anything());
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith("exquis_layout_override", false);
    expect(settings).toMatchObject({ rSteps: 9, drSteps: 4 });
  });

});
