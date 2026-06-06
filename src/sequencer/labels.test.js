import { describe, expect, it } from "vitest";
import { buildChordProportion, buildSnapshotDescription } from "./labels.js";

describe("sequencer snapshot labels", () => {
  it("derives a lowest-terms harmonic proportion from exact JI ratios", () => {
    expect(buildChordProportion([
      { midicents: 76, ratioText: "5/4" },
      { midicents: 69, ratioText: "1/1" },
      { midicents: 81, ratioText: "3/2" },
    ])).toBe("4:5:6");
  });

  it("reduces common factors after clearing denominators", () => {
    expect(buildChordProportion([
      { midicents: 72, ratioText: "6/5" },
      { midicents: 76, ratioText: "3/2" },
    ])).toBe("4:5");
  });

  it("derives chord interval cents from the lowest MIDIcents value", () => {
    expect(buildSnapshotDescription([
      { midicents: 76.5 },
      { midicents: 69 },
      { midicents: 81.25 },
    ], "interval_cents")).toBe("750.000¢, 1225.000¢");
  });

  it("falls back to chord interval cents when chord proportion is unavailable", () => {
    expect(buildSnapshotDescription([
      { midicents: 69, displayLabel: "A" },
      { midicents: 76, displayLabel: "E", ratioText: "3/2" },
    ], "proportion")).toBe("700.000¢");
  });

  it("appends units to frequency labels", () => {
    expect(buildSnapshotDescription([
      { midicents: 69 },
      { midicents: 81 },
    ], "frequency")).toBe("440.00 Hz, 880.00 Hz");
  });
});
