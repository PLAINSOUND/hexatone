/**
 * Tests for src/hooks/use-settings-change.js
 */
import { act, render } from "@testing-library/preact";
import { useEffect } from "preact/hooks";
import useSettingsChange, { resizeScaleWithEquavePadding } from "./use-settings-change.js";
import { settingsToTuningRecord } from "../hexatone/tuning-record.js";

const HookHarness = ({
  settings,
  setSettings,
  midi,
  capture,
  keysRef = { current: null },
  setLatch = vi.fn(),
}) => {
  const handlers = useSettingsChange(settings, setSettings, {
    midi,
    setMidiLearnActive: vi.fn(),
    setHakenPedalLearnActive: vi.fn(),
    keysRef,
    setLatch,
    bumpImportCount: vi.fn(),
    onUserScaleEdit: vi.fn(),
  });

  useEffect(() => {
    capture(handlers);
  }, [handlers, capture]);

  return null;
};

describe("resizeScaleWithEquavePadding", () => {
  it("grows by repeating the current equave and padding names/colors from degree 0", () => {
    const settings = {
      scale: ["100.", "200.", "3/1"],
      note_names: ["C", "D", "E"],
      note_colors: ["#111111", "#222222", "#333333"],
    };

    expect(resizeScaleWithEquavePadding(settings, 5)).toEqual({
      scale: ["100.", "200.", "3/1", "3/1", "3/1"],
      note_names: ["C", "D", "E", "C", "C"],
      note_colors: ["#111111", "#222222", "#333333", "#111111", "#111111"],
    });
  });

  it("truncates scale, names, and colors when shrinking", () => {
    const settings = {
      scale: ["100.", "200.", "300.", "2/1"],
      note_names: ["C", "D", "E", "F"],
      note_colors: ["#111111", "#222222", "#333333", "#444444"],
    };

    expect(resizeScaleWithEquavePadding(settings, 2)).toEqual({
      scale: ["100.", "200."],
      note_names: ["C", "D"],
      note_colors: ["#111111", "#222222"],
    });
  });

  it("clears scale, names, and colors when shrinking to a blank surface", () => {
    const settings = {
      scale: ["100.", "200.", "2/1"],
      note_names: ["C", "D", "E"],
      note_colors: ["#111111", "#222222", "#333333"],
    };

    expect(resizeScaleWithEquavePadding(settings, 0)).toEqual({
      scale: [],
      note_names: [],
      note_colors: [],
    });
  });

  it("falls back to a default equave and root metadata when scale data is sparse", () => {
    const settings = {
      scale: [],
      note_names: [],
      note_colors: [],
    };

    expect(resizeScaleWithEquavePadding(settings, 3)).toEqual({
      scale: ["2/1", "2/1", "2/1"],
      note_names: ["", "", ""],
      note_colors: ["#ffffff", "#ffffff", "#ffffff"],
    });
  });
});

