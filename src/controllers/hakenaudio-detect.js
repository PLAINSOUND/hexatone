/**
 * controllers/hakenaudio-detect.js
 *
 * Lightweight device-name detection shared between the controller registry and
 * the optional Haken controller helpers. Keeping it separate lets the registry
 * identify devices without forcing the full Haken helper module into main.
 */

const HAKEN_DEVICE_PATTERNS = [
  "continuum",
  "haken",
  "eaganmatrix",
  "um-one",
  "um one",
];

export function detectHakenDeviceName(name = "") {
  const lower = name.toLowerCase();
  return HAKEN_DEVICE_PATTERNS.some((pattern) => lower.includes(pattern));
}
