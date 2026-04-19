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
  sendNrpn(output, 19,  0);  // Bend range = 1 semitones
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
    sendNrpn(output, 20, 0);  // Send X (pitch bend) = off
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
    sendNrpn(output, 20, 0);  // Send X (pitch bend) = off
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
 * White (8), Pink (11), and Off (7) are handled by lightness thresholds
 * separately — Pink is not a hue bucket but a pastel/high-lightness tier
 * for pink-range hues (see hexToLinnsPaletteValue).
 */
const LINNS_PALETTE = [
  { value: 1,  label: "Red",     h: 0   },
  { value: 9,  label: "Orange",  h: 30  },
  { value: 2,  label: "Yellow",  h: 45  }, // boundary with Lime at ~63°
  { value: 10, label: "Lime",    h: 82  }, // boundary with Yellow at ~63°; h=64° → Lime
  { value: 3,  label: "Green",   h: 120 },
  { value: 4,  label: "Cyan",    h: 180 },
  { value: 5,  label: "Blue",    h: 240 },
  { value: 6,  label: "Magenta", h: 300 },
  // Pink (11) is intentionally absent here — it is matched by lightness,
  // not by hue, so that medium-lightness pinks map to Magenta.
];

const LINNS_OFF   = 7;   // unlit
const LINNS_WHITE = 8;   // white / near-white
const LINNS_PINK  = 11;  // pastel pink (high-lightness, pink-hue range)

// Lightness/saturation thresholds (0–1 scale):
const DARK_THRESHOLD  = 0.18; // below → Off
const WHITE_THRESHOLD = 0.92; // above this lightness → White (any hue, any saturation)
const GREY_SAT        = 0.40; // below this saturation → White (if light) or Off (if dark)
const PINK_HUE_MIN = 310;      // hue range for pastel-pink tier (wraps at 360)
const PINK_HUE_MAX = 30;       //   310°–360° and 0°–30° = red/pink/rose zone (not yellow)

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
 * Degree 0 always gets Red (hardcoded in buildLinnstrumentDegreeMap),
 * so tonic colours are not listed here.
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

/** Palette value for Red — reserved for the 1/1 (degree 0) key. */
export const LINNS_RED = 1;

/** Palette value for Off — unmapped / dark cells. */
export { LINNS_OFF };

// Palette entries available for non-tonic degrees (Red excluded).
const LINNS_PALETTE_NO_RED = LINNS_PALETTE.filter((e) => e.value !== LINNS_RED);

/**
 * Map a CSS hex color to the nearest LinnStrument CC22 palette value.
 * Dark colors → Off (7).  Near-white low-saturation → White (8).
 * All others → nearest hue bucket from LINNS_PALETTE.
 *
 * @param {string}  hex        '#rrggbb' color string.
 * @param {boolean} excludeRed When true, Red (1) is excluded from matching so
 *                             it stays reserved for the 1/1 key.
 */
