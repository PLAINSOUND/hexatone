// This module owns the controller-facing consequences of live modulation.
// It is responsible for:
// - applying fixed-do geometry shifts to controller/sequential input coords
// - keeping the runtime display/camera offset aligned with the active frame
// - triggering controller LED resync when modulation changes alter hardware orientation
//
// It does not derive harmonic modulation, mutate history, or rebuild tuning.
// Callers provide a Keys-like object with the current settings, active frame,
// resize/redraw hooks, and controller LED sync hooks.

import { applyGeometryShiftToCoords } from "../tuning/modulation-geometry-runtime.js";

export function modulatedControllerCoords(keys, coords, frame = null) {
  if (!coords) return coords;
  if (keys.settings.modulation_style !== "fixed_do") return coords;
  return applyGeometryShiftToCoords(coords, frame ?? keys._activeFrame?.() ?? null);
}

export function refreshRuntimeDisplayOffset(keys) {
  const nextX = keys.settings.modulation_style === "fixed_do"
    ? Math.trunc(keys._activeFrame()?.geometryShiftRSteps ?? 0)
    : 0;
  const nextY = keys.settings.modulation_style === "fixed_do"
    ? Math.trunc(keys._activeFrame()?.geometryShiftDrSteps ?? 0)
    : 0;
  if (
    keys.settings.runtime_display_offset_x === nextX &&
    keys.settings.runtime_display_offset_y === nextY
  ) {
    return;
  }
  keys.settings.runtime_display_offset_x = nextX;
  keys.settings.runtime_display_offset_y = nextY;
  keys._lastResizeSignature = null;
  keys.resizeHandler();
}

export function syncControllerColorsForModulation(keys) {
  keys._syncControllerAutoColors();
}
