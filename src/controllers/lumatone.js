/**
 * Lumatone controller mapping — layout of keys follows the .ltn format
 * Keys are numbered 0-55 (mapped to MIDI Note Numbers) in five blocks
 * numbered 1-5 (mapped to MIDI Channels)
 *
 * Physical layout:
 *   5 blocks (boards), each on a separate MIDI channel (1–5).
 *   Each block has 56 keys, MIDI notes 0–55 per channel.
 *
 * Within-block geometry:
 *   Notes are arranged in 11 rows. Within each row, notes are numbered
 *   left-to-right. r = position within row (with stagger), dr = row index.
 *
 *   Row lengths and starting notes:
 *     row  0:  2 keys — notes  0..1
 *     row  1:  5 keys — notes  2..6
 *     rows 2–8: 6 keys each — notes 7..48
 *     row  9:  5 keys — notes 49..53
 *     row 10:  2 keys — notes 54..55
 *
 *   The block forms a parallelogram slanting down-left (from the
 *   perspective of the bottom left key). Every row n contains a key
 *   at (0, n) - down-right diagonal. Rows 0–8 start at r = -floor(dr/2)
 *   (no even/odd distinction — pairs of rows share the same start_r).
 *   Row 9 is shifted right by 1, Row 10 is shifted right by 3.
 *
 *   Verified neighbours of default anchor note 26 (r=-1, dr=5):
 *     left=25(-1,0)  right=27(+1,0)
 *     upper-left=20(0,-1)  upper-right=21(+1,-1)
 *     lower-left=32(-1,+1)  lower-right=33(0,+1)
 *
 *   Inter-block layout:
 *   Each successive block shifts by (+6r, +2dr) to match the physical staircase.
 *   Adjust LUMATONE_BLOCK_OFFSETS if your instrument's staircase differs.
 */

export const LUMATONE_BLOCKS = 5;
export const LUMATONE_NOTES_PER_BLOCK = 56;

export const LUMATONE_BLOCK_OFFSETS = [
  { x: 0, y: 0 }, // channel 1
  { x: 5, y: 2 }, // channel 2
  { x: 10, y: 4 }, // channel 3
  { x: 15, y: 6 }, // channel 4
  { x: 20, y: 8 }, // channel 5
];

// [r, dr] position of each note 0–55 within a block.
// r  = horizontal hex-grid position (0 = centre column), dr = row index (0 = top).
//
// Rows 0–8: each row has a note at r=0.
//   All rows: start at r = -floor(dr/2) (no even/odd distinction)
// Rows 9–10: indented (short rows at the bottom of the parallelogram).
//   Row 9: starts at r = -3  (5 keys)
//   Row 10: starts at r = -1 (2 keys)
const NOTE_XY = [
  [0, 0], //  0  row 0 (2 keys, even)
  [1, 0], //  1
  [0, 1], //  2  row 1 (5 keys, odd)
  [1, 1], //  3
  [2, 1], //  4
  [3, 1], //  5
  [4, 1], //  6
  [-1, 2], //  7  row 2 (6 keys, even)
  [0, 2], //  8
  [1, 2], //  9
  [2, 2], // 10
  [3, 2], // 11
  [4, 2], // 12
  [-1, 3], // 13  row 3 (6 keys)
  [0, 3], // 14
  [1, 3], // 15
  [2, 3], // 16
  [3, 3], // 17
  [4, 3], // 18
  [-2, 4], // 19  row 4 (6 keys, even)
  [-1, 4], // 20
  [0, 4], // 21
  [1, 4], // 22
  [2, 4], // 23
  [3, 4], // 24
  [-2, 5], // 25  row 5 (6 keys)
  [-1, 5], // 26  ← default anchor
  [0, 5], // 27
  [1, 5], // 28
  [2, 5], // 29
  [3, 5], // 30
  [-3, 6], // 31  row 6 (6 keys, even)
  [-2, 6], // 32
  [-1, 6], // 33
  [0, 6], // 34
  [1, 6], // 35
  [2, 6], // 36
  [-3, 7], // 37  row 7 (6 keys)
  [-2, 7], // 38
  [-1, 7], // 39
  [0, 7], // 40
  [1, 7], // 41
  [2, 7], // 42
  [-4, 8], // 43  row 8 (6 keys, even)
  [-3, 8], // 44
  [-2, 8], // 45
  [-1, 8], // 46
  [0, 8], // 47
  [1, 8], // 48
  [-3, 9], // 49  row 9 (5 keys, indented)
  [-2, 9], // 50
  [-1, 9], // 51
  [0, 9], // 52
  [1, 9], // 53
  [-1, 10], // 54  row 10 (2 keys, indented)
  [0, 10], // 55
];

/**
 * (x, y) offset of note N from anchor note A, in hexatone axial (r, dr) space.
 *
 * @param {number} note        0–55
 * @param {number} anchorNote  0–55
 * @returns {{x: number, y: number}}
 */
export function lumatoneNoteOffset(note, anchorNote) {
  const [ax, ay] = NOTE_XY[anchorNote];
  const [nx, ny] = NOTE_XY[note];
  return { x: nx - ax, y: ny - ay };
}

/**
 * Build raw hex coords for all 5 × 56 = 280 Lumatone keys.
 *
 * anchorChannel (1–5) and anchorNote (0–55) define the key that maps
 * to hexatone origin (0, 0).
 *
 * Returns a Map keyed by "channel,note" with value { x, y }.
 */
export function buildLumatoneRawCoords(anchorChannel, anchorNote) {
  const anchorOff = LUMATONE_BLOCK_OFFSETS[anchorChannel - 1];
  const raw = new Map();

  for (let ch = 1; ch <= LUMATONE_BLOCKS; ch++) {
    const blk = LUMATONE_BLOCK_OFFSETS[ch - 1];
    const bx = blk.x - anchorOff.x;
    const by = blk.y - anchorOff.y;

    for (let note = 0; note < LUMATONE_NOTES_PER_BLOCK; note++) {
      const { x, y } = lumatoneNoteOffset(note, anchorNote);
      raw.set(`${ch},${note}`, { x: x + bx, y: y + by });
    }
  }

  return raw;
}

/**
 * Find the integer offset (dx, dy) that maximises the number of Lumatone
 * keys landing on visible hexatone coords, with tie-break by ||offset||.
 */
export function bestFitOffset(rawCoords, stepsTable, centerHexOffset) {
  const visible = new Set();
  for (const points of stepsTable.values()) {
    for (const p of points) visible.add(p.x + "," + p.y);
  }

  const ox = centerHexOffset.x;
  const oy = centerHexOffset.y;
  let bestDx = 0,
    bestDy = 0,
    bestCount = -1,
    bestDist2 = Infinity;
  const RANGE = 10;

  for (let dx = -RANGE; dx <= RANGE; dx++) {
    for (let dy = -RANGE; dy <= RANGE; dy++) {
      let count = 0;
      for (const { x, y } of rawCoords.values()) {
        if (visible.has(x + ox + dx + "," + (y + oy + dy))) count++;
      }
      const dist2 = dx * dx + dy * dy;
      if (count > bestCount || (count === bestCount && dist2 < bestDist2)) {
        bestCount = count;
        bestDx = dx;
        bestDy = dy;
        bestDist2 = dist2;
      }
    }
  }
  return { dx: bestDx, dy: bestDy, count: bestCount };
}
