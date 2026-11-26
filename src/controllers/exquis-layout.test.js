import { expect, it } from "vitest";
import { effectiveExquisLayout, exquisLayoutStep } from "./exquis-layout.js";
import { settingsImpactKey } from "../settings/settings-impact-registry.js";
it("overrides only the active Exquis geometry and restores saved steps without mutating tuning", () => {
  const settings = { rSteps: 9, drSteps: 4, exquis_layout_override: true, exquis_rSteps: 3, exquis_drSteps: -2 };
  expect(effectiveExquisLayout(settings, "exquis")).toEqual({ rSteps: 3, drSteps: -2 });
  expect(settings.rSteps).toBe(9);
  expect(effectiveExquisLayout({ ...settings, exquis_layout_override: false }, "exquis"))
    .toEqual({ rSteps: 9, drSteps: 4 });
  expect(effectiveExquisLayout(settings, "lumatone")).toEqual({ rSteps: 9, drSteps: 4 });
  expect(effectiveExquisLayout({ ...settings, rSteps: 7, drSteps: 5, exquis_layout_override: false }, "exquis"))
    .toEqual({ rSteps: 7, drSteps: 5 });
});
it("defaults unspecified steps to 5 and 6 and validates signed integer edits", () => {
  expect(effectiveExquisLayout({ rSteps: 2, drSteps: 1, exquis_layout_override: true }, "exquis"))
    .toEqual({ rSteps: 5, drSteps: 6 });
  for (const invalid of [null, "", "3x", 1.2, Infinity, 1221]) expect(exquisLayoutStep(invalid, 7)).toBe(7);
  expect(exquisLayoutStep(0, 7)).toBe(0);
  expect(exquisLayoutStep(-1220, 7)).toBe(-1220);
});
it("changes reconstruction only when effective geometry changes", () => {
  const settings = { rSteps: 2, drSteps: 1, exquis_layout_override: false, exquis_rSteps: 9, exquis_drSteps: 4 };
  const key = (s, id) => settingsImpactKey({ ...s, ...effectiveExquisLayout(s, id) }, "keysReconstruction");
  expect(key(settings, "exquis")).toBe(key({ ...settings, exquis_rSteps: 10 }, "exquis"));
  const on = { ...settings, exquis_layout_override: true };
  expect(key(on, "exquis")).not.toBe(key(settings, "exquis"));
  expect(key(on, "lumatone")).toBe(key(settings, "exquis"));
});


it("uses preset Exquis steps only for Exquis, with the manual override taking precedence", () => {
  const tuning = { rSteps: 9, drSteps: 4, exquis_rsteps: 7, exquis_drsteps: 3,
    exquis_rSteps: 5, exquis_drSteps: 6, exquis_anchor_note: 27 };
  expect(effectiveExquisLayout(tuning, "exquis")).toEqual({ rSteps: 7, drSteps: 3 });
  expect(effectiveExquisLayout(tuning, "lumatone")).toEqual({ rSteps: 9, drSteps: 4 });
  expect(effectiveExquisLayout({ ...tuning, exquis_layout_override: true }, "exquis"))
    .toEqual({ rSteps: 5, drSteps: 6 });
  expect(effectiveExquisLayout({ ...tuning, exquis_drsteps: undefined }, "exquis"))
    .toEqual({ rSteps: 7, drSteps: 4 });
  expect(tuning).toMatchObject({ rSteps: 9, drSteps: 4, exquis_rsteps: 7, exquis_drsteps: 3 });
});