it("keeps Exquis tracking attached across mode settings and applies a pending change only after release", () => {
  vi.useFakeTimers();
  try {
    let receive, handlers;
    const input = { id: "exquis", name: "Exquis",
      addEventListener: vi.fn((_, handler) => { receive = handler; }), removeEventListener: vi.fn() };
    const midi = { inputs: new Map([["exquis", input]]) };
    const settings = { midiin_device: "exquis", midiin_controller_override: "exquis", midi_passthrough: false };
    const setSettings = vi.fn();
    const capture = value => { handlers = value; };
    const view = render(<HookHarness {...{ settings, setSettings, midi, capture }} />);
    act(() => receive({ data: [0x90, 60, 100] }));
    act(() => handlers.onChange("midi_passthrough", true));
    expect(setSettings).not.toHaveBeenCalled();
    expect(handlers.exquisModePending).toBe(true);
    view.rerender(<HookHarness {...{ settings: { ...settings, midiin_mpe_input: false }, setSettings,
      midi: { ...midi }, capture }} />);
    expect(input.addEventListener).toHaveBeenCalledOnce();
    act(() => receive({ data: [0x80, 60, 0] }));
    expect(setSettings).not.toHaveBeenCalled();
    act(() => vi.runAllTimers());
    expect(setSettings).toHaveBeenCalledOnce();
    expect(setSettings.mock.calls[0][0]()).toMatchObject({ midi_passthrough: true });
    view.unmount();
    expect(input.removeEventListener).toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

describe("useSettingsChange", () => {
  it("defers an entire atomic Exquis mode edit until every key is released", () => {
    vi.useFakeTimers();
    let receive, handlers;
    const input = { id: "exquis", name: "Exquis", removeEventListener: vi.fn(),
      addEventListener: vi.fn((_, handler) => { receive = handler; }) };
    const midi = { inputs: new Map([["exquis", input]]) };
    const settings = { midiin_device: "exquis", midiin_controller_override: "exquis",
      midi_passthrough: false, midiin_mapping_target: "hex_layout" };
    const setSettings = vi.fn();
    const view = render(<HookHarness {...{ settings, setSettings, midi }} capture={value => { handlers = value; }} />);
    try {
      act(() => receive({ data: [0x90, 60, 100] }));
      const update = { midi_passthrough: true, midiin_mapping_target: "scale", name: "Atomic" };
      act(() => handlers.onAtomicChange(update));
      expect(setSettings).not.toHaveBeenCalled();
      expect(handlers.exquisPendingSettings).toMatchObject(update);
      act(() => receive({ data: [0x80, 60, 0] }));
      act(() => vi.advanceTimersByTime(120));
      expect(setSettings).toHaveBeenCalledOnce();
      expect(setSettings.mock.calls[0][0]()).toMatchObject(update);
    } finally { view.unmount(); vi.useRealTimers(); }
  });
  it("changes instrument without panicking the canvas or clearing sustain", () => {
    const settings = { instrument: "old" };
    const setSettings = vi.fn();
    const setLatch = vi.fn();
    const panic = vi.fn();
    let handlers;
    render(
      <HookHarness
        settings={settings}
        setSettings={setSettings}
        setLatch={setLatch}
        keysRef={{ current: { panic } }}
        capture={(value) => {
          handlers = value;
        }}
      />,
    );
    handlers.onChange("instrument", "new");
    expect(panic).not.toHaveBeenCalled();
    expect(setLatch).not.toHaveBeenCalled();
    expect(setSettings).toHaveBeenCalledOnce();
    expect(setSettings.mock.calls[0][0](settings).instrument).toBe("new");
  });

  beforeEach(() => {
    sessionStorage.clear();
  });

  it("clears the detected controller output-port override when switching back to Auto Detect", () => {
    const setSettings = vi.fn();
    let handlers = null;
    const capture = (value) => {
      handlers = value;
    };

    render(
      <HookHarness
        settings={{
          midiin_device: "input-1",
          midiin_controller_override: "hakenaudio",
          hakenaudio_out_port: "manual-port",
        }}
        setSettings={setSettings}
        midi={{
          inputs: new Map([["input-1", { id: "input-1", name: "Haken Audio Continuum" }]]),
          outputs: new Map(),
        }}
        capture={capture}
      />,
    );

    sessionStorage.setItem("hakenaudio_out_port", "manual-port");

    handlers.onChange("midiin_controller_override", "auto");

    expect(setSettings).toHaveBeenCalledTimes(1);
    const nextSettings = setSettings.mock.calls[0][0]({
      midiin_device: "input-1",
      midiin_controller_override: "hakenaudio",
      hakenaudio_out_port: "manual-port",
    });
    expect(nextSettings.midiin_controller_override).toBe("auto");
    expect(nextSettings.hakenaudio_out_port).toBeNull();
    expect(sessionStorage.getItem("midiin_controller_override")).toBe("auto");
    expect(sessionStorage.getItem("hakenaudio_out_port")).toBeNull();
  });

  it("updates the live settings ref during atomic colour commits so a following spectrum toggle uses the committed state", () => {
    const setSettings = vi.fn();
    const updateColors = vi.fn();
    let handlers = null;
    const capture = (value) => {
      handlers = value;
    };

    render(
      <HookHarness
        settings={{
          auto_colors: true,
          spectrum_colors: true,
          fundamental_color: "#abcdef",
          note_colors: ["#ffffff", "#ffffff"],
          scale: ["23/16", "2/1"],
          equivSteps: 2,
          note_names: ["1/1", "23"],
          key_labels: "note_names",
        }}
        setSettings={setSettings}
        midi={null}
        keysRef={{ current: { updateColors } }}
        capture={capture}
      />,
    );

    handlers.onAtomicChange({
      note_colors: ["#ffa5a5", "#95c69b"],
      auto_colors: false,
      spectrum_colors: false,
    });
    handlers.onChange("spectrum_colors", true);

    expect(updateColors.mock.calls.at(-1)[0]).toMatchObject({
      spectrum_colors: true,
    });
    expect(updateColors.mock.calls.at(-1)[0].note_colors).toHaveLength(2);
    expect(updateColors.mock.calls.at(-1)[0].note_colors).not.toEqual(["ffa5a5", "95c69b"]);
  });

  it("persists HEJI palette display preferences but not its constructed spelling", () => {
    const setSettings = vi.fn();
    let handlers = null;
    render(
      <HookHarness
        settings={{
          heji_palette_visible: false,
          heji_palette_structure: "",
          heji_palette_deviation: "",
          heji_palette_decimals: 0,
        }}
        setSettings={setSettings}
        midi={null}
        capture={(value) => {
          handlers = value;
        }}
      />,
    );

    handlers.onChange("heji_palette_visible", true);
    handlers.onAtomicChange({
      heji_palette_structure: '{"letter":"A"}',
      heji_palette_deviation: "+17",
      heji_palette_decimals: 2,
    });

    expect(sessionStorage.getItem("heji_palette_visible")).toBe("true");
    expect(sessionStorage.getItem("heji_palette_structure")).toBeNull();
    expect(sessionStorage.getItem("heji_palette_deviation")).toBeNull();
    expect(sessionStorage.getItem("heji_palette_decimals")).toBe("2");
  });

  it.each([["Exquis", "exquis", 17, 1], ["Lumatone", "lumatone", 41, 2]])(
    "saves auto-detected %s anchor edits and refreshes the reload snapshot",
    (name, id, note, channel) => {
      const snapshotKey = "hexatone_restored_preset_payload";
      const previous = sessionStorage.getItem(snapshotKey);
      localStorage.setItem("hexatone_restore_io_on_reload", "true");
      sessionStorage.setItem(snapshotKey, JSON.stringify({ preset: { name: "Anchor edit", scale: ["2/1"] } }));
      const setSettings = vi.fn();
      let handlers;
      render(<HookHarness settings={{ name: "Anchor edit", scale: ["2/1"],
        midiin_device: "input-1", midiin_controller_override: "auto", midi_passthrough: false,
        midiin_anchor_note: 60, midiin_anchor_channel: 3 }}
        midi={{ inputs: new Map([["input-1", { id: "input-1", name }]]) }}
        setSettings={setSettings} capture={value => { handlers = value; }} />);
      try {
        handlers.onChange("midiin_anchor_note", note);
        handlers.onChange("midiin_anchor_channel", channel);
        const next = setSettings.mock.calls.at(-1)[0]();
        const saved = settingsToTuningRecord(next);
        const restored = JSON.parse(sessionStorage.getItem(snapshotKey)).preset;
        for (const record of [saved, restored]) {
          expect(record[`${id}_anchor_note`]).toBe(note);
          expect(record[`${id}_anchor_channel`]).toBe(id === "exquis" ? undefined : channel);
        }
      } finally {
        if (previous == null) sessionStorage.removeItem(snapshotKey);
        else sessionStorage.setItem(snapshotKey, previous);
        localStorage.removeItem("hexatone_restore_io_on_reload");
      }
    },
  );

  it("copies manual Lumatone anchor edits into preset-specific fields", () => {
    const setSettings = vi.fn();
    let handlers = null;
    render(
      <HookHarness
        settings={{
          midiin_device: "input-1",
          midiin_controller_override: "lumatone",
          midi_passthrough: false,
          midiin_anchor_note: 26,
          midiin_anchor_channel: 3,
        }}
        setSettings={setSettings}
        midi={{
          inputs: new Map([["input-1", { id: "input-1", name: "Lumatone" }]]),
          outputs: new Map(),
        }}
        capture={(value) => {
          handlers = value;
        }}
      />,
    );

    handlers.onChange("midiin_anchor_note", 41);
    handlers.onChange("midiin_anchor_channel", 2);

    expect(setSettings.mock.calls[0][0]()).toEqual(
      expect.objectContaining({
        midiin_anchor_note: 41,
        lumatone_anchor_note: 41,
        lumatone_anchor_channel: 3,
      }),
    );
    expect(setSettings.mock.calls[1][0]()).toEqual(
      expect.objectContaining({
        midiin_anchor_note: 41,
        midiin_anchor_channel: 2,
        lumatone_anchor_note: 41,
        lumatone_anchor_channel: 2,
      }),
    );
  });

  it("copies atomic Haken anchor edits into preset-specific fields", () => {
    const setSettings = vi.fn();
    let handlers = null;
    render(
      <HookHarness
        settings={{
          midiin_device: "input-1",
          midiin_controller_override: "hakenaudio",
          midi_passthrough: false,
          midiin_anchor_note: 60,
          midiin_anchor_channel: 1,
        }}
        setSettings={setSettings}
        midi={{
          inputs: new Map([["input-1", { id: "input-1", name: "Haken Audio Continuum" }]]),
          outputs: new Map(),
        }}
        capture={(value) => {
          handlers = value;
        }}
      />,
    );

    handlers.onAtomicChange({ midiin_anchor_note: 67 });

    expect(setSettings.mock.calls[0][0]()).toEqual(
      expect.objectContaining({
        midiin_anchor_note: 67,
        haken_anchor_note: 67,
      }),
    );
  });
});
