import { render, waitFor } from "@testing-library/preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "preact/hooks";

vi.mock("./settings/presets/preset_values", () => ({
  presets: [
    {
      name: "Tests",
      settings: [
        {
          name: "Preset A",
          scale: ["100.", "1200."],
          note_names: ["A", "B"],
          note_colors: ["#ffffff", "#eeeeee"],
          key_labels: "note_names",
          fundamental: 440,
          reference_degree: 0,
        },
      ],
    },
  ],
  default_settings: {},
}));
vi.mock("./settings/presets/custom-presets", () => ({
  loadCustomPresets: vi.fn(() => []),
}));

import {
  SCALE_KEYS_TO_CLEAR,
  clearScaleSettings,
  mergePresetIntoSettings,
  scaleHexSizeForScreen,
  default as usePresets,
} from "./use-presets.js";

describe("scaleHexSizeForScreen", () => {
  it("scales large preset hex sizes on phone portrait screens", () => {
    window.innerWidth = 390;
    window.innerHeight = 844;

    expect(scaleHexSizeForScreen(42)).toBe(31);
  });

  it("scales large preset hex sizes on phone landscape screens", () => {
    window.innerWidth = 844;
    window.innerHeight = 390;

    expect(scaleHexSizeForScreen(42)).toBe(31);
  });

  it("preserves preset hex sizes on larger screens", () => {
    window.innerWidth = 1024;
    window.innerHeight = 768;

    expect(scaleHexSizeForScreen(42)).toBe(42);
  });
});

