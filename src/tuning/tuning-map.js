/**
 * tuning-map.js
 *
 * Build and patch the 128-entry MTS tuning map from scale + anchor data.
 * No canvas, no WebMidi, no state.
 *
 * Exports:
 *   buildTuningMapEntries(degree0, scale, equave, fundamental,
 *                         degree0toRefAsArray)    → number[][]  (Array[128] of [tt,yy,zz])
 *   patchTuningEntry(entries, midiNote, triplet)  → number[][]  (immutable copy)
 *   mtsTuningMap(sysexType, deviceId, mapNumber,
 *                degree0, scale, name, equave,
 *                fundamental, degree0toRefAsArray) → number[][] | number[]
 */

import { centsToMTS, buildRealtimeSingleNoteMessage, buildBulkDumpMessage } from "./mts-format.js";

// ── buildTuningMapEntries ─────────────────────────────────────────────────────

/**
 * Build the raw 128-entry tuning data for a tuning map.
 *
 * Each entry is a [tt, yy, zz] MTS triplet representing the target pitch for
 * that MIDI note number. The mapping wraps the scale cyclically around the
 * anchor note (tuning_map_degree0), octave-shifted by the equivalence interval.
 *
 * @param {number}     tuningMapDegree0   MIDI note number that maps to scale degree 0
 * @param {number[]}   scale              Numeric-cents array (scale[0] === 0)
 * @param {number}     equave             Equivalence interval in cents (e.g. 1200)
 * @param {number}     fundamental        Hz assigned to the reference degree
 * @param {number[]}   degree0toRefAsArray  [cents, ratio] from degree0ToRef()
 * @returns {number[][]}                  Array[128] of [tt, yy, zz]
 */
export function buildTuningMapEntries(
  tuningMapDegree0,
  scale,
  equave,
  fundamental,
  degree0toRefAsArray,
  octaveOffset = 0,
) {
  // Express fundamental in cents relative to A4 = MIDI 69.
  // degree0toRefAsArray[0] is the cents offset from degree 0 to the reference degree,
  // so subtracting it gives the cents position of degree 0 itself.
  const fundamentalCents = 1200 * Math.log2(fundamental / 440);
  const degree0Cents = fundamentalCents - degree0toRefAsArray[0] + octaveOffset * equave;

  // map_offset: cents distance between degree 0 and MIDI note tuningMapDegree0
  // assuming 12-EDO spacing (100 cents/semitone) for carrier note placement.
  const mapOffset = degree0Cents - 100 * (tuningMapDegree0 - 69);

  const mtsData = [];
  for (let i = 0; i < 128; i++) {
    // Default to silence sentinel — will be clamped in bulk dump serialisation.
    mtsData[i] = [127, 127, 127];

    // Wrap i around the scale, offset by the anchor, in a large-positive modulus
    // to avoid negative remainder issues.
    const scaleLen = scale.length;
    const idx = (i - tuningMapDegree0 + 128 * scaleLen) % scaleLen;
    const octaves = Math.floor((i - tuningMapDegree0 + 128 * scaleLen) / scaleLen) - 128;
    const targetCents = scale[idx] + mapOffset + equave * octaves;

    if (typeof targetCents === "number") {
      mtsData[i] = centsToMTS(tuningMapDegree0, targetCents);
    }
  }

  return mtsData;
}

// ── patchTuningEntry ──────────────────────────────────────────────────────────

/**
 * Return a copy of tuning-map entries with one note replaced.
 * The original array and all unmodified entries are not mutated.
 *
 * @param {number[][]} entries   Array[128] of [tt, yy, zz]
 * @param {number}     midiNote  Slot to replace (0–127)
 * @param {number[]}   triplet   New [tt, yy, zz] value
 * @returns {number[][]}         Copied array with one entry patched
 */
export function patchTuningEntry(entries, midiNote, triplet) {
  const next = entries.map((entry) => [...entry]);
  next[midiNote] = [...triplet];
  return next;
}

// ── mtsTuningMap ─────────────────────────────────────────────────────────────

/**
 * Build the complete 128-note MTS tuning map for a given scale and anchor,
 * serialised for the requested transport mode.
 *
 * @param {number}     sysexType          127 = real-time, 126 = non-real-time bulk
 * @param {number}     deviceId           MTS device ID (0–127, 127 = broadcast)
 * @param {number}     mapNumber          Tuning-map slot to fill (0–127)
 * @param {number}     tuningMapDegree0   MIDI note number that maps to scale degree 0
 * @param {number[]}   scale              Numeric-cents array (scale[0] === 0)
 * @param {string}     name               Preset name (truncated to 16 ASCII chars)
 * @param {number}     equave             Equivalence interval in cents
 * @param {number}     fundamental        Hz assigned to the reference degree
 * @param {number[]}   degree0toRefAsArray  [cents, ratio] from degree0ToRef()
 *
 * @returns {number[][] | number[]}
 *   sysexType 127 → Array[128] of per-note sysex byte arrays (real-time)
 *   sysexType 126 → single flat byte array including checksum (bulk dump)
 */
export function mtsTuningMap(
  sysexType,
  deviceId,
  mapNumber,
  tuningMapDegree0,
  scale,
  name,
  equave,
  fundamental,
  degree0toRefAsArray,
  octaveOffset = 0,
) {
  const mtsData = buildTuningMapEntries(
    tuningMapDegree0,
    scale,
    equave,
    fundamental,
    degree0toRefAsArray,
    octaveOffset,
  );

  if (parseInt(sysexType) === 127) {
    // Real-time: one single-note tuning change message per MIDI note.
    return Array.from({ length: 128 }, (_, j) =>
      buildRealtimeSingleNoteMessage(deviceId, mapNumber, j, mtsData[j]),
    );
  }

  if (parseInt(sysexType) === 126) {
    // Non-real-time: one bulk dump message for all 128 notes.
    return buildBulkDumpMessage(deviceId, mapNumber, name, mtsData);
  }
}
