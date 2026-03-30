import { describe, it, expect } from "vitest";
import { buildTuningMapEntries, patchTuningEntry, mtsTuningMap } from "./tuning-map.js";
import { mtsToMidiFloat } from "./mts-format.js";
import { degree0ToRef } from "./center-anchor.js";
import { scalaToCents } from "../settings/scale/parse-scale.js";

// ── helpers ───────────────────────────────────────────────────────────────────

// 12-EDO scale (scale[0] = 0, no equave at end)
const edo12Scale = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100];
const edo12Equave = 1200;

// ── buildTuningMapEntries ─────────────────────────────────────────────────────

describe("buildTuningMapEntries", () => {
  it("returns exactly 128 entries", () => {
    const entries = buildTuningMapEntries(69, edo12Scale, edo12Equave, 440, [0, 1]);
    expect(entries).toHaveLength(128);
  });

  it("each entry is a 3-element array with values 0–127", () => {
    const entries = buildTuningMapEntries(69, edo12Scale, edo12Equave, 440, [0, 1]);
    for (const [tt, yy, zz] of entries) {
      expect(tt).toBeGreaterThanOrEqual(0);
      expect(tt).toBeLessThanOrEqual(127);
      expect(yy).toBeGreaterThanOrEqual(0);
      expect(yy).toBeLessThanOrEqual(127);
      expect(zz).toBeGreaterThanOrEqual(0);
      expect(zz).toBeLessThanOrEqual(127);
    }
  });

  it("maps the anchor note (degree0) to its own MIDI float (identity tuning for 12-EDO)", () => {
    // For 12-EDO at A4 = 440 Hz with anchor = 69, degree 0 at MIDI 69:
    // the MTS encoding of MIDI 69 should decode back to ~69.0
    const entries = buildTuningMapEntries(69, edo12Scale, edo12Equave, 440, [0, 1]);
    const decoded = mtsToMidiFloat(entries[69]);
    expect(decoded).toBeCloseTo(69.0, 2);
  });

  it("maps MIDI 70 to one semitone above anchor in 12-EDO", () => {
    const entries = buildTuningMapEntries(69, edo12Scale, edo12Equave, 440, [0, 1]);
    const decoded = mtsToMidiFloat(entries[70]);
    expect(decoded).toBeCloseTo(70.0, 2);
  });

  it("maps MIDI 57 to one octave below anchor in 12-EDO", () => {
    const entries = buildTuningMapEntries(69, edo12Scale, edo12Equave, 440, [0, 1]);
    const decoded = mtsToMidiFloat(entries[57]);
    expect(decoded).toBeCloseTo(57.0, 2);
  });

  it("maps MIDI 81 to one octave above anchor in 12-EDO", () => {
    const entries = buildTuningMapEntries(69, edo12Scale, edo12Equave, 440, [0, 1]);
    const decoded = mtsToMidiFloat(entries[81]);
    expect(decoded).toBeCloseTo(81.0, 2);
  });

  it("maps correctly with a non-zero reference degree (degree0ToRef integration)", () => {
    // 5-note pentatonic: [0, 200, 400, 700, 900] cents, equave = 1200.
    // Reference degree = 2 (400 cents above degree 0).
    // fundamental = 440 Hz is assigned to degree 2.
    // degree0Cents = 0 - 400 = -400 cents relative to A4.
    // mapOffset = -400 (anchor = 69, so -400 - 100*(69-69) = -400).
    //
    // MIDI carrier 71 → idx 2, oct 0 → targetCents = 400 + (-400) + 0 = 0
    //   → targetFloat = 69 + 0/100 = 69.0 (the reference pitch, 440 Hz = A4)
    // MIDI carrier 69 → idx 0, oct 0 → targetCents = 0 + (-400) + 0 = -400
    //   → targetFloat = 69 + (-400/100) = 65.0 (degree 0, ~F4 ≈ 349 Hz)
    const scale = [0, 200, 400, 700, 900];
    const equave = 1200;
    const fundamental = 440; // Hz assigned to degree 2
    const ref = degree0ToRef(2, scale); // [400, 2^(400/1200)]
    const entries = buildTuningMapEntries(69, scale, equave, fundamental, ref);
    expect(entries).toHaveLength(128);
    // Carrier 71 carries the reference degree (degree 2, 440 Hz = MIDI 69.0)
    const decodedRef = mtsToMidiFloat(entries[71]);
    expect(decodedRef).toBeCloseTo(69.0, 2);
    // Carrier 69 carries degree 0 (~349 Hz = MIDI 65.0)
    const decodedDeg0 = mtsToMidiFloat(entries[69]);
    expect(decodedDeg0).toBeCloseTo(65.0, 2);
  });
});

// ── patchTuningEntry ──────────────────────────────────────────────────────────

