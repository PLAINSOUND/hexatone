import { describe, expect, it } from "vitest";
import {
  displayLabelForDegree,
  labelDegreeFromFrame,
  scaleCentsLabelForDegree,
} from "./keys-display-runtime.js";

describe("keyboard/keys-display-runtime", () => {
  it("keeps moveable-surface labels on their committed degree", () => {
    expect(labelDegreeFromFrame(5, {
      frame: { strategy: "retune_surface_to_source", transpositionSteps: 3 },
      scaleLength: 12,
    })).toBe(5);
  });

  it("remaps stable-surface labels through frame transposition steps", () => {
    expect(labelDegreeFromFrame(5, {
      frame: { strategy: "reinterpret_surface_from_target", transpositionSteps: 3 },
      scaleLength: 12,
    })).toBe(8);
  });

  it("keeps scale-cents labels anchored to committed degree 0", () => {
    expect(scaleCentsLabelForDegree(5, [0, 100, 200, 300, 400, 500])).toBe("500.");
  });

  it("selects live HEJI/note labels but committed cents labels", () => {
    expect(displayLabelForDegree(5, {
      settings: {
        note: true,
        note_names: Array.from({ length: 12 }, (_, index) => `n${index}`),
      },
      frame: { strategy: "reinterpret_surface_from_target", transpositionSteps: 2 },
      scaleLength: 12,
      scale: [0, 100, 200, 300, 400, 500],
    })).toBe("n7");

    expect(displayLabelForDegree(5, {
      settings: { cents: true },
      frame: { strategy: "reinterpret_surface_from_target", transpositionSteps: 2 },
      scaleLength: 12,
      scale: [0, 100, 200, 300, 400, 500],
    })).toBe("500.");
  });
});
