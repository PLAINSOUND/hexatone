/**
 * okhsl.js
 *
 * ES-module port of Björn Ottosson's okHSL colour space implementation.
 * Original: https://bottosson.github.io/posts/colorpicker/
 *
 * okHSL is a perceptually uniform HSL space built on top of Oklab.
 * Hue is truly perceptual (equal hue-distances look equal), and lightness
 * tracks perceived brightness rather than raw luminance.  This makes it ideal
 * for adjusting saturation/lightness while keeping the apparent hue intact.
 *
 * Public API:
 *   srgb_to_okhsl(r, g, b)  → [h, s, l]   (r/g/b in 0–255; h/s/l in 0–1)
 *   okhsl_to_srgb(h, s, l)  → [r, g, b]   (r/g/b in 0–255 integers)
 *   adjustColorForLumatone(hex, options)  → '#rrggbb'
 */

// ── sRGB ↔ linear ────────────────────────────────────────────────────────────

function srgb_to_linear(x) {
  return x > 0.04045 ? ((x + 0.055) / 1.055) ** 2.4 : x / 12.92;
}

function linear_to_srgb(x) {
  return x >= 0.0031308 ? 1.055 * x ** (1 / 2.4) - 0.055 : 12.92 * x;
}

// ── Linear sRGB ↔ Oklab ──────────────────────────────────────────────────────

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

// ── okHSL internals ──────────────────────────────────────────────────────────

function toe(x) {
  const k1 = 0.206, k2 = 0.03, k3 = (1 + k1) / (1 + k2);
  return 0.5 * (k3 * x - k1 + Math.sqrt((k3 * x - k1) ** 2 + 4 * k2 * k3 * x));
}

function toe_inv(x) {
  const k1 = 0.206, k2 = 0.03, k3 = (1 + k1) / (1 + k2);
  return (x * x + k1 * x) / (k3 * (x + k2));
}

function compute_max_saturation(a, b) {
  let k0, k1, k2, k3, k4, wl, wm, ws;
  if (-1.88170328 * a - 0.80936493 * b > 1) {
    k0 = 1.19086277; k1 = 1.76576728; k2 = 0.59662641; k3 = 0.75515197; k4 = 0.56771245;
    wl = +4.0767416621; wm = -3.3077115913; ws = +0.2309699292;
  } else if (1.81444104 * a - 1.19445276 * b > 1) {
    k0 = 0.73956515; k1 = -0.45954404; k2 = 0.08285427; k3 = 0.1254107; k4 = 0.14503204;
    wl = -1.2684380046; wm = +2.6097574011; ws = -0.3413193965;
  } else {
    k0 = 1.35733652; k1 = -0.00915799; k2 = -1.1513021; k3 = -0.50559606; k4 = 0.00692167;
    wl = -0.0041960863; wm = -0.7034186147; ws = +1.707614701;
  }
  let S = k0 + k1 * a + k2 * b + k3 * a * a + k4 * a * b;
  const kl = +0.3963377774 * a + 0.2158037573 * b;
  const km = -0.1055613458 * a - 0.0638541728 * b;
  const ks = -0.0894841775 * a - 1.291485548  * b;
  const l_ = 1 + S * kl, m_ = 1 + S * km, s_ = 1 + S * ks;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const f  = wl * l + wm * m + ws * s;
  const f1 = wl * 3 * kl * l_ ** 2 + wm * 3 * km * m_ ** 2 + ws * 3 * ks * s_ ** 2;
  const f2 = wl * 6 * kl ** 2 * l_ + wm * 6 * km ** 2 * m_ + ws * 6 * ks ** 2 * s_;
  return S - (f * f1) / (f1 * f1 - 0.5 * f * f2);
}

function find_cusp(a, b) {
  const S = compute_max_saturation(a, b);
  const rgb = oklab_to_linear_srgb(1, S * a, S * b);
  const L = Math.cbrt(1 / Math.max(rgb[0], rgb[1], rgb[2]));
  return [L, L * S];
}

