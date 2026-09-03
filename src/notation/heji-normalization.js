// This module owns normalization and defaulting around HEJI text input.
// It reconciles typed HEJI glyph strings, anchor defaults, and mixed tempered
// vs HEJI spelling states so the notation UI can stay forgiving and consistent.

import { Fraction } from "xen-dev-utils";
import { monzoToFractionOnBasis, parseExactInterval } from "../tuning/interval.js";
import {
  addMonzos,
  BASE_BY_ID,
  HEJI_FAMILIES,
  parseHejiPitchClassLabel,
  subtractMonzos,
} from "./heji.js";
import {
  createPitchStructure,
  parseHejiToStructure,
  pitchStructureToMonzo,
} from "./pitch-structure.js";
import { scalaToCents } from "../settings/scale/parse-scale.js";

// HEJI glyph codepoints used for deriving anchor defaults.
// U+E261 = Plainsound natural, U+E260 = flat, U+E262 = sharp.
const HEJI_NATURAL = "\uE261";
const HEJI_FLAT = "\uE260";
const HEJI_SHARP = "\uE262";
const HEJI_DOUBLE_SHARP = "\uE263";
const HEJI_DOUBLE_FLAT = "\uE264";

// Tempered natural glyph (U+E2F2) — visually distinct from the exact HEJI natural.
// Used when the anchor is inferred from frequency rather than confirmed by a note name,
// so the user can see at a glance that the spelling is approximate.
const TEMPERED_NATURAL = "\uE2F2";
const TEMPERED_FLAT = "\uE2F1";
const TEMPERED_SHARP = "\uE2F3";

// HEJI exact-natural labels per letter (confirmed JI spelling from note_names).
export const HEJI_NATURAL_LABELS = {
  C: `${HEJI_NATURAL}C`,
  D: `${HEJI_NATURAL}D`,
  E: `${HEJI_NATURAL}E`,
  F: `${HEJI_NATURAL}F`,
  G: `${HEJI_NATURAL}G`,
  A: `${HEJI_NATURAL}A`,
  B: `${HEJI_NATURAL}B`,
};

// Tempered cautionary-natural labels per letter (frequency-inferred spelling).
// The tempered glyph signals to the user that this anchor was guessed from Hz,
// not derived from an explicit note name.
export const TEMPERED_NATURAL_LABELS = {
  C: `${TEMPERED_NATURAL}C`,
  D: `${TEMPERED_NATURAL}D`,
  E: `${TEMPERED_NATURAL}E`,
  F: `${TEMPERED_NATURAL}F`,
  G: `${TEMPERED_NATURAL}G`,
  A: `${TEMPERED_NATURAL}A`,
  B: `${TEMPERED_NATURAL}B`,
};

const LETTER_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// 12-EDO chromatic scale from C (semitones 0–11), preferred natural-letter spelling.
// Used to convert a MIDI pitch class to a note letter for frequency inference.
const SEMITONE_TO_LETTER = ["C", "C", "D", "E", "E", "F", "F", "G", "G", "A", "B", "B"];
//   semitone:              0    1    2    3    4    5    6    7    8    9   10   11
// (Semitones 1, 3, 6, 8, 10 are accidentals; we round to the nearest natural neighbour.)

// OpenType ligature prefixes used in some preset note_names:
//   *n → natural (same as bare "n" → U+E261)
//   *f → flat    (same as "b"  → U+E260)
//   *s → sharp   (same as "#"  → U+E262)
// Substitute these so the rest of the parsing logic sees plain ASCII shortcuts.
export function expandOpenTypeLigatures(name) {
  return name.replace(/\*n/g, "n").replace(/\*f/g, "b").replace(/\*s/g, "#");
}

function normalizeGermanNoteLetter(value) {
  const source = String(value ?? "");
  if (/^[Hh]/u.test(source)) return `B${source.slice(1)}`;
  return source.replace(/[Hh]$/u, "B");
}