describe("patchTuningEntry", () => {
  it("returns a copy with only the specified slot changed", () => {
    const entries = Array.from({ length: 4 }, (_, i) => [i, i, i]);
    const patched = patchTuningEntry(entries, 2, [99, 98, 97]);
    expect(patched[0]).toEqual([0, 0, 0]);
    expect(patched[1]).toEqual([1, 1, 1]);
    expect(patched[2]).toEqual([99, 98, 97]);
    expect(patched[3]).toEqual([3, 3, 3]);
  });

  it("does not mutate the original array", () => {
    const entries = Array.from({ length: 4 }, (_, i) => [i, i, i]);
    patchTuningEntry(entries, 2, [99, 98, 97]);
    expect(entries[2]).toEqual([2, 2, 2]);
  });

  it("returns a different array object", () => {
    const entries = Array.from({ length: 4 }, (_, i) => [i, i, i]);
    const patched = patchTuningEntry(entries, 0, [10, 20, 30]);
    expect(patched).not.toBe(entries);
  });

  it("does not mutate unpatched entry objects", () => {
    const entries = Array.from({ length: 4 }, (_, i) => [i, i, i]);
    const original0 = entries[0];
    const patched = patchTuningEntry(entries, 2, [99, 98, 97]);
    // The entry objects in unpatched slots should also be new copies.
    expect(patched[0]).not.toBe(original0);
    expect(patched[0]).toEqual([0, 0, 0]);
  });
});

// ── mtsTuningMap — real-time (sysexType 127) ──────────────────────────────────

describe("mtsTuningMap — real-time mode (sysexType 127)", () => {
  it("returns exactly 128 messages", () => {
    const result = mtsTuningMap(127, 127, 0, 69, edo12Scale, "test", edo12Equave, 440, [0, 1]);
    expect(result).toHaveLength(128);
  });

  it("each message starts with real-time SysEx header [127, deviceId, 8, 2]", () => {
    const result = mtsTuningMap(127, 42, 0, 69, edo12Scale, "test", edo12Equave, 440, [0, 1]);
    for (const msg of result) {
      expect(msg[0]).toBe(127);
      expect(msg[1]).toBe(42);
      expect(msg[2]).toBe(8);
      expect(msg[3]).toBe(2);
    }
  });

  it("message N carries MIDI note N", () => {
    const result = mtsTuningMap(127, 127, 0, 69, edo12Scale, "test", edo12Equave, 440, [0, 1]);
    for (let i = 0; i < 128; i++) {
      expect(result[i][6]).toBe(i);
    }
  });

  it("decodes the anchor note to approximately its own MIDI float in 12-EDO", () => {
    const result = mtsTuningMap(127, 127, 0, 69, edo12Scale, "test", edo12Equave, 440, [0, 1]);
    // Message for MIDI 69: bytes 7,8,9 are the triplet
    const triplet = [result[69][7], result[69][8], result[69][9]];
    expect(mtsToMidiFloat(triplet)).toBeCloseTo(69.0, 2);
  });
});

// ── mtsTuningMap — bulk dump (sysexType 126) ──────────────────────────────────

describe("mtsTuningMap — bulk dump mode (sysexType 126)", () => {
  it("returns a flat array (not nested)", () => {
    const result = mtsTuningMap(126, 127, 0, 69, edo12Scale, "test", edo12Equave, 440, [0, 1]);
    expect(Array.isArray(result)).toBe(true);
    expect(typeof result[0]).toBe("number");
  });

  it("returns 406 bytes (21 header + 128*3 entries + 1 checksum)", () => {
    const result = mtsTuningMap(126, 127, 0, 69, edo12Scale, "test", edo12Equave, 440, [0, 1]);
    expect(result).toHaveLength(406);
  });

  it("starts with non-real-time bulk dump header [126, deviceId, 8, 1]", () => {
    const result = mtsTuningMap(126, 42, 7, 69, edo12Scale, "test", edo12Equave, 440, [0, 1]);
    expect(result[0]).toBe(126);
    expect(result[1]).toBe(42);
    expect(result[2]).toBe(8);
    expect(result[3]).toBe(1);
    expect(result[4]).toBe(7); // mapNumber
  });

  it("has a valid XOR checksum as the last byte", () => {
    const result = mtsTuningMap(126, 127, 0, 69, edo12Scale, "test", edo12Equave, 440, [0, 1]);
    let checksum = 0;
    for (let i = 1; i < result.length - 1; i++) checksum ^= result[i];
    expect(result[result.length - 1]).toBe(checksum & 0x7f);
  });
});

// ── integration: Partch scale ─────────────────────────────────────────────────

describe("mtsTuningMap — Partch scale integration", () => {
  it("produces 128 real-time messages for the 19-tone Partch scale", () => {
    const rawScale = [
      "81/80", "33/32", "21/20", "16/15", "12/11", "11/10", "10/9",
      "9/8", "8/7", "7/6", "32/27", "6/5", "11/9", "5/4", "14/11",
      "9/7", "21/16", "4/3", "2/1",
    ];
    const numericScale = rawScale.map(scalaToCents);
    const equivInterval = numericScale[numericScale.length - 1];
    const scale = [0, ...numericScale.slice(0, -1)];
    const ref = degree0ToRef(0, scale);
    const result = mtsTuningMap(127, 127, 0, 44, scale, "Partch", equivInterval, 220.5, ref);
    expect(result).toHaveLength(128);
    // Each message is a real-time single-note message
    for (const msg of result) {
      expect(msg[0]).toBe(127);
      expect(msg[2]).toBe(8);
      expect(msg[3]).toBe(2);
    }
  });
});