describe("mergePresetIntoSettings", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("clears stale HEJI anchor values when loading a preset without an explicit anchor", () => {
    const merged = mergePresetIntoSettings(
      {
        heji_anchor_ratio: "1088.268712",
        heji_anchor_label: "A",
        key_labels: "heji",
        fundamental: 294,
      },
      {
        name: "Pauline Oliveros: Heart of Tones",
        fundamental: 294,
      },
    );

    expect(merged.heji_anchor_ratio).toBe("");
    expect(merged.heji_anchor_label).toBe("");
  });

  it("preserves an explicit HEJI anchor when the incoming preset defines one", () => {
    const merged = mergePresetIntoSettings(
      {
        heji_anchor_ratio: "1088.268712",
        heji_anchor_label: "A",
      },
      {
        name: "Explicit anchor preset",
        heji_anchor_ratio: "15/8",
        heji_anchor_label: "A",
      },
    );

    expect(merged.heji_anchor_ratio).toBe("15/8");
    expect(merged.heji_anchor_label).toBe("A");
  });

  it("preserves hardware/runtime settings when a preset is merged on reload", () => {
    const merged = mergePresetIntoSettings(
      {
        midiin_device: "input-1",
        midiin_controller_override: "auto",
        linnstrument_led_sync: true,
        midiin_mapping_target: "hex_layout",
        midi_passthrough: false,
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
        linnstrument_channel_allocation: "single_channel",
        output_mts: true,
        mts_bulk_device: "out-1",
        name: "Old preset",
      },
      {
        name: "New preset",
        scale: ["100.", "200.", "1200."],
        rSteps: 2,
        drSteps: 1,
      },
    );

    expect(merged.name).toBe("New preset");
    expect(merged.midiin_device).toBe("input-1");
    expect(merged.midiin_controller_override).toBe("auto");
    expect(merged.linnstrument_led_sync).toBe(true);
    expect(merged.midiin_mapping_target).toBe("hex_layout");
    expect(merged.midi_passthrough).toBe(false);
    expect(merged.linnstrument_pitch_bend_mode).toBe("follow_scale_geometry");
    expect(merged.linnstrument_channel_allocation).toBe("single_channel");
    expect(merged.output_mts).toBe(true);
    expect(merged.mts_bulk_device).toBe("out-1");
  });

  it("drops stale runtime anchor rewrites and restores the persisted base anchor", () => {
    sessionStorage.setItem("midiin_anchor_note", "26");
    sessionStorage.setItem("midiin_anchor_channel", "3");

    const merged = mergePresetIntoSettings(
      {
        midiin_anchor_note: -999,
        midiin_anchor_channel: -2,
        controller_virtual_anchor_x: -18,
        controller_virtual_anchor_y: 6,
      },
      {
        name: "Harry Partch",
        scale: ["100.", "200.", "1200."],
      },
    );

    expect(merged.midiin_anchor_note).toBe(26);
    expect(merged.midiin_anchor_channel).toBe(3);
    expect(merged.controller_virtual_anchor_x).toBeNull();
    expect(merged.controller_virtual_anchor_y).toBeNull();
  });

  it("uses preset-specific Lumatone anchor fields when present", () => {
    sessionStorage.setItem("midiin_anchor_note", "31");
    sessionStorage.setItem("midiin_anchor_channel", "2");

    const merged = mergePresetIntoSettings(
      {
        midiin_anchor_note: 31,
        midiin_anchor_channel: 2,
        midiin_controller_override: "lumatone",
        midi_passthrough: false,
      },
      {
        name: "Sabat The Tree",
        lumatone_anchor_note: 26,
        lumatone_anchor_channel: 3,
      },
    );

    expect(merged.midiin_anchor_note).toBe(26);
    expect(merged.midiin_anchor_channel).toBe(3);
    expect(merged.lumatone_anchor_note).toBe(26);
    expect(merged.lumatone_anchor_channel).toBe(3);
  });

  it("uses preset-specific Exquis anchor fields when Exquis 2D is active", () => {
    sessionStorage.setItem("midiin_anchor_note", "23");

    const merged = mergePresetIntoSettings(
      {
        midiin_anchor_note: 23,
        midiin_controller_override: "exquis",
        midi_passthrough: false,
      },
      {
        name: "Exquis preset anchor",
        exquis_anchor_note: 19,
      },
    );

    expect(merged.midiin_anchor_note).toBe(19);
    expect(merged.exquis_anchor_note).toBe(19);
  });

  it("uses preset-specific LinnStrument anchor fields when LinnStrument 2D is active", () => {
    sessionStorage.setItem("midiin_anchor_note", "12");
    sessionStorage.setItem("midiin_anchor_channel", "4");

    const merged = mergePresetIntoSettings(
      {
        midiin_anchor_note: 12,
        midiin_anchor_channel: 4,
        midiin_controller_override: "linnstrument",
        midi_passthrough: false,
      },
      {
        name: "LinnStrument preset anchor",
        linnstrument_anchor_note: 9,
      },
    );

    expect(merged.midiin_anchor_note).toBe(9);
    expect(merged.midiin_anchor_channel).toBe(4);
    expect(merged.linnstrument_anchor_note).toBe(9);
  });

  it("ignores non-matching preset anchor fields when another controller is active", () => {
    sessionStorage.setItem("midiin_anchor_note", "31");

    const merged = mergePresetIntoSettings(
      {
        midiin_anchor_note: 31,
        midiin_controller_override: "exquis",
        midi_passthrough: false,
      },
      {
        name: "Sabat The Tree",
        lumatone_anchor_note: 26,
        lumatone_anchor_channel: 3,
      },
    );

    expect(merged.midiin_anchor_note).toBe(31);
    expect(merged.lumatone_anchor_note).toBe(26);
    expect(merged.lumatone_anchor_channel).toBe(3);
  });

  it("restores the user's saved anchor after leaving a preset-specific Lumatone anchor", () => {
    localStorage.setItem("lumatone__layout2d__anchor", "31");
    localStorage.setItem("lumatone__layout2d__anchor_channel", "2");

    const merged = mergePresetIntoSettings(
      {
        midiin_anchor_note: 26,
        midiin_anchor_channel: 3,
        midiin_controller_override: "lumatone",
        midi_passthrough: false,
        lumatone_anchor_note: 26,
        lumatone_anchor_channel: 3,
      },
      {
        name: "No Lumatone preset anchor",
      },
    );

    expect(merged.midiin_anchor_note).toBe(31);
    expect(merged.midiin_anchor_channel).toBe(2);
    expect(merged.lumatone_anchor_note).toBeUndefined();
    expect(merged.lumatone_anchor_channel).toBeUndefined();
  });

  it("restores the user's saved Exquis anchor after leaving a preset-specific Exquis anchor", () => {
    localStorage.setItem("exquis__layout2d__anchor", "23");

    const merged = mergePresetIntoSettings(
      {
        midiin_anchor_note: 19,
        midiin_controller_override: "exquis",
        midi_passthrough: false,
        exquis_anchor_note: 19,
      },
      {
        name: "No Exquis preset anchor",
      },
    );

    expect(merged.midiin_anchor_note).toBe(23);
    expect(merged.exquis_anchor_note).toBeUndefined();
  });

  it("restores the user's saved LinnStrument anchor after leaving a preset-specific LinnStrument anchor", () => {
    localStorage.setItem("linnstrument__userfw__anchor", "12");
    localStorage.setItem("linnstrument__userfw__anchor_channel", "4");

    const merged = mergePresetIntoSettings(
      {
        midiin_anchor_note: 9,
        midiin_anchor_channel: 4,
        midiin_controller_override: "linnstrument",
        midi_passthrough: false,
        linnstrument_anchor_note: 9,
      },
      {
        name: "No LinnStrument preset anchor",
      },
    );

    expect(merged.midiin_anchor_note).toBe(12);
    expect(merged.midiin_anchor_channel).toBe(4);
    expect(merged.linnstrument_anchor_note).toBeUndefined();
  });
});

