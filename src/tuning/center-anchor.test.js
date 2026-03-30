import { describe, it, expect } from "vitest";
import {
  degree0ToRef,
  computeCenterPitchHz,
  computeNaturalAnchor,
  chooseStaticMapCenterMidi,
  computeStaticMapDegree0,
} from "./center-anchor.js";
import { scalaToCents } from "../settings/scale/parse-scale.js";

// ── degree0ToRef ──────────────────────────────────────────────────────────────

describe("degree0ToRef", () => {
  it("returns [0, 1] when reference degree is 0", () => {
    const scale = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100];
    expect(degree0ToRef(0, scale)).toEqual([0, 1]);
  });

  it("returns [0, 1] when reference degree is negative", () => {
    const scale = [0, 100, 200];
    expect(degree0ToRef(-1, scale)).toEqual([0, 1]);
  });

  it("returns the correct cents and ratio for a non-zero reference degree", () => {
    const scale = [0, 100, 200, 700];
    const [cents, ratio] = degree0ToRef(3, scale);
    expect(cents).toBe(700);
    expect(ratio).toBeCloseTo(2 ** (700 / 1200), 10);
  });

  it("computes a just fifth (3/2 = ~701.955 cents) correctly", () => {
    // Scale: [0, 9/8, 5/4, 3/2, ...], degree 3 = 3/2
    // scalaToCents maps each string; we need raw cents for degree 3.
    const rawScale = ["1/1", "9/8", "5/4", "3/2", "2/1"];
    const numericScale = rawScale.map(scalaToCents);
    // scale[0]=0, scale[1]=9/8 cents, scale[2]=5/4 cents, scale[3]=3/2 cents
    // But scalaToCents("1/1") = 0, so numericScale = [0, ~204, ~386, ~702, 1200]
    // We build the normalized form directly (scale[0]=0 is already correct here).
    const scale = numericScale.slice(0, -1); // drop equave, keep [0, 204, 386, 702]
    const [cents, ratio] = degree0ToRef(3, scale);
    expect(cents).toBeCloseTo(701.955, 2);
    expect(ratio).toBeCloseTo(3 / 2, 6);
  });
});

// ── computeCenterPitchHz ──────────────────────────────────────────────────────

describe("computeCenterPitchHz", () => {
  it("returns the fundamental when center degree is 0 and reference degree is 0", () => {
    const scale = [0, 100, 200];
    expect(computeCenterPitchHz(440, 0, scale, 1200, 0)).toBeCloseTo(440, 8);
  });

  it("computes a non-zero center degree correctly", () => {
    const scale = [0, 100, 200];
    const hz = computeCenterPitchHz(440, 0, scale, 1200, 1);
    expect(hz).toBeCloseTo(440 * (2 ** (100 / 1200)), 8);
  });

  it("handles a center degree equal to scale length (next octave)", () => {
    const scale = [0, 400, 700]; // 3-note scale
    // Degree 3 = octave above degree 0 = fundamental * 2^(equave/1200)
    const hz = computeCenterPitchHz(440, 0, scale, 1200, 3);
    expect(hz).toBeCloseTo(880, 6);
  });

  it("handles a negative center degree (below tonic)", () => {
    const scale = [0, 400, 700];
    // Degree -3 = one octave below degree 0
    const hz = computeCenterPitchHz(440, 0, scale, 1200, -3);
    expect(hz).toBeCloseTo(220, 6);
  });

  it("computes the Partch 4/3 center pitch correctly (integration with scalaToCents)", () => {
    const rawScale = [
      "81/80", "33/32", "21/20", "16/15", "12/11", "11/10", "10/9",
      "9/8", "8/7", "7/6", "32/27", "6/5", "11/9", "5/4", "14/11",
      "9/7", "21/16", "4/3", "2/1",
    ];
    const numericScale = rawScale.map(scalaToCents);
    const equivInterval = numericScale[numericScale.length - 1];
    const scale = [0, ...numericScale.slice(0, -1)];
    const [degree0toRefCents] = degree0ToRef(0, scale);
    const hz = computeCenterPitchHz(220.5, degree0toRefCents, scale, equivInterval, 18);
    expect(hz).toBeCloseTo(294, 6);
  });
});

// ── computeNaturalAnchor ──────────────────────────────────────────────────────

describe("computeNaturalAnchor", () => {
  it("returns MIDI 69 for A4 = 440 Hz with 12-EDO and center degree 0", () => {
    const scale = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100];
    expect(computeNaturalAnchor(440, 0, scale, 1200, 0)).toBe(69);
  });

  it("shifts up by one semitone when center degree is 1 in 12-EDO", () => {
    const scale = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100];
    expect(computeNaturalAnchor(440, 0, scale, 1200, 1)).toBe(70);
  });

  it("clamps to 0 for an extremely low pitch", () => {
    const scale = [0];
    expect(computeNaturalAnchor(0.001, 0, scale, 1200, 0)).toBe(0);
  });

  it("clamps to 127 for an extremely high pitch", () => {
    const scale = [0];
    expect(computeNaturalAnchor(1e9, 0, scale, 1200, 0)).toBe(127);
  });
});

// ── chooseStaticMapCenterMidi ─────────────────────────────────────────────────

describe("chooseStaticMapCenterMidi", () => {
  it("chooses A3 (MIDI 57) for 220 Hz", () => {
    expect(chooseStaticMapCenterMidi(220)).toBe(57);
  });

  it("chooses A4 (MIDI 69) for 440 Hz", () => {
    expect(chooseStaticMapCenterMidi(440)).toBe(69);
  });

  it("chooses the nearest note for a pitch between two MIDI notes", () => {
    // A4 = 440, A#4 = ~466.16. 452 Hz is closer to A4.
    expect(chooseStaticMapCenterMidi(452)).toBe(69);
    // 454 Hz is closer to A#4 (MIDI 70)
    expect(chooseStaticMapCenterMidi(454)).toBe(70);
  });

  it("returns a value in the expected search range (57–72)", () => {
    for (const hz of [220, 280, 330, 440, 520, 600]) {
      const midi = chooseStaticMapCenterMidi(hz);
      expect(midi).toBeGreaterThanOrEqual(57);
      expect(midi).toBeLessThanOrEqual(72);
    }
  });

  it("handles the Partch 4/3 center correctly (integration test)", () => {
    // From computeCenterPitchHz Partch test above: hz ≈ 294
    expect(chooseStaticMapCenterMidi(294)).toBe(62); // D4
  });
});

// ── computeStaticMapDegree0 ───────────────────────────────────────────────────

describe("computeStaticMapDegree0", () => {
  it("returns centerMidiNote when centerDegree is 0", () => {
    expect(computeStaticMapDegree0(69, 0)).toBe(69);
  });

  it("subtracts center degree from center MIDI note", () => {
    expect(computeStaticMapDegree0(69, 12)).toBe(57);
  });

  it("handles negative center degree (adds to MIDI note)", () => {
    expect(computeStaticMapDegree0(57, -12)).toBe(69);
  });

  it("may return a value outside 0–127 (intentional, used as offset)", () => {
    expect(computeStaticMapDegree0(57, 100)).toBe(-43);
  });

  it("handles the Partch integration case (centerMidi=62, centerDegree=18)", () => {
    expect(computeStaticMapDegree0(62, 18)).toBe(44);
  });
});
