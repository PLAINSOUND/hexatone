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
      "Second",
      "First",
    ]);
  });

  it("offers live snapshot-derived raster filters only when auto-generation is enabled", () => {
    const onChange = vi.fn();
    const saveControllerPref = vi.fn();

    render(
      <HakenContinuumSettings
        ctrl={{ id: "hakenaudio" }}
        settings={{
          hakenaudio_out_port: null,
          hakenaudio_x_glide_mode: "pitch_bending",
          hakenaudio_glide_flip_cc: 67,
          hakenaudio_raster_filter_mode: "all",
          hakenaudio_raster_filter: "",
          hakenaudio_raster_filter_snapshots: false,
          scale: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
          equivInterval: 1200,
          reference_degree: 9,
          fundamental: 440,
        }}
        snapshots={[
          {
            id: 1,
            notes: [{ midicents: 69 }, { midicents: 64 }, { midicents: 60 }],
          },
        ]}
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
    ]);

    fireEvent.click(screen.getByLabelText("Auto-Generate from Snapshots"));

    expect(onChange).toHaveBeenCalledWith("hakenaudio_raster_filter_snapshots", true);
    expect(saveControllerPref).toHaveBeenCalledWith(
      { id: "hakenaudio" },
      "hakenaudio_raster_filter_snapshots",
      true,
      expect.any(Object),
      { hakenaudio_raster_filter_snapshots: true },
    );
  });

  it("persists the optional raster filter for pitch-bending attacks", () => {
    const onChange = vi.fn();
    const saveControllerPref = vi.fn();

    render(
      <HakenContinuumSettings
        ctrl={{ id: "hakenaudio" }}
        settings={{
          hakenaudio_out_port: null,
          hakenaudio_x_glide_mode: "pitch_bending",
          hakenaudio_raster_filter_mode: "filter",
          hakenaudio_raster_filter: "0,4,7",
          hakenaudio_raster_filter_snapshots: false,
          hakenaudio_apply_raster_in_pitch_bending: false,
          hakenaudio_shape_x_glide_to_raster: false,
        }}
        rawPorts={{ output: { id: "umone-out", name: "UM-ONE" } }}
        midiOutputs={new Map()}
        onChange={onChange}
        saveControllerPref={saveControllerPref}
        hakenPedalLearnActive={false}
      />,
    );

    const checkbox = screen.getByLabelText("Apply Raster in Pitch Bending Mode");
    const shapeCheckbox = screen.getByLabelText("Shape X Glide to Raster");
    expect(checkbox.checked).toBe(false);
    expect(shapeCheckbox.checked).toBe(false);

    fireEvent.click(shapeCheckbox);

    expect(onChange).toHaveBeenCalledWith("hakenaudio_shape_x_glide_to_raster", true);
    expect(saveControllerPref).toHaveBeenCalledWith(
      { id: "hakenaudio" },
      "hakenaudio_shape_x_glide_to_raster",
      true,
      expect.any(Object),
      { hakenaudio_shape_x_glide_to_raster: true },
    );
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);

    expect(onChange).toHaveBeenCalledWith("hakenaudio_apply_raster_in_pitch_bending", true);
    expect(saveControllerPref).toHaveBeenCalledWith(
      { id: "hakenaudio" },
      "hakenaudio_apply_raster_in_pitch_bending",
      true,
      expect.any(Object),
      { hakenaudio_apply_raster_in_pitch_bending: true },
    );
  });

  it("applies an enabled snapshot-derived raster filter against the current tuning", () => {
    const onChange = vi.fn();
    const saveControllerPref = vi.fn();

    render(
      <HakenContinuumSettings
        ctrl={{ id: "hakenaudio" }}
        settings={{
          hakenaudio_out_port: null,
          hakenaudio_x_glide_mode: "pitch_bending",
          hakenaudio_glide_flip_cc: 67,
          hakenaudio_raster_filter_mode: "all",
          hakenaudio_raster_filter: "",
          hakenaudio_raster_filter_snapshots: true,
          scale: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
          equivInterval: 1200,
          reference_degree: 9,
          fundamental: 440,
        }}
        snapshots={[
          {
            id: 1,
            notes: [{ midicents: 69 }, { midicents: 64 }, { midicents: 60 }],
          },
        ]}
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
      "──────── Snapshots ────────",
      "Snapshot 1",
    ]);

    fireEvent.change(select, { target: { value: "__snapshot__:1" } });

    expect(onChange).toHaveBeenCalledWith("hakenaudio_raster_filter_mode", "filter");
    expect(onChange).toHaveBeenCalledWith("hakenaudio_raster_filter", "0,4,9");
  });

  it("shows generated snapshot raster filters when the setting is already enabled and snapshots load later", () => {
    const onChange = vi.fn();
    const saveControllerPref = vi.fn();
    const props = {
      ctrl: { id: "hakenaudio" },
      settings: {
        hakenaudio_out_port: null,
        hakenaudio_x_glide_mode: "pitch_bending",
        hakenaudio_glide_flip_cc: 67,
        hakenaudio_raster_filter_mode: "all",
        hakenaudio_raster_filter: "",
        hakenaudio_raster_filter_snapshots: true,
        scale: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
        equivInterval: 1200,
        reference_degree: 9,
        fundamental: 440,
      },
      rawPorts: { output: { id: "umone-out", name: "UM-ONE" } },
      midiOutputs: new Map(),
      onChange,
      saveControllerPref,
      hakenPedalLearnActive: false,
    };

    const { rerender } = render(<HakenContinuumSettings {...props} snapshots={[]} />);

    let select = screen.getByRole("combobox", { name: "Continuum Raster Filter" });
    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All Degrees",
    ]);

    rerender(
      <HakenContinuumSettings
        {...props}
        snapshots={[
          {
            id: 1,
            notes: [{ midicents: 69 }, { midicents: 64 }, { midicents: 60 }],
          },
        ]}
      />,
    );

    select = screen.getByRole("combobox", { name: "Continuum Raster Filter" });
    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All Degrees",
      "──────── Snapshots ────────",
      "Snapshot 1",
    ]);
  });
});
