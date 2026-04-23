import { describe, expect, it } from "vitest";
import { mergePresetIntoSettings } from "./use-presets.js";

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
