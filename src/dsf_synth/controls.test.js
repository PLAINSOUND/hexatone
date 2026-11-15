import { expect, it } from "vitest";
import { DSF_DEFAULTS, dsfControlsFromSettings, normalizeDsfControls } from "./controls.js";
import { REGISTRY_BY_KEY } from "../persistence/settings-registry.js";
it("uses the requested DSF preset consistently in the engine and saved settings", () => {
  expect(DSF_DEFAULTS).toEqual({ volume: 0.25, partials: 1024, timbre: 0.25,
    attack: 10, release: 120, velocity: true, pressure: true, timbreResponse: true, iso226: true, generateYZ: false });
  expect(normalizeDsfControls()).toEqual(DSF_DEFAULTS);
  expect(dsfControlsFromSettings()).toEqual(DSF_DEFAULTS);
  expect(REGISTRY_BY_KEY.output_dsf.default).toBe(true);
  for (const [key, value] of Object.entries(DSF_DEFAULTS))
    expect(REGISTRY_BY_KEY[`dsf_${key}`].default).toBe(value);
});
it("preserves saved zero times and disabled response options", () => {
  expect(dsfControlsFromSettings({ dsf_attack: 0, dsf_release: 0, dsf_velocity: false,
    dsf_pressure: false, dsf_timbreResponse: false, dsf_iso226: false })).toMatchObject({
    attack: 0, release: 0, velocity: false, pressure: false, timbreResponse: false, iso226: false,
  });
});
