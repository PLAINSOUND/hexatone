import { fireEvent, render, screen } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LumatoneSettings from "./lumatone-settings.js";
import {
  LUMATONE_COLOR_FILTER_LIBRARY_KEY,
  LUMATONE_COLOR_FILTER_SELECTED_KEY,
} from "../../../controllers/lumatone-color-filters.js";

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
    const saveControllerPref = vi.fn();
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
        saveControllerPref={saveControllerPref}
      />,
    );

    fireEvent.change(screen.getByLabelText("Lumatone Colour Filter"), {
      target: { value: "Subset" },
    });

    expect(onChange).toHaveBeenCalledWith("lumatone_degree_filter_mode", "filter");
    expect(onChange).toHaveBeenCalledWith("lumatone_degree_filter", "0,4,7");
    expect(saveControllerPref).toHaveBeenCalledWith(null, "lumatone_degree_filter_mode", "filter");
    expect(saveControllerPref).toHaveBeenCalledWith(null, "lumatone_degree_filter", "0,4,7");
    expect(keysRef.current.syncLumatoneLEDs).toHaveBeenCalledTimes(1);
  });

  it("applies the All Keys Dark built-in option", () => {
    const onChange = vi.fn();
    const saveControllerPref = vi.fn();
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
        saveControllerPref={saveControllerPref}
      />,
    );

    fireEvent.change(screen.getByLabelText("Lumatone Colour Filter"), {
      target: { value: "dark" },
    });

    expect(onChange).toHaveBeenCalledWith("lumatone_degree_filter_mode", "dark");
    expect(onChange).toHaveBeenCalledWith("lumatone_degree_filter", "");
    expect(saveControllerPref).toHaveBeenCalledWith(null, "lumatone_degree_filter_mode", "dark");
    expect(saveControllerPref).toHaveBeenCalledWith(null, "lumatone_degree_filter", "");
    expect(keysRef.current.syncLumatoneLEDs).toHaveBeenCalledTimes(1);
  });

  it("offers live snapshot-derived filter entries only when auto-generation is enabled", () => {
    const onChange = vi.fn();
    const saveControllerPref = vi.fn();
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
          lumatone_degree_filter_snapshots: false,
          scale: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
          equivInterval: 1200,
          reference_degree: 9,
          fundamental: 440,
        }}
        snapshots={[{
          id: 1,
          notes: [
            { midicents: 69 },
            { midicents: 64 },
            { midicents: 60 },
          ],
        }]}
        rawPorts={{ output: { id: "lumatone", name: "Lumatone MIDI" } }}
        midiOutputs={new Map()}
        keysRef={keysRef}
        hasSysexMidi={true}
        onChange={onChange}
        saveControllerPref={saveControllerPref}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Lumatone Colour Filter" });
    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All Degrees",
      "All Keys Dark",
    ]);

    fireEvent.click(screen.getByLabelText("Auto-Generate from Snapshots"));

    expect(onChange).toHaveBeenCalledWith("lumatone_degree_filter_snapshots", true);
    expect(saveControllerPref).toHaveBeenCalledWith(null, "lumatone_degree_filter_snapshots", true);
  });

  it("applies an enabled snapshot-derived filter against the current tuning", () => {
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
          lumatone_degree_filter_snapshots: true,
          scale: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
          equivInterval: 1200,
          reference_degree: 9,
          fundamental: 440,
        }}
        snapshots={[{
          id: 1,
          notes: [
            { midicents: 69 },
            { midicents: 64 },
            { midicents: 60 },
          ],
        }]}
        rawPorts={{ output: { id: "lumatone", name: "Lumatone MIDI" } }}
        midiOutputs={new Map()}
        keysRef={keysRef}
        hasSysexMidi={true}
        onChange={onChange}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Lumatone Colour Filter" });
    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All Degrees",
      "All Keys Dark",
      "──────── Snapshots ────────",
      "Snapshot 1",
    ]);

    fireEvent.change(select, { target: { value: "__snapshot__:1" } });

    expect(onChange).toHaveBeenCalledWith("lumatone_degree_filter_mode", "filter");
    expect(onChange).toHaveBeenCalledWith("lumatone_degree_filter", "0,4,9");
    expect(keysRef.current.syncLumatoneLEDs).toHaveBeenCalledTimes(1);
  });

  it("shows generated snapshot filters when the setting is already enabled and snapshots load later", () => {
    const onChange = vi.fn();
    const keysRef = {
      current: {
        settings: { lumatone_led_sync: true },
        syncLumatoneLEDs: vi.fn(),
      },
    };

    const props = {
      settings: {
        midi_passthrough: false,
        lumatone_out_port: null,
        lumatone_led_sync: true,
        lumatone_degree_filter_mode: "all",
        lumatone_degree_filter: "",
        lumatone_degree_filter_snapshots: true,
        scale: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
        equivInterval: 1200,
        reference_degree: 9,
        fundamental: 440,
      },
      rawPorts: { output: { id: "lumatone", name: "Lumatone MIDI" } },
      midiOutputs: new Map(),
      keysRef,
      hasSysexMidi: true,
      onChange,
    };

    const { rerender } = render(
      <LumatoneSettings
        {...props}
        snapshots={[]}
      />,
    );

    let select = screen.getByRole("combobox", { name: "Lumatone Colour Filter" });
    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All Degrees",
      "All Keys Dark",
    ]);

    rerender(
      <LumatoneSettings
        {...props}
        snapshots={[{
          id: 1,
          notes: [
            { midicents: 69 },
            { midicents: 64 },
            { midicents: 60 },
          ],
        }]}
      />,
    );

    select = screen.getByRole("combobox", { name: "Lumatone Colour Filter" });
    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All Degrees",
      "All Keys Dark",
      "──────── Snapshots ────────",
      "Snapshot 1",
    ]);
  });

  it("lets the user reorder saved filters in the menu", () => {
    localStorage.setItem(
      LUMATONE_COLOR_FILTER_LIBRARY_KEY,
      JSON.stringify([
        { name: "First", degrees: [0] },
        { name: "Second", degrees: [7] },
      ]),
    );
    localStorage.setItem(LUMATONE_COLOR_FILTER_SELECTED_KEY, "Second");

    render(
      <LumatoneSettings
        settings={{
          midi_passthrough: false,
          lumatone_out_port: null,
          lumatone_led_sync: true,
          lumatone_degree_filter_mode: "filter",
          lumatone_degree_filter: "7",
        }}
        rawPorts={{ output: { id: "lumatone", name: "Lumatone MIDI" } }}
        midiOutputs={new Map()}
        keysRef={{
          current: {
            settings: { lumatone_led_sync: true },
            syncLumatoneLEDs: vi.fn(),
          },
        }}
        hasSysexMidi={true}
        onChange={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Lumatone Colour Filter" });
    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All Degrees",
      "All Keys Dark",
      "──────── User Filters ────────",
      "First",
      "Second",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Move filter up" }));

    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All Degrees",
      "All Keys Dark",
      "──────── User Filters ────────",
      "Second",
      "First",
    ]);
  });

  it("sends a generated 2D bypass layout and reports coverage", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const sendLumatoneBypassLayout = vi.fn(() => ({
      exactCount: 270,
      disabledCount: 10,
      totalCount: 280,
    }));

    render(
      <LumatoneSettings
        settings={{
          midi_passthrough: true,
          lumatone_out_port: null,
          lumatone_led_sync: true,
          lumatone_degree_filter_mode: "all",
          lumatone_degree_filter: "",
        }}
        rawPorts={{ output: { id: "lumatone", name: "Lumatone MIDI" } }}
        midiOutputs={new Map()}
        keysRef={{
          current: {
            settings: { lumatone_led_sync: true },
            sendLumatoneBypassLayout,
          },
        }}
        hasSysexMidi={true}
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Send Layout and Colours").closest("button"));

    expect(sendLumatoneBypassLayout).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      "Sent Lumatone 2D bypass layout.\n\nExact keys: 270/280\nDisabled dark keys: 10/280",
    );
    alertSpy.mockRestore();
  });

  it("enables auto-send without triggering an immediate duplicate colour sync from the checkbox handler", () => {
    const onChange = vi.fn();
    const onEnableLumatoneAutoSync = vi.fn();
    const keysRef = {
      current: {
        settings: { lumatone_led_sync: false },
      },
    };

    render(
      <LumatoneSettings
        settings={{
          midi_passthrough: false,
          lumatone_out_port: null,
          lumatone_led_sync: false,
          lumatone_degree_filter_mode: "all",
          lumatone_degree_filter: "",
        }}
        rawPorts={{ output: { id: "lumatone", name: "Lumatone MIDI" } }}
        midiOutputs={new Map()}
        keysRef={keysRef}
        hasSysexMidi={true}
        onChange={onChange}
        onEnableLumatoneAutoSync={onEnableLumatoneAutoSync}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /Automatically Send LED Colours/i }));

    expect(onChange).toHaveBeenCalledWith("lumatone_led_sync", true);
    expect(keysRef.current.settings.lumatone_led_sync).toBe(true);
    expect(onEnableLumatoneAutoSync).toHaveBeenCalledTimes(1);
  });

  it("keeps LED Output and the bypass layout sender visible in bypass mode only", () => {
    render(
      <LumatoneSettings
        settings={{
          midi_passthrough: true,
          lumatone_out_port: null,
          lumatone_led_sync: true,
          lumatone_degree_filter_mode: "all",
          lumatone_degree_filter: "",
        }}
        rawPorts={{ output: { id: "lumatone", name: "Lumatone MIDI" } }}
        midiOutputs={new Map()}
        keysRef={{ current: { settings: {} } }}
        hasSysexMidi={true}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("LED Output (SysEx)")).toBeTruthy();
    expect(screen.getByText("2D Bypass Key Layout")).toBeTruthy();
    expect(screen.getByText("Send Layout and Colours")).toBeTruthy();
    expect(screen.queryByText("Send Blank Layout")).toBeNull();
    expect(screen.queryByText("Automatically Send LED Colours")).toBeNull();
    expect(screen.queryByText("Lumatone Colour Filter")).toBeNull();
  });
});
