import { expect, it } from "vitest";
import { DsfOscillator } from "./dsf-oscillator.js";

it("starts at phase zero", () => {
    const oscillator = new DsfOscillator(48000);
    oscillator.setFrequency(440);
    expect(oscillator.nextSample()).toBe(0);
});

it.each([44100, 48000, 96000])("generates a sine wave at the requested frequency", (sampleRate) => {
  const oscillator = new DsfOscillator(sampleRate);
  oscillator.setFrequency(440);

  for (let i = 0; i < 1000; i++) {
    const expected = Math.sin(2 * Math.PI * 440 * i / sampleRate);

    expect(oscillator.nextSample()).toBeCloseTo(expected, 10);
  }
});

it.each([44100, 48000, 96000])("preserves phase when frequency changes", (sampleRate) => {
  const oscillator = new DsfOscillator(sampleRate);
  oscillator.setFrequency(440);

  for (let i = 0; i < 100; i++) {
    oscillator.nextSample();
  }

  const phaseBefore = oscillator.phase;

  oscillator.setFrequency(880);

  expect(oscillator.phase).toBe(phaseBefore);
  expect(oscillator.nextSample()).toBeCloseTo(
    Math.sin(phaseBefore),
    10,
  );

  const nextPhase = phaseBefore + 2 * Math.PI * 880 / sampleRate;

  expect(oscillator.nextSample()).toBeCloseTo(
    Math.sin(nextPhase),
    10,
  );
});

it.each([44100, 48000, 96000])(
  "ignores invalid frequencies at %i Hz sample rate",
  (sampleRate) => {
    const oscillator = new DsfOscillator(sampleRate);
    oscillator.setFrequency(440);

    const originalStep = oscillator.phaseStep;

    for (const frequency of [
      0,
      -440,
      sampleRate / 2,
      sampleRate,
      NaN,
      Infinity,
      -Infinity,
      undefined,
    ]) {
      oscillator.setFrequency(frequency);

      expect(oscillator.phaseStep).toBe(originalStep);
    }
  },
);

