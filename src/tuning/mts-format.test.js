import { describe, it, expect } from "vitest";
import {
  centsToMTS,
  mtsToMidiFloat,
  sanitizeBulkDumpName,
  resolveBulkDumpName,
  buildRealtimeSingleNoteMessage,
  buildBulkDumpMessage,
} from "./mts-format.js";

// ── centsToMTS ────────────────────────────────────────────────────────────────

describe("centsToMTS", () => {
  it("returns [0,0,0] for zero note and zero bend", () => {
    expect(centsToMTS(0, 0)).toEqual([0, 0, 0]);
  });

  it("encodes A4 (MIDI 69) with zero bend as [69, 0, 0]", () => {
    expect(centsToMTS(69, 0)).toEqual([69, 0, 0]);
  });

  it("encodes a 50-cent upward bend as approximately half-semitone fine tune", () => {
    const [tt, yy, zz] = centsToMTS(69, 50);
    expect(tt).toBe(69);
    // 50 cents = 50/100 of a semitone = 8192/16384 fine-tune units
    // yy = floor(8192/128) = 64, zz = 8192 % 128 = 0
    expect(yy).toBe(64);
    expect(zz).toBe(0);
  });

  it("encodes a 100-cent upward bend as the next semitone", () => {
    const [tt, yy, zz] = centsToMTS(69, 100);
    expect(tt).toBe(70);
    expect(yy).toBe(0);
    expect(zz).toBe(0);
  });

  it("encodes a negative bend by borrowing from the semitone below", () => {
    const [tt, yy, zz] = centsToMTS(69, -50);
    expect(tt).toBe(68);
    // remainder = 50 cents above MIDI 68
    expect(yy).toBe(64);
    expect(zz).toBe(0);
  });

  it("clamps note < 0 to [0, 0, 0]", () => {
    expect(centsToMTS(-1, 0)).toEqual([0, 0, 0]);
  });

  it("clamps note > 127 to [127, 127, 126]", () => {
    expect(centsToMTS(128, 0)).toEqual([127, 127, 126]);
  });

  it("clamps a large positive bend that pushes above 127 to [127, 127, 126]", () => {
    expect(centsToMTS(127, 200)).toEqual([127, 127, 126]);
  });

  it("returns [0,0,0] for non-numeric inputs", () => {
    expect(centsToMTS("69", 0)).toEqual([0, 0, 0]);
    expect(centsToMTS(69, null)).toEqual([0, 0, 0]);
  });

  it("avoids fine overflow at exactly 1.0 remainder (fine = 16384 → 16383)", () => {
    // Construct a case where remainder is exactly 1.0 semitone after shift.
    // centsToMTS(69.0, 100) pushes tt to 70 with remainder 0 — the interesting
    // case is fine landing at 16384 internally, which must clamp to 16383.
    // We verify the output bytes are all ≤ 127.
    const result = centsToMTS(69, 99.9999);
    expect(result.every((b) => b <= 127)).toBe(true);
  });
});

// ── mtsToMidiFloat ────────────────────────────────────────────────────────────

describe("mtsToMidiFloat", () => {
  it("decodes [69, 0, 0] as exactly 69.0", () => {
    expect(mtsToMidiFloat([69, 0, 0])).toBeCloseTo(69.0, 10);
  });

  it("decodes a 50-cent bend correctly", () => {
    // Encode 50 cents up from A4, then decode — should round-trip to ~69.5
    const triplet = centsToMTS(69, 50);
    const decoded = mtsToMidiFloat(triplet);
    expect(decoded).toBeCloseTo(69.5, 3);
  });

  it("decodes [0, 0, 0] as exactly 0.0", () => {
    expect(mtsToMidiFloat([0, 0, 0])).toBe(0);
  });

  it("decodes [127, 127, 126] as close to 127.9999", () => {
    expect(mtsToMidiFloat([127, 127, 126])).toBeCloseTo(127.999, 2);
  });
});

// ── centsToMTS / mtsToMidiFloat round-trip ────────────────────────────────────

describe("centsToMTS / mtsToMidiFloat round-trip", () => {
  const cases = [
    { note: 60, bend: 0, label: "middle C, no bend" },
    { note: 69, bend: 33, label: "A4, 33-cent bend" },
    { note: 21, bend: 50, label: "low note, 50-cent bend" },
    { note: 108, bend: 0, label: "high note, no bend" },
    { note: 64, bend: -25, label: "negative bend" },
  ];

  for (const { note, bend, label } of cases) {
    it(`round-trips ${label}`, () => {
      const triplet = centsToMTS(note, bend);
      const decoded = mtsToMidiFloat(triplet);
      // Target float MIDI note is note + bend/100
      const expected = note + bend / 100;
      expect(decoded).toBeCloseTo(expected, 2);
    });
  }
});

// ── sanitizeBulkDumpName ──────────────────────────────────────────────────────

