/**
 * lumatone-export.js
 *
 * Generates Lumatone .ltn layout files from Hexatone settings.
 *
 * The Lumatone is a 280-key isomorphic keyboard: 5 boards × 56 keys each.
 * Each key is assigned a MIDI note (0–127), MIDI channel (1–16), RGB colour,
 * and key type.
 *
 * ── Global geometry ───────────────────────────────────────────────────────────
 *
 * The 5 boards form a continuous hex surface. Board b offsets each key by
 *   globalCol = localCol + 12 · b
 *   globalRow = localRow +  2 · b
 * so board b+1's row 0 is physically adjacent to board b's row 3.
 *
 * Pitch step from global coordinates:
 *   step(col, row) = (col − row) / 2 · rSteps + row · drSteps
 * where rSteps = steps per right hex move, drSteps = steps per down-right move.
 *
 * ── Slot model ────────────────────────────────────────────────────────────────
 *
 *   slot = channel_0indexed × 128 + note   (channel 0-indexed, note 0–127)
 *
 * A central key is anchored to a chosen slot:
 *   centralSlot = centralChannel_0idx × 128 + centralNote
 *   Default: channel 3, note 60 → slot 444 (MIDI ch 4, C4)
 *
 * Every other key is offset by its pitch-step distance from the central key:
 *   slot(b, k) = centralSlot + stepsFromCentral(b, k)
 *
 * ── Colour adjustment ─────────────────────────────────────────────────────────
 *
 * Colours are adjusted for the Lumatone display using the database-driven
 * okLab RBF transfer in color-transfer.js.  Known screen→Lumatone pairs are
 * returned exactly; everything else is smoothly interpolated.
 *
 * Pass { colorTransfer: false } to disable all colour adjustment.
 */

import { transferColor, LUMATONE_TONIC, LUMATONE_TONIC_OTHER } from './color-transfer.js';

// ── Physical geometry ─────────────────────────────────────────────────────────

/**
 * Physical (col, row) position of each of the 56 keys per board.
 *
 * Keys are numbered left-to-right, top-to-bottom within each board.
 * The board has 11 rows of 2, 5, 6, 6, 6, 6, 6, 6, 6, 5, 2 keys.
 *
 * The hex grid uses a staggered column scheme: even rows have keys in even
 * columns; odd rows have keys in odd columns. Both are 0-indexed, so columns
 * run 0–11 across the board width (though not all columns are used in every row).
 *
 * Pitch step formula (scale-agnostic):
 *   step(col, row) = (col − row) / 2 × rSteps + row × drSteps
 *
 * This encodes the isomorphic layout:
 *   Right within a row   (col+2, row)   → +rSteps
 *   Down-right to next row (col+1, row+1) → +drSteps
 *   Down-left to next row  (col−1, row+1) → drSteps − rSteps
 *
 * Note: (col − row) is always even because col and row share the same parity.
 *
 * stepsFromCentral(b, k) =
 *   step(col_k, row_k) − step(REF_COL, REF_ROW) + (b − 2) × equivSteps
 */
export const BOARD_KEY_COORDS = [
  [0, 0], [2, 0],                                          // row  0  (keys  0– 1)
      [1, 1], [3, 1], [5, 1], [7, 1], [9, 1],             // row  1  (keys  2– 6)
  [0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2],        // row  2  (keys  7–12)
      [1, 3], [3, 3], [5, 3], [7, 3], [9, 3], [11, 3],    // row  3  (keys 13–18)
  [0, 4], [2, 4], [4, 4], [6, 4], [8, 4], [10, 4],        // row  4  (keys 19–24)
      [1, 5], [3, 5], [5, 5], [7, 5], [9, 5], [11, 5],    // row  5  (keys 25–30)  key 27 = default central (5, 5)
  [0, 6], [2, 6], [4, 6], [6, 6], [8, 6], [10, 6],        // row  6  (keys 31–36)
      [1, 7], [3, 7], [5, 7], [7, 7], [9, 7], [11, 7],    // row  7  (keys 37–42)
  [0, 8], [2, 8], [4, 8], [6, 8], [8, 8], [10, 8],        // row  8  (keys 43–48)
              [3, 9], [5, 9], [7, 9], [9, 9], [11, 9],    // row  9  (keys 49–53)
                                  [8,10], [10,10],         // row 10  (keys 54–55)
];

/** Column and row of the central reference key on its own board (board 2, key 27). */
const REF_COL = 5;
const REF_ROW = 5;

