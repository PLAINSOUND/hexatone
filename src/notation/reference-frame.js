import { Fraction, toMonzo } from "xen-dev-utils";
import {
  addMonzos,
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
  return new Fraction(Number(value), 1);
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
  const anchorRatioMonzo = toMonzo(normalizeFractionToPitchClass(parseRatioText(anchorRatio)));
  const globalOffsetMonzo = subtractMonzos(anchorRatioMonzo, absoluteMonzo);
  return {
    anchorLabel,
    anchorRatioText: anchorRatio,
    anchorRatio: parseRatioText(anchorRatio),
    anchorOctave,
    anchor,
    anchorAbsoluteMonzo: absoluteMonzo,
    anchorRatioMonzo,
    globalOffsetMonzo,
  };
}

export function spellPitchClassFromReferenceFrame(frame, ratioText, options = {}) {
  const ratio = parseRatioText(ratioText);
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
