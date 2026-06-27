import { render, screen } from "@testing-library/preact";
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
    midiOutputs: new Map(),
    keysRef: { current: { settings: {} } },
    hasSysexMidi: true,
    appModeEnabled: true,
    onChange: vi.fn(),
  };

  it("labels the output as App Mode", () => {
    render(
      <ExquisSettings
        {...baseProps}
        rawPorts={{ output: { id: "exquis", name: "Exquis MIDI" } }}
        ledStatus={{ ok: true }}
      />,
    );

    expect(screen.getByText("LED Output (App Mode)")).toBeTruthy();
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

  it("shows App Mode disabled and hides LED controls in nearest-scale mode", () => {
    render(
      <ExquisSettings
        {...baseProps}
        appModeEnabled={false}
        rawPorts={{ output: { id: "exquis", name: "Exquis MIDI" } }}
        ledStatus={{ ok: true }}
      />,
    );

    expect(screen.getByText("App Mode")).toBeTruthy();
    expect(screen.getByText("disabled")).toBeTruthy();
    expect(screen.queryByText("Auto Send Colours")).toBeNull();
    expect(screen.queryByText("LED Brightness")).toBeNull();
    expect(screen.queryByText("LED Saturation")).toBeNull();
  });
});
