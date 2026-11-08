import { describe, expect, it } from "vitest";
import { adjustLumatoneColour } from "./lumatone-color-adjustments.js";

describe("Lumatone colour adjustments", () => {
  const colour = { r: 128, g: 64, b: 32 };

  it("keeps neutral colours exact and never mutates the base RGB", () => {
    const base = Object.freeze({ ...colour });
    expect(adjustLumatoneColour(base)).toEqual(colour);
    expect(adjustLumatoneColour(base, 0.5)).toEqual({ r: 64, g: 32, b: 16 });
    expect(adjustLumatoneColour(base)).toEqual(colour);
  });

  it("changes HSV saturation while retaining value and hue", () => {
    expect(adjustLumatoneColour(colour, 1, 0)).toEqual({ r: 128, g: 128, b: 128 });
    expect(adjustLumatoneColour(colour, 1, 2)).toEqual({ r: 128, g: 43, b: 0 });
    expect(adjustLumatoneColour(colour, 0.5, 0)).toEqual({ r: 64, g: 64, b: 64 });
  });

  it("caps brightness uniformly, preserves black and does not colour neutral greys", () => {
    expect(adjustLumatoneColour(colour, 2)).toEqual({ r: 255, g: 128, b: 64 });
    expect(adjustLumatoneColour(colour, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(adjustLumatoneColour({ r: 0, g: 0, b: 0 }, 2, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(adjustLumatoneColour({ r: 100, g: 100, b: 100 }, 1, 2)).toEqual({ r: 100, g: 100, b: 100 });
  });

  it("uses neutral defaults for non-finite settings and clamps negative values", () => {
    expect(adjustLumatoneColour(colour, NaN, Infinity)).toEqual(colour);
    expect(adjustLumatoneColour(colour, -1)).toEqual({ r: 0, g: 0, b: 0 });
  });
});
