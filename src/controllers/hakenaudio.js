/**
 * hakenaudio.js
 *
 * First-pass controller metadata for Haken Audio Continuum devices.
 *
 * This module currently owns only device identification and conservative
 * runtime defaults. It does not yet define a 2D/3D controller geometry map
 * or LED protocol, but it now includes the small NRPN helper needed to send
 * Continuum MPE+ smoothing controls.
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

export function sendHakenNrpn(output, channel1, nrpn, value) {
  if (!output) return;
  const channel = Math.max(1, Math.min(16, Number(channel1) || 1));
  const data = Math.max(0, Math.min(127, Number(value) || 0));
  output.sendControlChange(99, 0, { channels: channel });
  output.sendControlChange(98, nrpn & 0x7f, { channels: channel });
  output.sendControlChange(6, data, { channels: channel });
  output.sendControlChange(99, 127, { channels: channel });
  output.sendControlChange(98, 127, { channels: channel });
}
