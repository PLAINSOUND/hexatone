/* eslint-disable no-console */
/**
 * linnstrument-config.js
 *
 * Plug-and-play NRPN configuration and LED colour sync for the
 * Roger Linn Design LinnStrument 128.
 *
 * ── What this module does ─────────────────────────────────────────────────────
 *
 * configureLinnStrument(output, mpeEnabled)
 *   Sends a one-shot NRPN burst over `output` to set:
 *     • Row offset = No Overlap  (NRPN 227 = 0)
 *     • Octave −2, Transpose −6  (NRPNs 36, 37)
 *       → MIDI note 0 lands at bottom-left pad (col 0, row 7)
 *     • Bend range = 1 semitone  (NRPN 19)
 *       → Maximum incoming pitch-bend resolution; Hexatone's own MPE
 *         output uses the separately configured mpe_pitchbend_range.
 *     • Split MIDI mode, channel assignments, X/Y/Z expression routing
 *       according to `mpeEnabled` (see tables below).
 *     • Switch 1 = Sustain, Switch 2 = CC65
 *       (TODO: Hexatone does not yet handle incoming CC65 from controllers)
 *
 * ── NRPN configuration tables ────────────────────────────────────────────────
 *
 * Invariant (both modes):
 *   NRPN 227 = 0   Row offset = No Overlap
 *   NRPN 36  = 3   Octave = −2   (0=−5 … 5=0 … 10=+5)
 *   NRPN 37  = 1   Transpose pitch = −6 st  (0=−7, 1=−6 … 7=0 … 14=+7)
 *   NRPN 19  = 1   Bend range = 1 semitone
 *   NRPN 21  = 0   Pitch Quantize = off
 *   NRPN 228 = 2   Switch 1 = Sustain
 *   NRPN 229 = 3   Switch 2 = CC65  (TODO: handle CC65 in Hexatone)
 *
 * MPE mode (Channel Per Note):
 *   NRPN 0       = 1   MIDI mode = Ch Per Note
 *   NRPN 1       = 1   Main channel = 1 (MPE manager)
 *   NRPN 2       = 0   Per-note ch 1 = off  (manager, not voice)
 *   NRPN 3–16   = 1   Per-note ch 2–15 = on
 *   NRPN 17      = 0   Per-note ch 16 = off
 *   NRPN 18      = 2   Per Row lowest ch = 2 (voice channels start at 2)
 *   NRPN 20      = 1   Send X (pitch bend) = on
 *   NRPN 24      = 1   Send Y = on
 *   NRPN 25      = 74  Y CC = CC74 (MPE Timbre)
 *   NRPN 39      = 2   Y expression = CC (as defined by NRPN 25)
 *   NRPN 27      = 1   Send Z = on
 *   NRPN 28      = 0   Z = Poly Aftertouch
 *
 * Single-channel mode (One Channel):
 *   NRPN 0       = 0   MIDI mode = One Channel
 *   NRPN 1       = 1   Main channel = 1
 *   NRPN 2–17   = 0   Per-note channels all off
 *   NRPN 20      = 1   Send X (pitch bend) = on (Smart MIDI handles mono/poly)
 *   NRPN 24      = 1   Send Y = on
 *   NRPN 25      = 1   Y CC = CC1 (Mod Wheel)
 *   NRPN 39      = 2   Y expression = CC
 *   NRPN 27      = 1   Send Z = on
 *   NRPN 28      = 0   Z = Poly Aftertouch (per-voice pressure on ch 1)
 *
 * ── LED colour sync ───────────────────────────────────────────────────────────
 *
 * LinnStrumentLEDs uses CC 20/21/22 on channel 1 to paint individual pads.
 * Only 11 palette colours are available (see LINNS_PALETTE below).
 * sendColors(hexArray128) maps each of the 128 CSS hex colors to the nearest
 * palette entry by hue, with black/dark colours mapped to Off (7).
 *
 * No sysex, no ACK, no heartbeat — fire and forget.
 * Only changed cells are re-sent on updateColors().
 */

// ── NRPN helpers ──────────────────────────────────────────────────────────────

/**
 * Send one NRPN parameter/value pair.
 * LinnStrument expects exactly 6 CC messages: param MSB, param LSB,
 * value MSB, value LSB, RPN reset MSB, RPN reset LSB.
 * Sent on channel 1 (status byte 0xB0).
 */