export function hexToLinnsPaletteValue(hex, excludeRed = false) {
  const rgb = parseHex(hex);
  if (!rgb) return LINNS_OFF;
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  if (l < DARK_THRESHOLD) return LINNS_OFF;

  // Very high lightness → White regardless of hue/saturation (catches #ffffff etc.)
  if (l > WHITE_THRESHOLD) {
    // Exception: saturated pink-hue colours at this lightness → Pink, not White.
    const inPinkHue = h >= PINK_HUE_MIN || h <= PINK_HUE_MAX;
    if (inPinkHue && s >= GREY_SAT) return LINNS_PINK;
    return LINNS_WHITE;
  }

  // Low-saturation colours below the white threshold → Off (dark keys, grey etc.)
  if (s < GREY_SAT) return LINNS_OFF;

  // Find nearest hue in palette, accounting for circular wrap at 360°.
  // When Red is excluded, hues in the red zone (≥340° or ≤20°) default to
  // Magenta rather than Orange — perceptually red-family hues read as pink/magenta.
  const RED_ZONE_MAGENTA = 6; // Magenta palette value
  const inRedZone = h >= 340 || h <= 20;
  if (excludeRed && inRedZone) return RED_ZONE_MAGENTA;

  const palette = excludeRed ? LINNS_PALETTE_NO_RED : LINNS_PALETTE;
  let best = palette[0];
  let bestDist = Infinity;
  for (const entry of palette) {
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
 * Analyse the full set of scale-degree colours and return a Map from
 * reducedSteps → LinnStrument palette value, using a two-pass approach:
 *
 * Pass 1 — classify each degree by its HSL properties:
 *   • degree 0           → Red (reserved tonic)
 *   • high-l / low-s     → "white key" candidate
 *   • low-l / low-s      → "black key" candidate (Off)
 *   • saturated          → hue-bucket candidate
 *
 * Pass 2 — within the white-key candidates, if there are multiple
 * lightness tiers, assign the lightest tier White and darker tiers
 * their nearest hue (which for warm near-whites gives Yellow/Lime).
 * This lets presets like Meantone (three cream shades) produce
 * White / Yellow / Off rather than three Offs.
 *
 * @param {Map<number, string>} degreeColors  Map of reducedSteps → '#rrggbb'
 *                                            for every degree in the scale.
 * @returns {Map<number, number>}             reducedSteps → CC22 palette value
 */
export function buildLinnstrumentDegreeMap(degreeColors) {
  const result = new Map();

  // ── Pass 0: exact lookup from the manual colour table ──────────────────────
  // Any degree whose screen hex is in LINNS_COLOR_PAIRS gets its value directly.
  // Remaining degrees fall through to the hue-clustering passes below.
  const remaining = new Map();
  for (const [degree, hex] of degreeColors) {
    if (degree === 0) { result.set(degree, LINNS_RED); continue; }
    const normalised = hex.replace("#", "").toLowerCase();
    const exact = _LINNS_EXACT.get(normalised);
    if (exact !== undefined) {
      result.set(degree, exact);
    } else {
      remaining.set(degree, hex);
    }
  }

  // ── Pass 1: classify remaining degrees ─────────────────────────────────────
  // Low-saturation colours may be "piano-style" white/black keys (genuinely
  // achromatic) or faintly-tinted colours that still deserve hue assignment.
  // We defer the decision until we've seen all of them.
  const greyish = []; // { degree, h, s, l } — below GREY_SAT, above dark
  const hued    = []; // { degree, h, s, l } — saturated (s ≥ GREY_SAT)

  for (const [degree, hex] of remaining) {
    const rgb = parseHex(hex);
    if (!rgb) { result.set(degree, LINNS_OFF); continue; }
    const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);

    if (l < DARK_THRESHOLD) {
      result.set(degree, LINNS_OFF);
    } else if (s < GREY_SAT) {
      greyish.push({ degree, h, s, l });
    } else {
      hued.push({ degree, h, s, l });
    }
  }

  // ── Pass 2a: decide how to treat the low-saturation cluster ────────────────
  // If all greyish entries share a narrow hue band (≤60° spread), they are
  // genuinely achromatic — treat lightest tier as White, rest as Off.
  // If they span multiple hues (e.g. Partch's tinted pastel set), each gets
  // its own hue-match instead, so colours remain distinguishable on the device.
  if (greyish.length > 0) {
    // Find the circular hue spread of the group.
    const hues = greyish.map((e) => e.h);
    let maxSpread = 0;
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const diff = Math.abs(hues[i] - hues[j]);
        maxSpread = Math.max(maxSpread, Math.min(diff, 360 - diff));
      }
    }

    if (maxSpread <= 60) {
      // Genuinely achromatic cluster → White / Off by lightness tier.
      const sorted = [...greyish].sort((a, b) => b.l - a.l);
      const whiteL = sorted[0].l - 0.06;
      for (const { degree, l } of greyish) {
        result.set(degree, l >= whiteL ? LINNS_WHITE : LINNS_OFF);
      }
    } else {
      // Multi-hue tinted cluster → hue-match each entry individually.
      for (const entry of greyish) {
        hued.push(entry); // re-classify as hued for processing below
      }
    }
  }

  // ── Pass 2b: hue-match all saturated / re-classified candidates ────────────
  for (const { degree, h, l } of hued) {
    // High-lightness pink-hue saturated colours → Pink (pastel pinks like #ffe5e5).
    if (l > WHITE_THRESHOLD) {
      const inPinkHue = h >= PINK_HUE_MIN || h <= PINK_HUE_MAX;
      if (inPinkHue) { result.set(degree, LINNS_PINK); continue; }
      // Other saturated high-lightness hues fall through to hue-match below.
    }
    // Red zone (hue near 0°) → Magenta when Red is reserved for degree 0.
    const inRedZone = h >= 340 || h <= 20;
    if (inRedZone) { result.set(degree, 6 /* Magenta */); continue; }

    // Nearest hue in Red-excluded palette.
    let best = LINNS_PALETTE_NO_RED[0];
    let bestDist = Infinity;
    for (const entry of LINNS_PALETTE_NO_RED) {
      const diff = Math.abs(h - entry.h);
      const dist = Math.min(diff, 360 - diff);
      if (dist < bestDist) { bestDist = dist; best = entry; }
    }
    result.set(degree, best.value);
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
  }

  /**
   * Send colours for all 128 pads from CSS hex strings.
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

  /**
   * Send pre-computed palette values (0–11) for all 128 pads.
   * Used by keys.js when it needs direct control over palette assignment
   * (e.g. to hard-code Red for the 1/1 tonic key).
   * @param {Uint8Array|number[]} values  128 palette values.
   */
  sendPaletteValues(values) {
    if (!this._out) return;
    for (let note = 0; note < 128; note++) {
      this._sendCell(note, values[note] ?? LINNS_OFF);
    }
  }

  /**
   * Same as sendPaletteValues but skips unchanged cells.
   */
  updatePaletteValues(values) {
    if (!this._out) return;
    for (let note = 0; note < 128; note++) {
      const pv = values[note] ?? LINNS_OFF;
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