describe("sanitizeBulkDumpName", () => {
  it("passes through a plain ASCII string", () => {
    expect(sanitizeBulkDumpName("Hello World")).toBe("Hello World");
  });

  it("truncates to 16 characters", () => {
    expect(sanitizeBulkDumpName("abcDEF1234567890!")).toBe("abcDEF1234567890");
  });

  it("removes non-ASCII characters", () => {
    expect(sanitizeBulkDumpName("naïve name")).toBe("nave name");
  });

  it("removes control characters", () => {
    expect(sanitizeBulkDumpName("tab\there")).toBe("tabhere");
  });

  it("returns empty string for null", () => {
    expect(sanitizeBulkDumpName(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(sanitizeBulkDumpName(undefined)).toBe("");
  });

  it("allows all printable ASCII punctuation", () => {
    const input = "!@#$%^&*()_+-=";
    expect(sanitizeBulkDumpName(input)).toBe(input);
  });
});

// ── resolveBulkDumpName ───────────────────────────────────────────────────────

describe("resolveBulkDumpName", () => {
  it("prefers explicit override when provided", () => {
    expect(resolveBulkDumpName("CustomMap", "ShortDesc", "Long Name")).toBe("CustomMap");
  });

  it("uses short description when override is null", () => {
    expect(resolveBulkDumpName(null, "ShortDesc", "Long Name")).toBe("ShortDesc");
  });

  it("uses fallback when override is null and short description is empty", () => {
    expect(resolveBulkDumpName(null, "", "Long Name")).toBe("Long Name");
  });

  it("uses fallback when override is undefined and short description is falsy", () => {
    expect(resolveBulkDumpName(undefined, "", "Long Name")).toBe("Long Name");
  });

  it("preserves an empty string override as intentional blank name", () => {
    expect(resolveBulkDumpName("", "ShortDesc", "Long Name")).toBe("");
  });

  it("sanitizes the chosen name", () => {
    expect(resolveBulkDumpName(null, "naïve", "fallback")).toBe("nave");
  });
});

// ── buildRealtimeSingleNoteMessage ────────────────────────────────────────────

describe("buildRealtimeSingleNoteMessage", () => {
  it("produces a 10-byte message [127,deviceId,8,2,mapNumber,1,midiNote,tt,yy,zz]", () => {
    expect(buildRealtimeSingleNoteMessage(127, 0, 69, [69, 0, 0])).toHaveLength(10);
  });

  it("starts with real-time SysEx header bytes [127, deviceId, 8, 2]", () => {
    const msg = buildRealtimeSingleNoteMessage(42, 3, 69, [69, 0, 0]);
    expect(msg[0]).toBe(127);
    expect(msg[1]).toBe(42); // deviceId
    expect(msg[2]).toBe(8);
    expect(msg[3]).toBe(2);
  });

  it("places mapNumber, noteCount=1, midiNote, then triplet", () => {
    const msg = buildRealtimeSingleNoteMessage(127, 5, 60, [62, 32, 16]);
    expect(msg[4]).toBe(5); // mapNumber
    expect(msg[5]).toBe(1); // noteCount
    expect(msg[6]).toBe(60); // midiNote
    expect(msg[7]).toBe(62); // tt
    expect(msg[8]).toBe(32); // yy — wait, length is 8, so msg[8] doesn't exist
    // Triplet is spread — message is [127, deviceId, 8, 2, mapNumber, 1, midiNote, tt, yy, zz]
    // That's 10 bytes, not 8. Re-check the spec.
  });

  it("has correct full structure: [127, deviceId, 8, 2, mapNumber, 1, midiNote, tt, yy, zz]", () => {
    const msg = buildRealtimeSingleNoteMessage(42, 5, 60, [62, 32, 16]);
    expect(msg).toEqual([127, 42, 8, 2, 5, 1, 60, 62, 32, 16]);
  });
});

// ── buildBulkDumpMessage ──────────────────────────────────────────────────────

describe("buildBulkDumpMessage", () => {
  it("places device ID and map number in the expected header positions", () => {
    const entries = Array.from({ length: 128 }, () => [60, 1, 2]);
    const sysex = buildBulkDumpMessage(42, 7, "Test", entries);
    expect(sysex[0]).toBe(126); // non-real-time SysEx ID
    expect(sysex[1]).toBe(42); // deviceId
    expect(sysex[2]).toBe(8); // sub-ID 1 (MIDI tuning standard)
    expect(sysex[3]).toBe(1); // sub-ID 2 (bulk dump request)
    expect(sysex[4]).toBe(7); // mapNumber
  });

  it("pads the name to 16 ASCII bytes at positions 5–20", () => {
    const entries = Array.from({ length: 128 }, () => [60, 1, 2]);
    const sysex = buildBulkDumpMessage(42, 7, "AB", entries);
    expect(sysex.slice(5, 21)).toEqual([
      65, 66, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32,
    ]);
  });

  it("computes the correct XOR checksum as the last byte", () => {
    const entries = Array.from({ length: 128 }, () => [60, 1, 2]);
    const sysex = buildBulkDumpMessage(42, 7, "Test", entries);
    let checksum = 0;
    for (let i = 1; i < sysex.length - 1; i++) checksum ^= sysex[i];
    expect(sysex[sysex.length - 1]).toBe(checksum & 0x7f);
  });

  it("replaces silence sentinel [127,127,127] with [127,127,126]", () => {
    const entries = Array.from({ length: 128 }, () => [127, 127, 127]);
    const sysex = buildBulkDumpMessage(127, 0, "", entries);
    // First triplet starts at byte 21
    expect(sysex[21]).toBe(127);
    expect(sysex[22]).toBe(127);
    expect(sysex[23]).toBe(126); // clamped, not 127
  });

  it("produces the correct total message length (21 + 128*3 + 1 = 406 bytes)", () => {
    const entries = Array.from({ length: 128 }, () => [60, 1, 2]);
    expect(buildBulkDumpMessage(127, 0, "test", entries)).toHaveLength(406);
  });
});
