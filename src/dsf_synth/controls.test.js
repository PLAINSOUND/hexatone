import { expect, it } from "vitest";
import { DSF_DEFAULTS, dsfControlsFromSettings, normalizeDsfControls } from "./controls.js";
import { REGISTRY_BY_KEY } from "../persistence/settings-registry.js";
it("uses the requested DSF preset consistently in the engine and saved settings", () => {
  expect(DSF_DEFAULTS).toEqual({ volume: 0.25, partials: 1024, timbre: 0.25,
    volumeEnvelope: true, timbreEnvelope: true,
    timbreAmount: 0, timbreAttack: 10, timbreDecay: 100, timbreSustain: 0, timbreRelease: 120,
    attack: 10, decay: 0, sustain: 1, release: 120, velocity: true, releaseVelocity: true, pressure: true, timbreResponse: true, iso226: 1, generateYZ: false });
  expect(normalizeDsfControls()).toEqual(DSF_DEFAULTS);
  expect(dsfControlsFromSettings()).toEqual(DSF_DEFAULTS);
  expect(REGISTRY_BY_KEY.output_dsf.default).toBe(true);
  for (const [key, value] of Object.entries(DSF_DEFAULTS))
    expect(REGISTRY_BY_KEY[`dsf_${key}`].default).toBe(value);
});
it("preserves saved zero times and disabled response options", () => {
  expect(dsfControlsFromSettings({ dsf_attack: 0, dsf_release: 0, dsf_velocity: false,
    dsf_pressure: false, dsf_timbreResponse: false, dsf_iso226: false })).toMatchObject({
    attack: 0, release: 0, velocity: false, pressure: false, timbreResponse: false, iso226: 0,
  });
});
it("bounds ADSR values and preserves a saved zero sustain", () => {
  expect(normalizeDsfControls({ decay: 5000, sustain: -1 })).toMatchObject({ decay: 4000, sustain: 0 });
  expect(normalizeDsfControls({ decay: -1, sustain: 3 })).toMatchObject({ decay: 0, sustain: 2 });
  expect(dsfControlsFromSettings({ dsf_decay: 15, dsf_sustain: 0 })).toMatchObject({ decay: 15, sustain: 0 });
});
it("accepts ISO amounts and the previous checkbox values", () => {
  for (const [value, expected] of [[true, 1], [false, 0], ["true", 1], ["false", 0], [.35, .35], [-1, 0], [2, 1]])
    expect(normalizeDsfControls({ iso226: value }).iso226).toBe(expected);
});
it("bounds and restores the independent timbre ADSR", () => {
  expect(normalizeDsfControls({ timbreAmount: -2, timbreAttack: -1, timbreDecay: 5000,
    timbreSustain: 3, timbreRelease: -1 })).toMatchObject({ timbreAmount: -1, timbreAttack: 0,
    timbreDecay: 4000, timbreSustain: 2, timbreRelease: 0 });
  expect(dsfControlsFromSettings({ dsf_timbreAmount: -.4, dsf_timbreAttack: 0,
    dsf_timbreSustain: 0 })).toMatchObject({ timbreAmount: -.4, timbreAttack: 0, timbreSustain: 0 });
});
it.each([[false, false, false], [true, false, false], [false, true, false], [true, true, true]])(
  "requires velocity %s and pressure %s for Generate YZ", (velocity, pressure, enabled) => {
    expect(normalizeDsfControls({ generateYZ: true, velocity, pressure }).generateYZ).toBe(enabled);
  },
);
