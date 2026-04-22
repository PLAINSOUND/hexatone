import { parseExactInterval } from "./interval.js";
import {
  buildConsonantFamilyLibrary,
  enumerateCandidatesFromBounds,
  findRationalCandidates,
  harmonicRadiusFromMonzo,
  primeLimitToBounds,
  rerankCandidatesInContext,
  selectRationalisationContext,
} from "./rationalise.js";
import {
  DEFAULT_OVERTONAL_SOURCE_SET,
  DEFAULT_TUNEABLE_INTERVALS,
  findTuneableFamilyMatches,
  findOvertonalNeighbors,
  getNeighborFamilies,
} from "./tuneable-intervals.js";
import { createScaleWorkspace } from "./workspace.js";

describe("tuning/rationalise", () => {
  it("computes harmonic radius for 3/2", () => {
    const interval = parseExactInterval("3/2");
    expect(harmonicRadiusFromMonzo(interval.monzo)).toBeCloseTo(0.5 * Math.log2(3), 6);
  });

  it("builds sane prime-limit bounds", () => {
    expect(primeLimitToBounds(7)).toEqual({ 3: 3, 5: 2, 7: 2 });
  });

  it("finds 3/2 near 700 cents", () => {
    const results = findRationalCandidates(700, { primeLimit: 3, centsTolerance: 5 });
    expect(results.some((candidate) => candidate.ratioText === "3/2")).toBe(true);
  });

  it("finds 11/8 near 551 cents", () => {
    const results = findRationalCandidates(551.32, { primeLimit: 11, centsTolerance: 5 });
    expect(results.some((candidate) => candidate.ratioText === "11/8")).toBe(true);
  });

  it("respects odd-limit filtering", () => {
    const results = findRationalCandidates(435, {
      primeLimit: 7,
      oddLimit: 5,
      centsTolerance: 10,
    });
    expect(results.every((candidate) => candidate.oddLimit <= 5)).toBe(true);
  });

  it("supports prime-bounds override", () => {
    const results = findRationalCandidates(700, {
      primeBounds: { 3: 11 },
      centsTolerance: 5,
    });
    expect(results.some((candidate) => candidate.ratioText === "3/2")).toBe(true);
  });

  it("supports overtonal region restriction", () => {
    const results = enumerateCandidatesFromBounds(701.955, {
      primeBounds: { 3: 2 },
      region: "overtonal",
      centsTolerance: 0.5,
    });
    expect(results.some((candidate) => candidate.ratioText === "3/2")).toBe(true);
    expect(results.some((candidate) => candidate.ratioText === "4/3")).toBe(false);
  });

  it("builds a consonant family library including 41/32", () => {
    const library = buildConsonantFamilyLibrary();
    expect(library.some((entry) => entry.ratio === "41/32")).toBe(true);
  });

  it("uses 9/8 as the second tuneable interval before 8/7", () => {
    expect(DEFAULT_TUNEABLE_INTERVALS[1].ratio).toBe("9/8");
    expect(DEFAULT_TUNEABLE_INTERVALS[2].ratio).toBe("8/7");
  });

  it("finds tuneable family matches around 9/8", () => {
    const matches = findTuneableFamilyMatches(204);
    expect(matches[0].ratio).toBe("9/8");
  });

  it("returns neighborhood families for a tuneable ratio", () => {
    const neighbors = getNeighborFamilies("3/2");
    expect(neighbors.length).toBeGreaterThan(0);
    expect(neighbors.includes("3/2")).toBe(false);
  });

  it("exposes the 81-note overtonal source set including 41/32", () => {
    expect(DEFAULT_OVERTONAL_SOURCE_SET).toContain("41/32");
    expect(DEFAULT_OVERTONAL_SOURCE_SET).toContain("3/2");
    expect(DEFAULT_OVERTONAL_SOURCE_SET).toContain("2");
  });

  it("finds overtonal neighbors constrained to the overtonal source set", () => {
    const neighbors = findOvertonalNeighbors("3/2");
    expect(neighbors.length).toBeGreaterThan(0);
    expect(neighbors.every((ratio) => DEFAULT_OVERTONAL_SOURCE_SET.includes(ratio))).toBe(true);
  });

  it("reranks candidates against bounded context", () => {
    const workspace = createScaleWorkspace({
      scale: ["9/8", "5/4", "3/2", "2/1"],
      reference_degree: 0,
      fundamental: 440,
    });
    const context = selectRationalisationContext(workspace, 2, { maxContextComparisons: 2 });
    expect(context.committedSlots.length).toBeLessThanOrEqual(2);

    const candidates = [
      {
        ratio: parseExactInterval("41/32").ratio,
        ratioText: "41/32",
        cents: parseExactInterval("41/32").cents,
        deviation: 0,
        primeLimit: 41,
        oddLimit: 41,
        monzo: parseExactInterval("41/32").monzo,
        harmonicRadius: harmonicRadiusFromMonzo(parseExactInterval("41/32").monzo),
        region: "symmetric",
        contextualConsonance: 0,
        contextualBestMatch: 0,
        aggregateScore: 0,
      },
      {
        ratio: parseExactInterval("9/7").ratio,
        ratioText: "9/7",
        cents: parseExactInterval("9/7").cents,
        deviation: 0,
        primeLimit: 7,
        oddLimit: 9,
        monzo: parseExactInterval("9/7").monzo,
        harmonicRadius: harmonicRadiusFromMonzo(parseExactInterval("9/7").monzo),
        region: "symmetric",
        contextualConsonance: 0,
        contextualBestMatch: 0,
        aggregateScore: 0,
      },
    ];

    const reranked = rerankCandidatesInContext(candidates, context, {
      contextualToleranceTable: { "9/7": 10, "41/32": 10 },
    });
    expect(reranked[0].contextualConsonance).toBeGreaterThanOrEqual(0);
    expect(reranked[0].aggregateScore).toBeLessThanOrEqual(reranked[1].aggregateScore);
  });

  it("adds contextual scoring fields in contextual searches", () => {
    const workspace = createScaleWorkspace({
      scale: ["9/8", "5/4", "3/2", "2/1"],
      reference_degree: 0,
      fundamental: 440,
    });
    const results = findRationalCandidates(386.314, {
      primeLimit: 17,
      centsTolerance: 10,
      workspace,
      targetDegree: 2,
    });
    expect(results[0]).toHaveProperty("contextualConsonance");
    expect(results[0]).toHaveProperty("contextualBestMatch");
    expect(results[0]).toHaveProperty("aggregateScore");
  });
});
