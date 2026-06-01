import { describe, expect, it } from "vitest";
import {
  degreeFilterSetFromSettings,
  formatLumatoneDegreeFilter,
  normalizeLumatoneColorFilterLibrary,
  parseLumatoneDegreeFilter,
} from "./lumatone-color-filters.js";

describe("parseLumatoneDegreeFilter", () => {
  it("parses comma-separated degree lists", () => {
    expect(parseLumatoneDegreeFilter("7, 0, 4, 4")).toEqual([0, 4, 7]);
  });

  it("returns null for invalid tokens", () => {
    expect(parseLumatoneDegreeFilter("0, x, 7")).toBeNull();
  });
});

describe("formatLumatoneDegreeFilter", () => {
  it("normalizes degree arrays to a compact stable string", () => {
    expect(formatLumatoneDegreeFilter([7, 0, 4, 4])).toBe("0,4,7");
  });
});

describe("normalizeLumatoneColorFilterLibrary", () => {
  it("normalizes names and degree payloads", () => {
    expect(
      normalizeLumatoneColorFilterLibrary([
        { name: " Fifths ", degrees: [7, 0, 7, 4] },
        { name: "Fifths", degrees: [1] },
        { name: "Odd", filter: "9, 3" },
      ]),
    ).toEqual([
      { name: "Fifths", filter: "0,4,7" },
      { name: "Odd", filter: "3,9" },
    ]);
  });
});

describe("degreeFilterSetFromSettings", () => {
  it("returns null when filtering is disabled", () => {
    expect(degreeFilterSetFromSettings({ lumatone_degree_filter_mode: "all" })).toBeNull();
  });

  it("returns a Set of active degrees when filtering is enabled", () => {
    expect([...degreeFilterSetFromSettings({
      lumatone_degree_filter_mode: "filter",
      lumatone_degree_filter: "0,4,7",
    })]).toEqual([0, 4, 7]);
  });
});