function sendNrpn(output, param, value) {
  const ch = 0xb0; // channel 1
  output.send([ch, 99, (param >> 7) & 0x7f]);
  output.send([ch, 98, param & 0x7f]);
  output.send([ch, 6,  (value >> 7) & 0x7f]);
  output.send([ch, 38, value & 0x7f]);
  output.send([ch, 101, 127]);
  output.send([ch, 100, 127]);
}

/**
 * Send all NRPN parameters to configure the LinnStrument 128 for use with
 * Hexatone.  Call once on device connect and again whenever mpeEnabled toggles.
 *
 * @param {MIDIOutput} output      Raw Web MIDI output port.
 * @param {boolean}    mpeEnabled  true = Channel Per Note, false = One Channel.
 */
export function configureLinnStrument(output, mpeEnabled) {
  if (!output) return;

  // ── Invariant settings ────────────────────────────────────────────────────
  sendNrpn(output, 227, 0);  // Row offset = No Overlap
  sendNrpn(output, 36,  3);  // Octave = −2
  sendNrpn(output, 37,  1);  // Transpose = −6 semitones
  sendNrpn(output, 19,  1);  // Bend range = 1 semitones
  sendNrpn(output, 21,  1);  // Pitch Quantize = on
  sendNrpn(output, 22,  1);  // Pitch Quantize Hold = medium
  sendNrpn(output, 228, 2);  // Switch 1 = Sustain
  sendNrpn(output, 229, 3);  // Switch 2 = CC65 (TODO: handle CC65 in Hexatone)

  // ── Mode-dependent settings ───────────────────────────────────────────────
  if (mpeEnabled) {
    sendNrpn(output, 0,  1);  // MIDI mode = Ch Per Note
    sendNrpn(output, 1,  1);  // Main channel = 1 (MPE manager)
    sendNrpn(output, 2,  0);  // Per-note ch 1 = off (manager)
    for (let ch = 2; ch <= 15; ch++) {
      sendNrpn(output, ch + 1, 1); // Per-note ch 2–15 = on  (NRPNs 3–16)
    }
    sendNrpn(output, 17, 0);  // Per-note ch 16 = off
    sendNrpn(output, 18, 2);  // Per Row lowest ch = 2
    sendNrpn(output, 20, 1);  // Send X = on
    sendNrpn(output, 24, 1);  // Send Y = on
    sendNrpn(output, 25, 74); // Y CC = CC74 (MPE Timbre)
    sendNrpn(output, 39, 2);  // Y expression = CC
    sendNrpn(output, 27, 1);  // Send Z = on
    sendNrpn(output, 28, 0);  // Z = Poly Aftertouch
  } else {
    sendNrpn(output, 0,  0);  // MIDI mode = One Channel
    sendNrpn(output, 1,  1);  // Main channel = 1
    for (let ch = 1; ch <= 16; ch++) {
      sendNrpn(output, ch + 1, 0); // Per-note ch 1–16 = off (NRPNs 2–17)
    }
    sendNrpn(output, 20, 1);  // Send X = on (Smart MIDI pitch bend)
    sendNrpn(output, 24, 1);  // Send Y = on
    sendNrpn(output, 25, 1);  // Y CC = CC1 (Mod Wheel)
    sendNrpn(output, 39, 2);  // Y expression = CC
    sendNrpn(output, 27, 1);  // Send Z = on
    sendNrpn(output, 28, 0);  // Z = Poly Aftertouch
  }

  console.log(`[LinnStrument] Configured: ${mpeEnabled ? "MPE (Ch Per Note)" : "single-channel"}`);
}

// ── LED colour sync ────────────────────────────────────────────────────────────

/**
 * LinnStrument palette entries indexed by CC22 value.
 * Value 7 = Off, values 1–6 and 8–11 are the available colours.
 * Represented as [H, S] in HSL degrees/percent for nearest-hue matching.
 * White (8) and Off (7) are handled by lightness thresholds separately.
 */