describe("clearScaleSettings", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("removes only fresh-start scale/preset session keys", () => {
    for (const key of SCALE_KEYS_TO_CLEAR) sessionStorage.setItem(key, "preset-value");
    sessionStorage.setItem("midiin_device", "input-1");
    sessionStorage.setItem("midiin_controller_override", "auto");
    sessionStorage.setItem("linnstrument_led_sync", "true");
    sessionStorage.setItem("mts_bulk_device", "out-1");

    clearScaleSettings();

    for (const key of SCALE_KEYS_TO_CLEAR) {
      expect(sessionStorage.getItem(key)).toBeNull();
    }
    expect(sessionStorage.getItem("midiin_device")).toBe("input-1");
    expect(sessionStorage.getItem("midiin_controller_override")).toBe("auto");
    expect(sessionStorage.getItem("linnstrument_led_sync")).toBe("true");
    expect(sessionStorage.getItem("mts_bulk_device")).toBe("out-1");
  });
});

describe("usePresets refresh ordering", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("applies merged preset settings before scheduling the runtime reset on builtin refresh", async () => {
    localStorage.setItem("hexatone_persist_on_reload", "true");
    sessionStorage.setItem("hexatone_preset_source", "builtin");
    sessionStorage.setItem("hexatone_preset_name", "Preset A");

    const order = [];
    let lastHook = null;
    let scheduledReset = null;
    const originalRaf = window.requestAnimationFrame;
    const raf = vi.fn((callback) => {
      order.push("raf");
      scheduledReset = callback;
      return 1;
    });
    window.requestAnimationFrame = raf;
    globalThis.requestAnimationFrame = raf;

    const setSettings = vi.fn(() => {
      order.push("setSettings");
    });
    const bumpPresetRuntimeReset = vi.fn(() => {
      order.push("bump");
    });

    const Harness = () => {
      const hook = usePresets(
        {
          key_labels: "no_labels",
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          fundamental: 440,
          reference_degree: 0,
        },
        setSettings,
        {
          synthRef: { current: null },
          onUserInteraction: vi.fn(),
          bumpImportCount: vi.fn(),
          bumpPresetRuntimeReset,
          currentModulationLibrary: [],
          setPresetModulationLibrary: vi.fn(),
          onPresetModulationLibraryLoaded: vi.fn(),
        },
      );

      useEffect(() => {
        lastHook = hook;
      }, [hook]);

      return null;
    };

    render(<Harness />);

    await waitFor(() => {
      expect(lastHook?.activePresetName).toBe("Preset A");
    });

    order.length = 0;
    setSettings.mockClear();

    await act(async () => {
      lastHook.onRevertBuiltin();
    });

    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["setSettings", "raf"]);
    expect(bumpPresetRuntimeReset).not.toHaveBeenCalled();

    await act(async () => {
      scheduledReset?.();
    });

    expect(bumpPresetRuntimeReset).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["setSettings", "raf", "bump"]);

    window.requestAnimationFrame = originalRaf;
    globalThis.requestAnimationFrame = originalRaf;
  });

  it("applies merged preset settings before scheduling the runtime reset on builtin restore", async () => {
    localStorage.setItem("hexatone_persist_on_reload", "true");
    sessionStorage.setItem("hexatone_preset_source", "builtin");
    sessionStorage.setItem("hexatone_preset_name", "Preset A");

    const order = [];
    const originalRaf = window.requestAnimationFrame;
    const raf = vi.fn((callback) => {
      order.push("raf");
      callback();
      return 1;
    });
    window.requestAnimationFrame = raf;
    globalThis.requestAnimationFrame = raf;

    const setSettings = vi.fn(() => {
      order.push("setSettings");
    });
    const bumpPresetRuntimeReset = vi.fn(() => {
      order.push("bump");
    });
    const bumpImportCount = vi.fn(() => {
      order.push("import");
    });

    const Harness = () => {
      usePresets(
        {
          key_labels: "no_labels",
          heji_anchor_ratio: "",
          heji_anchor_label: "",
          fundamental: 440,
          reference_degree: 0,
        },
        setSettings,
        {
          synthRef: { current: null },
          onUserInteraction: vi.fn(),
          bumpImportCount,
          bumpPresetRuntimeReset,
          currentModulationLibrary: [],
          setPresetModulationLibrary: vi.fn(),
          onPresetModulationLibraryLoaded: vi.fn(),
        },
      );

      return null;
    };

    render(<Harness />);

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledTimes(1);
    });

    expect(order).toEqual(["import", "setSettings", "raf", "bump"]);

    window.requestAnimationFrame = originalRaf;
    globalThis.requestAnimationFrame = originalRaf;
  });

  it("returns to blank settings instead of reloading when the last user preset is deleted", async () => {
    const { loadCustomPresets } = await import("./settings/presets/custom-presets");
    loadCustomPresets.mockReturnValue([]);

    const setSettings = vi.fn();
    const bumpPresetRuntimeReset = vi.fn();
    const onPresetModulationLibraryLoaded = vi.fn();
    const setPresetModulationLibrary = vi.fn();
    const prepare = vi.fn();
    let lastHook = null;

    const Harness = () => {
      const hook = usePresets(
        {
          name: "Loaded User Tuning",
          scale: ["100.", "1200."],
          note_names: ["A", "B"],
          note_colors: ["#ffffff", "#eeeeee"],
          fundamental: 440,
          reference_degree: 0,
          key_labels: "note_names",
          midiin_device: "input-1",
        },
        setSettings,
        {
          synthRef: { current: { prepare } },
          onUserInteraction: vi.fn(),
          bumpImportCount: vi.fn(),
          bumpPresetRuntimeReset,
          currentModulationLibrary: [],
          setPresetModulationLibrary,
          onPresetModulationLibraryLoaded,
        },
      );

      useEffect(() => {
        lastHook = hook;
      }, [hook]);

      return null;
    };

    render(<Harness />);

    await act(async () => {
      lastHook.onClearUserPresets();
    });

    expect(setPresetModulationLibrary).toHaveBeenCalledWith([]);
    expect(onPresetModulationLibraryLoaded).toHaveBeenCalledWith([]);
    expect(setSettings).toHaveBeenCalledTimes(1);
    const nextSettings = setSettings.mock.calls[0][0]();
    expect(nextSettings.name).toBe("");
    expect(nextSettings.scale).toBeNull();
    expect(nextSettings.note_names).toBeNull();
    expect(nextSettings.note_colors).toBeNull();
    expect(nextSettings.midiin_device).toBe("input-1");
    expect(bumpPresetRuntimeReset).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
