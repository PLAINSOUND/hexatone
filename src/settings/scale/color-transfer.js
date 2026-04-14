/**
 * color-transfer.js
 *
 * Perceptually-accurate colour adjustment for the Lumatone display.
 *
 * ── Approach ─────────────────────────────────────────────────────────────────
 *
 * The Lumatone's physical key LEDs render colours differently from an sRGB
 * screen.  Rather than applying a single global curve, this module maintains a
 * DATABASE of (screen colour, lumatone colour) pairs — the ground truth.
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
 * ── Special tonic colours ────────────────────────────────────────────────────
 *
 * The scale 1/1 (central pitch) uses Lumatone-only colours that are not
 * derived from any screen colour at all, and are never routed through
 * transferColor().  They are exported as named constants for use in
 * lumatone-export.js:
 *
 *   LUMATONE_TONIC        '#df270e'  – the 1/1 key on the reference board
 *   LUMATONE_TONIC_OTHER  '#902e20'  – the same pitch class in other equaves
 *
 * The corresponding Hexatone screen colour '#ffebed' is kept in Hexatone only
 * and is never sent to the Lumatone.
 *
 * ── Incomplete / ambiguous entries (not included) ────────────────────────────
 *
 * The following entries from the source notes were omitted because they lack
 * a complete screen→Lumatone pair and cannot anchor the RBF interpolation:
 *
 *   u17  #c3c3e9           — screen colour only, no Lumatone value given
 *   u17  ccccdb / 7b7bb    — Lumatone value is 5 digits (likely typo; unclear intent)
 *   u19  bedce4            — screen colour only, no Lumatone value given
 *   133° / 501A33          — Lumatone value only, no screen colour given
 *
 * Correct these in the source notes and add them here once complete.
 *
 * ── Database format ──────────────────────────────────────────────────────────
 *
 *   COLOR_PAIRS  is a plain array of [screenHex, lumatoneHex] pairs.
 *   Both hex values are 6-digit lowercase strings without '#'.
 *   When a screen hex appears more than once, the FIRST entry wins for
 *   exact-match lookup; ALL entries influence RBF interpolation.
 *
 * ── Public API ───────────────────────────────────────────────────────────────
 *
 *   LUMATONE_TONIC        – Lumatone colour for the 1/1 key
 *   LUMATONE_TONIC_OTHER  – Lumatone colour for other-equave 1/1 keys
 *   COLOR_PAIRS           – the live database array
 *   transferColor(hex)    – '#rrggbb'
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
  const l_ = Math.cbrt(l),
    m_ = Math.cbrt(m),
    s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}
function oklab_to_linear_srgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  return [
    +4.0767416621 * l_ ** 3 - 3.3077115913 * m_ ** 3 + 0.2309699292 * s_ ** 3,
    -1.2684380046 * l_ ** 3 + 2.6097574011 * m_ ** 3 - 0.3413193965 * s_ ** 3,
    -0.0041960863 * l_ ** 3 - 0.7034186147 * m_ ** 3 + 1.707614701 * s_ ** 3,
  ];
}

function hexToOklab(hex) {
  hex = hex.replace("#", "");
  const r = srgb_to_linear(parseInt(hex.slice(0, 2), 16) / 255);
  const g = srgb_to_linear(parseInt(hex.slice(2, 4), 16) / 255);
  const b = srgb_to_linear(parseInt(hex.slice(4, 6), 16) / 255);
  return linear_srgb_to_oklab(r, g, b);
}

function oklabToHex(L, a, b) {
  const rgb = oklab_to_linear_srgb(L, a, b);
  return (
    "#" +
    rgb
      .map((x) =>
        Math.min(255, Math.max(0, Math.round(255 * linear_to_srgb(x))))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

// ── Special tonic colours (Lumatone-only, not screen-derived) ─────────────────

/** Lumatone colour for the scale 1/1 on its reference board. */
export const LUMATONE_TONIC = "#df270e";

/** Lumatone colour for the scale 1/1 in other equave transpositions. */
export const LUMATONE_TONIC_OTHER = "#902e20";

// ── Colour pair database ──────────────────────────────────────────────────────
//
// Format: [screenHex, lumatoneHex]
// All entries are 6-digit hex strings, lowercase, no '#'.
// First occurrence of a screen hex wins for exact-match lookup.
// All entries contribute to RBF interpolation.
//
// Where a screen colour appears in multiple harmonic contexts with different
// Lumatone targets, all variants are listed so interpolation is informed by
// the full range of that colour's usage.