/**
 * Compute the pitch step of key k on board b relative to the central key
 * (default board 2, key 27), using the full 5-board global hex geometry.
 *
 * Each board b offsets its keys by col += 12·b, row += 2·b, so adjacent boards
 * connect seamlessly: board b+1's row 0 meets board b's row 3 at the hex edge.
 *
 * Step formula:
 *   globalCol = BOARD_KEY_COORDS[k][0] + 12 · b
 *   globalRow = BOARD_KEY_COORDS[k][1] +  2 · b
 *   step = (globalCol − globalRow) / 2 · rSteps + globalRow · drSteps
 *   stepsFromCentral = step(k, b) − step(centralKeyIndex, centralBoard)
 *
 * @param {number} k             - key index within the board (0–55)
 * @param {number} b             - board index (0–4)
 * @param {number} rSteps        - pitch steps per right hex move (col+2, same row)
 * @param {number} drSteps       - pitch steps per down-right hex move (col+1, row+1)
 * @param {number} centralBoard  - board index of the reference (anchor) key
 * @param {number} centralKey    - key index of the reference (anchor) key
 * @returns {number}
 */
export function keyStepsFromRef(k, b, rSteps, drSteps,
                                centralBoard = DEFAULT_CENTRAL_BOARD,
                                centralKey   = DEFAULT_CENTRAL_KEY) {
  function globalStep(board, key) {
    const [col, row] = BOARD_KEY_COORDS[key];
    const gc = col + 12 * board;
    const gr = row +  2 * board;
    return (gc - gr) / 2 * rSteps + gr * drSteps;
  }
  return globalStep(b, k) - globalStep(centralBoard, centralKey);
}

/** Default central Lumatone key: board 2, key 27. */
export const DEFAULT_CENTRAL_BOARD   = 2;
export const DEFAULT_CENTRAL_KEY     = 27;

/**
 * Default MIDI anchor: MIDI channel 4 (1-indexed, i.e. index 3 in 0-indexed),
 * note 60 (C4) → slot 3 × 128 + 60 = 444.
 *
 * centralChannel is stored and accepted everywhere as a 0-indexed value
 * (0 = MIDI ch 1, …, 15 = MIDI ch 16) to keep slot arithmetic simple.
 */
export const DEFAULT_CENTRAL_CHANNEL = 3;   // 0-indexed → MIDI ch 4
export const DEFAULT_CENTRAL_NOTE    = 60;

/**
 * The slot pool spans all 16 MIDI channels: 0–2047 (16 × 128).
 *   slot = channel_0indexed × 128 + note
 * Channels 9–16 (slots 1024–2047) carry the same transpositions as channels 1–8
 * and serve as polyphony alternatives: two keys that sound the same pitch can
 * be sent on ch 4 and ch 12 respectively, keeping note numbers identical but
 * giving the synth independent note-on/off voices.
 */
export const SLOT_MAX = 2047;  // 16 channels × 128 notes − 1

// ── Colour helpers ────────────────────────────────────────────────────────────

/**
 * Convert a CSS hex colour (#rrggbb or #rgb) to the 6-character uppercase hex
 * string required by the .ltn format.  Returns "000000" for unrecognised input.
 *
 * @param {string} cssColor
 * @returns {string}  e.g. "E1E1F8"
 */
