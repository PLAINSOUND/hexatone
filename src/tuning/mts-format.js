/**
 * mts-format.js
 *
 * Pure MTS (MIDI Tuning Standard) byte-level encoding and decoding.
 * No canvas, no WebMidi, no state — all functions are referentially transparent.
 *
 * Exports:
 *   centsToMTS(note, bend)          → [tt, yy, zz]
 *   mtsToMidiFloat([tt, yy, zz])    → float
 *   sanitizeBulkDumpName(name)      → string (≤16 printable ASCII chars)
 *   resolveBulkDumpName(override, short, fallback) → string
 *   buildRealtimeSingleNoteMessage(deviceId, mapNumber, midiNote, triplet) → number[]
 *   buildBulkDumpMessage(deviceId, mapNumber, name, entries)               → number[]
 */

// ── centsToMTS / mtsToMidiFloat ───────────────────────────────────────────────

/**
 * Convert a float MIDI note anchor + cents offset to the 3-byte MTS encoding.
 *
 * The MTS 3-byte format encodes a target pitch as:
 *   tt        — MIDI note number (0–127), the semitone floor of the target pitch
 *   yy, zz    — 14-bit fine-tune (0–16383) split as yy = MSB (7 bits), zz = LSB (7 bits)
 *               where the full 14-bit value represents 0–100 cents above tt.
 *
 * @param {number} note  Float MIDI note number used as carrier (e.g. 69.0 = A4)
 * @param {number} bend  Cents offset from `note` (may be negative or > 100)
 * @returns {number[]}   [tt, yy, zz] — three 7-bit sysex bytes, values 0–127
 */
export function centsToMTS(note, bend) {
  let mts = [0, 0, 0];
  if (typeof note === "number" && typeof bend === "number") {
    // Compute integer semitone floor, handling negative notes correctly.
    if (note >= 0) {
      mts[0] = Math.floor(note);
    } else {
      mts[0] = -1 * Math.floor(-1 * note);
      if (mts[0] > note) mts[0] -= 1;
    }

    // total_bend is the full pitch offset in semitones from mts[0],
    // incorporating both the fractional part of note and the cents bend.
    const total_bend = (bend * 0.01) + note - mts[0];

    // shift absorbs any whole-semitone component of total_bend into mts[0].
    let shift = total_bend >= 0
      ? Math.floor(total_bend)
      : -1 * Math.floor(-1 * total_bend);
    if (shift > total_bend) shift -= 1;

    const remainder = total_bend - shift;
    mts[0] += shift;

    if (mts[0] < 0) {
      // Below MIDI range — clamp to silence sentinel
      mts = [0, 0, 0];
    } else if (mts[0] > 127) {
      // Above MIDI range — clamp to maximum representable pitch
      mts = [127, 127, 126];
    } else {
      let fine = Math.round(16384 * remainder);
      if (fine === 16384) fine = 16383; // avoid overflow at exactly 1 semitone
      mts[1] = Math.floor(fine / 128);  // MSB (7 bits)
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

// ── Name helpers ──────────────────────────────────────────────────────────────

/**
 * Trim a name string to ≤16 printable ASCII characters (codes 32–127).
 * Non-ASCII and control characters are silently dropped.
 *
 * @param {string|null|undefined} name
 * @returns {string}  safe name, may be empty string
 */
export function sanitizeBulkDumpName(name) {
  return Array.from(String(name ?? ""))
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 31 && code < 128;
    })
    .slice(0, 16)
    .join("");
}

/**
 * Choose the best available name for a bulk dump preset, in priority order:
 *   1. explicit override (even if empty string — intentional blank name)
 *   2. short_description from settings
 *   3. fallback name (usually settings.name)
 *
 * All candidates are passed through sanitizeBulkDumpName.
 *
 * @param {string|null|undefined} overrideName
 * @param {string|null|undefined} shortDescription
 * @param {string|null|undefined} fallbackName
 * @returns {string}
 */
export function resolveBulkDumpName(overrideName, shortDescription, fallbackName) {
  if (overrideName !== null && overrideName !== undefined) {
    return sanitizeBulkDumpName(overrideName);
  }
  if (shortDescription) {
    return sanitizeBulkDumpName(shortDescription);
  }
  return sanitizeBulkDumpName(fallbackName);
}

// ── Message builders ──────────────────────────────────────────────────────────

/**
 * Build one real-time single-note tuning message payload (MTS SysEx type 0x7F 0x08 0x02).
 *
 * @param {number}   deviceId         MTS device ID (0–127, 127 = broadcast)
 * @param {number}   mapNumber        Tuning-map slot (0–127)
 * @param {number}   midiNote         Target MIDI note / carrier note number
 * @param {number[]} triplet          [tt, yy, zz] from centsToMTS
 * @returns {number[]}                Full real-time message payload (8 bytes)
 */
export function buildRealtimeSingleNoteMessage(deviceId, mapNumber, midiNote, triplet) {
  return [127, deviceId, 8, 2, mapNumber, 1, midiNote, ...triplet];
}

/**
 * Serialize 128 tuning entries as a non-real-time bulk dump message
 * (MTS SysEx type 0x7E 0x08 0x01).
 *
 * The sentinel triplet [127, 127, 127] (meaning "no change") is replaced
 * with [127, 127, 126] which is the highest representable pitch, as the
 * bulk dump format does not support per-note no-change sentinels.
 *
 * @param {number}     deviceId         MTS device ID (0–127, 127 = broadcast)
 * @param {number}     mapNumber        Tuning-map slot (0–127)
 * @param {string}     name             Preset name (truncated/padded to 16 ASCII chars)
 * @param {number[][]} entries          Array[128] of [tt, yy, zz]
 * @returns {number[]}                  Full bulk-dump byte payload including checksum
 */
export function buildBulkDumpMessage(deviceId, mapNumber, name, entries) {
  // Replace silence sentinels — [127,127,127] is not valid in bulk dump format.
  const clampedEntries = entries.map((triplet) =>
    triplet[0] === 127 && triplet[1] === 127 && triplet[2] === 127
      ? [127, 127, 126]
      : triplet
  );

  // Build 16-byte ASCII name field, space-padded.
  const nameChars = Array.from(name || "");
  const asciiName = Array.from({ length: 16 }, (_, i) => {
    const code = i < nameChars.length ? nameChars[i].charCodeAt(0) : 32;
    return code > 31 && code < 128 ? code : 32;
  });

  const sysex = [126, deviceId, 8, 1, mapNumber, ...asciiName];
  for (let i = 0; i < 128; i++) {
    sysex.push(...clampedEntries[i]);
  }

  // XOR checksum over all bytes after the first (device ID byte onward).
  let checksum = 0;
  for (let i = 1; i < sysex.length; i++) checksum ^= sysex[i];
  sysex.push(checksum & 0x7f);

  return sysex;
}
