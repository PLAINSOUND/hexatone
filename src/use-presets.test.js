import { describe, expect, it } from "vitest";
import { mergePresetIntoSettings, scaleHexSizeForScreen } from "./use-presets.js";

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
});
