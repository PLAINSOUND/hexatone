import { describe, it, expect } from "vitest";
import { findNearestDegree } from "./scale-mapper.js";

const edoScale = (divisions, equave = 1200) =>
  Array.from({ length: divisions }, (_, i) => (i * equave) / divisions);

describe("findNearestDegree", () => {
  it("finds the nearest degree in 12-EDO", () => {
    const result = findNearestDegree(386, edoScale(12), 1200, 25, "discard");
    expect(result).toEqual({ steps: 4, distanceCents: 14 });
  });

  it("finds the nearest degree in 31-EDO", () => {
    const scale31 = edoScale(31);
    const result = findNearestDegree(390, scale31, 1200, 25, "discard");
    expect(result.steps).toBe(10);
    expect(result.distanceCents).toBeCloseTo(Math.abs(390 - scale31[10]), 10);
  });

  it("finds the nearest degree in a JI scale", () => {
    const jiScale = [
      0,
      111.7312852698, // 16/15
      203.9100017308, // 9/8
      315.6412870006, // 6/5
      386.3137138648, // 5/4
      498.0449991346, // 4/3
      701.9550008654, // 3/2
      813.6862861352, // 8/5
      884.3587129994, // 5/3
      1017.5962878659, // 9/5
      1088.2687147302, // 15/8
    ];
    const result = findNearestDegree(812, jiScale, 1200, 20, "discard");
    expect(result.steps).toBe(7);
    expect(result.distanceCents).toBeCloseTo(Math.abs(812 - jiScale[7]), 10);
  });

  it("returns null in discard mode when pitch is outside tolerance", () => {
    const result = findNearestDegree(350, edoScale(12), 1200, 20, "discard");
    expect(result).toBeNull();
  });

  it("always returns the nearest degree in accept mode regardless of tolerance", () => {
    const result = findNearestDegree(350, edoScale(12), 1200, 1, "accept");
    expect(result).toEqual({ steps: 3, distanceCents: 50 });
  });

  it("wraps pitches near the equave boundary to degree 0 of the next octave", () => {
    const result = findNearestDegree(1195, edoScale(12), 1200, 10, "accept");
    expect(result).toEqual({ steps: 12, distanceCents: 5 });
  });

  it("returns zero distance on an exact match", () => {
    const result = findNearestDegree(700, edoScale(12), 1200, 1, "discard");
    expect(result).toEqual({ steps: 7, distanceCents: 0 });
  });

  it("handles negative pitchCents below the reference", () => {
    const result = findNearestDegree(-100, edoScale(12), 1200, 10, "accept");
    expect(result).toEqual({ steps: -1, distanceCents: 0 });
  });
});
