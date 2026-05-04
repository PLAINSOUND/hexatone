import { beforeEach, describe, expect, it } from "vitest";
import {
  SCALE_KEYS_TO_CLEAR,
  ANCHOR_SESSION_KEYS_TO_CLEAR,
  RUNTIME_ONLY_ANCHOR_DIRTY_SESSION_KEY,
  clearRuntimeOnlyAnchorSessionState,
  clearScaleSettings,
  mergePresetIntoSettings,
  scaleHexSizeForScreen,
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
    sessionStorage.setItem("midiin_central_degree", "26");
    sessionStorage.setItem("midiin_anchor_channel", "3");
    sessionStorage.setItem("lumatone_center_note", "26");
    sessionStorage.setItem("lumatone_center_channel", "3");

    const merged = mergePresetIntoSettings(
      {
        midiin_central_degree: -999,
        midiin_anchor_channel: -2,
        lumatone_center_note: -999,
        lumatone_center_channel: -2,
        controller_virtual_anchor_x: -18,
        controller_virtual_anchor_y: 6,
      },
      {
        name: "Harry Partch",
        scale: ["100.", "200.", "1200."],
      },
    );

    expect(merged.midiin_central_degree).toBe(26);
    expect(merged.midiin_anchor_channel).toBe(3);
    expect(merged.lumatone_center_note).toBe(26);
    expect(merged.lumatone_center_channel).toBe(3);
    expect(merged.controller_virtual_anchor_x).toBeNull();
    expect(merged.controller_virtual_anchor_y).toBeNull();
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

describe("clearRuntimeOnlyAnchorSessionState", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("removes only runtime-only anchor reload residue", () => {
    for (const key of ANCHOR_SESSION_KEYS_TO_CLEAR) sessionStorage.setItem(key, "anchor-value");
    sessionStorage.setItem(RUNTIME_ONLY_ANCHOR_DIRTY_SESSION_KEY, "true");
    sessionStorage.setItem("midiin_device", "input-1");
    sessionStorage.setItem("hexatone_preset_name", "Harry Partch");

    clearRuntimeOnlyAnchorSessionState();

    for (const key of ANCHOR_SESSION_KEYS_TO_CLEAR) {
      expect(sessionStorage.getItem(key)).toBeNull();
    }
    expect(sessionStorage.getItem(RUNTIME_ONLY_ANCHOR_DIRTY_SESSION_KEY)).toBeNull();
    expect(sessionStorage.getItem("midiin_device")).toBe("input-1");
    expect(sessionStorage.getItem("hexatone_preset_name")).toBe("Harry Partch");
  });
});
