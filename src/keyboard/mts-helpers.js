/**
 * mts-helpers.js
 *
 * Pure MTS (MIDI Tuning Standard) math — no canvas, no WebMidi, no state.
 *
 * ── Exports ───────────────────────────────────────────────────────────────────
 *
 *   centsToMTS(note, bend)       → [tt, yy, zz]
 *     Convert a float MIDI note (anchor) + cents offset to the 3-byte MTS
 *     representation used in sysex tuning messages.
 *     Re-exported here so callers can import from one place; the implementation
 *     also lives in midi_synth/index.js for internal use.
 *
 *   mtsToMidiFloat([tt, yy, zz]) → float
 *     Reverse: decode a 3-byte MTS value back to a float MIDI note number.
 *
 *   degree0ToRef(reference_degree, scale) → [cents, ratio]
 *     Cents and ratio offset from scale degree 0 to the reference degree.
 *     Used to anchor the tuning map to the user's chosen reference frequency.
 *
 *   computeNaturalAnchor(fundamental, degree0toRef_cents, scale,
 *                        equivInterval, center_degree)          → MIDI note int
 *     Default tuning-map anchor when no controller has set midiin_central_degree.
 *     Returns the nearest MIDI note (0–127) to the on-screen centre hex's pitch.
 *
 *   mtsTuningMap(sysex_type, device_id, tuning_map_number,
 *                tuning_map_degree0, scale, name, equave,
 *                fundamental, degree0toRef_asArray)
 *     Build the full 128-note MTS tuning map.
 *     Returns either:
 *       sysex_type 127 → Array[128] of per-note sysex byte arrays (real-time)
 *       sysex_type 126 → flat sysex byte Array (non-real-time bulk dump)
 */

// ── centsToMTS / mtsToMidiFloat ───────────────────────────────────────────────
// Identical to the copies in midi_synth/index.js.  Kept here so this module is
// self-contained and testable without importing the full synth.

/**
 * Convert a float MIDI note anchor + cents offset to the 3-byte MTS encoding.
 *
 * @param {number} note  Float MIDI note number (e.g. 69.0 = A4)
 * @param {number} bend  Cents offset from `note` (e.g. +50 = quarter-tone up)
 * @returns {number[]}   [tt, yy, zz] — 3 sysex bytes, values 0–127
 */
export function centsToMTS(note, bend) {
  let mts = [0, 0, 0];
  if (typeof note === "number" && typeof bend === "number") {
    if (note >= 0) {
      mts[0] = Math.floor(note);
    } else {
      mts[0] = -1 * Math.floor(-1 * note);
      if (mts[0] > note) mts[0] -= 1;
    }
    let total_bend = (bend * 0.01) + note - mts[0];
    let shift = total_bend >= 0
      ? Math.floor(total_bend)
      : -1 * Math.floor(-1 * total_bend);
    if (shift > total_bend) shift -= 1;
    const remainder = total_bend - shift;
    mts[0] += shift;
    if (mts[0] < 0) {
      mts = [0, 0, 0];
    } else if (mts[0] > 127) {
      mts = [127, 127, 126];
    } else {
      let fine = Math.round(16384 * remainder);
      if (fine === 16384) fine = 16383;
      mts[1] = Math.floor(fine / 128);
      mts[2] = Math.round(128 * ((fine / 128) - mts[1]));
      if (mts[2] === 128) mts[2] = 127;
    }
  }
  return mts;
}

/**
 * Decode a 3-byte MTS value back to a float MIDI note number.
 *
 * @param {number[]} mts  [tt, yy, zz]
 * @returns {number}      float MIDI note (e.g. 69.5 = 50 cents above A4)
 */
export function mtsToMidiFloat(mts) {
  return mts[0] + (mts[1] / 128) + (mts[2] / 16384);
}

// ── Tuning-map construction helpers ──────────────────────────────────────────

/**
 * Compute the cents and ratio offset from scale degree 0 to the reference degree.
 *
 * @param {number}   reference_degree  Scale degree designated as the reference (0 = tonic)
 * @param {number[]} scale             Numeric-cents scale array (scale[0] = 0)
 * @returns {[number, number]}         [cents_from_0_to_ref, ratio_from_0_to_ref]
 */
export function degree0ToRef(reference_degree, scale) {
  let degree0_to_reference_asArray = [0, 1];
  if (reference_degree > 0) {
    degree0_to_reference_asArray[0] = scale[reference_degree];
    degree0_to_reference_asArray[1] =
      2 ** (degree0_to_reference_asArray[0] / 1200);
  }
  return degree0_to_reference_asArray;
}

/**
 * Default tuning-map anchor when no MIDI controller has set midiin_central_degree.
 * Returns the nearest MIDI note to the frequency of the on-screen centre hex,
 * which is typically in the A3–A4 range and gives good coverage either side.
 *
 * @param {number}   fundamental         Hz assigned to reference_degree
 * @param {number}   degree0toRef_cents  cents from degree 0 to reference degree
 *                                       (= degree0ToRef()[0])
 * @param {number[]} scale               numeric-cents scale array (scale[0] = 0)
 * @param {number}   equivInterval       equivalence interval in cents (e.g. 1200)
 * @param {number}   center_degree       scale degree shown at screen centre
 * @returns {number}                     integer MIDI note number, clamped 0–127
 */
