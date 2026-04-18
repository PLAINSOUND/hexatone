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

/**
 * Derive the HEJI anchor (ratio + label) for auto-filling the anchor fields.
 *
 * Priority order:
 *   1. reference_degree with a parseable note name — use that degree's ratio
 *      and its canonicalised HEJI label.  Most musically direct: the named
 *      reference pitch becomes the 0¢-deviation anchor.
 *   2. Scan note_names for the first plain A-natural entry.  Covers presets
 *      that don't assign a meaningful reference_degree but do have note names.
 *   3. Infer from fundamental frequency: A-range (392–466 Hz) → anchor is
 *      the reference_degree at ♮A; C-range (248–270 Hz) → degree 0 at ♮C.
 *   4. Final fallback: degree 0, label ♮C (1/1 = C natural).
 *
 * @param {number|undefined}  referenceDegree - settings.reference_degree (0-based).
 * @param {string[]}          noteNames       - Raw note_names array from settings.
 * @param {string[]}          degreeTexts     - Ratio/cents string per degree; index 0 = "1/1".
 * @param {number|undefined}  fundamental     - Reference frequency in Hz (settings.fundamental).
 * @returns {{ ratio: string, label: string }}  Always returns a value (never null).
 */
export function deriveHejiAnchor(referenceDegree, noteNames, degreeTexts, fundamental) {
  // --- Strategy 1: reference_degree with parseable note name ---
  if (referenceDegree != null && referenceDegree >= 0 && noteNames?.length) {
    const name = String(noteNames[referenceDegree] ?? "").trim();
    const label = canonicalHejiLabel(name);
    if (label) {
      const ratio = degreeTexts[referenceDegree] ?? "1/1";
      // If the ratio is not a rational interval (EDO step or decimal cents),
      // the anchor is a tempered pitch.  Downgrade any exact HEJI natural glyph
      // to its tempered equivalent so the visual distinction is preserved.
      const isRational = ratio.includes("/");
      if (!isRational) {
        // Replace exact HEJI base glyphs with tempered equivalents in the label.
        const tempered = label
          .replace(/\uE261/g, TEMPERED_NATURAL)
          .replace(/\uE260/g, "\uE2F1")
          .replace(/\uE262/g, "\uE2F3");
        return { ratio, label: tempered };
      }
      return { ratio, label };
    }
  }

  // --- Strategy 2: scan note_names for plain A-natural ---
  if (noteNames?.length) {
    for (let i = 0; i < noteNames.length; i++) {
      const raw = String(noteNames[i] ?? "").trim();
      if (!raw) continue;
      const name = expandOpenTypeLigatures(raw);
      // Accept bare "A" or "a" as A-natural.
      if (/^[Aa]$/.test(name)) {
        return { ratio: degreeTexts[i] ?? "1/1", label: HEJI_NATURAL_LABELS.A };
      }
      // Accept any HEJI label that resolves to plain A-natural
      // (letter=A, chromatic=natural, no higher-prime modifiers, no schisma).
      const parsed = parseHejiPitchClassLabel(name);
      if (
        parsed &&
        parsed.letter === "A" &&
        parsed.baseId === "natural:0" &&
        parsed.schismaAmount === 0 &&
        parsed.extraIds.length === 0
      ) {
        return { ratio: degreeTexts[i] ?? "1/1", label: HEJI_NATURAL_LABELS.A };
      }
    }
  }

  // --- Strategy 3: infer from fundamental frequency via MIDI pitch class ---
  // The inferred label uses the tempered-natural glyph (♮ look-alike but distinct)
  // to signal that this is a frequency-based guess, not a confirmed JI spelling.
  // The user can override it in the Notation (Spelling) field.
  const inferredLabel = inferTemperedLabelFromFrequency(fundamental);
  if (inferredLabel) {
    return {
      ratio: degreeTexts[referenceDegree ?? 0] ?? "1/1",
      label: inferredLabel,
    };
  }

  // --- Strategy 4: safe default — degree 0 = tempered C natural ---
  return { ratio: "1/1", label: TEMPERED_NATURAL_LABELS.C };
}

// Keep the old export name as an alias for backward compatibility with any callers/tests.
export const deriveHejiAnchorFromNoteNames = (noteNames, degreeTexts) =>
  deriveHejiAnchor(undefined, noteNames, degreeTexts, undefined);