const LINNS_PALETTE = [
  { value: 1,  label: "Red",     h: 0   },
  { value: 9,  label: "Orange",  h: 30  },
  { value: 2,  label: "Yellow",  h: 60  },
  { value: 10, label: "Lime",    h: 90  },
  { value: 3,  label: "Green",   h: 120 },
  { value: 4,  label: "Cyan",    h: 180 },
  { value: 5,  label: "Blue",    h: 240 },
  { value: 6,  label: "Magenta", h: 300 },
  { value: 11, label: "Pink",    h: 330 },
];

const LINNS_OFF   = 7;  // unlit
const LINNS_WHITE = 8;  // white / near-white

// Lightness thresholds (0–1 scale):
const DARK_THRESHOLD  = 0.18; // below → Off
const WHITE_THRESHOLD = 0.80; // above (with low saturation) → White

/**
 * Parse a '#rrggbb' hex string to { r, g, b } in 0–1 range.
 * Returns null for missing / invalid input.
 */
function parseHex(hex) {
  if (!hex || hex.length < 7) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return { r, g, b };
}

/**
 * Convert linear RGB to HSL.
 * Returns { h: 0–360, s: 0–1, l: 0–1 }.
 */
function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else                h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/**
 * Map a CSS hex color to the nearest LinnStrument CC22 palette value.
 * Dark colors → Off (7).  Near-white low-saturation → White (8).
 * All others → nearest hue bucket from LINNS_PALETTE.
 */
export function hexToLinnsPaletteValue(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return LINNS_OFF;
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  if (l < DARK_THRESHOLD) return LINNS_OFF;
  if (l > WHITE_THRESHOLD && s < 0.3) return LINNS_WHITE;

  // Find nearest hue in palette, accounting for circular wrap at 360°.
  let best = LINNS_PALETTE[0];
  let bestDist = Infinity;
  for (const entry of LINNS_PALETTE) {
    const diff = Math.abs(h - entry.h);
    const dist = Math.min(diff, 360 - diff);
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  return best.value;
}

/**
 * LED colour driver for the LinnStrument 128.
 *
 * Uses CC 20/21/22 on MIDI channel 1 to set individual pad colours.
 * Only changed cells are re-transmitted on updateColors() to minimise
 * the MIDI data burst (128 × 3 = 384 messages for a full repaint).
 */
export class LinnStrumentLEDs {
  /**
   * @param {MIDIOutput} outputPort  Raw Web MIDI output port.
   */
  constructor(outputPort) {
    this._out = outputPort;
    // Last-sent palette values per cell, indexed by note (0–127).
    // Initialised to -1 so first sendColors() always paints all cells.
    this._last = new Int8Array(128).fill(-1);
  }

  /**
   * Send colours for all 128 pads.
   * @param {string[]} colors  128-element array of '#rrggbb' strings, indexed by note.
   *                           Missing entries default to black (Off).
   */
  sendColors(colors) {
    if (!this._out) return;
    for (let note = 0; note < 128; note++) {
      const pv = hexToLinnsPaletteValue(colors[note] ?? "#000000");
      this._sendCell(note, pv);
    }
  }

  /**
   * Same as sendColors but skips cells whose palette value hasn't changed.
   * Use for incremental color updates (e.g. on scale color picker drag).
   */
  updateColors(colors) {
    if (!this._out) return;
    for (let note = 0; note < 128; note++) {
      const pv = hexToLinnsPaletteValue(colors[note] ?? "#000000");
      if (pv !== this._last[note]) {
        this._sendCell(note, pv);
      }
    }
  }

  /** Turn off all 128 pads (Off = 7). */
  clearColors() {
    if (!this._out) return;
    for (let note = 0; note < 128; note++) {
      this._sendCell(note, LINNS_OFF);
    }
  }

  /** Release the output port reference. Call on device disconnect. */
  exit() {
    this._out = null;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  _sendCell(note, paletteValue) {
    // note = row * 16 + col  (row 0 = bottom, col 0 = left)
    const col = note % 16;
    const row = Math.floor(note / 16);
    // CC20 = col (0-indexed), CC21 = row (0-indexed), CC22 = colour value.
    // All sent on channel 1 (status 0xB0).
    this._out.send([0xb0, 20, col + 1]);  // it seems this is NOT 0 indexed??? why???
    this._out.send([0xb0, 21, row]);
    this._out.send([0xb0, 22, paletteValue]);
    this._last[note] = paletteValue;
  }
}
