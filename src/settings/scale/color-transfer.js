/**
 * color-transfer.js
 *
 * Perceptually-accurate colour adjustment for the Lumatone display.
 *
 * ── Approach ─────────────────────────────────────────────────────────────────
 *
 * The Lumatone's physical key LEDs render colours differently from an sRGB
 * screen.  Rather than applying a single global curve, this module maintains a
 * DATABASE of (screen colour, lumatone colour) pairs contributed by hand — the
 * ground truth.
 *
 * For any input colour:
 *   1. EXACT MATCH — if the colour is in the database, return its known
 *      Lumatone equivalent directly.
 *
 *   2. INTERPOLATION — otherwise, convert both the query and every database
 *      pair to okLab and compute a weighted average of the correction vectors:
 *
 *        Δ(q) = Σ  w_i · (luma_i − screen_i)
 *               ─────────────────────────────
 *               Σ  w_i  +  W_fallback
 *
 *        w_i = exp( −‖q − screen_i‖² / (2σ²) )
 *
 *      where σ = 0.10 (in okLab units ≈ a clearly visible colour difference)
 *      and W_fallback smoothly damps the total correction toward zero when the
 *      query is far from all database entries (passthrough as safe fallback).
 *
 * The result is exact at each database point, smooth between them, and
 * identity-like far from all points.
 *
 * ── Database format ──────────────────────────────────────────────────────────
 *
 *   COLOR_PAIRS  is a plain array of [screenHex, lumatoneHex] pairs.
 *   Add your own entries to improve accuracy for your palette.
 *   Both hex values are 6-digit lowercase strings without '#'.
 *
 * ── Public API ───────────────────────────────────────────────────────────────
 *
 *   transferColor(hex)  → '#rrggbb'
 *     Apply the transfer to a single CSS hex colour.
 *
 *   COLOR_PAIRS
 *     The live database array — add, remove, or edit entries at runtime.
 */

// ── okLab conversion (self-contained) ────────────────────────────────────────

function srgb_to_linear(x) {
  return x > 0.04045 ? ((x + 0.055) / 1.055) ** 2.4 : x / 12.92;
}
function linear_to_srgb(x) {
  return x >= 0.0031308 ? 1.055 * x ** (1 / 2.4) - 0.055 : 12.92 * x;
}
function linear_srgb_to_oklab(r, g, b) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785  * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205  * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766  * s_,
  ];
}
function oklab_to_linear_srgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548  * b;
  return [
    +4.0767416621 * l_ ** 3 - 3.3077115913 * m_ ** 3 + 0.2309699292 * s_ ** 3,
    -1.2684380046 * l_ ** 3 + 2.6097574011 * m_ ** 3 - 0.3413193965 * s_ ** 3,
    -0.0041960863 * l_ ** 3 - 0.7034186147 * m_ ** 3 + 1.707614701  * s_ ** 3,
  ];
}

function hexToOklab(hex) {
  hex = hex.replace('#', '');
  const r = srgb_to_linear(parseInt(hex.slice(0, 2), 16) / 255);
  const g = srgb_to_linear(parseInt(hex.slice(2, 4), 16) / 255);
  const b = srgb_to_linear(parseInt(hex.slice(4, 6), 16) / 255);
  return linear_srgb_to_oklab(r, g, b);
}

function oklabToHex(L, a, b) {
  const rgb = oklab_to_linear_srgb(L, a, b);
  return '#' + rgb
    .map(x => Math.min(255, Math.max(0, Math.round(255 * linear_to_srgb(x))))
      .toString(16).padStart(2, '0'))
    .join('');
}

// ── Colour pair database ──────────────────────────────────────────────────────
//
// Format: [screenHex, lumatoneHex]
// All entries are 6-digit hex strings, lowercase, no '#'.
//
// Source: Marc's hand-crafted Hexatone → Lumatone colour equivalents.
// Add new rows as you calibrate more colours on your unit.