function find_gamut_intersection(a, b, L1, C1, L0, cusp) {
  if (!cusp) cusp = find_cusp(a, b);
  let t;
  if ((L1 - L0) * cusp[1] - (cusp[0] - L0) * C1 <= 0) {
    t = (cusp[1] * L0) / (C1 * cusp[0] + cusp[1] * (L0 - L1));
  } else {
    t = (cusp[1] * (L0 - 1)) / (C1 * (cusp[0] - 1) + cusp[1] * (L0 - L1));
    const kl = +0.3963377774 * a + 0.2158037573 * b;
    const km = -0.1055613458 * a - 0.0638541728 * b;
    const ks = -0.0894841775 * a - 1.291485548  * b;
    const L = L0 * (1 - t) + t * L1, C = t * C1;
    const l_ = L + C * kl, m_ = L + C * km, s_ = L + C * ks;
    const ldt = (L1 - L0) + C1 * kl, mdt = (L1 - L0) + C1 * km, sdt = (L1 - L0) + C1 * ks;
    const f  = 4.0767416621 * l_ ** 3 - 3.3077115913 * m_ ** 3 + 0.2309699292 * s_ ** 3 - 1;
    const f1 = 4.0767416621 * 3 * ldt * l_ ** 2 - 3.3077115913 * 3 * mdt * m_ ** 2 + 0.2309699292 * 3 * sdt * s_ ** 2;
    const f2 = 4.0767416621 * 6 * ldt ** 2 * l_ - 3.3077115913 * 6 * mdt ** 2 * m_ + 0.2309699292 * 6 * sdt ** 2 * s_;
    t = t - f * f1 / (f1 * f1 - 0.5 * f * f2);
  }
  return t;
}

function get_Cs(L, a_, b_) {
  const cusp = find_cusp(a_, b_);
  const C_max = find_gamut_intersection(a_, b_, L, 1, L, cusp);
  const ST_max = [cusp[1] / cusp[0], cusp[1] / (1 - cusp[0])];
  const S_mid = 0.11516993 + 1 / (7.4477897 + 4.1590124 * b_ + a_ * (-2.19557347 + 1.75198401 * b_ + a_ * (-2.13704948 - 10.02301043 * b_ + a_ * (-4.24894561 + 5.38770819 * b_ + 4.69891013 * a_))));
  const T_mid = 0.11239642 + 1 / (1.6132032  - 0.68124379 * b_ + a_ * (0.40370612  + 0.90148123 * b_ + a_ * (-0.27087943 + 0.6122399  * b_ + a_ * (0.00299215  - 0.45399568 * b_ - 0.14661872 * a_))));
  const k = C_max / Math.min(L * ST_max[0], (1 - L) * ST_max[1]);
  const C_a = L * S_mid, C_b = (1 - L) * T_mid;
  const C_mid = 0.9 * k * Math.sqrt(Math.sqrt(1 / (1 / C_a ** 4 + 1 / C_b ** 4)));
  const C_0 = Math.sqrt(1 / (1 / (L * 0.4) ** 2 + 1 / ((1 - L) * 0.8) ** 2));
  return [C_0, C_mid, C_max];
}

// ── Public: okHSL ↔ sRGB ─────────────────────────────────────────────────────

/**
 * Convert an sRGB colour to okHSL.
 * @param {number} r  0–255
 * @param {number} g  0–255
 * @param {number} b  0–255
 * @returns {[number, number, number]}  [h, s, l]  all in 0–1
 */
export function srgb_to_okhsl(r, g, b) {
  const lab = linear_srgb_to_oklab(
    srgb_to_linear(r / 255),
    srgb_to_linear(g / 255),
    srgb_to_linear(b / 255),
  );
  const C = Math.sqrt(lab[1] ** 2 + lab[2] ** 2);
  if (C < 1e-10) return [0, 0, toe(lab[0])];
  const a_ = lab[1] / C, b_ = lab[2] / C;
  const L = lab[0];
  const h = 0.5 + 0.5 * Math.atan2(-lab[2], -lab[1]) / Math.PI;
  const [C_0, C_mid, C_max] = get_Cs(L, a_, b_);
  let s;
  if (C < C_mid) {
    const k1 = 0.8 * C_0, k2 = 1 - k1 / C_mid;
    s = (C / (k1 + k2 * C)) * 0.8;
  } else {
    const k0 = C_mid, k1 = 0.2 * C_mid ** 2 * 1.5625 / C_0, k2 = 1 - k1 / (C_max - C_mid);
    s = 0.8 + 0.2 * (C - k0) / (k1 + k2 * (C - k0));
  }
  return [h, Math.min(1, s), toe(L)];
}

