/**
 * key-label.js
 *
 * Generates per-degree key labels for the `heji` label mode.
 *
 * For exact rational degrees that fall within the HEJI basis (≤ 47-limit),
 * delegates to `spellPitchClassFromReferenceFrame` and returns the HEJI glyph
 * string (accidentals + letter, no octave number).
 *
 * For non-rational degrees (cents, EDO steps) or ratios beyond the 47-limit
 * that `monzoToHeji` cannot spell, falls back to a tempered approximation:
 *   - find the nearest 12-EDO semitone relative to the frame anchor
 *   - derive the note letter + ♭/♮/♯ symbol from the standard chromatic scale
 *   - append the signed cents deviation (rounded to integer), e.g. "+18" or "-6"
 *   - result looks like: "♭E+18", "♮A", "♯G-6"
 *
 * The anchor note for the tempered fallback is derived from the frame's anchor
 * letter.  The 12-EDO chromatic scale is always spelled in the "sharps up from C"
 * convention, then the window is rotated so the anchor letter aligns with 0 cents.
 */

import { BASE_BY_ID } from "./heji.js";
import { spellPitchClassFromReferenceFrame } from "./reference-frame.js";

// Plainsound font glyphs for tempered/approximate accidentals (U+E2F1–E2F3).
// These are visually distinct from the exact HEJI chromatic glyphs so that
// a tempered approximation is immediately distinguishable from a proper HEJI
// spelling.  The cents deviation suffix (+N / -N) makes the approximation
// quantitatively explicit.
const GLYPH_FLAT    = "\uE2F1"; // tempered flat
const GLYPH_NATURAL = "\uE2F2"; // tempered natural
const GLYPH_SHARP   = "\uE2F3"; // tempered sharp

// 12-EDO chromatic pitches from C, in semitones, with preferred spelling.
// Each entry: { letter, accidental } using Plainsound font glyphs.
// This table is used only for the tempered fallback.
const CHROMATIC_12 = [
  { letter: "C", accidental: GLYPH_NATURAL },   // 0
  { letter: "C", accidental: GLYPH_SHARP   },   // 1
  { letter: "D", accidental: GLYPH_NATURAL },   // 2
  { letter: "E", accidental: GLYPH_FLAT    },   // 3
  { letter: "E", accidental: GLYPH_NATURAL },   // 4
  { letter: "F", accidental: GLYPH_NATURAL },   // 5
  { letter: "F", accidental: GLYPH_SHARP   },   // 6
  { letter: "G", accidental: GLYPH_NATURAL },   // 7
  { letter: "G", accidental: GLYPH_SHARP   },   // 8
  { letter: "A", accidental: GLYPH_NATURAL },   // 9
  { letter: "B", accidental: GLYPH_FLAT    },   // 10
  { letter: "B", accidental: GLYPH_NATURAL },   // 11
];

// Semitone offset from C for each letter name.
const LETTER_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Chromatic offset in semitones for flat / natural / sharp (3/5-limit only).
// Used to determine the 12-EDO reference semitone implied by any HEJI spelling
// (letter + chromatic accidental), ignoring higher-prime arrows.
const CHROMATIC_TO_SEMITONE_DELTA = { flat: -1, natural: 0, sharp: 1 };

/**
 * Return the 12-EDO semitone (0–11, relative to C) implied by a letter and
 * chromatic accidental, ignoring all higher-prime arrows.
 * E.g. letter="E", chromatic="flat" → 3.
 *
 * @param {string} letter    - "A"–"G" (uppercase)
 * @param {string} chromatic - "flat" | "natural" | "sharp"
 * @returns {number}         - Semitone 0–11 from C.
 */
function chromaticSemitone(letter, chromatic) {
  const base = LETTER_TO_SEMITONE[letter.toUpperCase()] ?? 9;
  const delta = CHROMATIC_TO_SEMITONE_DELTA[chromatic] ?? 0;
  return ((base + delta) % 12 + 12) % 12;
}