function expandExtendedOpenTypeLigaturePrefix(value) {
  const source = String(value ?? "")
    .replace(/^\*ft/iu, TEMPERED_FLAT)
    .replace(/^\*nt/iu, TEMPERED_NATURAL)
    .replace(/^\*st/iu, TEMPERED_SHARP);
  const ligatureMatch = source.match(/^\*(ff|ss|f|n|s)((?:[ou]\d+)*)/iu);
  if (!ligatureMatch) return source;
  const chromatic = {
    f: "flat",
    n: "natural",
    s: "sharp",
    ff: "doubleflat",
    ss: "doublesharp",
  }[ligatureMatch[1].toLowerCase()];
  const primeExponents = new Map();
  for (const modifier of ligatureMatch[2].matchAll(/([ou])(\d+)/giu)) {
    let product = Number(modifier[2]);
    const amount = modifier[1].toLowerCase() === "o" ? -1 : 1;
    if (!Number.isSafeInteger(product) || product < 1 || product % 2 === 0) return source;
    for (const prime of [5, ...HEJI_FAMILIES.map((family) => family.prime)]) {
      while (product % prime === 0) {
        primeExponents.set(prime, (primeExponents.get(prime) ?? 0) + amount);
        product /= prime;
      }
    }
    if (product !== 1) return source;
  }
  const syntonic = primeExponents.get(5) ?? 0;
  primeExponents.delete(5);
  const clampedSyntonic = Math.max(-3, Math.min(3, syntonic));
  const baseGlyph = BASE_BY_ID[`${chromatic}:${clampedSyntonic}`]?.glyph;
  if (!baseGlyph) return source;
  const syntonicSpill =
    Math.abs(syntonic) > 3
      ? (BASE_BY_ID[`natural:${syntonic < 0 ? -1 : 1}`]?.glyph ?? "").repeat(Math.abs(syntonic) - 3)
      : "";
  const extras = [...primeExponents.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([prime, exponent]) => {
      const family = HEJI_FAMILIES.find((candidate) => candidate.prime === prime);
      const glyph = exponent < 0 ? family?.lower?.glyph : family?.upper?.glyph;
      return glyph?.repeat(Math.abs(exponent)) ?? "";
    })
    .join("");
  return `${extras}${baseGlyph}${syntonicSpill}${source.slice(ligatureMatch[0].length)}`;
}

/**
 * Normalize a pitch-class spelling shared by sequence and Scale Table editors.
 * Supports German H, bare note letters, HEJI glyphs, and Plainsound OpenType
 * shorthand such as *n, *ft, *so5, *fu11, and composite prime products.
 */
export function normalizeHejiPitchClassInput(value) {
  const compact = String(value ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!compact) return null;
  const spelling = expandExtendedOpenTypeLigaturePrefix(normalizeGermanNoteLetter(compact));
  return canonicalHejiAnchorLabelInput(spelling);
}

