/**
 * linnstrument-config.js
 *
 * NRPN configuration and LED colour sync for the LinnStrument in
 * User Firmware Mode (NRPN 245 = 1).
 *
 * ── What this module does ─────────────────────────────────────────────────────
 *
 * configureLinnStrument(output)
 *   One-shot NRPN burst to set geometry and layout for UF mode:
 *     • Row offset = No Overlap  (NRPN 227 = 0)
 *     • Octave −2, Transpose −6  (NRPNs 36, 37)
 *     • Switch 1 = Sustain, Switch 2 = CC65
 *   X/Y/Z streams are NOT configured here — in UF mode they are enabled
 *   per-row via CC 10/11/12 (see enableLinnstrumentXData/YZData).
 *   NRPN 245 is NOT sent here — the app-level User Firmware lifecycle owns it.
 *
 * ── NRPN configuration table ─────────────────────────────────────────────────
 *
 *   NRPN 227 = 0   Row offset = No Overlap
 *   NRPN 36  = 3   Octave = −2   (0=−5 … 5=0 … 10=+5)
 *   NRPN 37  = 1   Transpose pitch = −6 st  (0=−7, 1=−6 … 7=0 … 14=+7)
 *   NRPN 228 = 2   Switch 1 = Sustain
 *   NRPN 229 = 3   Switch 2 = CC65
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
 * Send geometry NRPNs to configure the LinnStrument for User Firmware Mode.
 * Call once after the app-level lifecycle has sent NRPN 245=1.
 * X/Y/Z streams are enabled separately via enableLinnstrumentYZData/XData.
 *
 * @param {MIDIOutput} output  Raw Web MIDI output port.
 */
export function configureLinnStrument(output) {
  if (!output) return;

  // NRPN 245 (User Firmware Mode) is NOT sent here.
  sendNrpn(output, 227, 0);  // Row offset = No Overlap
  sendNrpn(output, 36,  3);  // Octave = −2
  sendNrpn(output, 37,  1);  // Transpose = −6 semitones
  sendNrpn(output, 228, 2);  // Switch 1 = Sustain
  sendNrpn(output, 229, 3);  // Switch 2 = CC65

}

/**
 * Restore LinnStrument factory defaults for the settings Hexatone overrides.
 * Call when the user deselects the LinnStrument or disables MIDI input,
 * so the device returns to stand-alone playable mode.
 *
 * Restores:
 *   NRPN 245 = 0 
 *
 * @param {MIDIOutput} output  Raw Web MIDI output port.
 */
export function unconfigureLinnStrument(output) {
  if (!output) return;

  sendNrpn(output, 245, 0);  // Turn off User Firmware mode
}

/**
 * Enable 3D touch data streams for all 8 rows in User Firmware Mode.
 *
 * Must be called AFTER NRPN 245=1 (User Firmware Mode active).
 * Each time User Firmware Mode activates it starts from a clean slate —
 * data streams default to off and must be re-enabled every time.
 *
 * Y data  (CC 11, per row ch 1-8): per-cell vertical position, CC 64-89.
 * Z data  (CC 12, per row ch 1-8): per-cell pressure, Polyphonic Aftertouch.
 * X data is left OFF by default — X requires a separate call to
 * enableLinnstrumentXData() and significantly increases MIDI bandwidth.
 *
 * @param {MIDIOutput} output
 */
export function enableLinnstrumentYZData(output) {
  if (!output) return;
  for (let row = 1; row <= 8; row++) {
    const status = 0xb0 | (row - 1); // CC status byte for channel `row`
    output.send([status, 11, 1]);    // CC 11 = enable Y data for this row
    output.send([status, 12, 1]);    // CC 12 = enable Z data for this row
  }
}

export function enableLinnstrumentRowSlide(output) {
  if (!output) return;
  for (let row = 1; row <= 8; row++) {
    const status = 0xb0 | (row - 1);
    output.send([status, 9, 1]);     // CC 9 = enable X-axis row slide mode
  }
}

/**
 * Enable X (slide) data for all 8 rows in User Firmware Mode.
 * This significantly increases MIDI bandwidth (14-bit per cell per frame).
 * Call only when pitch-slide expression is needed.
 *
 * @param {MIDIOutput} output
 */
export function enableLinnstrumentXData(output) {
  if (!output) return;
  for (let row = 1; row <= 8; row++) {
    const status = 0xb0 | (row - 1);
    output.send([status, 10, 1]);    // CC 10 = enable X data for this row
  }
}

// ── LED colour sync ────────────────────────────────────────────────────────────

