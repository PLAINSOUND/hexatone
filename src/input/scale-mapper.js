/**
 * scale-mapper.js
 *
 * Maps an absolute pitch (in cents) to the nearest scale degree, with
 * equave-octave wrapping. Used by keys.js when inputRuntime.target === 'scale'.
 *
 * The scale array follows the same convention as settings.scale:
 *   - scale[0] = 0 (unison)
 *   - scale[scale.length - 1] = equave (e.g. 1200 for 2/1)
 *   - All values in cents
 *
 * The "steps" value returned is the integer scale-degree distance from the
 * origin (same unit as bestVisibleCoord / noteToSteps in midi-coord-resolver.js),
 * so it can be fed directly to coordResolver.bestVisibleCoord(steps).
 *
 * Reference pitch: the fundamental at center_degree.
 * refCents = degree0ToRef offset already baked into hexCoordsToCents; here we
 * replicate the calculation the same way Keys does it:
 *   pitch of center_degree = octs * equivInterval + scale[reducedCenter]
 * But for mapping we only need pitch *relative to degree 0*, which is just
 * octs * equivInterval + scale[reducedCenter], where octs = floor(center_degree / scaleLen).
 *
 * Simpler approach used here: work in "reduced cents" — fold the incoming pitch
 * into [0, equave), compare against each scale degree, then count octaves.
 */

/**
 * Find the nearest scale degree to a given pitch.
 *
 * @param {number}   pitchCents    Absolute pitch of the incoming note in cents,
 *                                 measured from the same reference as scale degree 0
 *                                 (i.e. from the fundamental at center_degree = 0).
 * @param {number[]} scale         Scale as cents array: [0, …, last_degree].
 *                                 Does NOT include the equave — that is passed separately.
 *                                 scale.length is the number of degrees per equave.
 * @param {number}   equave        Equave in cents (e.g. 1200).
 * @param {number}   toleranceCents Maximum allowed distance in cents. Ignored when
 *                                 fallback === 'accept'; used to gate when 'discard'.
 * @param {string}   fallback      'discard' | 'accept'. When 'discard', returns null
 *                                 if the nearest degree is farther than toleranceCents.
 *
 * @returns {{ steps: number, distanceCents: number } | null}
 *   steps: integer scale-degree offset from origin (suitable for bestVisibleCoord).
 *   Returns null only when fallback === 'discard' and distance > tolerance.
 */
export function findNearestDegree(pitchCents, scale, equave, toleranceCents, fallback) {
  // settings.scale is [0, …, last_degree_before_equave] — no equave entry.
  // equave is passed separately as equivInterval.
  const numDegrees = scale.length; // e.g. 12 for 12-EDO

  // Which equave does this pitch live in?
  const octave = Math.floor(pitchCents / equave);
  // Reduced pitch within [0, equave)
  let reduced = pitchCents - octave * equave;
  // Guard against floating-point landing exactly on equave
  if (reduced >= equave) {
    reduced -= equave;
  }
  if (reduced < 0) {
    reduced += equave;
  }

  let bestDegree = 0;
  let bestDist = Infinity;

  for (let d = 0; d < numDegrees; d++) {
    // Distance, accounting for wrapping across the equave boundary
    // (e.g. pitch near 0¢ can match the last degree via the short way round).
    let dist = Math.abs(reduced - scale[d]);
    const wrapped = equave - dist;
    if (wrapped < dist) dist = wrapped;

    if (dist < bestDist) {
      bestDist = dist;
      bestDegree = d;
    }
  }

  if (fallback === "discard" && bestDist > toleranceCents) {
    return null;
  }

  // Adjust octave if the best match was across the equave boundary (wrap-around).
  // e.g. pitch near equave might match degree 0 of the next octave.
  let adjustedOctave = octave;
  const distUp = Math.abs(reduced - scale[bestDegree]);
  const distDown = equave - distUp;
  if (distDown < distUp && scale[bestDegree] > reduced) {
    // We wrapped: matched degree is actually in the octave below
    adjustedOctave -= 1;
  } else if (distDown < distUp && scale[bestDegree] < reduced) {
    // We wrapped: matched degree is in the octave above
    adjustedOctave += 1;
  }

  const steps = adjustedOctave * numDegrees + bestDegree;
  return { steps, distanceCents: bestDist };
}
