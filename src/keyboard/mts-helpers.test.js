/**
 * mts-helpers.test.js — re-export shim test
 *
 * Verifies that mts-helpers.js correctly re-exports all functions from the
 * canonical src/tuning/ modules. Once all callers are migrated to import
 * from src/tuning/ directly, this file and mts-helpers.js can be deleted.
 *
 * Full test coverage for these functions lives in:
 *   src/tuning/mts-format.test.js
 *   src/tuning/center-anchor.test.js
 *   src/tuning/tuning-map.test.js
 */

import { describe, it, expect } from "vitest";
import {
  centsToMTS,
  mtsToMidiFloat,
  sanitizeBulkDumpName,
  resolveBulkDumpName,
  buildRealtimeSingleNoteMessage,
  buildBulkDumpMessage,
  degree0ToRef,
  computeCenterPitchHz,
  computeNaturalAnchor,
  chooseStaticMapCenterMidi,
  computeStaticMapDegree0,
  buildTuningMapEntries,
  patchTuningEntry,
  mtsTuningMap,
} from "./mts-helpers.js";

describe("mts-helpers re-export shim", () => {
  it("re-exports centsToMTS", () => {
    expect(typeof centsToMTS).toBe("function");
    expect(centsToMTS(69, 0)).toEqual([69, 0, 0]);
  });

  it("re-exports mtsToMidiFloat", () => {
    expect(typeof mtsToMidiFloat).toBe("function");
    expect(mtsToMidiFloat([69, 0, 0])).toBeCloseTo(69.0, 10);
  });

  it("re-exports sanitizeBulkDumpName", () => {
    expect(typeof sanitizeBulkDumpName).toBe("function");
    expect(sanitizeBulkDumpName("abcDEF1234567890!")).toBe("abcDEF1234567890");
  });

  it("re-exports resolveBulkDumpName", () => {
    expect(typeof resolveBulkDumpName).toBe("function");
    expect(resolveBulkDumpName("CustomMap", "ShortDesc", "Long Name")).toBe("CustomMap");
    expect(resolveBulkDumpName(null, "ShortDesc", "Long Name")).toBe("ShortDesc");
    expect(resolveBulkDumpName(undefined, "", "Long Name")).toBe("Long Name");
    expect(resolveBulkDumpName("", "ShortDesc", "Long Name")).toBe("");
  });

  it("re-exports buildRealtimeSingleNoteMessage", () => {
    expect(typeof buildRealtimeSingleNoteMessage).toBe("function");
    const msg = buildRealtimeSingleNoteMessage(42, 5, 60, [62, 32, 16]);
    expect(msg).toEqual([127, 42, 8, 2, 5, 1, 60, 62, 32, 16]);
  });

  it("re-exports buildBulkDumpMessage", () => {
    expect(typeof buildBulkDumpMessage).toBe("function");
    const entries = Array.from({ length: 128 }, () => [60, 1, 2]);
    const sysex = buildBulkDumpMessage(42, 7, "Test", entries);
    expect(sysex[0]).toBe(126);
    expect(sysex[1]).toBe(42);
    expect(sysex[4]).toBe(7);
  });

  it("re-exports degree0ToRef", () => {
    expect(typeof degree0ToRef).toBe("function");
    expect(degree0ToRef(0, [0, 100, 200])).toEqual([0, 1]);
  });

  it("re-exports computeCenterPitchHz", () => {
    expect(typeof computeCenterPitchHz).toBe("function");
    expect(computeCenterPitchHz(440, 0, [0, 100, 200], 1200, 0)).toBeCloseTo(440, 8);
  });

  it("re-exports computeNaturalAnchor", () => {
    expect(typeof computeNaturalAnchor).toBe("function");
    const scale = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100];
    expect(computeNaturalAnchor(440, 0, scale, 1200, 0)).toBe(69);
  });

  it("re-exports chooseStaticMapCenterMidi", () => {
    expect(typeof chooseStaticMapCenterMidi).toBe("function");
    expect(chooseStaticMapCenterMidi(440)).toBe(69);
  });

  it("re-exports computeStaticMapDegree0", () => {
    expect(typeof computeStaticMapDegree0).toBe("function");
    expect(computeStaticMapDegree0(69, 0)).toBe(69);
    expect(computeStaticMapDegree0(69, 12)).toBe(57);
  });

  it("re-exports buildTuningMapEntries", () => {
    expect(typeof buildTuningMapEntries).toBe("function");
    const scale = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100];
    expect(buildTuningMapEntries(69, scale, 1200, 440, [0, 1])).toHaveLength(128);
  });

  it("re-exports patchTuningEntry", () => {
    expect(typeof patchTuningEntry).toBe("function");
    const entries = Array.from({ length: 4 }, (_, i) => [i, i, i]);
    const patched = patchTuningEntry(entries, 2, [99, 98, 97]);
    expect(patched[2]).toEqual([99, 98, 97]);
    expect(entries[2]).toEqual([2, 2, 2]);
  });

  it("re-exports mtsTuningMap", () => {
    expect(typeof mtsTuningMap).toBe("function");
    const scale = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100];
    expect(mtsTuningMap(127, 127, 0, 69, scale, "test", 1200, 440, [0, 1])).toHaveLength(128);
  });
});