/**
 * Compute the signed cents deviation of a pitch (given as cents from the
 * anchor) from the 12-EDO semitone implied by a HEJI spelling's letter and
 * chromatic accidental.
 *
 * The anchor's own letter+chromatic tells us its 12-EDO semitone, so
 * centsFromAnchor=0 should give deviation=0 for the anchor's own spelling.
 *
 * @param {number} centsFromAnchor - Cents in [0, 1200) from anchor pitch class.
 * @param {string} letter          - Spelled letter of this degree ("A"–"G").
 * @param {string} chromatic       - "flat" | "natural" | "sharp" of this degree.
 * @param {string} anchorLetter    - Letter of the anchor note.
 * @param {string} anchorChromatic - "flat" | "natural" | "sharp" of anchor.
 * @returns {number}               - Signed integer cents deviation (−50 to +50).
 */
function chromaticDeviation(centsFromAnchor, letter, chromatic, anchorLetter, anchorChromatic) {
  const pc = ((centsFromAnchor % 1200) + 1200) % 1200;
  // 12-EDO semitones from C for this note and the anchor.
  const thisSemitone   = chromaticSemitone(letter, chromatic);
  const anchorSemitone = chromaticSemitone(anchorLetter, anchorChromatic);
  // Expected 12-EDO cents from anchor for this spelling.
  const expected = ((thisSemitone - anchorSemitone) * 100 % 1200 + 1200) % 1200;
  // Round to integer so labels like "+0" don't appear.
  const raw = Math.round(pc - expected);
  // Fold to (−600, 600) — should always be within ±50 for valid HEJI spellings.
  return ((raw + 600) % 1200 + 1200) % 1200 - 600;
}

/**
 * Format a signed cents deviation as a compact string suffix.
 * Returns "" for 0, "+N" for positive, "−N" for negative (using Unicode minus).
 */
function deviationStr(deviation) {
  if (deviation === 0) return "";
  return deviation > 0 ? `+${deviation}` : `\u2212${Math.abs(deviation)}`;
}

/**
 * Returns the tempered fallback label for a pitch given in cents relative to
 * the frame anchor.  Uses the nearest 12-EDO semitone from the anchor to pick
 * letter + tempered accidental glyph, then appends the cents deviation.
 *
 * @param {number} centsFromAnchor - Pitch class in [0, 1200), cents from anchor.
 * @param {string} anchorLetter    - Capital letter of the anchor note (A–G).
 * @param {string} [anchorChromatic] - "flat"|"natural"|"sharp" of anchor (default "natural").
 * @returns {string}               - E.g. "♭E+18", "♮A", "♯G−6"
 */
export function temperedLabel(centsFromAnchor, anchorLetter, anchorChromatic = "natural") {
  // Normalise to [0, 1200).
  const pc = ((centsFromAnchor % 1200) + 1200) % 1200;

  // Nearest 12-EDO semitone from C for this pitch class.
  const anchorSemitone = chromaticSemitone(anchorLetter, anchorChromatic);
  const absPc = ((pc + anchorSemitone * 100) % 1200 + 1200) % 1200;
  const semitoneFloat = absPc / 100;
  const semitoneNearest = Math.round(semitoneFloat) % 12;

  const { letter, accidental } = CHROMATIC_12[semitoneNearest];

  // Deviation from that 12-EDO position, folded to (−600, 600).
  // Without the fold, pitches near the top of the octave (e.g. 127/64 ≈ 1186¢)
  // would produce a raw difference of ~1186 instead of ~−14.
  const expectedCentsFromAnchor = ((semitoneNearest - anchorSemitone) * 100 % 1200 + 1200) % 1200;
  const raw = Math.round(pc - expectedCentsFromAnchor);
  const deviation = ((raw + 600) % 1200 + 1200) % 1200 - 600;

  return `${accidental}${letter}${deviationStr(deviation)}`;
}

