import { describe, expect, it } from "vitest";
import {
  barDisplayBucket,
  buildBarNumberById,
  buildStructuralMarkersByDisplayBucket,
  normalizeTempoBeatFraction,
} from "./transport-runtime.js";

describe("sequencer transport runtime", () => {
  it("normalizes tempo beat fractions into a transport-ready shape", () => {
    expect(normalizeTempoBeatFraction(3, 8)).toEqual({
      beatNumerator: 3,
      beatDenominator: 8,
      beatLength: 1.5,
    });
  });

  it("maps structural markers into the same display buckets used by the sequencer", () => {
    expect(barDisplayBucket(1)).toBe(-1);
    expect(barDisplayBucket(1.5)).toBe(0);
    expect(barDisplayBucket(2)).toBe(0);
    expect(barDisplayBucket(3)).toBe(1);
  });

  it("builds one-based bar numbers keyed by persisted bar id", () => {
    expect(
      buildBarNumberById([
        { id: "bar-1", position: 1 },
        { id: "bar-2", position: 2 },
      ]),
    ).toEqual(
      new Map([
        ["bar-1", 1],
        ["bar-2", 2],
      ]),
    );
  });

  it("groups whole-position bars and tempi with tempo precedence at the same position", () => {
    const groups = buildStructuralMarkersByDisplayBucket(
      [
        { id: "bar-1", position: 1, numerator: 4, denominator: 4 },
        { id: "bar-2", position: 2, numerator: 3, denominator: 4 },
        { id: "bar-float", position: 2.5, numerator: 5, denominator: 8 },
      ],
      [
        { id: "tempo-1", position: 1, bpm: 60 },
        { id: "tempo-2", position: 2, bpm: 72 },
        { id: "tempo-float", position: 2.25, bpm: 84 },
      ],
    );

    expect(groups.get(-1)).toEqual([
      { id: "tempo-1", position: 1, bpm: 60, structuralType: "tempo", structuralOrder: 0 },
      {
        id: "bar-1",
        position: 1,
        numerator: 4,
        denominator: 4,
        structuralType: "bar",
        structuralOrder: 0,
      },
    ]);
    expect(groups.get(0)).toEqual([
      { id: "tempo-2", position: 2, bpm: 72, structuralType: "tempo", structuralOrder: 1 },
      {
        id: "bar-2",
        position: 2,
        numerator: 3,
        denominator: 4,
        structuralType: "bar",
        structuralOrder: 1,
      },
    ]);
    expect(groups.has(1)).toBe(false);
  });
});
