// Keep controller layout preferences separate from the tuning's saved geometry.
export const EXQUIS_LAYOUT_DEFAULTS = Object.freeze({ exquis_rSteps: 7, exquis_drSteps: 4 });
export const EXQUIS_LAYOUT_FIELDS = ["exquis_layout_override", "exquis_rSteps", "exquis_drSteps"];

export function exquisLayoutStep(value, fallback) {
  if (value == null || String(value).trim() === "") return fallback;
  const step = Number(value);
  return Number.isInteger(step) && Math.abs(step) <= 1220 ? step : fallback;
}

export function effectiveExquisLayout(settings, controllerId) {
  const saved = { rSteps: settings.rSteps, drSteps: settings.drSteps };
  if (controllerId !== "exquis" || !settings.exquis_layout_override) return saved;
  return {
    rSteps: exquisLayoutStep(settings.exquis_rSteps, EXQUIS_LAYOUT_DEFAULTS.exquis_rSteps),
    drSteps: exquisLayoutStep(settings.exquis_drSteps, EXQUIS_LAYOUT_DEFAULTS.exquis_drSteps),
  };
}
