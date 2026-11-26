import { expect, it } from "vitest";
import { normalizeDsfControls } from "./controls.js";
import { DSF_RESPONSE_PROFILE, DSF_MODULATION_ROUTES, compileDsfModulation,
  velocityCurve, gentleVelocityCurve, velocityMultiplier, relativeTimbreOffset,
  expressionYTimbre, pressureGain, pressureBite } from "./modulation.js";

it.each([0, .25, .5, 1])("preserves the musical response curves at amount %f", amount => {
  const c = compileDsfModulation(normalizeDsfControls({ velocityVolume: amount,
    velocityTimbre: amount, velocityAttack: amount, releaseVelocityRelease: amount }));
  for (let velocity = 0; velocity <= 127; velocity++) {
    const offset = (velocity - 64) / (velocity < 64 ? 64 : 63);
    const curve = offset ** 3;
    expect(velocityMultiplier(c.volume, velocityCurve(velocity)))
      .toBeCloseTo(1 + amount * curve * (curve < 0 ? .75 : 3), 14);
    const time = 1 - amount * curve * (curve < 0 ? 3 : .75);
    expect(velocityMultiplier(c.attack, velocityCurve(velocity))).toBeCloseTo(time, 14);
    expect(velocityMultiplier(c.release, velocityCurve(velocity))).toBeCloseTo(time, 14);
    expect(c.timbreDepth * gentleVelocityCurve(velocity, c.timbreLinearWeight))
      .toBeCloseTo(.25 * amount * offset * (.5 + .5 * Math.abs(offset)), 14);
  }
});

it("keeps disabled routes neutral while other sources remain active", () => {
  const c = compileDsfModulation(normalizeDsfControls({ velocityVolume: 0,
    velocityTimbre: 0, velocityAttack: 0, releaseVelocityRelease: 0,
    pressure: false, timbreResponse: false }));
  for (const velocity of [0, 64, 127]) {
    expect(velocityMultiplier(c.volume, velocityCurve(velocity))).toBe(1);
    expect(velocityMultiplier(c.attack, velocityCurve(velocity))).toBe(1);
    expect(velocityMultiplier(c.release, velocityCurve(velocity))).toBe(1);
    expect(c.timbreDepth * gentleVelocityCurve(velocity)).toBeCloseTo(0, 14);
  }
  for (const value of [0, .04, .3, .5, 1]) {
    expect(pressureGain(c, value)).toBe(1);
    expect(pressureBite(c, value)).toBe(0);
    expect(expressionYTimbre(c, value)).toBeCloseTo(0, 14);
  }
});

it("retains the current Y/Z ranges and pressure bite shoulders", () => {
  const c = compileDsfModulation(normalizeDsfControls());
  for (let i = 0; i <= 100; i++) {
    const p = i / 100;
    expect(pressureGain(c, p)).toBeCloseTo(1 + 3 * p ** 3, 14);
    expect(expressionYTimbre(c, p)).toBeCloseTo((p - .5) * (p < .5 ? .1 : .2), 14);
    const smooth = t => t * t * (3 - 2 * t);
    const bite = p <= 0 || p >= .3 ? 0 : p < .04
      ? .06 * smooth(p / .04) : .06 * (1 - smooth((p - .04) / .26));
    expect(pressureBite(c, p)).toBeCloseTo(bite, 14);
  }
});

it("keeps relative envelope offsets within the base timbre's available range", () => {
  for (const base of [0, .25, .5, 1]) {
    expect(base + relativeTimbreOffset(base, -1)).toBe(0);
    expect(base + relativeTimbreOffset(base, 0)).toBe(base);
    expect(base + relativeTimbreOffset(base, 1)).toBe(1);
  }
});

it("allows a different response profile without changing source or renderer code", () => {
  const profile = { ...DSF_RESPONSE_PROFILE, velocityVolume: { low: .5, high: 2 },
    velocityTimbre: { depth: .1, linearWeight: 1 }, velocityAttack: { low: 2, high: .5 } };
  const c = compileDsfModulation(normalizeDsfControls(), profile);
  expect(velocityMultiplier(c.volume, velocityCurve(0))).toBe(.5);
  expect(velocityMultiplier(c.volume, velocityCurve(127))).toBe(2);
  expect(velocityMultiplier(c.attack, velocityCurve(0))).toBe(2);
  expect(velocityMultiplier(c.attack, velocityCurve(127))).toBe(.5);
  expect(c.timbreDepth * gentleVelocityCurve(32, c.timbreLinearWeight)).toBe(-.05);
  expect(DSF_RESPONSE_PROFILE.velocityVolume.high).toBe(4);
});

it("identifies each route's source, destinations, operation and update timing", () => {
  for (const route of DSF_MODULATION_ROUTES) {
    expect(route.source).toBeTruthy();
    expect(route.destinations.length).toBeGreaterThan(0);
    expect(["add", "multiply"]).toContain(route.operation);
    expect(route.curve).toBeTruthy();
    expect(route.timing).toBeTruthy();
  }
  expect(DSF_MODULATION_ROUTES.find(route => route.control === "velocityAttack").destinations)
    .toEqual(["volumeAttack", "timbreAttack"]);
});
