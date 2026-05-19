/**
 * hakenaudio.js
 *
 * First-pass controller metadata for Haken Audio Continuum devices.
 *
 * This module currently owns only device identification and conservative
 * runtime defaults. It does not yet define a 2D/3D controller geometry map
 * or LED protocol, but it now includes conservative helpers for the small
 * subset of controller-side MIDI configuration Hexatone currently sends.
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
  "um-one",
  "um one",
];

export function detectHakenDeviceName(name = "") {
  const lower = name.toLowerCase();
  return HAKEN_DEVICE_PATTERNS.some((pattern) => lower.includes(pattern));
}

function sendHakenCc(output, channel1, cc, value) {
  if (!output) return;
  const channel = Math.max(1, Math.min(16, Number(channel1) || 1));
  const channel0 = channel - 1;
  const cc7 = cc & 0x7f;
  const value7 = value & 0x7f;
  if (typeof output.send === "function") {
    output.send([0xb0 + channel0, cc7, value7]);
    return;
  }
  if (typeof output.sendControlChange === "function") {
    output.sendControlChange(cc7, value7, { channels: channel });
  }
}

export function sendHakenNrpn(output, channel1, nrpn, value) {
  if (!output) return;
  const data = Math.max(0, Math.min(127, Number(value) || 0));
  sendHakenCc(output, channel1, 99, 0);
  sendHakenCc(output, channel1, 98, nrpn & 0x7f);
  sendHakenCc(output, channel1, 6, data);
  sendHakenCc(output, channel1, 99, 127);
  sendHakenCc(output, channel1, 98, 127);
}

export function sendHakenRpn(output, channel1, rpnMsb, rpnLsb, dataMsb, dataLsb = 0) {
  if (!output) return;
  sendHakenCc(output, channel1, 101, rpnMsb & 0x7f);
  sendHakenCc(output, channel1, 100, rpnLsb & 0x7f);
  sendHakenCc(output, channel1, 6, dataMsb & 0x7f);
  sendHakenCc(output, channel1, 38, dataLsb & 0x7f);
  sendHakenCc(output, channel1, 101, 127);
  sendHakenCc(output, channel1, 100, 127);
}

export function sendHakenMpeConfig(output, channel1, config = {}) {
  if (!output) return;
  const bendRange = Math.max(0, Math.min(127, Number(config.bendRange) || 96));

  sendHakenRpn(output, channel1, 0, 0, bendRange, 0);
}
