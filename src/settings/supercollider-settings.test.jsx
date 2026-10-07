import { fireEvent, render, screen } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SuperColliderSettings from "./supercollider-settings.jsx";

describe("SuperCollider scsynth settings", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("renders OSC and SuperSonic controls in its own fieldset", () => {
    render(
      <SuperColliderSettings settings={{ output_osc: true, osc_local: true }} onChange={vi.fn()} />,
    );

    expect(screen.getByText("Built-in scsynth")).toBeTruthy();
    expect(screen.getByLabelText("Use SuperCollider Sounds")).toBeTruthy();
    expect(screen.getByLabelText("SuperSonic 0.88")).toBeTruthy();
    const description = screen.getByText(/SynthDefs run directly in the browser/);
    expect(description.closest("p")?.previousElementSibling?.textContent.trim()).toBe("SuperSonic 0.88");
    expect(description.closest("em")).toBeTruthy();
  });

  it("shows the italic OSC bridge description in the same place when SuperSonic is off", () => {
    render(
      <SuperColliderSettings settings={{ output_osc: true, osc_local: false }} onChange={vi.fn()} />,
    );

    const description = screen.getByText(/local WebSocket→OSC bridge/);
    expect(description.closest("p")?.previousElementSibling?.textContent.trim()).toBe("SuperSonic 0.88");
    expect(description.closest("em")).toBeTruthy();
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
