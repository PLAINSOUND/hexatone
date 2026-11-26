// Keep controller layout preferences separate from the tuning's saved geometry.
export const EXQUIS_LAYOUT_DEFAULTS = Object.freeze({ exquis_rSteps: 5, exquis_drSteps: 6 });
export const EXQUIS_PRESET_LAYOUT_FIELDS = ["exquis_rsteps", "exquis_drsteps"];
export const EXQUIS_LAYOUT_FIELDS = ["exquis_layout_override", "exquis_rSteps", "exquis_drSteps"];

export function exquisLayoutStep(value, fallback) {
  if (value == null || String(value).trim() === "") return fallback;
  const step = Number(value);
  return Number.isInteger(step) && Math.abs(step) <= 1220 ? step : fallback;
}

export function effectiveExquisLayout(settings, controllerId) {
  const saved = { rSteps: settings.rSteps, drSteps: settings.drSteps };
  if (controllerId !== "exquis") return saved;
  if (settings.exquis_layout_override) return {
    rSteps: exquisLayoutStep(settings.exquis_rSteps, EXQUIS_LAYOUT_DEFAULTS.exquis_rSteps),
    drSteps: exquisLayoutStep(settings.exquis_drSteps, EXQUIS_LAYOUT_DEFAULTS.exquis_drSteps),
  };
  return {
    rSteps: exquisLayoutStep(settings.exquis_rsteps, saved.rSteps),
    drSteps: exquisLayoutStep(settings.exquis_drsteps, saved.drSteps),
  };
}

// Route edits to the same source whose geometry is currently displayed.
export function exquisLayoutEditKeys(settings, controllerId) {
  const keys = { rSteps: "rSteps", drSteps: "drSteps" };
  if (controllerId !== "exquis") return keys;
  if (settings.exquis_layout_override) return { rSteps: "exquis_rSteps", drSteps: "exquis_drSteps" };
  for (const axis of ["rSteps", "drSteps"]) {
    const presetKey = `exquis_${axis.toLowerCase()}`;
    if (exquisLayoutStep(settings[presetKey], null) !== null) keys[axis] = presetKey;
  }
  return keys;
}

// Saving captures the visible layout as preset metadata, never the override switch.
export function withCurrentExquisPresetLayout(settings, controllerId) {
  if (controllerId !== "exquis") return settings;
  const { rSteps, drSteps } = effectiveExquisLayout(settings, controllerId);
  return { ...settings, exquis_rsteps: rSteps, exquis_drsteps: drSteps };
}