export function cssToLtnColor(cssColor) {
  if (!cssColor) return '000000';
  const s = cssColor.trim().toUpperCase();
  const hex6 = s.match(/^#([0-9A-F]{6})$/);
  if (hex6) return hex6[1];
  const hex3 = s.match(/^#([0-9A-F])([0-9A-F])([0-9A-F])$/);
  if (hex3) return hex3[1].repeat(2) + hex3[2].repeat(2) + hex3[3].repeat(2);
  return '000000';
}

// ── Slot assignment ───────────────────────────────────────────────────────────

/**
 * Given an absolute pitch value and a central channel, return the (note, ch_0idx)
 * pair that correctly encodes that pitch in the equave-per-channel model.
 *
 * Model: pitch(note, ch_0idx) = note + ch_0idx × equivSteps
 *        where note ∈ [0, 127] and ch_0idx ∈ [0, 15].
 *
 * We search for the ch_0idx closest to centralChannel_0idx such that
 * note = absolutePitch − ch_0idx × equivSteps lands in [0, 127].
 *
 * This correctly handles equave boundaries: going one rStep to the left of
 * note=7 on ch=4 stays at the same degree (note=7−rSteps wrapped within the
 * equave) on ch=3 rather than landing on note=126 (which would be the wrong
 * result of simply subtracting from the slot number).
 *
 * @param {number} absolutePitch      - centralNote + centralChannel×equivSteps + stepsFromCentral
 * @param {number} centralChannel_0idx
 * @param {number} equivSteps
 * @returns {{note: number, ch0: number} | null}  null if no valid channel found
 */
export function equaveNoteChannel(absolutePitch, centralChannel_0idx, equivSteps) {
  for (let dk = 0; dk <= 15; dk++) {
    for (const k of (dk === 0 ? [0] : [-dk, +dk])) {
      const ch0  = centralChannel_0idx + k;
      const note = absolutePitch - ch0 * equivSteps;
      if (ch0 >= 0 && ch0 <= 15 && note >= 0 && note <= 127) {
        return { note, ch0 };
      }
    }
  }
  return null;
}

/**
 * Assign a unique (note, channel) slot to every one of the 280 Lumatone keys.
 *
 * Pitch model — each MIDI channel sounds one equave higher than the previous
 * at the same note number:
 *
 *   pitch(note, ch_0idx) = note + ch_0idx × equivSteps
 *
 * For a key with stepsFromCentral = S:
 *   absolutePitch = centralNote + centralChannel_0idx × equivSteps + S
 *   (note, ch_0idx) chosen so pitch(note, ch_0idx) = absolutePitch,
 *   preferring the channel closest to centralChannel.
 *
 * Polyphony: the Lumatone geometry guarantees at most 2 keys share a pitch.
 * The duplicate gets the same note on a channel 8 higher (ch+8 mirrors channels
 * 1–8 onto 9–16 with identical tuning), provided that stays within ch 1–16.
 *
 * The central key is processed first so it always keeps its anchor (centralNote,
 * centralChannel).
 *
 * @param {number} rSteps              - pitch steps per right hex move
 * @param {number} drSteps             - pitch steps per down-right hex move
 * @param {number} equivSteps          - pitch steps per equave (= scale length)
 * @param {number} centralChannel_0idx - MIDI channel for the central key, 0-indexed
 * @param {number} centralNote         - MIDI note for the central key (0–127)
 * @param {number} centralBoard        - board index of the central key (0–4)
 * @param {number} centralKeyIndex     - key index of the central key (0–55)
 * @returns {Array<Array<number>>}     slotGrid[board][key] = slot (ch_0idx×128 + note), or −1
 */
export function assignSlots(rSteps, drSteps, equivSteps,
                            centralChannel_0idx, centralNote,
                            centralBoard     = DEFAULT_CENTRAL_BOARD,
                            centralKeyIndex  = DEFAULT_CENTRAL_KEY) {
  const centralAbsP = centralNote + centralChannel_0idx * equivSteps;
  const used        = new Set();
  const slotGrid    = Array.from({ length: 5 }, () => new Array(56).fill(-1));

  function assign(b, k) {
    const S    = keyStepsFromRef(k, b, rSteps, drSteps, centralBoard, centralKeyIndex);
    const absP = centralAbsP + S;
    const nc   = equaveNoteChannel(absP, centralChannel_0idx, equivSteps);
    if (!nc) return;                       // no valid channel — key stays disabled

    let slot = nc.ch0 * 128 + nc.note;
    if (used.has(slot)) {
      // Polyphony duplicate: same note, channel +8 (mirrors ch 1–8 → 9–16).
      const polySlot = slot + 8 * 128;
      if (polySlot <= SLOT_MAX) slot = polySlot;
      else return;                         // polyphony overflow — skip
    }
    slotGrid[b][k] = slot;
    used.add(slot);
  }

  // Central key first — guarantees it keeps its anchor slot.
  assign(centralBoard, centralKeyIndex);

  for (let b = 0; b < 5; b++) {
    for (let k = 0; k < 56; k++) {
      if (b === centralBoard && k === centralKeyIndex) continue;
      assign(b, k);
    }
  }

  return slotGrid;
}

// ── Core mapping function ─────────────────────────────────────────────────────

/**
 * Compute the Lumatone key data for all 5 boards from Hexatone settings.
 *
 * @param {object} settings
 * @param {number}  settings.equivSteps          - scale steps per equave
 * @param {number}  settings.rSteps              - pitch steps per right move on the hex grid
 * @param {number}  settings.drSteps             - pitch steps per down-right move (col+1, row+1) on the hex grid
 * @param {Array}   settings.note_colors         - CSS colours indexed by degree (1-based)
 * @param {string}  settings.fundamental_color   - CSS colour for degree 0
 *
 * @param {object} [options]
 * @param {number}  [options.centralBoard=2]       - Lumatone board of the central key (0–4)
 * @param {number}  [options.centralKeyIndex=27]   - Key index within that board (0–55)
 * @param {number}  [options.centralChannel=3]     - MIDI channel for degree 0, 0-indexed (3 = MIDI ch 4)
 * @param {number}  [options.centralNote=60]       - MIDI note for degree 0
 * @param {boolean} [options.colorTransfer=true]   - Apply screen→Lumatone colour transfer
 *
 * @returns {Array<Array<{note, channel, color, ktyp}>>}
 *   Outer: 5 boards.  Inner: 56 keys.
 *   note 0–127, channel 1–16 (1-indexed), color 6-char hex, ktyp 1=active / 0=disabled.
 */
export function hexatoneMappingForLumatone(settings, options = {}) {
  const {
    equivSteps,
    rSteps,
    drSteps,
    note_colors       = [],
    fundamental_color = '#ffffff',
  } = settings;

  const {
    centralBoard      = DEFAULT_CENTRAL_BOARD,
    centralKeyIndex   = DEFAULT_CENTRAL_KEY,
    centralChannel    = DEFAULT_CENTRAL_CHANNEL,
    centralNote       = DEFAULT_CENTRAL_NOTE,
    colorTransfer     = true,
  } = options;

  const centralSlot = centralChannel * 128 + centralNote;

  // Collision-free slot assignment using the equave-per-channel pitch model.
  const slotGrid = assignSlots(rSteps, drSteps, equivSteps, centralChannel, centralNote, centralBoard, centralKeyIndex);

  const adjustColor = colorTransfer ? transferColor : (css) => css;

  const boards = [];

  for (let b = 0; b < 5; b++) {
    const boardKeys = [];

    for (let k = 0; k < 56; k++) {
      const slot = slotGrid[b][k];

      if (slot < 0 || slot > SLOT_MAX) {
        boardKeys.push({ note: 0, channel: 1, color: '000000', ktyp: 0 });
        continue;
      }

      const note    = slot % 128;
      const channel = Math.floor(slot / 128) + 1;  // 1-indexed (1–16) for .ltn

      // Degree is based on actual pitch steps from the central key.
      const stepsFromCentral = keyStepsFromRef(k, b, rSteps, drSteps, centralBoard, centralKeyIndex);
      const degree = ((stepsFromCentral % equivSteps) + equivSteps) % equivSteps;

      if (degree === 0 && colorTransfer) {
        // Tonic keys use Lumatone-only colours that are not derived from any
        // screen colour.  The reference key itself (stepsFromCentral === 0) gets
        // the primary tonic colour; all other equave transpositions of the same
        // pitch class get the slightly darker secondary colour.
        const tonicColor = stepsFromCentral === 0 ? LUMATONE_TONIC : LUMATONE_TONIC_OTHER;
        boardKeys.push({ note, channel, color: cssToLtnColor(tonicColor), ktyp: 1 });
        continue;
      }

      const cssColor = degree === 0
        ? fundamental_color
        : (note_colors[degree] || '#000000');

      boardKeys.push({ note, channel, color: cssToLtnColor(adjustColor(cssColor)), ktyp: 1 });
    }

    boards.push(boardKeys);
  }

  return boards;
}

// ── .ltn file serialiser ──────────────────────────────────────────────────────

/**
 * Global footer appended to every .ltn file (Lumatone factory defaults).
 */
const LTN_FOOTER = [
  'AfterTouchActive=1',
  'LightOnKeyStrokes=0',
  'InvertFootController=0',
  'InvertSustain=0',
  'ExprCtrlSensivity=0',
  'VelocityIntrvlTbl=1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 60 61 62 63 64 66 67 68 70 71 72 73 74 76 77 79 81 82 84 86 88 90 92 94 96 98 101 104 107 111 115 119 124 129 134 140 146 152 159 170 171 175 180 185 190 195 200 205 210 215 220 225 230 235 240 245 250 255 260 265 270 275 280 285 290 295 300 305 310 ',
  'NoteOnOffVelocityCrvTbl=0 0 0 0 0 1 1 1 1 2 2 2 2 3 3 3 3 4 4 4 4 5 5 5 5 6 6 6 7 7 7 8 8 8 8 9 9 9 10 10 10 11 11 11 12 12 12 13 13 14 14 14 15 15 15 16 16 17 17 18 18 18 19 19 20 20 21 21 21 22 23 23 23 24 25 25 26 26 27 27 28 29 29 30 30 31 32 32 33 34 34 35 36 37 38 38 39 40 41 42 43 44 45 46 47 49 50 51 53 54 56 58 60 63 66 71 77 82 89 94 99 105 109 112 116 120 123 127 ',
  'FaderConfig=1 2 2 2 3 3 3 4 4 4 5 5 6 6 6 7 7 7 8 8 9 9 9 10 10 10 11 11 12 12 12 13 13 14 14 14 15 15 16 16 17 17 17 18 18 19 19 20 20 20 21 21 22 22 23 23 24 24 25 25 26 26 27 27 28 28 29 29 30 31 31 32 32 33 33 34 35 35 36 37 37 38 39 39 40 41 41 42 43 44 45 45 46 47 48 49 50 51 52 53 55 56 57 59 62 65 68 71 74 77 79 82 85 88 91 94 97 99 102 105 108 111 114 117 119 122 125 127 ',
  'afterTouchConfig=0 2 3 5 6 8 9 10 12 13 14 16 17 18 20 21 22 24 25 26 27 28 30 31 32 33 34 36 37 38 39 40 41 43 44 45 46 47 48 49 50 51 52 53 54 55 57 58 59 60 61 62 63 64 65 66 67 68 69 70 70 71 72 73 74 75 76 77 78 79 80 81 82 83 84 85 85 86 87 88 89 90 91 92 92 93 94 95 96 97 98 99 99 100 101 102 103 104 104 105 106 107 108 108 109 110 111 112 112 113 114 115 116 116 117 118 119 120 120 121 122 123 123 124 125 126 126 127 ',
  'LumaTouchConfig=0 1 2 2 3 3 3 4 4 4 5 5 5 6 6 7 7 7 8 8 8 9 9 10 10 10 11 11 11 12 12 13 13 13 14 14 15 15 15 16 16 17 17 18 18 18 19 19 20 20 21 21 22 22 22 23 23 24 24 25 25 26 26 27 27 28 28 29 29 30 30 31 32 32 33 33 34 34 35 36 36 37 37 38 39 39 40 41 41 42 43 43 44 45 46 47 47 48 49 50 51 52 53 53 54 56 57 58 60 61 63 65 68 70 73 75 78 81 84 87 90 94 98 102 107 113 121 127 ',
].join('\r\n') + '\r\n';

/**
 * Serialise a full Lumatone mapping to a .ltn file string.
 *
 * @param {Array<Array<{note, channel, color, ktyp}>>} boards
 * @returns {string} complete .ltn file content (Windows line endings \r\n)
 */
export function boardsToLtn(boards) {
  let out = '';

  for (let b = 0; b < boards.length; b++) {
    out += `[Board${b}]\r\n`;
    const keys = boards[b];

    for (let k = 0; k < keys.length; k++) {
      const { note, channel, color, ktyp } = keys[k];
      out += `Key_${k}=${note}\r\n`;
      out += `Chan_${k}=${channel}\r\n`;
      out += `Col_${k}=${color}\r\n`;
      if (ktyp !== 1) {
        out += `KTyp_${k}=${ktyp}\r\n`;
      }
      out += `CCInvert_${k}\r\n`;
    }
  }

  out += LTN_FOOTER;
  return out;
}

// ── Top-level convenience functions ──────────────────────────────────────────

/**
 * Generate a complete .ltn file string from Hexatone settings.
 *
 * @param {object} settings   - Hexatone settings object
 * @param {object} [options]  - Central key/channel overrides (see hexatoneMappingForLumatone)
 * @returns {string}
 */
export function settingsToLtn(settings, options = {}) {
  return boardsToLtn(hexatoneMappingForLumatone(settings, options));
}

/**
 * Trigger a browser download of a .ltn file generated from Hexatone settings.
 *
 * @param {object} settings    - Hexatone settings object
 * @param {object} [options]   - Central key/channel overrides
 * @param {string} [filename]  - Download filename (default: "hexatone.ltn")
 */
export function downloadLtn(settings, options = {}, filename = 'hexatone.ltn') {
  const content = settingsToLtn(settings, options);
  const blob    = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href        = url;
  a.download    = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
