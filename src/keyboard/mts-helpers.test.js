import { describe, it, expect } from "vitest";
import {
  computeCenterPitchHz,
  chooseStaticMapCenterMidi,
  computeStaticMapDegree0,
  buildBulkDumpMessage,
  patchTuningEntry,
  degree0ToRef,
  sanitizeBulkDumpName,
  resolveBulkDumpName,
} from "./mts-helpers.js";
import { scalaToCents } from "../settings/scale/parse-scale.js";

describe("mts-helpers", () => {
  describe("computeCenterPitchHz", () => {
    it("returns the fundamental when center degree is 0 and reference degree is 0", () => {
      expect(computeCenterPitchHz(440, 0, [0, 100, 200], 1200, 0)).toBeCloseTo(440, 8);
    });

    it("computes a non-zero center degree correctly", () => {
      const hz = computeCenterPitchHz(440, 0, [0, 100, 200], 1200, 1);
      expect(hz).toBeCloseTo(440 * (2 ** (100 / 1200)), 8);
    });

    it("computes the Partch 4/3 center pitch correctly", () => {
      const rawScale = [
        "81/80", "33/32", "21/20", "16/15", "12/11", "11/10", "10/9",
        "9/8", "8/7", "7/6", "32/27", "6/5", "11/9", "5/4", "14/11",
        "9/7", "21/16", "4/3", "2/1",
      ];
      const numericScale = rawScale.map((value) => scalaToCents(value));
      const equivInterval = numericScale[numericScale.length - 1];
      const scale = [0, ...numericScale.slice(0, -1)];
      const degree0 = degree0ToRef(0, scale);
      const hz = computeCenterPitchHz(220.5, degree0[0], scale, equivInterval, 18);
      expect(hz).toBeCloseTo(294, 6);
      expect(chooseStaticMapCenterMidi(hz)).toBe(62);
      expect(computeStaticMapDegree0(62, 18)).toBe(44);
    });
  });

  describe("chooseStaticMapCenterMidi", () => {
    it("chooses A3 for 220 Hz", () => {
      expect(chooseStaticMapCenterMidi(220)).toBe(57);
    });

    it("chooses A4 for 440 Hz", () => {
      expect(chooseStaticMapCenterMidi(440)).toBe(69);
    });
  });

  describe("computeStaticMapDegree0", () => {
    it("maps the center degree to the chosen center MIDI note", () => {
      expect(computeStaticMapDegree0(69, 0)).toBe(69);
      expect(computeStaticMapDegree0(69, 12)).toBe(57);
      expect(computeStaticMapDegree0(57, -12)).toBe(69);
    });
  });

  describe("buildBulkDumpMessage", () => {
    it("places device id and map number in the expected header positions", () => {
      const entries = Array.from({ length: 128 }, () => [60, 1, 2]);
      const sysex = buildBulkDumpMessage(42, 7, "Test", entries);
      expect(sysex[0]).toBe(126);
      expect(sysex[1]).toBe(42);
      expect(sysex[4]).toBe(7);
    });

    it("pads the name to 16 ASCII characters", () => {
      const entries = Array.from({ length: 128 }, () => [60, 1, 2]);
      const sysex = buildBulkDumpMessage(42, 7, "AB", entries);
      expect(sysex.slice(5, 21)).toEqual([
        65, 66, 32, 32, 32, 32, 32, 32,
        32, 32, 32, 32, 32, 32, 32, 32,
      ]);
    });

    it("computes the expected checksum", () => {
      const entries = Array.from({ length: 128 }, () => [60, 1, 2]);
      const sysex = buildBulkDumpMessage(42, 7, "Test", entries);
      let checksum = 0;
      for (let i = 1; i < sysex.length - 1; i++) checksum ^= sysex[i];
      expect(sysex[sysex.length - 1]).toBe(checksum & 0x7f);
    });
  });

  describe("bulk dump naming helpers", () => {
    it("sanitizes to 16 printable ASCII characters", () => {
      expect(sanitizeBulkDumpName("abcDEF1234567890!")).toBe("abcDEF1234567890");
      expect(sanitizeBulkDumpName("naïve name")).toBe("nave name");
    });

    it("prefers explicit override, then short description, then fallback name", () => {
      expect(resolveBulkDumpName("CustomMap", "ShortDesc", "Long Name")).toBe("CustomMap");
      expect(resolveBulkDumpName(null, "ShortDesc", "Long Name")).toBe("ShortDesc");
      expect(resolveBulkDumpName(undefined, "", "Long Name")).toBe("Long Name");
      expect(resolveBulkDumpName("", "ShortDesc", "Long Name")).toBe("");
    });
  });

  describe("patchTuningEntry", () => {
    it("returns a copy with only one slot changed", () => {
      const entries = Array.from({ length: 4 }, (_, i) => [i, i, i]);
      const patched = patchTuningEntry(entries, 2, [99, 98, 97]);
      expect(patched).not.toBe(entries);
      expect(patched[0]).toEqual([0, 0, 0]);
      expect(patched[1]).toEqual([1, 1, 1]);
      expect(patched[2]).toEqual([99, 98, 97]);
      expect(patched[3]).toEqual([3, 3, 3]);
      expect(entries[2]).toEqual([2, 2, 2]);
    });
  });
});
