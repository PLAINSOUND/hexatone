import { Fraction } from "xen-dev-utils";
import { monzoToFractionOnBasis, parseExactInterval } from "../tuning/interval.js";
import { addMonzos, hejiToMonzo, parseHejiPitchClassLabel, subtractMonzos } from "./heji.js";
import { createPitchStructure, parseHejiToStructure, pitchStructureToMonzo } from "./pitch-structure.js";
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
  if (!isExplicitHejiSpelling(noteNames?.[0])) return null;
  const degreeZeroLabel = canonicalHejiLabel(noteNames?.[0]);
  const parsedDegreeZero = degreeZeroLabel ? parseHejiPitchClassLabel(degreeZeroLabel) : null;
  if (!parsedDegreeZero) return null;
  const parsedA = parseHejiPitchClassLabel(HEJI_NATURAL_LABELS.A);
  if (!parsedA) return null;
  const degreeZeroMonzo = hejiToMonzo({ ...parsedDegreeZero, octave: 4 });
  const aNaturalMonzo = hejiToMonzo({ ...parsedA, octave: 4 });
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
  const parsed = parseExactInterval(String(raw ?? "1/1"));
  return parsed?.exact && Array.isArray(parsed?.monzo) ? parsed : null;
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

function deriveExactAFromReferenceDegreeFrequency(referenceDegree, degreeTexts, fundamental) {
  if (!Number.isFinite(referenceDegree) || referenceDegree < 0 || !fundamental || fundamental <= 0) return null;
  const exactDegree = parseExactDegreeInterval(degreeTexts?.[referenceDegree] ?? "1/1");
  if (!exactDegree) return null;
  const distanceCents = Math.min(
    ...KNOWN_A_FREQUENCIES.map((target) => centsDistanceToNearestOctave(fundamental, target)),
  );
  if (distanceCents > NAMED_A_C_MAX_DISTANCE_CENTS) return null;
  return {
    ratio: degreeTexts[referenceDegree] ?? "1/1",
    label: HEJI_NATURAL_LABELS.A,
  };
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
 *   4. If there are still no exact clues, use plain A/C letter names together
 *      with known concert-frequency heuristics.
 *   5. Otherwise, compute a virtual tempered A from degree 0 to 440 Hz.
 *   6. Final fallback: degree 0, tempered A.
 *
 * @param {number|undefined}  referenceDegree - settings.reference_degree (0-based).
 * @param {string[]}          noteNames       - Raw note_names array from settings.
 * @param {string[]}          degreeTexts     - Ratio/cents string per degree; index 0 = "1/1".
 * @param {number|undefined}  fundamental     - Reference frequency in Hz (settings.fundamental).
 * @param {number[]}          scaleCents      - Full committed cents list, including degree 0.
 * @returns {{ ratio: string, label: string }}  Always returns a value (never null).
 */
export function deriveHejiAnchor(referenceDegree, noteNames, degreeTexts, fundamental, scaleCents = []) {
  const degreeFrequencies = buildDegreeFrequencies({
    scaleCents,
    fundamental,
    referenceDegree,
  });

  // --- Strategy 1: explicit exact A-natural already present ---
  if (referenceDegree != null && referenceDegree >= 0 && noteNames?.length) {
    if (isExactNaturalLabel(noteNames[referenceDegree], "A")) {
      return { ratio: degreeTexts[referenceDegree] ?? "1/1", label: HEJI_NATURAL_LABELS.A };
    }
  }
  if (noteNames?.length) {
    for (let i = 0; i < noteNames.length; i++) {
      if (isExactNaturalLabel(noteNames[i], "A")) {
        return { ratio: degreeTexts[i] ?? "1/1", label: HEJI_NATURAL_LABELS.A };
      }
    }
  }

  // --- Strategy 2: derive exact A from any explicit exact HEJI frame clue ---
  const degreeZeroExactA = deriveExactAFromDegreeZero(noteNames);
  if (degreeZeroExactA) return degreeZeroExactA;

  if (noteNames?.length) {
    const exactHejiPriority = [
      referenceDegree,
      0,
      ...noteNames.map((_, index) => index),
    ].filter((value, index, array) => Number.isFinite(value) && array.indexOf(value) === index);
    for (const degree of exactHejiPriority) {
      const exactA = deriveExactAFromExplicitHejiDegree(noteNames[degree], degreeTexts[degree] ?? "1/1");
      if (exactA) return exactA;
    }
  }

  // --- Strategy 3: exact rational reference degree at a known A frequency ---
  const exactReferenceA = deriveExactAFromReferenceDegreeFrequency(referenceDegree, degreeTexts, fundamental);
  if (exactReferenceA) return exactReferenceA;

  // --- Strategy 4: plain letter names + known frequency references ---
  const namedA = findNamedReferenceByFrequency({
    noteNames,
    degreeFrequencies,
    degreeTexts,
    letter: "A",
    targetFrequencies: KNOWN_A_FREQUENCIES,
  });
  if (namedA) {
    return { ratio: namedA.ratio, label: TEMPERED_NATURAL_LABELS.A };
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
      return { ratio: derivedRatio, label: TEMPERED_NATURAL_LABELS.A };
    }
  }

  // --- Strategy 5: virtual tempered A from degree 0 to 440 Hz ---
  const degree0Hz = degreeFrequencies[0] ?? null;
  if (degree0Hz) {
    return {
      ratio: (1200 * Math.log2(440 / degree0Hz)).toFixed(6),
      label: TEMPERED_NATURAL_LABELS.A,
    };
  }

  // --- Strategy 6: safe default — degree 0 = tempered A natural ---
  return { ratio: "1/1", label: TEMPERED_NATURAL_LABELS.A };
}

// Keep the old export name as an alias for backward compatibility with any callers/tests.
export const deriveHejiAnchorFromNoteNames = (noteNames, degreeTexts) =>
  deriveHejiAnchor(undefined, noteNames, degreeTexts, undefined);
