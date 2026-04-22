import { Fraction, toMonzo } from "xen-dev-utils";
import {
  hejiToMonzo,
  monzoToHeji,
  parseHejiPitchClassLabel,
  subtractMonzos,
} from "./heji.js";

function parseRatioText(text) {
  const value = String(text || "").trim();
  if (value.includes("/")) {
    const [numerator, denominator] = value.split("/").map((part) => Number(part.trim()));
    return new Fraction(numerator, denominator);
  }
  // Only plain ratios (n/d) are accepted here.  EDO steps (n\m), decimal cents
  // (700.0), and bare integers (900) are not ratios — return null so the caller
  // knows the anchor is not rational.
  return null;
}

function fractionCompare(a, b) {
  return a.s * a.n * b.d - b.s * b.n * a.d;
}

export function normalizeFractionToPitchClass(ratio) {
  let out = ratio;
  while (fractionCompare(out, new Fraction(1, 1)) < 0) out = out.mul(2);
  while (fractionCompare(out, new Fraction(2, 1)) >= 0) out = out.div(2);
  return out;
}

export function createReferenceFrame({ anchorLabel, anchorRatio, anchorOctave = 4 }) {
  const anchor = parseHejiPitchClassLabel(anchorLabel);
  if (!anchor) throw new Error(`Invalid anchor HEJI label: ${anchorLabel}`);
  const absoluteMonzo = hejiToMonzo({
    ...anchor,
    octave: anchorOctave,
  });

  // anchorRatio may be an EDO step ("9\12") or decimal cents ("900.0") rather
  // than a plain ratio.  In those cases parseRatioText / toMonzo cannot produce
  // a meaningful monzo, so we skip the offset calculation.  The frame is still
  // valid for the tempered-fallback path in spelledHejiLabel; the JI spelling
  // path (spellPitchClassFromReferenceFrame) is never reached for non-ratio
  // degrees anyway because ratioText will be null.
  const parsedAnchorRatio = parseRatioText(anchorRatio);
  let anchorRatioMonzo = null;
  let globalOffsetMonzo = null;
  try {
    anchorRatioMonzo = toMonzo(normalizeFractionToPitchClass(parsedAnchorRatio));
    globalOffsetMonzo = subtractMonzos(anchorRatioMonzo, absoluteMonzo);
  } catch {
    // Non-rational anchor (EDO step / cents) — monzo offset unavailable.
    // JI spelling will not be attempted for any degree in this frame.
  }

  return {
    anchorLabel,
    anchorRatioText: anchorRatio,
    anchorRatio: parsedAnchorRatio,
    anchorOctave,
    anchor,
    anchorAbsoluteMonzo: absoluteMonzo,
    anchorRatioMonzo,
    globalOffsetMonzo,
    // True only when the anchor ratio is a plain ratio (contains "/") and the
    // monzo offset was successfully computed.  When false, all degrees fall
    // through to the tempered label path regardless of their own ratio form.
    rationalAnchor: globalOffsetMonzo !== null,
  };
}

export function spellPitchClassFromReferenceFrame(frame, ratioText, options = {}) {
  // If the frame has no globalOffsetMonzo (non-rational anchor), JI spelling
  // is impossible — return unsupported so the caller falls back to temperedLabel.
  if (!frame.globalOffsetMonzo) return { supported: false };
  const ratio = parseRatioText(ratioText);
  // Non-ratio degree text (EDO step, cents) — cannot spell as JI.
  if (ratio == null) return { supported: false };
  const normalizedRatio = normalizeFractionToPitchClass(ratio);
  const ratioMonzo = toMonzo(normalizedRatio);
  const absoluteMonzo = subtractMonzos(ratioMonzo, frame.globalOffsetMonzo);
  const spelled = monzoToHeji(absoluteMonzo, {
    octaveMin: options.octaveMin ?? frame.anchorOctave - 2,
    octaveMax: options.octaveMax ?? frame.anchorOctave + 2,
    allowSchismaConventional: options.allowSchismaConventional ?? false,
    notationPolicy: options.notationPolicy,
  });
  if (!spelled.supported) {
    return {
      ...spelled,
      ratioText,
      relativeRatio: normalizeFractionToPitchClass(ratio.div(frame.anchorRatio)).toFraction(),
    };
  }
  return {
    ...spelled,
    ratioText,
    relativeRatio: normalizeFractionToPitchClass(ratio.div(frame.anchorRatio)).toFraction(),
    pitchClassGlyphs: spelled.label.glyphs.replace(/[0-9]/g, ""),
  };
}

export function spellScaleFromReferenceFrame(scale, frame, options = {}) {
  return scale.map((ratioText) => spellPitchClassFromReferenceFrame(frame, ratioText, options));
}
