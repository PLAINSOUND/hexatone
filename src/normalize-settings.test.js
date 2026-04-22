import { describe, it, expect } from "vitest";
import { normalizeColors, normalizeStructural } from "./normalize-settings.js";

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

describe("normalizeStructural", () => {
  it("derives the Keys tuning shape from workspace committed cents", () => {
    const normalized = normalizeStructural({
      rotation: 0,
      key_labels: "no_labels",
      scale: ["9/8", "5/4", "7\\12", "2/1"],
      equivSteps: 4,
      note_names: [],
    });

    expect(normalized.scale).toHaveLength(4);
    expect(normalized.scale[0]).toBe(0);
    expect(normalized.scale[1]).toBeCloseTo(203.91000173077484, 6);
    expect(normalized.scale[2]).toBeCloseTo(386.3137138648348, 6);
    expect(normalized.scale[3]).toBeCloseTo(700, 6);
    expect(normalized.equivInterval).toBeCloseTo(1200, 6);
    expect(normalized.equivSteps).toBe(4);
  });

  it("keeps scala_names sourced from the entered scale text", () => {
    const normalized = normalizeStructural({
      rotation: 0,
      key_labels: "scala_names",
      scale: ["9/8", "5/4", "2/1"],
      equivSteps: 3,
      note_names: [],
    });

    expect(normalized.scala_names).toEqual(["1/1", "9/8", "5/4"]);
  });

  it("prefers an injected tuning runtime for the Keys-facing cents payload", () => {
    const normalized = normalizeStructural(
      {
        rotation: 0,
        key_labels: "no_labels",
        scale: ["9/8", "5/4", "2/1"],
        equivSteps: 3,
        note_names: [],
      },
      {
        tuningRuntime: {
          scale: [0, 111, 222],
          equivInterval: 999,
          equivSteps: 3,
        },
      },
    );

    expect(normalized.scale).toEqual([0, 111, 222]);
    expect(normalized.equivInterval).toBe(999);
  });
});
