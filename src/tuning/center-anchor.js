/**
 * center-anchor.js
 *
 * Pure helpers for deriving the tuning-map anchor from user settings.
 * No canvas, no WebMidi, no state.
 *
 * The "anchor" is the MIDI note number used as scale degree 0 when building
 * either a real-time or static bulk tuning map. Choosing it well centres the
 * 128-note map on the visible keyboard region, maximising coverage.
 *
 * Exports:
 *   degree0ToRef(referenceDegree, scale)                        → [cents, ratio]
 *   computeCenterPitchHz(fundamental, degree0toRefCents,
 *                        scale, equivInterval, centerDegree)    → Hz
 *   computeNaturalAnchor(fundamental, degree0toRefCents,
 *                        scale, equivInterval, centerDegree)    → MIDI int
 *   chooseStaticMapCenterMidi(centerPitchHz)                    → MIDI int
 *   computeStaticMapDegree0(centerMidiNote, centerDegree)       → int
 */

// ── degree0ToRef ──────────────────────────────────────────────────────────────

/**
 * Compute the cents and ratio offset from scale degree 0 to the reference degree.
 *
 * The reference degree is the one whose frequency equals `fundamental` Hz.
 * All scale values are in the numeric-cents scale array (scale[0] = 0).
 *
 * @param {number}   referenceDegree  Scale degree designated as the reference
 * @param {number[]} scale            Numeric-cents array (scale[0] === 0)
 * @returns {[number, number]}        [cents_from_0_to_ref, ratio_from_0_to_ref]
 */
export function degree0ToRef(referenceDegree, scale) {
  if (referenceDegree <= 0) {
    return [0, 1];
  }
  const cents = scale[referenceDegree];
  return [cents, 2 ** (cents / 1200)];
}

// ── Center pitch ──────────────────────────────────────────────────────────────

/**
 * Compute the absolute pitch of the on-screen center degree in Hz.
 *
 * @param {number}   fundamental        Hz assigned to the reference degree
 * @param {number}   degree0toRefCents  Cents from degree 0 to reference degree
 *                                      (= degree0ToRef()[0])
 * @param {number[]} scale              Numeric-cents array (scale[0] === 0)
 * @param {number}   equivInterval      Equivalence interval in cents (e.g. 1200)
 * @param {number}   centerDegree       Scale degree shown at screen centre
 * @returns {number}                    Center pitch in Hz
 */
export function computeCenterPitchHz(
  fundamental,
  degree0toRefCents,
  scale,
  equivInterval,
  centerDegree,
) {
  const degree0Hz = fundamental / 2 ** (degree0toRefCents / 1200);
  const cd = centerDegree || 0;
  const octs = Math.floor(cd / scale.length);
  const red = ((cd % scale.length) + scale.length) % scale.length;
  const centerPitchCents = octs * equivInterval + scale[red];
  return degree0Hz * 2 ** (centerPitchCents / 1200);
}

// ── Real-time anchor ──────────────────────────────────────────────────────────

/**
 * Default tuning-map anchor for real-time mode when no MIDI controller has
 * overridden midiin_central_degree.
 *
 * Returns the nearest integer MIDI note (0–127) to the on-screen centre hex's
 * pitch. Typically lands in the A3–A4 range for normal tunings, giving good
 * coverage either side of the playable register.
 *
 * @param {number}   fundamental        Hz assigned to the reference degree
 * @param {number}   degree0toRefCents  Cents from degree 0 to reference degree
 * @param {number[]} scale              Numeric-cents array (scale[0] === 0)
 * @param {number}   equivInterval      Equivalence interval in cents
 * @param {number}   centerDegree       Scale degree shown at screen centre
 * @returns {number}                    Integer MIDI note, clamped 0–127
 */
export function computeNaturalAnchor(
  fundamental,
  degree0toRefCents,
  scale,
  equivInterval,
  centerDegree,
) {
  const degree0Midi = 69 + (1200 * Math.log2(fundamental / 440) - degree0toRefCents) / 100;
  const cd = centerDegree || 0;
  const octs = Math.floor(cd / scale.length);
  const red = ((cd % scale.length) + scale.length) % scale.length;
  const centerPitchCents = octs * equivInterval + scale[red];
  return Math.max(0, Math.min(127, Math.round(degree0Midi + centerPitchCents / 100)));
}

// ── Static bulk-map anchor ────────────────────────────────────────────────────

/**
 * Choose a musically sensible central MIDI note for a static 128-note map.
 * Searches MIDI notes 57–72 (A3–C5) and picks the one whose 12-EDO pitch
 * is closest in absolute cents to centerPitchHz.
 *
 * @param {number} centerPitchHz  Target pitch in Hz
 * @returns {number}              MIDI note in range 57–72
 */
export function chooseStaticMapCenterMidi(centerPitchHz) {
  let bestMidi = 69;
  let bestError = Infinity;
  for (let midi = 57; midi <= 72; midi++) {
    const hz = 440 * 2 ** ((midi - 69) / 12);
    const centsError = Math.abs(1200 * Math.log2(centerPitchHz / hz));
    if (centsError < bestError) {
      bestError = centsError;
      bestMidi = midi;
    }
  }
  return bestMidi;
}

/**
 * Convert a chosen center MIDI note into the abstract degree-0 anchor used by
 * the static bulk map.
 *
 * The returned value may lie outside 0–127; that is intentional — the map is
 * constructed using it as an offset origin and only played notes are clamped.
 *
 * @param {number} centerMidiNote  MIDI note chosen for the on-screen center
 * @param {number} centerDegree    Scale degree shown at screen centre
 * @returns {number}               Abstract MIDI note for scale degree 0
 */
export function computeStaticMapDegree0(centerMidiNote, centerDegree) {
  return Math.round(centerMidiNote) - (centerDegree || 0);
}