/**
 * LinnStrument palette entries indexed by CC22 value.
 * Value 7 = Off, values 1–6 and 8–11 are the available colours.
 * The current fallback mapper uses exact screen-hex overrides first, then
 * perceptual nearest-neighbour matching in okLab space.
 */
const LINNS_OFF   = 7;   // unlit

// Minimal perceptual lightness gate (okLab L in 0–1 scale).
const DARK_THRESHOLD  = 0.4; // below → Off

/**
 * Manual screen-hex → LinnStrument CC22 palette value mappings.
 * Mirrors the structure of color-transfer.js COLOR_PAIRS but targets
 * the 11-value LinnStrument palette instead of Lumatone RGB.
 *
 * Format: [screenHex (no '#', lowercase), CC22 palette value]
 * CC22 palette values (LinnStrument LED colours):
 *   0  As set in Note Lights settings (device default)
 *   1  Red
 *   2  Yellow
 *   3  Green
 *   4  Cyan
 *   5  Blue
 *   6  Magenta
 *   7  Off  (unlit)
 *   8  White
 *   9  Orange
 *   10 Lime
 *   11 Pink
 *
 * First match wins for exact lookup; duplicates (same screen hex in
 * different harmonic contexts) are listed for completeness but only
 * the first entry is used.
 */
