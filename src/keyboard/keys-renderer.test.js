import { describe, expect, it } from "vitest";
import { fitHexLabelScale } from "./keys-renderer.js";

describe("fitHexLabelScale", () => {
  it("shrinks long labels to fit the hex width", () => {
    const context = {
      measureText(text) {
        return { width: text.length * 20 };
      },
    };

    const shortScale = fitHexLabelScale(context, "A", 46);
    const longScale = fitHexLabelScale(context, "A+37", 46);

    expect(shortScale).toBe(1);
    expect(longScale).toBeLessThan(1);
    expect(longScale).toBeGreaterThan(0);
  });

  it("uses actual bounding boxes when glyph clusters underreport width", () => {
    const context = {
      measureText() {
        return {
          width: 24,
          actualBoundingBoxLeft: 28,
          actualBoundingBoxRight: 32,
        };
      },
    };

    const scale = fitHexLabelScale(context, "A+37", 46);

    expect(scale).toBeLessThan(1);
    expect(scale).toBeCloseTo((46 * 1.12) / 60, 5);
  });
});