/**
 * Convert an okHSL colour to sRGB.
 * @param {number} h  0–1
 * @param {number} s  0–1
 * @param {number} l  0–1
 * @returns {[number, number, number]}  [r, g, b]  each 0–255 (integers)
 */
export function okhsl_to_srgb(h, s, l) {
  if (l >= 1) return [255, 255, 255];
  if (l <= 0) return [0, 0, 0];
  const a_ = Math.cos(2 * Math.PI * h), b_ = Math.sin(2 * Math.PI * h);
  const L = toe_inv(l);
  const [C_0, C_mid, C_max] = get_Cs(L, a_, b_);
  let C, t, k0, k1, k2;
  if (s < 0.8) {
    t = 1.25 * s; k0 = 0; k1 = 0.8 * C_0; k2 = 1 - k1 / C_mid;
  } else {
    t = 5 * (s - 0.8); k0 = C_mid; k1 = 0.2 * C_mid ** 2 * 1.5625 / C_0; k2 = 1 - k1 / (C_max - C_mid);
  }
  C = k0 + t * k1 / (1 - k2 * t);
  const rgb = oklab_to_linear_srgb(L, C * a_, C * b_);
  return [
    Math.min(255, Math.max(0, Math.round(255 * linear_to_srgb(rgb[0])))),
    Math.min(255, Math.max(0, Math.round(255 * linear_to_srgb(rgb[1])))),
    Math.min(255, Math.max(0, Math.round(255 * linear_to_srgb(rgb[2])))),
  ];
}

// ── Public: Lumatone colour adjustment ───────────────────────────────────────

/**
 * Adjust a CSS hex colour for the Lumatone display.
 *
 * The Lumatone's physical key LEDs appear significantly brighter than an sRGB
 * screen, so pastel/light colours need to be darkened considerably to look
 * optically equivalent.  A flat additive offset (−0.2) under-corrects light
 * colours and over-corrects dark ones.  A power-curve applied to okHSL
 * lightness fits the data much better:
 *
 *   l_out = l_in ^ lGamma          (default lGamma ≈ 3.5)
 *
 * This naturally anchors at 0 (black stays black) and 1 (pure white stays
 * white), and compresses the mid-range in proportion to how light the colour
 * is — which is exactly the observed pattern across Marc's colour pairs.
 *
 * Saturation is barely changed on average across the corpus of pairs (mean
 * Δs ≈ −0.02), so the default sOffset is 0.  Add a small positive sOffset
 * (e.g. +0.05) if you find colours look washed-out on your unit.
 *
 * The transform is applied purely in okHSL, so perceptual hue is preserved
 * exactly.
 *
 * Suggested starting values:
 *   lGamma = 3.5   — darken aggressively (suits most pastel Hexatone palettes)
 *   sOffset = 0    — no saturation change
 *
 * Use lGamma = 1 (or 0 for lOffset mode) to bypass the curve entirely.
 *
 * @param {string} hex      CSS hex colour, e.g. '#ffe070' or 'fceec5'
 * @param {object} [opts]
 * @param {number}   [opts.lGamma=3.5]    Lightness power exponent (> 1 darkens)
 * @param {number}   [opts.sOffset=0]     Additive saturation shift in okHSL (−1..+1)
 * @returns {string}  Adjusted colour as '#rrggbb'
 */
export function adjustColorForLumatone(hex, { lGamma = 3.5, sOffset = 0 } = {}) {
  hex = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return '#' + hex;   // passthrough if unrecognised

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  const [h, s, l] = srgb_to_okhsl(r, g, b);

  const lNew = l ** lGamma;                                      // power curve
  const sNew = Math.min(1, Math.max(0, s + sOffset));

  const [ro, go, bo] = okhsl_to_srgb(h, sNew, lNew);

  return '#' + [ro, go, bo].map(v => v.toString(16).padStart(2, '0')).join('');
}