function isExplicitHejiSpelling(raw) {
  const source = String(raw ?? "").trim();
  if (!source) return false;
  return /[\uE260-\uE2FF\uEE50-\uEE59]|\*[nfs]|^(?:n|b|#|bb|##)[A-Ga-g]$/.test(source);
}

function expandAsciiHejiAccidentals(text) {
  return text
    .replace(/##/g, HEJI_DOUBLE_SHARP)
    .replace(/bb/gi, HEJI_DOUBLE_FLAT)
    .replace(/#/g, HEJI_SHARP)
    .replace(/b/g, HEJI_FLAT)
    .replace(/n/g, HEJI_NATURAL);
}

export function canonicalHejiAnchorLabelInput(name) {
  if (typeof name !== "string") return null;
  const compact = expandOpenTypeLigatures(name).replace(/\s+/g, "");
  if (!compact) return null;
  const prefixMatch = compact.match(/^(.*?)([A-Ga-g])$/);
  const suffixMatch = compact.match(/^([A-Ga-g])(.*)$/);
  let letter = null;
  let accidentalText = null;

  if (prefixMatch && isExplicitHejiSpelling(compact)) {
    letter = prefixMatch[2].toUpperCase();
    accidentalText = prefixMatch[1];
  } else if (suffixMatch && /^[A-Ga-g](?:n|b|#|bb|##)?$/.test(compact)) {
    letter = suffixMatch[1].toUpperCase();
    accidentalText = suffixMatch[2];
  } else if (/^[A-Ga-g]$/.test(compact)) {
    letter = compact.toUpperCase();
    accidentalText = "";
  } else {
    return null;
  }

  const prefix = accidentalText === "" ? HEJI_NATURAL : expandAsciiHejiAccidentals(accidentalText);
  const candidate = `${prefix}${letter}`;
  return parseHejiPitchClassLabel(candidate) ? candidate : null;
}

/**
 * Canonicalise a bare letter A-G to the HEJI natural-prefixed glyph form.
 * e.g. "A" → "\uE261A", "nA" → "\uE261A" (already prefixed), "♮A" → "♮A" (pass-through).
 * Returns null if the name is not a parseable HEJI pitch-class label or bare letter.
 *
 * @param {string} name - A single note_names entry.
 * @returns {string|null} Canonical HEJI glyph label, or null if not recognisable.
 */
export function canonicalHejiLabel(name) {
  if (!name) return null;
  return canonicalHejiAnchorLabelInput(name);
}

/**
 * Reduce a HEJI spelling to a tempered flat, natural, or sharp spelling.
 * The letter and 3-limit accidental direction are retained; syntonic and
 * higher-prime inflections are deliberately discarded.
 */
export function temperedAnchorLabelFromHeji(name) {
  const canonical = canonicalHejiAnchorLabelInput(name);
  const structure = canonical ? parseHejiToStructure(canonical) : null;
  if (!structure?.letter) return null;
  const glyph =
    (structure.accidentalCount ?? 0) < 0
      ? TEMPERED_FLAT
      : (structure.accidentalCount ?? 0) > 0
        ? TEMPERED_SHARP
        : TEMPERED_NATURAL;
  return `${glyph}${structure.letter}`;
}

/**
 * Infer the nearest natural note letter from a reference frequency (Hz) using
 * MIDI note number arithmetic.
 *
 * Converts hz → MIDI float (A4=440 as 0¢ reference: midi = 69 + 12*log2(hz/440)),
 * takes the pitch class (mod 12, rounded), then maps to the nearest natural letter.
 * Returns a tempered-natural label string (e.g. "\uE2F2D") rather than a raw letter,
 * because the spelling is inferred, not confirmed.
 *
 * @param {number} hz - Reference frequency in Hz.
 * @returns {string|null} Tempered-natural label, or null if hz is invalid.
 */
export function inferTemperedLabelFromFrequency(hz) {
  if (!hz || typeof hz !== "number" || hz <= 0) return null;
  const midi = 69 + 12 * Math.log2(hz / 440);
  // Pitch class 0–11 from C, rounded to nearest semitone.
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  const letter = SEMITONE_TO_LETTER[pc];
  return TEMPERED_NATURAL_LABELS[letter] ?? null;
}

const isExactNaturalLabel = (raw, letter) => {
  if (!raw) return false;
  const name = expandOpenTypeLigatures(String(raw).trim());
  if (new RegExp(`^[${letter}${letter.toLowerCase()}]$`).test(name)) return true;
  if (name === `n${letter}` || name === `n${letter.toLowerCase()}`) return true;
  if (name === `${HEJI_NATURAL}${letter}`) return true;
  if (name === `${HEJI_NATURAL}${letter.toLowerCase()}`) return true;
  return false;
};

const centsDistance = (hz, targetHz) => Math.abs(1200 * Math.log2(hz / targetHz));

function centsDistanceToNearestOctave(hz, baseHz) {
  if (!hz || !baseHz || hz <= 0 || baseHz <= 0) return Infinity;
  const octaveShift = Math.round(Math.log2(hz / baseHz));
  return centsDistance(hz, baseHz * Math.pow(2, octaveShift));
}

function fractionCompare(a, b) {
  return a.s * a.n * b.d - b.s * b.n * a.d;
}

function normalizeFractionToPitchClass(ratio) {
  let out = ratio;
  while (fractionCompare(out, new Fraction(1, 1)) < 0) out = out.mul(2);
  while (fractionCompare(out, new Fraction(2, 1)) >= 0) out = out.div(2);
  return out;
}

function formatPitchClassRatioFromMonzo(monzo) {
  const ratio = normalizeFractionToPitchClass(monzoToFractionOnBasis(monzo));
  const text = ratio.toFraction();
  return text.includes("/") ? text : `${text}/1`;
}

function deriveExactAFromDegreeZero(noteNames) {
  const degreeZeroStructure = parseExactHejiStructure(noteNames?.[0]);
  if (!degreeZeroStructure) return null;
  const aNaturalStructure = createPitchStructure({ letter: "A" });
  const degreeZeroMonzo = pitchStructureToMonzo(degreeZeroStructure);
  const aNaturalMonzo = pitchStructureToMonzo(aNaturalStructure);
  const ratioMonzo = subtractMonzos(aNaturalMonzo, degreeZeroMonzo);
  return {
    ratio: formatPitchClassRatioFromMonzo(ratioMonzo),
    label: HEJI_NATURAL_LABELS.A,
  };
}

function parseExactHejiStructure(raw) {
  const canonical = canonicalHejiLabel(raw);
  const structure = canonical ? parseHejiToStructure(canonical) : null;
  if (!structure || structure.useTemperedAccidentals) return null;
  return structure;
}

function parseExactDegreeInterval(raw) {
  try {
    const parsed = parseExactInterval(String(raw ?? "1/1"));
    return parsed?.exact && Array.isArray(parsed?.monzo) ? parsed : null;
  } catch {
    return null;
  }
}

function deriveExactAFromExplicitHejiDegree(rawName, degreeText) {
  const structure = parseExactHejiStructure(rawName);
  const exactDegree = parseExactDegreeInterval(degreeText);
  if (!structure || !exactDegree) return null;
  const aNatural = createPitchStructure({ letter: "A" });
  const ratioMonzo = addMonzos(
    exactDegree.monzo,
    subtractMonzos(pitchStructureToMonzo(aNatural), pitchStructureToMonzo(structure)),
  );
  return {
    ratio: formatPitchClassRatioFromMonzo(ratioMonzo),
    label: HEJI_NATURAL_LABELS.A,
  };
}

function parseTemperedHejiStructure(raw) {
  const canonical = canonicalHejiLabel(raw);
  const structure = canonical ? parseHejiToStructure(canonical) : null;
  if (!structure || structure.useTemperedAccidentals !== true) return null;
  return structure;
}

function normalizePitchClassCents(cents) {
  const normalized = ((Number(cents) % 1200) + 1200) % 1200;
  return Math.abs(normalized - 1200) < 1e-9 ? 0 : normalized;
}

function deriveTemperedAFromExplicitTemperedDegree(rawName, degreeText) {
  const structure = parseTemperedHejiStructure(rawName);
  if (!structure?.letter) return null;
  const degreeCents = scalaToCents(String(degreeText ?? "1/1"));
  if (!Number.isFinite(degreeCents)) return null;
  const sourceSemitones =
    (LETTER_TO_SEMITONE[structure.letter] ?? 0) + (structure.accidentalCount ?? 0);
  const anchorCents = normalizePitchClassCents(degreeCents + (9 - sourceSemitones) * 100);
  return {
    ratio: anchorCents.toFixed(6),
    label: TEMPERED_NATURAL_LABELS.A,
    inferredTemperedOnly: true,
  };
}

const buildDegreeFrequencies = ({ scaleCents, fundamental, referenceDegree = 0 }) => {
  if (!Array.isArray(scaleCents) || !scaleCents.length || !fundamental || fundamental <= 0) {
    return [];
  }
  const referenceCents = scaleCents[referenceDegree] ?? 0;
  return scaleCents.map((cents) => fundamental * Math.pow(2, (cents - referenceCents) / 1200));
};

const KNOWN_A_FREQUENCIES = [440, 441, 442, 443, 444, 415, 392];
const TEMPERED_C_FREQUENCY = 261.625565;
const NAMED_A_C_MAX_DISTANCE_CENTS = 20;
const NATURAL_LETTER_TO_A_SEMITONES = {
  C: -9,
  D: -7,
  E: -5,
  F: -4,
  G: -2,
  A: 0,
  B: 2,
};

function isPlainLetterName(raw, letter) {
  return new RegExp(`^${letter}$`, "i").test(String(raw ?? "").trim());
}

function findNamedReferenceByFrequency({
  noteNames,
  degreeFrequencies,
  degreeTexts,
  letter,
  targetFrequencies,
  maxDistanceCents = NAMED_A_C_MAX_DISTANCE_CENTS,
}) {
  let best = null;
  for (let i = 0; i < (noteNames?.length ?? 0); i += 1) {
    if (!isPlainLetterName(noteNames?.[i], letter)) continue;
    const hz = degreeFrequencies[i];
    if (!hz || hz <= 0) continue;
    const distanceCents = Math.min(
      ...targetFrequencies.map((target) => centsDistanceToNearestOctave(hz, target)),
    );
    if (distanceCents > maxDistanceCents) continue;
    if (!best || distanceCents < best.distanceCents) {
      best = {
        degree: i,
        ratio: degreeTexts[i] ?? "1/1",
        distanceCents,
      };
    }
  }
  return best;
}

function deriveTemperedARatioFromC(degreeText) {
  const centsValue = scalaToCents(String(degreeText ?? "1/1"));
  if (!Number.isFinite(centsValue)) return null;
  return (((centsValue + 900) % 1200) + 1200).toFixed(6);
}

function complementPitchClassRatioText(ratioText) {
  const exact = parseExactInterval(String(ratioText ?? ""));
  if (!exact?.ratio) return ratioText;
  const complemented = new Fraction(2, 1).div(exact.ratio);
  const text = complemented.toFraction();
  return text.includes("/") ? text : `${text}/1`;
}

function deriveAFromNaturalLetter(letter, degreeText = "1/1") {
  if (!letter || !HEJI_NATURAL_LABELS[letter]) return null;
  const exactA = deriveExactAFromExplicitHejiDegree(HEJI_NATURAL_LABELS[letter], degreeText);
  if (exactA) {
    const desiredCents = ((((9 - (LETTER_TO_SEMITONE[letter] ?? 9)) % 12) + 12) % 12) * 100;
    const currentCents = scalaToCents(String(exactA.ratio ?? ""));
    const preferUpperHalf = desiredCents > 600;
    const currentUpperHalf = Number.isFinite(currentCents) && currentCents > 600;
    const ratio =
      Number.isFinite(currentCents) && preferUpperHalf !== currentUpperHalf
        ? complementPitchClassRatioText(exactA.ratio)
        : exactA.ratio;
    return { ...exactA, ratio, inferredTemperedOnly: true };
  }
  const degreeCents = scalaToCents(String(degreeText ?? "1/1"));
  if (!Number.isFinite(degreeCents)) return null;
  const sourceSemitones = LETTER_TO_SEMITONE[letter] ?? 0;
  return {
    ratio: normalizePitchClassCents(degreeCents + (9 - sourceSemitones) * 100).toFixed(6),
    label: TEMPERED_NATURAL_LABELS.A,
    inferredTemperedOnly: true,
  };
}

function inferNaturalLetterFromReferenceFrequency(referenceHz) {
  if (!referenceHz || referenceHz <= 0) return null;
  for (const targetA of KNOWN_A_FREQUENCIES) {
    let bestForTarget = null;
    for (const [letter, semitoneOffset] of Object.entries(NATURAL_LETTER_TO_A_SEMITONES)) {
      const baseHz = targetA * Math.pow(2, semitoneOffset / 12);
      const octaveShift = Math.round(Math.log2(referenceHz / baseHz));
      const candidateHz = baseHz * Math.pow(2, octaveShift);
      const distanceCents = centsDistance(referenceHz, candidateHz);
      if (!bestForTarget || distanceCents < bestForTarget.distanceCents) {
        bestForTarget = { letter, distanceCents };
      }
    }
    if (bestForTarget && bestForTarget.distanceCents <= NAMED_A_C_MAX_DISTANCE_CENTS) {
      return bestForTarget.letter;
    }
  }
  return null;
}

function noteNamesLackSpellingClues(noteNames) {
  if (!Array.isArray(noteNames) || noteNames.length === 0) return true;
  return noteNames.every((raw) => {
    const text = String(raw ?? "").trim();
    return text === "" || /^[+\-]?\d+$/.test(text);
  });
}

function deriveExactAFromReferenceDegreeFrequency(referenceDegree, degreeTexts, fundamental) {
  if (!Number.isFinite(referenceDegree) || referenceDegree < 0 || !fundamental || fundamental <= 0)
    return null;
  if (inferNaturalLetterFromReferenceFrequency(fundamental) !== "A") return null;
  const exactDegree = parseExactDegreeInterval(degreeTexts?.[referenceDegree] ?? "1/1");
  if (!exactDegree) return null;
  return {
    ratio: formatPitchClassRatioFromMonzo(exactDegree.monzo),
    label: HEJI_NATURAL_LABELS.A,
  };
}

function deriveAnchorFromExplicitANaturalDegree(degreeText) {
  const raw = String(degreeText ?? "1/1");
  const exactDegree = parseExactDegreeInterval(raw);
  if (exactDegree) {
    return {
      ratio: formatPitchClassRatioFromMonzo(exactDegree.monzo),
      label: HEJI_NATURAL_LABELS.A,
    };
  }
  const centsValue = scalaToCents(raw);
  if (Number.isFinite(centsValue)) {
    return {
      ratio: raw,
      label: TEMPERED_NATURAL_LABELS.A,
      inferredTemperedOnly: true,
    };
  }
  return { ratio: raw || "1/1", label: HEJI_NATURAL_LABELS.A };
}

function deriveExactAFromAnyDegreeFrequency(
  degreeTexts,
  degreeFrequencies,
  noteNames = [],
  referenceDegree,
  fundamental,
) {
  if (!Array.isArray(degreeFrequencies) && !fundamental) return null;
  const referenceInterval = parseExactDegreeInterval(degreeTexts?.[referenceDegree] ?? "1/1");
  const referenceCents =
    Number.isFinite(referenceDegree) && degreeFrequencies?.[referenceDegree] != null
      ? scalaToCents(String(degreeTexts?.[referenceDegree] ?? "1/1"))
      : null;
  let best = null;
  const degreeCount = Math.max(
    degreeTexts?.length ?? 0,
    degreeFrequencies.length,
    noteNames?.length ?? 0,
  );
  for (let degree = 0; degree < degreeCount; degree += 1) {
    const rawInterval =
      degreeTexts?.[degree] ??
      (String(noteNames?.[degree] ?? "").includes("/") ? String(noteNames?.[degree]) : "1/1");
    const exactDegree = parseExactDegreeInterval(rawInterval);
    let hz = degreeFrequencies[degree];
    if (
      (!hz || hz <= 0) &&
      exactDegree &&
      referenceInterval &&
      fundamental > 0 &&
      Number.isFinite(referenceCents)
    ) {
      const degreeCents = scalaToCents(String(rawInterval));
      if (Number.isFinite(degreeCents)) {
        hz = fundamental * Math.pow(2, (degreeCents - referenceCents) / 1200);
      }
    }
    if (!exactDegree || !hz || hz <= 0) continue;
    const inferredLetter = inferNaturalLetterFromReferenceFrequency(hz);
    if (inferredLetter !== "A") continue;
    let bestTargetIndex = -1;
    let distanceCents = Infinity;
    for (let index = 0; index < KNOWN_A_FREQUENCIES.length; index += 1) {
      const candidateDistance = centsDistanceToNearestOctave(hz, KNOWN_A_FREQUENCIES[index]);
      if (
        candidateDistance < distanceCents - 1e-9 ||
        (Math.abs(candidateDistance - distanceCents) <= 1e-9 &&
          (bestTargetIndex < 0 || index < bestTargetIndex))
      ) {
        distanceCents = candidateDistance;
        bestTargetIndex = index;
      }
    }
    if (distanceCents > NAMED_A_C_MAX_DISTANCE_CENTS) continue;
    if (
      !best ||
      distanceCents < best.distanceCents - 1e-9 ||
      (Math.abs(distanceCents - best.distanceCents) <= 1e-9 && bestTargetIndex < best.targetIndex)
    ) {
      best = {
        ratio: formatPitchClassRatioFromMonzo(exactDegree.monzo),
        distanceCents,
        targetIndex: bestTargetIndex,
      };
    }
  }
  return best ? { ratio: best.ratio, label: HEJI_NATURAL_LABELS.A } : null;
}

/**
 * Derive the HEJI anchor (ratio + label) for auto-filling the anchor fields.
 *
 * Priority order:
 *   1. Prefer explicit exact HEJI A-natural spellings already present in note_names.
 *   2. Otherwise, derive exact A from any explicit exact HEJI spelling,
 *      starting with reference_degree and degree 0 (1/1).
 *   3. Otherwise, if the reference degree itself sits at a known concert-A
 *      frequency and its interval is exact, treat that as exact A.
 *   4. If there are still no exact clues, infer a natural note from the
 *      reference frequency against known concert-A families and derive exact A.
 *   5. Otherwise, use plain A/C letter names together with known
 *      concert-frequency heuristics.
 *   6. Otherwise, compute a virtual tempered A from degree 0 to 440 Hz.
 *   7. Final fallback: degree 0, tempered A.
 *
 * @param {number|undefined}  referenceDegree - settings.reference_degree (0-based).
 * @param {string[]}          noteNames       - Raw note_names array from settings.
 * @param {string[]}          degreeTexts     - Ratio/cents string per degree; index 0 = "1/1".
 * @param {number|undefined}  fundamental     - Reference frequency in Hz (settings.fundamental).
 * @param {number[]}          scaleCents      - Full committed cents list, including degree 0.
 * @returns {{ ratio: string, label: string }}  Always returns a value (never null).
 */
export function deriveHejiAnchor(
  referenceDegree,
  noteNames,
  degreeTexts,
  fundamental,
  scaleCents = [],
) {
  const degreeFrequencies = buildDegreeFrequencies({
    scaleCents,
    fundamental,
    referenceDegree,
  });

  // --- Strategy 1: explicit exact A-natural already present ---
  if (referenceDegree != null && referenceDegree >= 0 && noteNames?.length) {
    if (isExactNaturalLabel(noteNames[referenceDegree], "A")) {
      return deriveAnchorFromExplicitANaturalDegree(degreeTexts[referenceDegree] ?? "1/1");
    }
  }
  if (noteNames?.length) {
    for (let i = 0; i < noteNames.length; i++) {
      if (isExactNaturalLabel(noteNames[i], "A")) {
        return deriveAnchorFromExplicitANaturalDegree(degreeTexts[i] ?? "1/1");
      }
    }
  }

  // --- Strategy 2: derive exact A from any explicit exact HEJI frame clue ---
  const degreeZeroExactA = deriveExactAFromDegreeZero(noteNames);
  if (degreeZeroExactA) return degreeZeroExactA;

  if (noteNames?.length) {
    const exactHejiPriority = [referenceDegree, 0, ...noteNames.map((_, index) => index)].filter(
      (value, index, array) => Number.isFinite(value) && array.indexOf(value) === index,
    );
    for (const degree of exactHejiPriority) {
      const exactA = deriveExactAFromExplicitHejiDegree(
        noteNames[degree],
        degreeTexts[degree] ?? "1/1",
      );
      if (exactA) return exactA;
    }
  }

  // --- Strategy 3: explicit tempered HEJI clues already present ---
  if (noteNames?.length) {
    const temperedHejiPriority = [referenceDegree, ...noteNames.map((_, index) => index), 0].filter(
      (value, index, array) => Number.isFinite(value) && array.indexOf(value) === index,
    );
    for (const degree of temperedHejiPriority) {
      const temperedA = deriveTemperedAFromExplicitTemperedDegree(
        noteNames[degree],
        degreeTexts[degree] ?? "1/1",
      );
      if (temperedA) return temperedA;
    }
  }

  // --- Strategy 4: exact rational reference degree at a known A frequency ---
  const exactReferenceA = deriveExactAFromReferenceDegreeFrequency(
    referenceDegree,
    degreeTexts,
    fundamental,
  );
  if (exactReferenceA) return exactReferenceA;

  // --- Strategy 4b: any exact degree landing on a known A frequency ---
  const exactScaleDegreeA = deriveExactAFromAnyDegreeFrequency(
    degreeTexts,
    degreeFrequencies,
    noteNames,
    referenceDegree,
    fundamental,
  );
  if (exactScaleDegreeA) return exactScaleDegreeA;

  // --- Strategy 5: infer a natural note directly from the reference frequency ---
  const inferredReferenceLetter = noteNamesLackSpellingClues(noteNames)
    ? inferNaturalLetterFromReferenceFrequency(fundamental)
    : null;
  if (inferredReferenceLetter) {
    const inferredExactA = deriveAFromNaturalLetter(
      inferredReferenceLetter,
      degreeTexts?.[referenceDegree] ?? "1/1",
    );
    if (inferredExactA) return inferredExactA;
  }

  // --- Strategy 6: plain letter names + known frequency references ---
  const namedA = findNamedReferenceByFrequency({
    noteNames,
    degreeFrequencies,
    degreeTexts,
    letter: "A",
    targetFrequencies: KNOWN_A_FREQUENCIES,
  });
  if (namedA) {
    return { ratio: namedA.ratio, label: TEMPERED_NATURAL_LABELS.A, inferredTemperedOnly: true };
  }
  const namedC = findNamedReferenceByFrequency({
    noteNames,
    degreeFrequencies,
    degreeTexts,
    letter: "C",
    targetFrequencies: [TEMPERED_C_FREQUENCY],
  });
  if (namedC) {
    const derivedRatio = deriveTemperedARatioFromC(namedC.ratio);
    if (derivedRatio) {
      return { ratio: derivedRatio, label: TEMPERED_NATURAL_LABELS.A, inferredTemperedOnly: true };
    }
  }

  // --- Strategy 7: virtual tempered A from degree 0 to 440 Hz ---
  const degree0Hz = degreeFrequencies[0] ?? null;
  if (degree0Hz) {
    return {
      ratio: (1200 * Math.log2(440 / degree0Hz)).toFixed(6),
      label: TEMPERED_NATURAL_LABELS.A,
      inferredTemperedOnly: true,
    };
  }

  // --- Strategy 8: safe default — degree 0 = tempered A natural ---
  return { ratio: "1/1", label: TEMPERED_NATURAL_LABELS.A, inferredTemperedOnly: true };
}

// Keep the old export name as an alias for backward compatibility with any callers/tests.
export const deriveHejiAnchorFromNoteNames = (noteNames, degreeTexts) =>
  deriveHejiAnchor(undefined, noteNames, degreeTexts, undefined);
