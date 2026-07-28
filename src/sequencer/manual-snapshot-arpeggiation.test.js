import { describe, expect, it } from "vitest";

import {
  DEFAULT_MANUAL_ARPEGGIATION,
  effectiveManualSnapshotArticulation,
  normalizeManualArpeggiation,
  normalizeManualSnapshotTrigger,
} from "./manual-snapshot-arpeggiation.js";

describe("manual snapshot arpeggiation settings", () => {
  it("normalizes absent and out-of-range settings", () => {
    expect(normalizeManualArpeggiation()).toEqual({
      ...DEFAULT_MANUAL_ARPEGGIATION,
      styleParameters: {},
    });
    expect(
      normalizeManualArpeggiation({
        mode: "invalid",
        initialSpreadMs: 9000,
        spreadVariation: 2,
        timingVariation: -1,
        decayMs: 90000,
        decayVariation: -1,
      }),
    ).toMatchObject({
      mode: "off",
      initialSpreadMs: 5000,
      spreadVariation: 1,
      timingVariation: 0,
      decayMs: 20000,
      decayVariation: 0,
    });
  });

  it("normalizes old snapshots to chord articulation", () => {
    expect(normalizeManualSnapshotTrigger()).toEqual({
      articulation: "chord",
      styleId: null,
      styleParameters: null,
    });
  });

  it("resolves global overrides without changing the stored snapshot value", () => {
    const stored = { articulation: "arpeggiate" };
    expect(effectiveManualSnapshotArticulation("off", stored)).toBe("chord");
    expect(effectiveManualSnapshotArticulation("per-snapshot", stored)).toBe("arpeggiate");
    expect(effectiveManualSnapshotArticulation("all", { articulation: "chord" })).toBe(
      "arpeggiate",
    );
    expect(stored).toEqual({ articulation: "arpeggiate" });
  });
});
