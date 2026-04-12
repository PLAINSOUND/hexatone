import { describe, it, expect } from "vitest";
import { normalizeColors } from "./normalize-settings.js";

describe("normalizeColors", () => {
  it("auto-generates note colors from the spectrum hue when none are present", () => {
    const normalized = normalizeColors({
      spectrum_colors: false,
      fundamental_color: "#f2e3e3",
      note_colors: [],
      equivSteps: 205,
    });

    expect(normalized.fundamental_color).toBe("f2e3e3");
    expect(normalized.note_colors).toHaveLength(205);
    expect(normalized.note_colors.every((color) => /^[0-9a-f]{6}$/i.test(color))).toBe(true);
  });

  it("preserves explicit note colors when they exist", () => {
    const normalized = normalizeColors({
      spectrum_colors: false,
      fundamental_color: "#f2e3e3",
      note_colors: ["#112233", "abcdef"],
      equivSteps: 2,
    });

    expect(normalized.note_colors).toEqual(["112233", "abcdef"]);
  });
});
