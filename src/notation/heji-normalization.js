import { parseHejiPitchClassLabel } from "./heji.js";

// HEJI glyph codepoints used for deriving anchor defaults.
// U+E261 = Plainsound natural, U+E260 = flat, U+E262 = sharp.
const HEJI_NATURAL = "\uE261";

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
  // Expand OpenType ligature shorthands before any further processing.
  const expanded = expandOpenTypeLigatures(name);
  // Bare letter A-G — treat as natural.
  if (/^[A-Ga-g]$/.test(expanded)) {
    return `${HEJI_NATURAL}${expanded.toUpperCase()}`;
  }
  // Parseable as a HEJI pitch-class label (ASCII shortcuts like "nA", "bA", "#A",
  // or already-Unicode glyph strings).
  const parsed = parseHejiPitchClassLabel(expanded);
  if (parsed) {
    // Return the expanded form so downstream glyph parsing sees known sequences.
    return expanded;
  }
  return null;
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
  return false;
};

const centsDistance = (hz, targetHz) => Math.abs(1200 * Math.log2(hz / targetHz));

const buildDegreeFrequencies = ({ scaleCents, fundamental, referenceDegree = 0 }) => {
  if (!Array.isArray(scaleCents) || !scaleCents.length || !fundamental || fundamental <= 0) {
    return [];
  }
  const referenceCents = scaleCents[referenceDegree] ?? 0;
  return scaleCents.map((cents) => fundamental * Math.pow(2, (cents - referenceCents) / 1200));
};

const findNearestDegreeByFrequency = ({
  targetHz,
  degreeFrequencies,
  degreeTexts,
  maxDistanceCents = 60,
}) => {
  let best = null;
  for (let i = 0; i < degreeFrequencies.length; i++) {
    const hz = degreeFrequencies[i];
    if (!hz || hz <= 0) continue;
    const distanceCents = centsDistance(hz, targetHz);
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
};

/**
 * Derive the HEJI anchor (ratio + label) for auto-filling the anchor fields.
 *
 * Priority order:
 *   1. reference_degree explicitly labelled as exact A-natural — use that degree.
 *   2. Scan note_names for exact A-natural anywhere in the scale.
 *   3. Computed scale degree nearest 440 Hz — use that degree as tempered A.
 *   4. Degree 0 explicitly labelled as exact C-natural.
 *   5. Degree 0 near middle C (JI or 12-EDO) → tempered C.
 *   6. Frequency-driven fallback: compute the cents from degree 0 to 440 Hz
 *      and use tempered A, even if that anchor is not itself a scale degree.
 *   7. Last resort: infer a tempered letter from the fundamental pitch class.
 *   8. Final fallback: degree 0, label tempered C.
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

  // --- Strategy 1: reference_degree explicitly labelled as exact A-natural ---
  if (referenceDegree != null && referenceDegree >= 0 && noteNames?.length) {
    if (isExactNaturalLabel(noteNames[referenceDegree], "A")) {
      const ratio = degreeTexts[referenceDegree] ?? "1/1";
      const isRational = ratio.includes("/");
      return { ratio, label: isRational ? HEJI_NATURAL_LABELS.A : TEMPERED_NATURAL_LABELS.A };
    }
  }

  // --- Strategy 2: scan note_names for exact A-natural anywhere in the scale ---
  if (noteNames?.length) {
    for (let i = 0; i < noteNames.length; i++) {
      if (isExactNaturalLabel(noteNames[i], "A")) {
        return { ratio: degreeTexts[i] ?? "1/1", label: HEJI_NATURAL_LABELS.A };
      }
    }
  }

  // --- Strategy 3: a committed scale degree itself lands at 440 Hz ---
  const nearestA = findNearestDegreeByFrequency({
    targetHz: 440,
    degreeFrequencies,
    degreeTexts,
    maxDistanceCents: 20,
  });
  if (nearestA) {
    const nearestName = String(noteNames?.[nearestA.degree] ?? "").trim();
    const parsedNearestName = nearestName
      ? parseHejiPitchClassLabel(expandOpenTypeLigatures(nearestName))
      : null;
    // Only promote an in-scale 440-Hz degree to A when the preset is not already
    // providing a concrete HEJI spelling at that degree. Otherwise, keep the
    // invisible-anchor fallback available for spelled scales like Hamilton.
    if (!parsedNearestName) {
      const isRational = String(nearestA.ratio).includes("/");
      return {
        ratio: nearestA.ratio,
        label: isRational ? HEJI_NATURAL_LABELS.A : TEMPERED_NATURAL_LABELS.A,
      };
    }
  }

  // --- Strategy 4: explicit degree-0 C-natural label ---
  if (isExactNaturalLabel(noteNames?.[0], "C")) {
    return { ratio: "1/1", label: HEJI_NATURAL_LABELS.C };
  }

  // --- Strategy 5: degree 0 near middle C (JI or 12-EDO) ---
  const degree0Hz = degreeFrequencies[0] ?? null;
  if (degree0Hz) {
    const nearJiC = centsDistance(degree0Hz, 260.740741) <= 20;
    const near12EdoC = centsDistance(degree0Hz, 261.625565) <= 20;
    if (nearJiC || near12EdoC) {
      return { ratio: "1/1", label: TEMPERED_NATURAL_LABELS.C };
    }
  }

  // --- Strategy 6: derive the invisible anchor from degree 0 to 440 Hz and spell it as A ---
  if (degree0Hz) {
    return {
      ratio: (1200 * Math.log2(440 / degree0Hz)).toFixed(6),
      label: TEMPERED_NATURAL_LABELS.A,
    };
  }

  // --- Strategy 7: infer from the fundamental's tempered pitch class ---
  const inferredLabel = inferTemperedLabelFromFrequency(fundamental);
  if (inferredLabel) {
    return {
      ratio: degreeTexts[referenceDegree ?? 0] ?? "1/1",
      label: inferredLabel,
    };
  }

  // --- Strategy 8: safe default — degree 0 = tempered C natural ---
  return { ratio: "1/1", label: TEMPERED_NATURAL_LABELS.C };
}

// Keep the old export name as an alias for backward compatibility with any callers/tests.
export const deriveHejiAnchorFromNoteNames = (noteNames, degreeTexts) =>
  deriveHejiAnchor(undefined, noteNames, degreeTexts, undefined);
