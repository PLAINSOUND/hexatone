import { expect, it } from "vitest";
import { equalLoudnessGain, dsfLoudnessGain } from "./equal-loudness.js";
it("is unity at 1 kHz, compensates bass, and stays bounded", () => {
  expect(equalLoudnessGain(1000)).toBeCloseTo(1, 12);
  expect(equalLoudnessGain(100)).toBeGreaterThan(1);
  expect(equalLoudnessGain(3150)).toBeLessThan(1);
  for (const hz of [0, 1, 20, 40, 250, 440, 1000, 12500, 20000, NaN]) {
    const gain = equalLoudnessGain(hz);
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBeLessThanOrEqual(10 ** (12 / 20));
  }
});
it("eases 80–200 Hz by 2 dB without changing deep bass or the upper contour", () => {
  for (const hz of [20, 40, 50, 315, 440, 1000, 12500])
    expect(dsfLoudnessGain(hz)).toBe(equalLoudnessGain(hz));
  for (const hz of [80, 100, 125, 160, 200])
    expect(dsfLoudnessGain(hz) / equalLoudnessGain(hz)).toBeCloseTo(10 ** (-2 / 20), 12);
  for (const hz of [63, 250]) {
    const ratio = dsfLoudnessGain(hz) / equalLoudnessGain(hz);
    expect(ratio).toBeGreaterThan(10 ** (-2 / 20));
    expect(ratio).toBeLessThan(1);
  }
  for (const hz of [50, 80, 200, 315])
    expect(dsfLoudnessGain(hz - 0.0001)).toBeCloseTo(dsfLoudnessGain(hz + 0.0001), 4);
});