export const LINNS_COLOR_PAIRS = [
  // ── Neutral / universal ───────────────────────────────────────────────────
  ["ffffff", 8],   // pure white
  ["ededed", 8],   // higher primes (near-white grey)
  ["cfcfcf", 7],   // neutral grey → Off
  ["adadad", 7],   // mid grey → Off

  // ── 12-edo ────────────────────────────────────────────────────────────────
  ["ededf7", 8],   // white keys (blue-tinted white)
  ["c3c3d5", 7],   // black keys (blue-tinted grey)
  ["ffdfdb", 11],  // C accent (warm pink) → Pink

  // ── 12-tone meantone ──────────────────────────────────────────────────────
  ["f9f7eb", 8],   // white keys (warm white)
  ["eee9d3", 2],   // sharps (warm cream) → Yellow
  ["e2dfcf", 10],   // flats (darker cream) → Lime
  ["eff4e7", 3],  // diesis up (green-tinted) → Green
  ["dddae2", 9],   // diesis down (blue-tinted) → Orange

  // ── Pythagorean ───────────────────────────────────────────────────────────
  ["d0d0d7", 7],   // black (near-achromatic) → Off

  // ── 5-limit / Yellow group ────────────────────────────────────────────────
  ["fffae5", 2],   // 5° 15° 45° 135° (warm bright yellow) → Yellow
  ["fef5be", 2],   // 25° 75° 225° (deeper yellow) → Yellow
  ["ffef8a", 9],   // 125° (saturated amber) → Orange
  ["fceec5", 8],   // 53-Tertial naturals (white) → Yellow
  ["ffe070", 9],   // 53-Tertial vv Bb (amber-orange) → Orange
  ["fafa82", 2],   // ivory (yellow-green) → Yellow
  ["fbf6e0", 2],   // 55-Luma ivory → Yellow
  ["dee2da", 10],  // u5 / u15 (green-grey) → Lime
  ["d3dab9", 3],  // 23° 69° (yellow-green grey) → Green

  // ── 7-limit / Red-Pink group ─────────────────────────────────────────────
  ["ffe5e5", 11],  // 7° 21° 63° 189° (pale pink) → Pink
  ["ffcba8", 9],   // 35° 105° 315° (peach-orange) → Orange
  ["ffd270", 9],   // 175° (amber) → Orange
  ["f8c9c9", 6],   // 49° 147° (rose) → Magenta
  ["ffa8a8", 6],   // 245° (coral red) → Magenta
  ["e2caca", 6],   // u7 (dusty rose) → Magenta
  ["ece6df", 9],   // 7°u5 (warm beige) → Orange
  ["ecc9a2", 9],   // 5°u7 (warm tan) → Orange
  ["d0d6e1", 11],   // u7 sharps (blue-grey) → Pink
  ["ffb8da", 6],   // 47° 141° (bright pink) → Magenta
  ["f79cc5", 6],   // 235° (hot pink) → Magenta

  // ── 11-limit / Green group ────────────────────────────────────────────────
  ["dfffd6", 3],   // 11° 33° 99° (bright green) → Green
  ["ddfe95", 10],  // 55° 165° (yellow-green) → Lime
  ["e9ecc1", 10],  // 77° 231° (olive lime) → Lime
  ["c3ffad", 3],   // 121° (bright green) → Green
  ["cee3e2", 4],   // u11 (cyan-grey) → Cyan
  ["bae5f7", 4],   // 7°u11 (sky blue) → Cyan
  ["e4fbe6", 3],   // 11°u7 (pale green) → Green
  ["e1d0e1", 10],   // 5°u11 (mauve) → Lime
  ["e2eecd", 10],  // 11°u5 (yellow-green) → Lime
  ["f5ffe0", 10],  // 55-Luma yellow-green → Lime
  ["ddfde3", 3],   // 55-Luma blue-green → Green

  // ── 13-limit / Purple group ───────────────────────────────────────────────
  ["e6d7fe", 5],   // 13° 39° 117° (pale violet) → Blue
  ["e9d7d3", 6],   // 65° 195° (rosy beige) → Cyan
  ["ebd0e0", 4],   // 91° (mauve-pink) → Magenta
  ["90f9cd", 4],   // 143° (mint) → Cyan
  ["dbb3ff", 5],   // 169° (pale purple) → Blue
  ["cba9fe", 5],   // u13 (lavender) → Blue
  ["e4f6fb", 4],   // 5°u13 (pale cyan) → Cyan
  ["e4fbf1", 3],   // 13°u5 (pale green) → Green
  ["e5adff", 5],   // 59° (violet) → Blue

  // ── 17-limit / Grey-brown group ───────────────────────────────────────────
  ["eceae4", 7],   // 85° 255° (warm grey) → Off
  ["ded4d5", 7],   // 119° (pinkish grey) → Off
  ["ccdbce", 7],   // 187° (green-grey) → off
  ["c3b4d5", 7],   // 221° (grey-violet) → Off
  ["bab4c0", 7],   // (grey-violet) → Off
  ["b5a5ca", 7],   // (grey-violet) → Off
  ["ada5c0", 7],   // (grey-violet) → Off

  // ── 19-limit / Pale blue group ────────────────────────────────────────────
  ["d6f7ff", 4],   // 19° 57° 171° (pale sky) → Cyan
  ["d8f7fd", 4],   // 55-Luma blue → Cyan
  ["bedce4", 4],   // u19 / pale silver-blue → Cyan
  ["e5fff9", 4],   // 95° (pale cyan-green) → Cyan
  ["f4e6f2", 4],   // 133° (pale mauve) → Cyan
  ["caf7e3", 4],   // 209° (pale mint) → Cyan
  ["dbe6ff", 4],   // 247° (pale blue) → Cyan

  // ── 23-limit / Dark green group ───────────────────────────────────────────
  ["95c69b", 3],   // 23° brighter (mid green) → Green
  ["90d597", 3],   // 115° (mid green) → Green
  ["91b195", 3],   // 161° (dark green) → Green
  ["69ec79", 3],   // 253° (bright green) → Green

  // ── 29-limit / Dark blue group ────────────────────────────────────────────
  ["b6ecd0", 5],   // 29° 87° (pale green) → Blue
  ["8aafff", 5],   // 29° brighter (periwinkle) → Blue
  ["b4cbfe", 5],   // 145° (pale blue) → Blue
  ["b0a9fe", 5],   // 203° (lavender-blue) → Blue

  // ── 31-limit / Turquoise group ────────────────────────────────────────────
  ["d1c2c2", 4],   // 31° (pale rose-grey) → Cyan
  ["68f3ec", 4],   // 31° brighter (turquoise) → Cyan
  ["0afff3", 4],   // 155° (bright cyan) → Cyan
  ["0fd2c8", 4],   // 217° (teal) → Cyan
];

// Fast exact-match lookup: normalised hex (no '#', lowercase) → palette value.
const _LINNS_EXACT = new Map(
  LINNS_COLOR_PAIRS.map(([hex, val]) => [hex.toLowerCase(), val])
);

// Nearest-neighbour fallback table in okLab space. All manual colour pairs
// contribute, so known palette nuances still shape the fallback result.
const _LINNS_OKLAB_SAMPLES = LINNS_COLOR_PAIRS.map(([hex, value]) => ({
  value,
  lab: hexToOklab(`#${hex}`),
}));

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

function srgb_to_linear(x) {
  return x > 0.04045 ? ((x + 0.055) / 1.055) ** 2.4 : x / 12.92;
}

function linear_srgb_to_oklab(r, g, b) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

function hexToOklab(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return rgbToOklab(rgb.r, rgb.g, rgb.b);
}

function rgbToOklab(r, g, b) {
  return linear_srgb_to_oklab(
    srgb_to_linear(r),
    srgb_to_linear(g),
    srgb_to_linear(b),
  );
}

