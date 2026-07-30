import { describe, expect, it, vi } from "vitest";
import {
  drawColorPreviewDegrees,
  fitHexLabelScale,
  scheduleColorPreviewRedraw,
} from "./keys-renderer.js";

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

describe("scheduleColorPreviewRedraw", () => {
  it("collapses rapid preview requests to one draw on the next frame", () => {
    let drawFrame;
    const requestAnimationFrame = vi.fn((callback) => {
      drawFrame = callback;
      return 17;
    });
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const ctx = {
      _gridRedrawRaf: null,
      _staticGridValid: true,
      drawGrid: vi.fn(),
    };

    scheduleColorPreviewRedraw.call(ctx);
    scheduleColorPreviewRedraw.call(ctx);

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(ctx._staticGridValid).toBe(false);
    expect(ctx.drawGrid).not.toHaveBeenCalled();

    drawFrame();

    expect(ctx._gridRedrawRaf).toBeNull();
    expect(ctx.drawGrid).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("passes accumulated manual degree changes to the partial redraw path", () => {
    let drawFrame;
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      drawFrame = callback;
      return 18;
    });
    const ctx = {
      _gridRedrawRaf: null,
      _staticGridValid: true,
      drawGrid: vi.fn(),
      drawColorPreviewDegrees: vi.fn(),
    };

    scheduleColorPreviewRedraw.call(ctx, 2);
    scheduleColorPreviewRedraw.call(ctx, 5);
    drawFrame();

    expect(ctx.drawColorPreviewDegrees).toHaveBeenCalledWith([2, 5]);
    expect(ctx.drawGrid).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("drawColorPreviewDegrees", () => {
  it("repaints only visible hexes belonging to changed degrees", () => {
    const degreeByX = new Map([
      [0, 1],
      [1, 2],
      [2, 1],
    ]);
    const ctx = {
      _staticGridValid: true,
      _staticGridContext: {},
      _staticGridCanvas: {},
      _visibleGridCoords: [{ x: 0 }, { x: 1 }, { x: 2 }],
      hexCoordsToCents: ({ x }) => [0, degreeByX.get(x)],
      _drawStaticHex: vi.fn(),
      _copyStaticGridToMain: vi.fn(() => true),
      _redrawSoundingHexes: vi.fn(),
      drawGrid: vi.fn(),
    };

    drawColorPreviewDegrees.call(ctx, [1]);

    expect(ctx._drawStaticHex).toHaveBeenCalledTimes(2);
    expect(ctx._drawStaticHex.mock.calls.map(([coords]) => coords.x)).toEqual([0, 2]);
    expect(ctx._copyStaticGridToMain).toHaveBeenCalledTimes(1);
    expect(ctx._redrawSoundingHexes).toHaveBeenCalledTimes(1);
    expect(ctx.drawGrid).not.toHaveBeenCalled();
  });
});
