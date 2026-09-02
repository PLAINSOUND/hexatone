import { describe, expect, it } from "vitest";
import {
  calculatorIntervalFromPitchStructure,
  calculatorPalettePitchFromAnalysis,
  calculatePitchLookup,
  canonicalCalculatorAnchorLabelInput,
  combineCalculatorIntervals,
  deriveCalculatorSeed,
  midiPitchFromFrequency,
  normalizeCalculatorInterval,
  parseCalculatorInterval,
  relativeCalculatorInterval,
} from "./runtime.js";
import { createPitchStructure, parseHejiToStructure } from "../notation/pitch-structure.js";

describe("calculator runtime", () => {
  it("uses an A 440 at 1/1 blank-slate workspace before a scale is loaded", () => {
    expect(deriveCalculatorSeed({ scale: null })).toMatchObject({
      referenceFrequency: 440,
      referenceInterval: "1/1",
      anchorInterval: "1/1",
      anchorReferenceInterval: "1/1",
      anchorLabel: "*nA",
      anchorFrequency: 440,
      targetInterval: "1/1",
      decimalPlaces: 0,
    });
  });

  it("derives 1/1 and the HEJI anchor frequency from a 27/16 reference", () => {
    const result = calculatePitchLookup({
      referenceFrequency: 440,
      referenceInterval: "27/16",
      anchorInterval: "27/16",
      anchorLabel: "*nA",
      targetInterval: "1/1",
    });

    expect(result.valid).toBe(true);
    expect(result.degree0Frequency).toBeCloseTo(260.740741, 6);
    expect(result.anchorFrequency).toBeCloseTo(440, 8);
    expect(result.ratioText).toBe("1/1");
    expect(result.ratioFromReferenceText).toBe("16/27");
    expect(result.hejiLabel).toBeTruthy();
  });

  it("accepts signed cents and reports pitch relative to reference and MIDI", () => {
    const result = calculatePitchLookup({
      referenceFrequency: 440,
      referenceInterval: "27/16",
      anchorInterval: "27/16",
      anchorLabel: "*nA",
      targetInterval: "-240.0",
    });

    expect(result.valid).toBe(true);
    expect(result.centsFromDegree0).toBe(-240);
    expect(result.centsFromReference).toBeCloseTo(-1145.865, 3);
    expect(result.midi.midiNote).toBeGreaterThanOrEqual(0);
    expect(Math.abs(result.midi.deviationCents)).toBeLessThanOrEqual(50);
    expect(result.nearbyRatios.length).toBeGreaterThan(0);
  });

  it("measures tuning-meter deviation from the notation anchor rather than A440", () => {
    const result = calculatePitchLookup({
      referenceFrequency: 442,
      referenceInterval: "1/1",
      anchorInterval: "400.",
      anchorLabel: "*nE",
      targetInterval: "400.",
    });

    expect(result.midi.deviationCents).not.toBe(0);
    expect(result.notationMeter).toEqual({ noteNames: ["E"], deviationCents: 0 });
  });

  it("reports full and octave-invariant radii from 1/1", () => {
    const rationalSearch = { primeLimit: 3, centsTolerance: 5, maxCandidates: 16 };
    const fourth = calculatePitchLookup({ targetInterval: "3/2", rationalSearch });
    const twelfth = calculatePitchLookup({ targetInterval: "3/1", rationalSearch });
    const fourthCandidate = fourth.nearbyRatios.find((candidate) => candidate.ratioText === "3/2");
    const twelfthCandidate = twelfth.nearbyRatios.find(
      (candidate) => candidate.ratioText === "3/1",
    );

    expect(fourthCandidate.oddRadius).toBeCloseTo(twelfthCandidate.oddRadius, 8);
    expect(fourthCandidate.harmonicRadius).toBeCloseTo(fourthCandidate.oddRadius + 0.5, 8);
    expect(twelfthCandidate.harmonicRadius).toBeCloseTo(twelfthCandidate.oddRadius, 8);
  });

  it("normalizes exact ratio input without treating cents as exact", () => {
    expect(parseCalculatorInterval(" 45 / 32 ").normalized).toBe("45/32");
    expect(parseCalculatorInterval("590.224").exact).toBe(false);
  });

  it("seeds from Hexatone settings without mutating them", () => {
    const settings = Object.freeze({
      fundamental: 442,
      reference_degree: 2,
      scale: ["9/8", "5/4", "2/1"],
      heji_anchor_ratio: "5/4",
      heji_anchor_label: "*nE",
      heji_anchor_frequency: "",
    });
    const seed = deriveCalculatorSeed(settings);

    expect(seed.referenceFrequency).toBe(442);
    expect(seed.referenceInterval).toBe("5/4");
    expect(seed.anchorInterval).toBe("5/4");
    expect(seed.anchorReferenceInterval).toBe("1/1");
    expect(seed.anchorLabel).toContain("E");
    expect(seed.anchorFrequency).toBeCloseTo(442, 8);
  });

  it("normalises a trailing cents deviation away from the notation anchor spelling", () => {
    expect(canonicalCalculatorAnchorLabelInput("*nA+0")).toContain("A");
    expect(canonicalCalculatorAnchorLabelInput("F−33¢")).toBe("F");
  });

  it("reports pitch in the Offset, HEJI anchor, Reference, and 1/1 frames", () => {
    const result = calculatePitchLookup({
      referenceFrequency: 440,
      referenceInterval: "3/2",
      anchorInterval: "5/4",
      anchorLabel: "*nA",
      offsetFromAnchorInterval: "9/8",
      pitchFromOffsetInterval: "6/5",
      targetInterval: "27/16",
    });

    expect(result.ratioFromOffsetText).toBe("6/5");
    expect(result.ratioFromAnchorText).toBe("27/20");
    expect(result.ratioFromReferenceText).toBe("9/8");
    expect(result.ratioText).toBe("27/16");
  });

  it("derives a synchronized Palette Input spelling and register", () => {
    expect(
      calculatorPalettePitchFromAnalysis({
        hejiLabel: "*nE+2",
        centsFromAnchor: 701.955,
        anchorLabel: "*nA",
      }),
    ).toMatchObject({
      spelling: expect.stringContaining("E"),
      deviation: "+2",
      octave: 5,
    });
  });

  it("formats A4 as MIDI note 69 with no deviation", () => {
    expect(midiPitchFromFrequency(440)).toMatchObject({
      midiNote: 69,
      noteName: "A4",
      noteNames: ["A4"],
      deviationCents: 0,
    });
  });

  it("offers flat and sharp names for an enharmonic MIDI pitch", () => {
    expect(midiPitchFromFrequency(440 * 2 ** (11 / 12))).toMatchObject({
      midiNote: 80,
      noteName: "Ab5",
      noteNames: ["Ab5", "G#5"],
      deviationCents: 0,
    });
  });

  it("resolves a HEJI spelling back to its exact interval from 1/1", () => {
    const result = calculatorIntervalFromPitchStructure({
      structure: parseHejiToStructure("*nA"),
      anchorLabel: "*nA",
      anchorInterval: "27/16",
    });

    expect(result).toMatchObject({ valid: true, exact: true, interval: "27/16" });
  });

  it("keeps palette pitches cents-based when the HEJI anchor is in cents", () => {
    const anchor = calculatorIntervalFromPitchStructure({
      structure: parseHejiToStructure("*nE"),
      anchorLabel: "*nE",
      anchorInterval: "400.",
    });
    const aNatural = calculatorIntervalFromPitchStructure({
      structure: parseHejiToStructure("*nA"),
      anchorLabel: "*nE",
      anchorInterval: "400.",
    });

    expect(anchor).toMatchObject({
      valid: true,
      exact: false,
      interval: "400.000000",
      relativeInterval: "1/1",
    });
    expect(aNatural.valid).toBe(true);
    expect(aNatural.exact).toBe(false);
    expect(aNatural.relativeInterval).toBe("4/3");
    expect(parseCalculatorInterval(aNatural.interval).cents).toBeCloseTo(
      400 + 1200 * Math.log2(4 / 3),
      6,
    );

    const lookup = calculatePitchLookup({
      referenceInterval: "1/1",
      anchorInterval: "400.",
      anchorLabel: "*nE",
      targetInterval: aNatural.interval,
      preferredHejiLabel: aNatural.hejiLabel,
    });
    expect(lookup.ratioText).toBeNull();
    expect(lookup.ratioFromReferenceText).toBeNull();
    expect(lookup.centsFromAnchor).toBeCloseTo(1200 * Math.log2(4 / 3), 6);
    expect(lookup.hejiLabel).toContain("A");
  });

  it("resolves tempered palette spellings with their entered cents deviation", () => {
    const result = calculatorIntervalFromPitchStructure({
      structure: createPitchStructure({
        letter: "C",
        accidentalCount: 1,
        useTemperedAccidentals: true,
      }),
      anchorLabel: "*nA",
      anchorInterval: "1/1",
      deviationCents: 12.5,
    });

    expect(result).toMatchObject({
      valid: true,
      exact: false,
      interval: "-787.500000",
      relativeInterval: "-787.500000",
      hejiLabel: "C+12.5",
    });
  });

  it("resolves palette spellings in an explicit scientific-pitch octave", () => {
    const structure = parseHejiToStructure("*nA");
    const middleC = parseHejiToStructure("*nC");

    expect(
      calculatorIntervalFromPitchStructure({
        structure: middleC,
        anchorLabel: "*nA",
        anchorInterval: "1/1",
        octave: 4,
      }).interval,
    ).toBe("16/27");

    expect(
      calculatorIntervalFromPitchStructure({
        structure,
        anchorLabel: "*nA",
        anchorInterval: "1/1",
        octave: 3,
      }).interval,
    ).toBe("1/2");
    expect(
      calculatorIntervalFromPitchStructure({
        structure,
        anchorLabel: "*nA",
        anchorInterval: "1/1",
        octave: 5,
      }).interval,
    ).toBe("2/1");
  });

  it("normalises to 1/1–2/1 while retaining octave boundaries as 2/1", () => {
    expect(normalizeCalculatorInterval("1/1").normalized).toBe("1/1");
    expect(normalizeCalculatorInterval("1/2").normalized).toBe("2/1");
    expect(normalizeCalculatorInterval("4/1").normalized).toBe("2/1");
    expect(normalizeCalculatorInterval("9/4").normalized).toBe("9/8");
    expect(normalizeCalculatorInterval("2400.0").normalized).toBe("1200.000000");
  });

  it("only normalises calculated lookup values when requested", () => {
    const input = {
      referenceFrequency: 440,
      referenceInterval: "1/1",
      anchorInterval: "1/1",
      anchorLabel: "*nA",
      targetInterval: "9/4",
    };

    expect(calculatePitchLookup(input).ratioText).toBe("9/4");
    expect(calculatePitchLookup(input).nearbyRatios[0].ratioText).toBe("9/4");
    expect(calculatePitchLookup({ ...input, normalizeResults: true })).toMatchObject({
      ratioText: "9/8",
      centsFromDegree0: expect.any(Number),
    });
    expect(
      calculatePitchLookup({ ...input, normalizeResults: true }).nearbyRatios[0].ratioText,
    ).toBe("9/8");
  });

  it("always writes integer ratios with an explicit denominator", () => {
    expect(parseCalculatorInterval("1").normalized).toBe("1/1");
    expect(parseCalculatorInterval("2/1").normalized).toBe("2/1");
  });

  it("combines an offset and a relative pitch as exact intervals", () => {
    expect(combineCalculatorIntervals("27/16", "1/1")).toBe("27/16");
    expect(combineCalculatorIntervals("27/16", "4/3")).toBe("9/4");
  });

  it("measures an absolute pitch relative to an editable offset", () => {
    expect(relativeCalculatorInterval("27/16", "27/16")).toBe("1/1");
    expect(relativeCalculatorInterval("27/16", "1/1")).toBe("27/16");
  });

  it("adds and subtracts cents when either interval is in cents", () => {
    expect(combineCalculatorIntervals("701.955", "-40.0")).toBe("661.955000");
    expect(relativeCalculatorInterval("661.955", "701.955")).toBe("-40.000000");
  });
});