/** Palette value for Red. */
export const LINNS_RED = 1;

/** Palette value for Off — unmapped / dark cells. */
export { LINNS_OFF };

/**
 * Map a CSS hex color to the nearest LinnStrument CC22 palette value.
 * Exact known hexes win first; unknown colors fall back to nearest manual
 * sample in perceptual okLab space. A minimal okLab lightness gate still
 * turns genuinely dark colors off.
 */
export function hexToLinnsPaletteValue(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return LINNS_OFF;
  const lab = rgbToOklab(rgb.r, rgb.g, rgb.b);
  if (lab[0] < DARK_THRESHOLD) return LINNS_OFF;

  let best = _LINNS_OKLAB_SAMPLES[0];
  let bestDist = Infinity;
  for (const entry of _LINNS_OKLAB_SAMPLES) {
    const dL = lab[0] - entry.lab[0];
    const da = lab[1] - entry.lab[1];
    const db = lab[2] - entry.lab[2];
    const dist = dL * dL + da * da + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  return best?.value ?? LINNS_OFF;
}

/**
 * Analyse the full set of scale-degree colours and return a Map from
 * reducedSteps → LinnStrument palette value. Exact screen-hex overrides win
 * first; all remaining colors fall back to the perceptual mapper above.
 *
 * @param {Map<number, string>} degreeColors  Map of reducedSteps → '#rrggbb'
 *                                            for every degree in the scale.
 * @returns {Map<number, number>}             reducedSteps → CC22 palette value
 */
export function buildLinnstrumentDegreeMap(degreeColors) {
  const result = new Map();
  for (const [degree, hex] of degreeColors) {
    const normalised = hex.replace("#", "").toLowerCase();
    const exact = _LINNS_EXACT.get(normalised);
    result.set(degree, exact !== undefined ? exact : hexToLinnsPaletteValue(hex));
  }

  return result;
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
    // Only send LED data when User Firmware Mode is active (NRPN 245 = 1).
    // Guards all send methods so colour data is never written while the device
    // is in normal firmware mode and manages its own display.
    this.userFirmwareActive = false;
  }

  /**
   * Send colours for all 128 pads from CSS hex strings.
   * @param {string[]} colors  128-element array of '#rrggbb' strings, indexed by note.
   *                           Missing entries default to black (Off).
   */
  sendColors(colors) {
    if (!this._out || !this.userFirmwareActive) return;
    for (let note = 0; note < 128; note++) {
      const pv = hexToLinnsPaletteValue(colors[note] ?? "#000000");
      this._sendCell(note, pv);
    }
  }

  /**
   * Same as sendColors but skips cells whose palette value hasn't changed.
   */
  updateColors(colors) {
    if (!this._out || !this.userFirmwareActive) return;
    for (let note = 0; note < 128; note++) {
      const pv = hexToLinnsPaletteValue(colors[note] ?? "#000000");
      if (pv !== this._last[note]) {
        this._sendCell(note, pv);
      }
    }
  }

  /**
   * Send pre-computed palette values (0–11) for all 128 pads.
   * Used by keys.js when it needs direct control over palette assignment
   * (e.g. to hard-code Red for the 1/1 tonic key).
   * @param {Uint8Array|number[]} values  128 palette values.
   */
  sendPaletteValues(values) {
    if (!this._out || !this.userFirmwareActive) return;
    for (let note = 0; note < 128; note++) {
      this._sendCell(note, values[note] ?? LINNS_OFF);
    }
  }

  /**
   * Same as sendPaletteValues but skips unchanged cells.
   */
  updatePaletteValues(values) {
    if (!this._out || !this.userFirmwareActive) return;
    for (let note = 0; note < 128; note++) {
      const pv = values[note] ?? LINNS_OFF;
      if (pv !== this._last[note]) {
        this._sendCell(note, pv);
      }
    }
  }

  /** Turn off all 128 pads (Off = 7). */
  clearColors() {
    if (!this._out || !this.userFirmwareActive) return;
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
    const row = Math.floor(note / 16);      // UF row 0 = bottom, matching ch=1
    // CC20 = col (0-indexed), CC21 = row (0-indexed), CC22 = colour value.
    // All sent on channel 1 (status 0xB0).
    this._out.send([0xb0, 20, col + 1]);   // 1-indexed despite docs saying 0
    this._out.send([0xb0, 21, row]);
    this._out.send([0xb0, 22, paletteValue]);
    this._last[note] = paletteValue;
  }
}