export function computeNaturalAnchor(
  fundamental,
  degree0toRef_cents,
  scale,
  equivInterval,
  center_degree,
) {
  const degree0_midi =
    69 + (1200 * Math.log2(fundamental / 440) - degree0toRef_cents) / 100;
  const cd = center_degree || 0;
  const octs = Math.floor(cd / scale.length);
  const red = ((cd % scale.length) + scale.length) % scale.length;
  const center_pitch_cents = octs * equivInterval + scale[red];
  return Math.max(
    0,
    Math.min(127, Math.round(degree0_midi + center_pitch_cents / 100)),
  );
}

// ── mtsTuningMap ─────────────────────────────────────────────────────────────

/**
 * Build the 128-note MTS tuning map for a given scale and anchor.
 *
 * @param {number}   sysex_type          127 = real-time, 126 = non-real-time bulk
 * @param {number}   device_id           MTS device ID (0–127, 127 = broadcast)
 * @param {number}   tuning_map_number   Which tuning-map slot to fill (0–127)
 * @param {number}   tuning_map_degree0  MIDI note number that maps to scale degree 0
 * @param {number[]} scale               numeric-cents array (scale[0] = 0)
 * @param {string}   name                Preset name (truncated/padded to 16 ASCII chars)
 * @param {number}   equave              Equivalence interval in cents (e.g. 1200)
 * @param {number}   fundamental         Hz assigned to the reference degree
 * @param {number[]} degree0toRef_asArray [cents, ratio] from degree0ToRef()
 *
 * @returns {number[][]|number[]}
 *   sysex_type 127 → Array[128] of per-note sysex byte arrays (real-time)
 *   sysex_type 126 → single flat byte Array including checksum (bulk dump)
 */
export function mtsTuningMap(
  sysex_type,
  device_id,
  tuning_map_number,
  tuning_map_degree0,
  scale,
  name,
  equave,
  fundamental,
  degree0toRef_asArray,
) {
  const fundamental_cents = 1200 * Math.log2(fundamental / 440);
  const degree_0_cents = fundamental_cents - degree0toRef_asArray[0];
  const map_offset = degree_0_cents - 100 * (tuning_map_degree0 - 69);

  // Build the 128 MTS tuning entries (shared by both sysex types).
  const mts_data = [];
  for (let i = 0; i < 128; i++) {
    mts_data[i] = [127, 127, 127]; // default: no tuning data
    const target_cents =
      scale[(i - tuning_map_degree0 + 128 * scale.length) % scale.length] +
      map_offset +
      equave *
        (Math.floor(
          (i - tuning_map_degree0 + 128 * scale.length) / scale.length,
        ) -
          128);
    if (typeof target_cents === "number") {
      mts_data[i] = centsToMTS(tuning_map_degree0, target_cents);
    }
  }

  if (parseInt(sysex_type) === 127) {
    // ── Real-time single-note tuning change (one message per note) ────────────
    // Each entry: [127, device_id, 8, 2, map#, 1, note, tt, yy, zz]
    const header = [127, device_id, 8, 2, tuning_map_number, 1];
    const sysex = [];
    for (let j = 0; j < 128; j++) {
      sysex[j] = [...header, j, ...mts_data[j]];
    }
    return sysex;

  } else if (parseInt(sysex_type) === 126) {
    // ── Non-real-time bulk tuning dump (single message, 128 notes) ───────────

    // Clamp entries that fell out of MTS range.
    // [127,127,127] is reserved as "no tuning data" — replace with max valid.
    for (let i = 0; i < 128; i++) {
      if (
        mts_data[i][0] === 127 &&
        mts_data[i][1] === 127 &&
        mts_data[i][2] === 127
      ) {
        mts_data[i] = [127, 127, 126];
      }
    }

    // Encode preset name as 16 ASCII bytes (space-padded, non-printable → space).
    const name_chars = Array.from(name || "");
    const ascii_name = Array.from({ length: 16 }, (_, i) => {
      const code = i < name_chars.length ? name_chars[i].charCodeAt(0) : 32;
      return code > 31 && code < 128 ? code : 32;
    });

    // Header: [126, device_id, 8, 1, map#, ...16 name bytes]
    const header = [126, device_id, 8, 1, tuning_map_number, ...ascii_name];

    // Payload: header bytes + 128×3 tuning bytes
    const sysex = [...header];
    for (let i = 0; i < 128; i++) {
      sysex.push(...mts_data[i]);
    }

    // Checksum: XOR of all bytes from index 1 onward, masked to 7 bits.
    // sysex[0] is 126 (manufacturer byte, excluded from checksum).
    let checksum = 0;
    for (let i = 1; i < sysex.length; i++) checksum ^= sysex[i];
    sysex.push(checksum & 0x7f);

    return sysex;
  }
}
