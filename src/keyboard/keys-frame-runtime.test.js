import { describe, expect, it } from "vitest";
import {
  createKeysFrame,
  deriveFrameForHistory,
  deriveFrameForHistoryIndex,
} from "./keys-frame-runtime.js";

describe("keyboard/keys-frame-runtime", () => {
  function makeFrameFactory() {
    let frameGeneration = 0;
    return (degree, extra = {}) => createKeysFrame({
      id: `frame:${++frameGeneration}:${degree}`,
      degree,
      referenceDegree: 9,
      fundamental: 440,
      strategy: "retune_surface_to_source",
      ...extra,
    });
  }

  it("builds a home frame when history is empty", () => {
    const frame = deriveFrameForHistory({
      history: [],
      scale: [0, 100, 200, 300],
      referenceDegree: 9,
      fundamental: 440,
      strategy: "retune_surface_to_source",
      makeFrame: makeFrameFactory(),
    });

    expect(frame.anchorDegree).toBe(9);
    expect(frame.transpositionCents).toBe(0);
    expect(frame.effectiveFundamental).toBe(440);
    expect(frame.sourceDegree).toBeNull();
    expect(frame.targetDegree).toBeNull();
  });

  it("derives compounded transposition and effective fundamental from history", () => {
    const frame = deriveFrameForHistory({
      history: [
        { sourceDegree: 3, targetDegree: 1, count: 1 },
        { sourceDegree: 2, targetDegree: 0, count: -2 },
      ],
      scale: [0, 100, 200, 300],
      referenceDegree: 9,
      fundamental: 440,
      strategy: "retune_surface_to_source",
      makeFrame: makeFrameFactory(),
    });

    expect(frame.anchorDegree).toBe(0);
    expect(frame.transpositionCents).toBe(-200);
    expect(frame.effectiveFundamental).toBeCloseTo(440 * Math.pow(2, -200 / 1200), 8);
    expect(frame.sourceDegree).toBe(2);
    expect(frame.targetDegree).toBe(0);
  });

  it("replays an explicit history index against the latest route", () => {
    const frame = deriveFrameForHistoryIndex({
      history: [
        { sourceDegree: 3, targetDegree: 1, count: 1 },
        { sourceDegree: 2, targetDegree: 0, count: 2 },
      ],
      historyIndex: -1,
      scale: [0, 100, 200, 300],
      referenceDegree: 9,
      fundamental: 440,
      strategy: "retune_surface_to_source",
      makeFrame: makeFrameFactory(),
    });

    expect(frame.anchorDegree).toBe(0);
    expect(frame.transpositionCents).toBe(0);
    expect(frame.effectiveFundamental).toBe(440);
  });

  it("treats zero-count history rows as inactive library metadata", () => {
    const frame = deriveFrameForHistory({
      history: [
        { sourceDegree: 3, targetDegree: 1, count: 0 },
        { sourceDegree: 2, targetDegree: 0, count: 0 },
      ],
      scale: [0, 100, 200, 300],
      referenceDegree: 9,
      fundamental: 440,
      strategy: "retune_surface_to_source",
      makeFrame: makeFrameFactory(),
    });

    expect(frame.anchorDegree).toBe(9);
    expect(frame.transpositionCents).toBe(0);
    expect(frame.effectiveFundamental).toBe(440);
    expect(frame.sourceDegree).toBeNull();
    expect(frame.targetDegree).toBeNull();
  });

  it("replays octave-displaced modulation routes from their stored cents delta", () => {
    const frame = deriveFrameForHistory({
      history: [
        {
          sourceDegree: 0,
          targetDegree: 6,
          count: 2,
          transpositionDeltaCents: 231.174093530875,
        },
      ],
      scale: [0, 203.91, 386.31, 498.04, 701.96, 884.36, 968.83],
      referenceDegree: 0,
      fundamental: 440,
      strategy: "retune_surface_to_source",
      makeFrame: makeFrameFactory(),
    });

    expect(frame.transpositionCents).toBeCloseTo(462.34818706175, 8);
    expect(frame.effectiveFundamental).toBeCloseTo(440 * Math.pow(2, 462.34818706175 / 1200), 8);
  });
});
