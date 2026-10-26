import { fireEvent, render, screen } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SuperColliderSettings from "./supercollider-settings.jsx";

describe("SuperCollider scsynth settings", () => {
  it("greys layer labels at zero and restores them immediately above zero", () => {
    render(<SuperColliderSettings
      settings={{ output_osc: true, osc_local: true }} onChange={vi.fn()}
      onOscLayerVolumeChange={vi.fn()}
    />);
    for (const name of ["Pluck", "Buzz", "Formant", "Saw"]) {
      const label = screen.getByText(name);
      const slider = screen.getByRole("slider", { name: `${name} volume` });
      expect(label.classList.contains("scsynth-layer-label--muted")).toBe(false);
      fireEvent.keyDown(slider, { key: "Home" });
      expect(label.classList.contains("scsynth-layer-label--muted")).toBe(true);
      fireEvent.keyDown(slider, { key: "ArrowRight" });
      expect(label.classList.contains("scsynth-layer-label--muted")).toBe(false);
    }
  });
  it("places live controller brightness above release and sends fader input without changing settings", () => {
    const onChange = vi.fn();
    const onOscBrightnessChange = vi.fn();
    const props = { settings: { output_osc: true, osc_local: true }, onChange, onOscBrightnessChange };
    const view = render(<SuperColliderSettings {...props} oscBrightness={64 / 127} />);
    const sliders = screen.getAllByRole("slider");
    const brightness = screen.getByRole("slider", { name: "Brightness" });
    expect(sliders.indexOf(brightness)).toBeLessThan(sliders.indexOf(screen.getByLabelText("Release Override Amount")));
    expect(Number(brightness.getAttribute("aria-valuenow"))).toBeCloseTo(64 / 127);
    fireEvent.keyDown(brightness, { key: "End" });
    expect(onOscBrightnessChange).toHaveBeenCalledWith(1);
    expect(onChange).not.toHaveBeenCalled();
    view.rerender(<SuperColliderSettings {...props} oscBrightness={0} />);
    expect(brightness.getAttribute("aria-valuenow")).toBe("0");
  });
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("renders OSC and SuperSonic controls in its own fieldset", () => {
    render(
      <SuperColliderSettings settings={{ output_osc: true, osc_local: true }} onChange={vi.fn()} />,
    );

    expect(screen.getByText("Built-in scsynth")).toBeTruthy();
    expect(screen.getByText("Built-in scsynth").closest("fieldset").classList.contains("output-routing-fieldset")).toBe(true);
    expect(screen.getByLabelText("Use SuperCollider Sounds")).toBeTruthy();
    expect(screen.getByLabelText("scsynth Server").value).toBe("supersonic");
    const description = screen.getByText(/SynthDefs run directly in the browser/);
    expect(description.closest("p")?.previousElementSibling?.querySelector("select")).toBe(screen.getByLabelText("scsynth Server"));
    expect(description.closest("em")).toBeTruthy();
  });

  it("shows the italic OSC bridge description in the same place when SuperSonic is off", () => {
    render(
      <SuperColliderSettings settings={{ output_osc: true, osc_local: false }} onChange={vi.fn()} />,
    );

    const description = screen.getByText(/local WebSocket→OSC bridge/);
    expect(screen.getByLabelText("scsynth Server").value).toBe("bridge");
    expect(description.closest("em")).toBeTruthy();
  });

  it("offers server OFF independently of the warm output toggle", () => {
    const onChange = vi.fn();
    const view = render(<SuperColliderSettings settings={{ output_osc: true, osc_local: true }} onChange={onChange} />);
    const menu = screen.getByLabelText("scsynth Server");
    expect([...menu.options].map(option => option.textContent)).toEqual(["OFF", "SuperSonic 0.92", "Local via OSC Bridge"]);
    fireEvent.change(menu, { target: { value: "OFF" } });
    expect(onChange).toHaveBeenCalledWith("osc_server_off", true);
    expect(onChange).not.toHaveBeenCalledWith("output_osc", false);
    view.rerender(<SuperColliderSettings settings={{ output_osc: true, osc_local: true, osc_server_off: true }} onChange={onChange} />);
    expect(menu.value).toBe("OFF");
    expect(screen.queryByRole("slider", { name: "Pluck volume" })).toBeNull();
    fireEvent.change(menu, { target: { value: "bridge" } });
    expect(onChange).toHaveBeenCalledWith("osc_local", false);
    expect(onChange).toHaveBeenCalledWith("osc_server_off", false);
  });

  it("updates and persists layer volume", () => {
    const onOscLayerVolumeChange = vi.fn();
    render(
      <SuperColliderSettings
        settings={{ output_osc: true, osc_local: true, osc_volume_pluck: 0.72 }}
        onChange={vi.fn()}
        onOscLayerVolumeChange={onOscLayerVolumeChange}
      />,
    );

    fireEvent.keyDown(screen.getByRole("slider", { name: "Pluck volume" }), { key: "ArrowRight" });
    expect(onOscLayerVolumeChange).toHaveBeenCalledWith(0, 0.73);
    expect(localStorage.getItem("osc_volume_pluck")).toBe("0.73");
    expect(sessionStorage.getItem("osc_volume_pluck")).toBe("0.73");
  });

  it("preserves the Buzz and Formant retrigger option", () => {
    const onChange = vi.fn();
    render(
      <SuperColliderSettings
        settings={{ output_osc: true, osc_local: true, osc_retrigger_buzz_formant: false }}
        onChange={onChange}
      />,
    );

    expect(
      screen.queryByRole("checkbox", { name: "Sustain Buzz + Formant until note-off" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Retrigger Buzz + Formant while held" }));
    expect(onChange).toHaveBeenCalledWith("osc_retrigger_buzz_formant", true);
  });

  it("preserves the release controls", () => {
    render(
      <SuperColliderSettings
        settings={{
          output_osc: true,
          osc_local: true,
          osc_quick_release: 0.5,
          osc_quick_release_time: 0.25,
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Release Time").getAttribute("aria-valuemax")).toBe("2");
    expect(screen.getByLabelText("Release Override Amount")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("Blend between velocity-based release and Release Time")).toBeTruthy();
  });
});
