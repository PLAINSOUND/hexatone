import { describe, expect, it } from "vitest";
import {
  buildSequencePitchFrameRegistry,
  formatSequencePitchFrameCompact,
  hydrateSequencePitchFrames,
  normalizeSequenceHejiName,
  resolveSequenceHejiName,
  splitOctaveHejiName,
} from "./pitch-frame.js";

const frame = {
  id: "frame-1",
  referenceLabel: "A4",
  referenceFrequency: 441,
  referenceInterval: "27/16",
  hejiAnchorLabel: "*nE",
  hejiAnchorInterval: "81/64",
};

describe("sequence pitch frames", () => {
  it("deduplicates frames for export and hydrates them for editing", () => {
    const built = buildSequencePitchFrameRegistry([
      { id: 1, pitchFrame: frame, notes: [] },
      { id: 2, pitchFrame: { ...frame, id: "another-id" }, notes: [] },
    ]);
    expect(built.pitchFrames).toHaveLength(1);
    expect(built.snapshots.map((snapshot) => snapshot.pitchFrameId)).toEqual([
      "frame-1",
      "frame-1",
    ]);
    expect(hydrateSequencePitchFrames(built.snapshots, built.pitchFrames)[1].pitchFrame).toEqual(
      built.pitchFrames[0],
    );
  });

  it("describes the compact and expanded frame data without an octave on the anchor", () => {
    expect(formatSequencePitchFrameCompact(frame)).toBe(
      "Reference A4 = 441 Hz = 27/16 | HEJI Anchor E (0¢)",
    );
  });

  it("uses scientific octave names and resolves rational pitches", () => {
    const resolved = resolveSequenceHejiName("E4", frame);
    expect(resolved.hejiName).toBe("E4");
    expect(resolved.midicents).toBeCloseTo(64.058851593, 8);
    expect(resolved.ratioText).toBe("81/64");
  });

  it("accepts tempered HEJI accidentals with a signed irrational deviation", () => {
    expect(splitOctaveHejiName("*stC5−12.5")).toMatchObject({
      spelling: "C",
      octave: 5,
      deviationCents: -12.5,
    });
    const resolved = resolveSequenceHejiName("*stC5−12.5", frame);
    expect(resolved.hejiName).toBe("C5−12.5");
    expect(resolved.ratioText).toBeUndefined();
    expect(resolved.monzo).toBeUndefined();
  });

  it("normalizes case, German H, bare naturals, aliases, and inherited octaves", () => {
    expect(normalizeSequenceHejiName("a", { fallbackOctave: 3 })).toBe("A3");
    expect(normalizeSequenceHejiName("h5")).toBe("B5");
    expect(normalizeSequenceHejiName("*fA2")).toBe("A2");
    expect(normalizeSequenceHejiName("*sC6")).toBe("C6");
    expect(normalizeSequenceHejiName("*ntd4")).toBe("D4+0");
    expect(normalizeSequenceHejiName("*ftE4+7")).toBe("E4+7");
    expect(normalizeSequenceHejiName("*stf4−19")).toBe("F4−19");
    expect(normalizeSequenceHejiName("*so5C4")).toBe("C4");
    expect(normalizeSequenceHejiName("*so25C4")).toBe("C4");
    expect(normalizeSequenceHejiName("*so125C4")).toBe("C4");
    expect(normalizeSequenceHejiName("*so7C4")).toBe("C4");
    expect(normalizeSequenceHejiName("*fu11A4")).toBe("A4");
    expect(normalizeSequenceHejiName("*no49D4")).toBe("D4");
    expect(normalizeSequenceHejiName("*stC4*-12")).toBe("C4−12");
    expect(normalizeSequenceHejiName("2", { fallbackName: "C4" })).toBe("C2");
    expect(normalizeSequenceHejiName("6", { fallbackName: "F4−19" })).toBe("F6−19");
  });

  it("rejects malformed names and cents attached to exact HEJI signs", () => {
    expect(normalizeSequenceHejiName("Q4")).toBeNull();
    expect(normalizeSequenceHejiName("A4oops")).toBeNull();
    expect(normalizeSequenceHejiName("*nA4+2")).toBeNull();
    expect(normalizeSequenceHejiName("A", { fallbackOctave: null })).toBeNull();
  });
});
