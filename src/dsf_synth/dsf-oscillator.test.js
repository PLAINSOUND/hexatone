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


it("matches the finite cosine sum at the endpoints and near its singularity", async () => {
  const { cosineDsf } = await import("./dsf-oscillator.js");
  for (const balance of [0, .5, .999, 1]) for (const phase of [0, .00001, .3, 2.7]) {
    let sum = 0;
    for (let n = 1; n <= 31; n++) sum += balance ** (n - 1) * Math.cos(n * phase);
    expect(cosineDsf(phase, balance, 31)).toBeCloseTo(sum, 7);
  }
});
it("matches the compensated trapezoidal harmonic reference without DC drift", () => {
  const osc = new DsfOscillator(48000);
  osc.configure(250, .5, 8);
  const r = osc.balance, step = 2 * Math.PI * 250 / (48000 * 4);
  let mean = 0;
  for (let i = 0; i < 192 * 20; i++) {
    let expected = 0;
    for (let n = 1; n <= 8; n++) expected += r ** (n - 1) *
      Math.tan(step / 2) / Math.tan(n * step / 2) * Math.sin(n * 2 * Math.PI * 250 * i / 48000);
    const value = osc.nextSample();
    expect(value).toBeCloseTo(expected, 8);
    mean += value;
  }
  expect(mean / (192 * 20)).toBeCloseTo(0, 9);
});
it("caps partials below output Nyquist even though integration is oversampled", () => {
  const osc = new DsfOscillator(48000);
  osc.configure(1000, 1, 1024);
  expect(osc.harmonics).toBe(21);
  for (let i = 0; i < 10000; i++) expect(Number.isFinite(osc.nextSample())).toBe(true);
});
it.each([44100, 48000, 96000])("preserves the integrated waveform through cached timbre changes at %i Hz", rate => {
  const osc = new DsfOscillator(rate);
  osc.configure(55, .5, 1024);
  for (let n = 0; n < 137; n++) osc.nextSample();
  const kernel = osc.pitchKernel;
  for (const timbre of [.95, 1, .25, .8]) {
    const phase = osc.phase;
    osc.configure(55, timbre, 1024);
    expect(osc.pitchKernel).toBe(kernel);
    expect(osc.phase).toBe(phase);
    const step = 2 * Math.PI * 55 / (rate * 4), r = osc.balance;
    for (let i = 0; i < 80; i++) {
      let expected = 0;
      for (let n = 1; n <= osc.harmonics; n++) expected += r ** (n - 1) *
        Math.tan(step / 2) / Math.tan(n * step / 2) * Math.sin(n * osc.phase);
      expect(osc.nextSample()).toBeCloseTo(expected, 8);
    }
  }
});
it("shares immutable pitch coefficients between copies and replaces them on retuning", () => {
  const osc = new DsfOscillator(48000), copy = new DsfOscillator(48000);
  osc.configure(110, .8, 128);
  for (let n = 0; n < 97; n++) osc.nextSample();
  copy.copyFrom(osc);
  const kernel = copy.pitchKernel;
  for (let n = 0; n < 100; n++) expect(copy.nextSample()).toBe(osc.nextSample());
  osc.configure(220, .8, 128);
  expect(osc.pitchKernel).not.toBe(kernel);
  expect(copy.pitchKernel).toBe(kernel);
  expect(copy.frequency).toBe(110);
  const state = { ...copy };
  expect(copy.configure(110, .8, 128)).toBe(true);
  expect({ ...copy }).toEqual(state);
});
it("gently darkens the midpoint while preserving monotonic brightness and endpoints", () => {
  const osc = new DsfOscillator(48000);
  osc.configure(110, 0, 1024);
  expect(osc.balance).toBe(0);
  expect(osc.factor).toBe(1);
  osc.configure(110, .5, 1024);
  expect(osc.balance).toBeCloseTo(1 - .53 ** (2 * Math.log(.33) / Math.log(.5)), 14);
  let previous = 0;
  for (let n = 1; n <= 100; n++) {
    osc.configure(110, n / 100, 1024);
    expect(osc.balance).toBeGreaterThan(previous);
    expect(osc.balance).toBeLessThanOrEqual(1);
    if (n < 100) expect(osc.balance).toBeGreaterThan(1 - (1 - n / 100) ** 2);
    previous = osc.balance;
  }
  expect(osc.balance).toBe(1);
});
it("retains the sinusoidal end correction alongside the gentle midpoint dip", () => {
  const osc = new DsfOscillator(48000);
  const exponent = 2 * Math.log(.33) / Math.log(.5);
  osc.configure(110, .25, 1024);
  expect(osc.balance).toBeGreaterThan(1 - .75 ** exponent);
  osc.configure(110, .75, 1024);
  expect(osc.balance).toBeLessThan(1 - .25 ** exponent);
  osc.configure(110, .5, 1024);
  expect(osc.balance).toBeCloseTo(1 - .53 ** exponent, 14);
});
it("spreads few-partial brightness across the timbre range and retains both endpoints", () => {
  const osc = new DsfOscillator(48000);
  let previousMidpoint = 0;
  for (const partials of [2, 4, 8, 16]) {
    osc.configure(110, .5, partials);
    expect(osc.balance).toBeGreaterThan(previousMidpoint);
    previousMidpoint = osc.balance;
    if (partials === 2) {
      expect(osc.balance).toBeGreaterThan(.32);
      expect(osc.balance).toBeLessThan(.34);
    }
    osc.configure(110, 0, partials);
    expect(osc.balance).toBe(0);
    expect(osc.factor).toBe(1);
    osc.configure(110, 1, partials);
    expect(osc.balance).toBe(1);
  }
  osc.configure(110, .5, 64);
  expect(osc.balance).toBe(previousMidpoint);
});
it("bases timbre adaptation on sounding partials after the Nyquist cap", () => {
  const low = new DsfOscillator(48000), high = new DsfOscillator(48000);
  low.configure(110, .5, 2);
  high.configure(8000, .5, 1024);
  expect(high.harmonics).toBe(2);
  expect(high.balance).toBe(low.balance);
});
it("keeps a single partial independent of timbre", () => {
  const sine = new DsfOscillator(48000), bright = new DsfOscillator(48000);
  sine.configure(110, 0, 1);
  bright.configure(110, 1, 1);
  for (let n = 0; n < 1000; n++) expect(bright.nextSample()).toBe(sine.nextSample());
});
