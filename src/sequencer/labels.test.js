import { describe, expect, it } from "vitest";
import {
  buildChordProportion,
  buildOddPartialProportion,
  buildSnapshotDescription,
} from "./labels.js";

describe("sequencer snapshot labels", () => {
  it("derives a lowest-terms harmonic proportion from exact JI ratios", () => {
    expect(
      buildChordProportion([
        { midicents: 76, ratioText: "5/4" },
        { midicents: 69, ratioText: "1/1" },
        { midicents: 81, ratioText: "3/2" },
      ]),
    ).toBe("4:5:6");
  });

  it("reduces common factors after clearing denominators", () => {
    expect(
      buildChordProportion([
        { midicents: 72, ratioText: "6/5" },
        { midicents: 76, ratioText: "3/2" },
      ]),
    ).toBe("4:5");
  });

  it("lifts later ratios by octaves to match the sounded voicing order", () => {
    expect(
      buildChordProportion([
        { midicents: 69, ratioText: "29/16" },
        { midicents: 81, ratioText: "1/1" },
        { midicents: 84.2, ratioText: "37/32" },
        { midicents: 90, ratioText: "43/32" },
        { midicents: 93, ratioText: "3/2" },
      ]),
    ).toBe("29:32:37:43:48");
  });

  it("ignores modulation metadata and only uses ratio text plus octave lifting", () => {
    expect(
      buildChordProportion([
        { midicents: 69, ratioText: "29/16", modulationRatioText: "2/1" },
        { midicents: 81, ratioText: "1/1", modulationRatioText: "2/1" },
        { midicents: 84.2, ratioText: "37/32", modulationRatioText: "2/1" },
        { midicents: 90, ratioText: "43/32", modulationRatioText: "2/1" },
        { midicents: 93, ratioText: "3/2", modulationRatioText: "2/1" },
      ]),
    ).toBe("29:32:37:43:48");
  });

  it("renders first-inversion and spread voicings from older equave-reduced snapshot ratios", () => {
    expect(
      buildChordProportion([
        { midicents: 58.49885491721271, ratioText: "235/128" },
        { midicents: 61.655267787218236, ratioText: "141/128" },
        { midicents: 66.63571777856436, ratioText: "47/32" },
      ]),
    ).toBe("5:6:8");

    expect(
      buildChordProportion([
        { midicents: 58.12653216976523, ratioText: "115/64" },
        { midicents: 59.77657445476445, ratioText: "253/128" },
        { midicents: 63.951654095808124, ratioText: "161/128" },
        { midicents: 66.26339503111687, ratioText: "23/16" },
        { midicents: 68.30249504842462, ratioText: "207/128" },
      ]),
    ).toBe("10:11:14:16:18");
  });

  it("drops repeated integers from odd-partial proportions", () => {
    expect(
      buildOddPartialProportion([
        { midicents: 69, ratioText: "3/2" },
        { midicents: 81, ratioText: "2/1" },
        { midicents: 88, ratioText: "4/1" },
        { midicents: 93, ratioText: "9/4" },
      ]),
    ).toBe("1:3:9");
  });

  it("derives an odd-partial proportion by removing powers of two and sorting the result", () => {
    expect(
      buildOddPartialProportion([
        { midicents: 69, ratioText: "29/16" },
        { midicents: 81, ratioText: "1/1" },
        { midicents: 84.2, ratioText: "37/32" },
        { midicents: 90, ratioText: "43/32" },
        { midicents: 93, ratioText: "3/2" },
      ]),
    ).toBe("1:3:29:37:43");
  });

  it("preserves odd identities after deriving the voiced integer proportion", () => {
    expect(
      buildOddPartialProportion([
        { midicents: 69, ratioText: "3/2" },
        { midicents: 83.7, ratioText: "7/2" },
      ]),
    ).toBe("3:7");

    expect(
      buildOddPartialProportion([
        { midicents: 69, ratioText: "5/3" },
        { midicents: 81.8, ratioText: "7/2" },
      ]),
    ).toBe("5:21");
  });

  it("derives chord interval cents from the lowest MIDIcents value", () => {
    expect(
      buildSnapshotDescription(
        [{ midicents: 76.5 }, { midicents: 69 }, { midicents: 81.25 }],
        "interval_cents",
      ),
    ).toBe("750.0, 1225.0");
  });

  it("falls back to chord interval cents when chord proportion is unavailable", () => {
    expect(
      buildSnapshotDescription(
        [
          { midicents: 69, displayLabel: "A" },
          { midicents: 76, displayLabel: "E", ratioText: "3/2" },
        ],
        "proportion",
      ),
    ).toBe("700.0");
  });

  it("renders odd partial proportion descriptions", () => {
    expect(
      buildSnapshotDescription(
        [
          { midicents: 69, ratioText: "5/4" },
          { midicents: 81, ratioText: "3/2" },
        ],
        "odd_proportion",
      ),
    ).toBe("3:5");
  });

  it("appends units to frequency labels", () => {
    expect(buildSnapshotDescription([{ midicents: 69 }, { midicents: 81 }], "frequency")).toBe(
      "440.00, 880.00",
    );
  });
});