export const COLOR_PAIRS = [
  // ── 12-edo ────────────────────────────────────────────────────────────────
  // whites
  ['ededf7', 'e1e1f8'],
  // C accent / pinky
  ['fef6f7', 'e6b4aa'],
  // blacks — two Lumatone variants exist; the first is used for exact-match lookup.
  // The second is kept as a named entry for manual assignment in the app.
  ['c3c3d5', '507bd8'],   // black key — blue variant (default)
  // ['c3c3d5', '6378a8'], // black key — dark-blue variant (uncomment to swap)

  // ── 12-tone meantone ──────────────────────────────────────────────────────
  ['f9f7eb', 'fef4ac'],   // white
  ['e2dfcf', '59543d'],   // black flats
  ['eee9d3', '867e64'],   // black sharps
  ['eff4e7', 'b6d87f'],   // diesis up
  ['dddae2', '756f81'],   // diesis down

  // ── Pythagorean ───────────────────────────────────────────────────────────
  ['d0d0d7', '5d5d60'],   // black

  // ── Yellow / 5-limit ─────────────────────────────────────────────────────
  ['fffae5', 'fbe57c'],   // 5° 15° 45° light
  ['fef5be', 'ffe63f'],   // 25° 75° 225°
  ['ffef8a', 'cdaf06'],   // 125°
  ['dee2da', '425d3b'],   // u5 u15

  // ── Red / 7-limit ─────────────────────────────────────────────────────────
  ['ffe5e5', 'ff98aa'],   // 7° 21° 63° 189° light
  ['ffcba8', 'f88942'],   // 35° 105° 315°
  ['ffd270', 'ffae00'],   // 175°
  ['f8c9c9', 'b45f5f'],   // 49° 147°
  ['ffa8a8', 'b95a00'],   // 245°
  ['e2caca', '8e4f45'],   // u7

  // ── Green / 11-limit ──────────────────────────────────────────────────────
  ['dfffd6', '7aff4f'],   // 11° 33° 99°
  ['ddfe95', 'bbff05'],   // 55° 165°
  ['e9ecc1', '626d04'],   // 77° 231°
  ['c3ffad', '30b604'],   // 121°

  // ── Purple / 13-limit ─────────────────────────────────────────────────────
  ['e6d7fe', 'ad76ff'],   // 13° 39° 117°
  ['e9d7d3', '7a6677'],   // 65° 195°
  ['ebd0e0', '814285'],   // 91°
  ['dbb3ff', '6800ff'],   // 169°

  // ── Dark grey / 17-limit ─────────────────────────────────────────────────
  ['cfcfcf', '383838'],   // 17° 51° 153° neutral
  ['eceae4', '908958'],   // 85° 255°
  ['ded4d5', '3e2f2f'],   // 119°

  // ── Pale blue / 19-limit ─────────────────────────────────────────────────
  ['d6f7ff', '9dbfef'],   // 19° 57° 171°
  ['e5fff9', '5b8d8d'],   // 95°

  // ── 53-Tertial ────────────────────────────────────────────────────────────
  ['ffe070', 'b8880d'],   // vv Bb
  ['fceec5', 'd4b253'],   // vv naturals

  // ── Silver / grey-tinted (contextual variants) ────────────────────────────
  // These screen colours appear elsewhere in the DB with different Lumatone
  // targets — these darker variants are used in specific scale contexts.
  // The exact-match lookup returns the first occurrence; these influence
  // interpolation for nearby unseen colours via RBF weighting.
  ['dee2da', '3b5d4d'],   // green-silver (vs u5/u15 → 425d3b above)
  ['d0d0d7', '5a5f64'],   // blue-silver  (vs Pythag black → 5d5d60 above)
];

// ── Pre-computed okLab representations ───────────────────────────────────────

const _db = COLOR_PAIRS.map(([sc, lm]) => {
  const li = hexToOklab(sc);
  const lo = hexToOklab(lm);
  return {
    sc,
    lm,
    li,
    delta: [lo[0] - li[0], lo[1] - li[1], lo[2] - li[2]],
  };
});

// ── Transfer function ─────────────────────────────────────────────────────────

const SIGMA         = 0.10;   // RBF bandwidth in okLab units
const W_FALLBACK    = 0.30;   // Fallback weight — damps correction to identity
                              // when query is far from all database entries.
                              // Increase to make extrapolation more conservative.

/**
 * Apply the screen→Lumatone colour transfer to a CSS hex colour.
 *
 * - Exact database matches are returned unchanged (guaranteed by zero distance).
 * - Colours between database entries are smoothly interpolated in okLab.
 * - Colours far from all entries fall back toward identity (no change).
 *
 * @param {string} hex  CSS hex colour ('#rrggbb', '#rgb', or 'rrggbb')
 * @returns {string}    Adjusted colour as '#rrggbb'
 */
export function transferColor(hex) {
  // Normalise
  hex = hex.trim().replace(/^#/, '').toLowerCase();
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  if (!/^[0-9a-f]{6}$/.test(hex)) return '#' + hex;   // passthrough if unrecognised

  // 1. Exact lookup — if the input is already a database entry, return its pair.
  const exact = _db.find(p => p.sc === hex);
  if (exact) return '#' + exact.lm;

  // 2. RBF interpolation in okLab space.
  const q = hexToOklab(hex);
  let wSum = 0, dL = 0, da = 0, db = 0;

  for (const p of _db) {
    const dist2 = (q[0] - p.li[0]) ** 2 + (q[1] - p.li[1]) ** 2 + (q[2] - p.li[2]) ** 2;
    const w = Math.exp(-dist2 / (2 * SIGMA * SIGMA));
    wSum += w;
    dL   += w * p.delta[0];
    da   += w * p.delta[1];
    db   += w * p.delta[2];
  }

  const totalW = wSum + W_FALLBACK;
  return oklabToHex(q[0] + dL / totalW, q[1] + da / totalW, q[2] + db / totalW);
}
