import { fireEvent, render, screen } from "@testing-library/preact";
import HakenContinuumSettings from "./haken-continuum-settings.js";
import {
  CONTINUUM_RASTER_FILTER_LIBRARY_KEY,
  CONTINUUM_RASTER_FILTER_SELECTED_KEY,
} from "../../../controllers/continuum-raster-filters.js";

describe("HakenContinuumSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("stores the Continuum output port override for the current session only", () => {
    const onChange = vi.fn();
    const saveControllerPref = vi.fn();
    const settings = {
      hakenaudio_out_port: null,
      hakenaudio_x_glide_mode: "pitch_bending",
      hakenaudio_glide_flip_cc: 67,
    };
    const midiOutputs = new Map([
      ["umone-out", { id: "umone-out", name: "UM-ONE" }],
      ["other-out", { id: "other-out", name: "Other Port" }],
    ]);

    render(
      <HakenContinuumSettings
        ctrl={{ id: "hakenaudio" }}
        settings={settings}
        rawPorts={{ output: { id: "umone-out", name: "UM-ONE" } }}
        midiOutputs={midiOutputs}
        onChange={onChange}
        saveControllerPref={saveControllerPref}
        hakenPedalLearnActive={false}
      />,
    );

    fireEvent.click(screen.getByText("Continuum Control Port"));
    fireEvent.change(screen.getByDisplayValue("Auto detect"), {
      target: { value: "other-out" },
    });

    expect(onChange).toHaveBeenCalledWith("hakenaudio_out_port", "other-out");
    expect(saveControllerPref).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("hakenaudio_out_port")).toBe("other-out");
  });

  it("applies and reorders saved Continuum raster filters without an All Keys Dark option", () => {
    localStorage.setItem(
      CONTINUUM_RASTER_FILTER_LIBRARY_KEY,
      JSON.stringify([
        { name: "First", degrees: [0] },
        { name: "Second", degrees: [7, 4] },
      ]),
    );
    localStorage.setItem(CONTINUUM_RASTER_FILTER_SELECTED_KEY, "Second");
    const onChange = vi.fn();
    const saveControllerPref = vi.fn();

    render(
      <HakenContinuumSettings
        ctrl={{ id: "hakenaudio" }}
        settings={{
          hakenaudio_out_port: null,
          hakenaudio_x_glide_mode: "pitch_bending",
          hakenaudio_glide_flip_cc: 67,
          hakenaudio_raster_filter_mode: "filter",
          hakenaudio_raster_filter: "4,7",
        }}
        rawPorts={{ output: { id: "umone-out", name: "UM-ONE" } }}
        midiOutputs={new Map()}
        onChange={onChange}
        saveControllerPref={saveControllerPref}
        hakenPedalLearnActive={false}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Continuum Raster Filter" });
    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All Degrees",
      "──────── User Filters ────────",
      "First",
      "Second",
    ]);
    expect(screen.queryByText("All Keys Dark")).toBeNull();

    fireEvent.change(select, { target: { value: "First" } });

    expect(onChange).toHaveBeenCalledWith("hakenaudio_raster_filter_mode", "filter");
    expect(onChange).toHaveBeenCalledWith("hakenaudio_raster_filter", "0");
    expect(saveControllerPref).toHaveBeenCalledWith(
      { id: "hakenaudio" },
      "hakenaudio_raster_filter",
      "0",
      expect.any(Object),
      { hakenaudio_raster_filter: "0" },
    );

    fireEvent.click(screen.getByRole("button", { name: "Move raster filter down" }));

    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All Degrees",
      "──────── User Filters ────────",
      "Current Custom Filter",
      "Second",
      "First",
    ]);
  });
});
