/**
 * hakenaudio.js
 *
 * First-pass controller metadata for Haken Audio Continuum devices.
 *
 * This module currently owns only device identification and conservative
 * runtime defaults. It does not yet define a 2D/3D controller geometry map,
 * LED protocol, or the Continuum-specific MPE+ / NRPN configuration layer.
 *
 * For the current implementation Hexatone treats the Continuum as:
 *   - an MPE-capable expressive input surface
 *   - selectable in Controller Geometry so users can bind controller-specific
 *     preferences and future geometry work to a stable controller id
 *   - unresolved geometrically unless/until a dedicated buildMap is added
 *
 * That means live input currently falls back to the existing generic MPE /
 * sequential address path rather than a Continuum-specific lattice map.
 */

const HAKEN_DEVICE_PATTERNS = [
  "continuum",
  "haken",
  "eaganmatrix",
];

export function detectHakenDeviceName(name = "") {
  const lower = name.toLowerCase();
  return HAKEN_DEVICE_PATTERNS.some((pattern) => lower.includes(pattern));
}

