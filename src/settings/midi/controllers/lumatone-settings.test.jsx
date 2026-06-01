import { fireEvent, render, screen } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LumatoneSettings from "./lumatone-settings.js";
import { LUMATONE_COLOR_FILTER_LIBRARY_KEY } from "../../../controllers/lumatone-color-filters.js";

describe("LumatoneSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("applies a saved colour filter from the selector", () => {
    localStorage.setItem(
      LUMATONE_COLOR_FILTER_LIBRARY_KEY,
      JSON.stringify([{ name: "Subset", degrees: [7, 0, 4] }]),
    );

    const onChange = vi.fn();
    const keysRef = {
      current: {
        settings: { lumatone_led_sync: true },
        syncLumatoneLEDs: vi.fn(),
      },
    };

    render(
      <LumatoneSettings
        settings={{
          midi_passthrough: false,
          lumatone_out_port: null,
          lumatone_led_sync: true,
          lumatone_degree_filter_mode: "all",
          lumatone_degree_filter: "",
        }}
        rawPorts={{ output: { id: "lumatone", name: "Lumatone MIDI" } }}
        midiOutputs={new Map()}
        keysRef={keysRef}
        hasSysexMidi={true}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Lumatone Colour Filter"), {
      target: { value: "Subset" },
    });

    expect(onChange).toHaveBeenCalledWith("lumatone_degree_filter_mode", "filter");
    expect(onChange).toHaveBeenCalledWith("lumatone_degree_filter", "0,4,7");
    expect(keysRef.current.syncLumatoneLEDs).toHaveBeenCalledTimes(1);
  });

  it("applies the All Keys Dark built-in option", () => {
    const onChange = vi.fn();
    const keysRef = {
      current: {
        settings: { lumatone_led_sync: true },
        syncLumatoneLEDs: vi.fn(),
      },
    };

    render(
      <LumatoneSettings
        settings={{
          midi_passthrough: false,
          lumatone_out_port: null,
          lumatone_led_sync: true,
          lumatone_degree_filter_mode: "all",
          lumatone_degree_filter: "",
        }}
        rawPorts={{ output: { id: "lumatone", name: "Lumatone MIDI" } }}
        midiOutputs={new Map()}
        keysRef={keysRef}
        hasSysexMidi={true}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Lumatone Colour Filter"), {
      target: { value: "dark" },
    });

    expect(onChange).toHaveBeenCalledWith("lumatone_degree_filter_mode", "dark");
    expect(onChange).toHaveBeenCalledWith("lumatone_degree_filter", "");
    expect(keysRef.current.syncLumatoneLEDs).toHaveBeenCalledTimes(1);
  });
});