export const COLOR_PAIRS = [
  // ── Neutral / universal ───────────────────────────────────────────────────
  ["ffffff", "ffffff"], // pure white
  ["fafa82", "fae989"], // ivory

  // ── 53-Tertial ────────────────────────────────────────────────────────────
  ["ffe070", "b8880d"], // vv Bb
  ["fceec5", "d4b253"], // vv naturals

  // ── 55-Luma ───────────────────────────────────────────────────────────────
  ["f5ffe0", "d9f2a2"], // yellow-green
  ["fbf6e0", "ffed9f"], // ivory
  ["d8f7fd", "ade9f3"], // blue
  ["ddfde3", "A8E6B2"], // blue-green

  ["bab4c0", "1e1928"], // ivory-blacks
  ["adadad", "1c1c1c"], // white-blacks
  ["b5a5ca", "110128"], // blue-blacks
  ["ada5c0", "160D29"], // green-blacks

  // ── 12-edo ────────────────────────────────────────────────────────────────
  ["ffdfdb", "de8e84"], // C accent pink
  ["ededf7", "e1e1f8"], // white
  ["c3c3d5", "507bd8"], // black

  // ── 12-tone meantone ──────────────────────────────────────────────────────
  ["f9f7eb", "fef4ac"], // white
  ["e2dfcf", "59543d"], // black flats
  ["eee9d3", "867e64"], // black sharps
  ["eff4e7", "b6d87f"], // diesis up
  ["dddae2", "756f81"], // diesis down

  // ── Pythagorean ───────────────────────────────────────────────────────────
  ["d0d0d7", "5d5d60"], // black (d0d0d7 also = blue-silver; first entry wins)

  // ── Yellow / 5-limit ─────────────────────────────────────────────────────
  ["fffae5", "fbe57c"], // 5° 15° 45° 135°
  ["fef5be", "ffe63f"], // 25° 75° 225°
  ["ffef8a", "cdaf06"], // 125°
  ["dee2da", "425d3b"], // u5 u15 (dee2da also = 43°; first entry wins)

  // ── Red / 7-limit ─────────────────────────────────────────────────────────
  ["ffe5e5", "ff98aa"], // 7° 21° 63° 189°
  ["ffcba8", "f88942"], // 35° 105° 315°
  ["ffd270", "d47f00"], // 175°
  ["f8c9c9", "e56568"], // 49° 147°
  ["ffa8a8", "ab502c"], // 245°
  ["e2caca", "8e4f45"], // u7
  ["d0d6e1", "3d5873"], // u7 sharps (41)
  ["ece6df", "bfa688"], // 7°u5
  ["ecc9a2", "c19563"], // 5°u7

  // ── Green / 11-limit ──────────────────────────────────────────────────────
  ["dfffd6", "7aff4f"], // 11° 33° 99°
  ["ddfe95", "bbff05"], // 55° 165°
  ["e9ecc1", "829000"], // 77° 231°
  ["c3ffad", "30b604"], // 121°
  ["cee3e2", "578d78"], // u11
  ["bae5f7", "6591a3"], // 7°u11
  ["e4fbe6", "3d9c43"], // 11°u7
  ["e1d0e1", "7e9b60"], // 5°u11
  ["e2eecd", "92cc2d"], // 11°u5

  // ── Purple / 13-limit ─────────────────────────────────────────────────────
  ["e6d7fe", "ad76ff"], // 13° 39° 117°
  ["e9d7d3", "a078a9"], // 65° 195°
  ["ebd0e0", "834476"], // 91°
  ["90f9cd", "00f77c"], // 143°
  ["dbb3ff", "6800ff"], // 169°
  ["cba9fe", "554969"], // u13
  ["e4f6fb", "9dd799"], // 5°u13
  ["e4fbf1", "86ce66"], // 13°u5

  // ── Dark grey / 17-limit ─────────────────────────────────────────────────
  ["cfcfcf", "5e5e5e"], // 17° 51° 153°
  ["eceae4", "908958"], // 85° 255°
  ["ded4d5", "3e2f2f"], // 119°
  ["ccdbce", "334d28"], // 187°
  ["c3b4d5", "493959"], // 221°

  // ── Pale blue / 19-limit ─────────────────────────────────────────────────
  ["d6f7ff", "9dbfef"], // 19° 57° 171°
  ["e5fff9", "5b8d8d"], // 95°
  ["f4e6f2", "a68fb8"], // 133°
  ["caf7e3", "87ec85"], // 209°
  ["dbe6ff", "8b8ed4"], // 247°

  // ── Dark green / 23-limit ─────────────────────────────────────────────────
  ["d3dab9", "96a853"], // 23° 69° 207°
  ["95c69b", "003405"], // 23° brighter variant
  ["90d597", "014d08"], // 115°
  ["91b195", "224100"], // 161°
  ["69ec79", "216a25"], // 253°

  // ── Dark blue / 29-limit ──────────────────────────────────────────────────
  ["b6ecd0", "4ba369"], // 29° 87°
  ["8aafff", "0037b0"], // 29° brighter variant
  ["b4cbfe", "3c74ed"], // 145°
  ["b0a9fe", "2f00c7"], // 203°

  // ── Turquoise / 31-limit ──────────────────────────────────────────────────
  ["d1c2c2", "6c4741"], // 31° 93°
  ["68f3ec", "006c52"], // 31° brighter variant
  ["0afff3", "008e8e"], // 155°
  ["0fd2c8", "095e72"], // 217°

  // ── Silver / 37-limit ────────────────────────────────────────────────────
  // cee3e2 also appears as u11; first entry (u11 = 578d78) wins for exact-match.
  // This 37° variant (779a8b) still contributes to interpolation.
  ["cee3e2", "779a8b"], // 37° 111°
  ["dfebdb", "98b585"], // 185°

  // ── Dark rose / 41-limit ─────────────────────────────────────────────────
  ["f2cdc5", "8e4f45"], // 41° 123°
  ["d39e92", "7b4e44"], // 41° darker variant
  ["e0b49e", "735036"], // 205°

  // ── Dark orange / 43-limit ───────────────────────────────────────────────
  // dee2da also = u5-u15; first entry wins for exact-match.
  ["dee2da", "425d3b"], // 43° 129°
  ["c9a573", "6c3e00"], // 43° darker variant
  ["e8c28c", "725007"], // 215°

  // ── Pink / 47-limit ──────────────────────────────────────────────────────
  ["ffb8da", "ac2764"], // 47° 141°
  ["f79cc5", "ae1f38"], // 235°

  // ── 59° ──────────────────────────────────────────────────────────────────
  ["e5adff", "a017de"], // 59°

  // ── Higher primes (generic) ───────────────────────────────────────────────
  ["ededed", "898989"], // higher primes
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

const SIGMA = 0.1; // RBF bandwidth in okLab units
const W_FALLBACK = 0.1; // Damps correction toward identity far from all DB entries.

/**
 * Apply the screen→Lumatone colour transfer to a CSS hex colour.
 *
 * - Exact database matches are returned unchanged (guaranteed by zero distance).
 * - Colours between database entries are smoothly interpolated in okLab.
 * - Colours far from all entries fall back toward identity (no change).
 *
 * The tonic (degree 0) colour is handled separately in lumatone-export.js using
 * LUMATONE_TONIC / LUMATONE_TONIC_OTHER and never passes through this function.
 *
 * @param {string} hex  CSS hex colour ('#rrggbb', '#rgb', or 'rrggbb')
 * @returns {string}    Adjusted colour as '#rrggbb'
 */
export function transferColor(hex) {
  // Normalise
  hex = hex.trim().replace(/^#/, "").toLowerCase();
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (!/^[0-9a-f]{6}$/.test(hex)) return "#" + hex; // passthrough if unrecognised

  // 1. Exact lookup — first matching entry in the database wins.
  const exact = _db.find((p) => p.sc === hex);
  if (exact) return "#" + exact.lm;

  // 2. RBF interpolation in okLab space.
  const q = hexToOklab(hex);
  let wSum = 0,
    dL = 0,
    da = 0,
    db = 0;

  for (const p of _db) {
    const dist2 = (q[0] - p.li[0]) ** 2 + (q[1] - p.li[1]) ** 2 + (q[2] - p.li[2]) ** 2;
    const w = Math.exp(-dist2 / (2 * SIGMA * SIGMA));
    wSum += w;
    dL += w * p.delta[0];
    da += w * p.delta[1];
    db += w * p.delta[2];
  }

  const totalW = wSum + W_FALLBACK;
  return oklabToHex(q[0] + dL / totalW, q[1] + da / totalW, q[2] + db / totalW);
}
