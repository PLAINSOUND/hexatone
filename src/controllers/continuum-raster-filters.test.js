import { describe, expect, it } from "vitest";
import {
  continuumRasterFilterSetFromRuntime,
  formatContinuumRasterFilter,
  normalizeContinuumRasterFilterLibrary,
  parseContinuumRasterFilter,
} from "./continuum-raster-filters.js";

describe("parseContinuumRasterFilter", () => {
  it("parses comma-separated degree lists", () => {
    expect(parseContinuumRasterFilter("7, 0, 4, 4")).toEqual([0, 4, 7]);
  });

  it("returns null for invalid tokens", () => {
    expect(parseContinuumRasterFilter("0, x, 7")).toBeNull();
  });
});

describe("formatContinuumRasterFilter", () => {
  it("normalizes degree arrays to a compact stable string", () => {
    expect(formatContinuumRasterFilter([7, 0, 4, 4])).toBe("0,4,7");
  });
});

describe("normalizeContinuumRasterFilterLibrary", () => {
  it("normalizes names and degree payloads while preserving order", () => {
    expect(
      normalizeContinuumRasterFilterLibrary([
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

describe("continuumRasterFilterSetFromRuntime", () => {
  it("returns null when filtering is disabled", () => {
    expect(continuumRasterFilterSetFromRuntime({ hakenRasterFilterMode: "all" })).toBeNull();
  });

  it("returns a Set of active degrees when filtering is enabled", () => {
    expect([...continuumRasterFilterSetFromRuntime({
      hakenRasterFilterMode: "filter",
      hakenRasterFilter: "0,4,7",
    })]).toEqual([0, 4, 7]);
  });
});