/**
 * Spell a single scale degree as a HEJI label with a cents deviation suffix,
 * or fall back to a tempered approximation.
 *
 * For exact HEJI ratios: returns the full HEJI glyph string (accidentals +
 * letter) followed by a signed cents deviation from the 12-EDO semitone
 * implied by the spelling's letter and chromatic accidental (flat/natural/sharp).
 * Higher-prime arrows are NOT counted when determining the reference semitone —
 * only the 3/5-limit (Pythagorean + syntonic) base is used.  This lets the
 * deviation reflect how far the just ratio deviates from equal temperament.
 *
 * For irrational or beyond-47-limit pitches: delegates to temperedLabel.
 *
 * @param {object} frame           - Reference frame from `createReferenceFrame`.
 * @param {string|null} ratioText  - Exact ratio text, or null for irrational.
 * @param {number} centsFromAnchor - Cents of this degree relative to the anchor.
 * @param {object} [options]       - Forwarded to `spellPitchClassFromReferenceFrame`.
 * @returns {string}               - HEJI glyph string + deviation, or tempered label.
 */
export function spelledHejiLabel(frame, ratioText, centsFromAnchor, options = {}) {
  // suppressDeviation: omit the cents suffix on resolved HEJI spellings only.
  // Tempered-fallback labels always retain their cents — they are structurally
  // necessary to convey the pitch when no exact HEJI spelling is available.
  const { suppressDeviation = false } = options;
  // Only attempt JI spelling when both the individual degree and the anchor
  // itself are rational.  A non-rational anchor (EDO step, decimal cents)
  // means the globalOffsetMonzo is absent — all degrees must use temperedLabel.
  if (ratioText != null && frame.rationalAnchor !== false) {
    try {
      const spelled = spellPitchClassFromReferenceFrame(frame, ratioText, options);
      if (spelled.supported && spelled.pitchClassGlyphs != null) {
        // Derive the 12-EDO reference from the letter + chromatic accidental
        // of the spelled note, ignoring all higher-prime arrows.
        // `spelled` is the monzoToHeji result: letter and baseId are top-level.
        const baseLetter    = spelled.letter ?? frame.anchor?.letter ?? "A";
        const baseChromatic = BASE_BY_ID[spelled.baseId]?.chromatic ?? "natural";
        const anchorChromatic = BASE_BY_ID[frame.anchor?.baseId]?.chromatic ?? "natural";
        const dev = chromaticDeviation(
          centsFromAnchor,
          baseLetter,
          baseChromatic,
          frame.anchor?.letter ?? "A",
          anchorChromatic,
        );
        return `${spelled.pitchClassGlyphs}${suppressDeviation ? "" : deviationStr(dev)}`;
      }
    } catch {
      // Fall through to tempered fallback.
    }
  }
  // Tempered fallback: cents are always included regardless of suppressDeviation,
  // because the tempered glyph alone does not uniquely identify the pitch.
  const anchorChromatic = BASE_BY_ID[frame.anchor?.baseId]?.chromatic ?? "natural";
  return temperedLabel(centsFromAnchor, frame.anchor?.letter ?? "A", anchorChromatic);
}

/**
 * Spell an entire scale as HEJI labels, one per degree.
 *
 * @param {Array<{ratioText: string|null, cents: number}>} degrees
 *   Each entry has:
 *   - `ratioText`: committed exact ratio (or null for inexact degrees)
 *   - `cents`: pitch in cents relative to the frame anchor
 * @param {object} frame    - Reference frame from `createReferenceFrame`.
 * @param {object} [options] - Forwarded to `spelledHejiLabel`.
 * @returns {string[]}       - One label per degree.
 */
export function spellScaleAsHejiLabels(degrees, frame, options = {}) {
  return degrees.map(({ ratioText, cents }) =>
    spelledHejiLabel(frame, ratioText, cents, options),
  );
}
