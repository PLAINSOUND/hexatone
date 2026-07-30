import { describe, expect, it } from "vitest";

import {
  DEFAULT_MANUAL_ARPEGGIATION,
  effectiveManualSnapshotArticulation,
  manualArpeggiationDecayDisplay,
  manualArpeggiationDecayFromSlider,
  manualArpeggiationDecaySliderValue,
  normalizeManualArpeggiation,
  normalizeManualSnapshotTrigger,
  SUSTAIN_MANUAL_ARPEGGIATION_DECAY_SLIDER_VALUE,
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
      decayMode: "timed",
      decayMs: 10000,
      decayVariation: 0,
    });
    expect(normalizeManualArpeggiation({ decayMs: 0 })).toMatchObject({
      decayMode: "sustain",
      decayMs: 100,
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

  it("maps immediate, timed, and sustain decay values to the slider boundary", () => {
    expect(manualArpeggiationDecaySliderValue({ decayMode: "immediate" })).toBe(0);
    expect(manualArpeggiationDecaySliderValue({ decayMode: "timed", decayMs: 700 })).toBe(700);
    expect(manualArpeggiationDecaySliderValue({ decayMode: "sustain" })).toBe(
      SUSTAIN_MANUAL_ARPEGGIATION_DECAY_SLIDER_VALUE,
    );
    expect(manualArpeggiationDecayFromSlider(0)).toEqual({ decayMode: "immediate" });
    expect(manualArpeggiationDecayFromSlider(700)).toEqual({
      decayMode: "timed",
      decayMs: 700,
    });
    expect(
      manualArpeggiationDecayFromSlider(SUSTAIN_MANUAL_ARPEGGIATION_DECAY_SLIDER_VALUE),
    ).toEqual({ decayMode: "sustain" });
    expect(manualArpeggiationDecayDisplay({ decayMode: "timed", decayMs: 700 })).toBe(
      "700 ms",
    );
  });
});
