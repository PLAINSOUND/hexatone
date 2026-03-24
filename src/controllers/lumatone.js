/**
 * Lumatone controller mapping — selfless mode
 *
 * Physical layout:
 *   5 blocks (boards), each on a separate MIDI channel (1–5).
 *   Each block has 55 keys, MIDI notes 0–54.
 *
 * Within-block geometry (derived from image):
 *   rStep (right-up)  = note +1  → hex x+1
 *   drStep (right-down) = note +6 → hex y+1
 *
 *   For note N relative to anchor A in the same block:
 *     diff   = N − A
 *     x_raw  = ((diff % 6) + 6) % 6       always 0..5
 *     x      = x_raw > 3 ? x_raw − 6 : x_raw   →  −2..+3
 *     y      = (diff − x) / 6                    →  −5..+4
 *
 *   The block spans x ∈ [−2, +3] (6 columns) and y ∈ [−5, +4] (9–10 rows
 *   per column); column x=+3 has 10 keys (y −5..+4), all others 9 (y −4..+4).
 *   Total: 10 + 5×9 = 55 keys ✓
 *
 * Inter-block layout:
 *   BLOCK_OFFSETS gives each block's anchor position relative to block 1.
 *   Default: blocks spaced horizontally by 6 steps (one block width).
 *   Calibrate BLOCK_OFFSETS to match your physical Lumatone arrangement.
 *   Typical staircase Lumatone: add a small y offset per block, e.g. (6, −2).
 */

export const LUMATONE_BLOCKS          = 5;
export const LUMATONE_NOTES_PER_BLOCK = 56;   // notes 0–55 per channel

// Spatial offset (in hexatone grid steps) of each block's anchor
// relative to block 1's anchor.  Index 0 = channel 1.
// Adjust the y components to match the physical staircase of your Lumatone.
export const LUMATONE_BLOCK_OFFSETS = [
  { x:  0, y:  0 },   // channel 1
  { x:  6, y:  0 },   // channel 2
  { x: 12, y:  0 },   // channel 3
  { x: 18, y:  0 },   // channel 4
  { x: 24, y:  0 },   // channel 5
];

/**
 * (x, y) offset of note N from anchor note A within the same block.
 */
export function lumatoneNoteOffset(note, anchorNote) {
  const diff   = note - anchorNote;
  const x_raw  = ((diff % 6) + 6) % 6;
  const x      = x_raw > 3 ? x_raw - 6 : x_raw;
  const y      = (diff - x) / 6;
  return { x, y };
}

/**
 * Build raw hex coords for all 5 × 56 = 280 Lumatone keys.
 *
 * anchorChannel (1–5) and anchorNote (0–55) define the key that maps
 * to hexatone origin (0, 0).
 *
 * Returns a Map keyed by the string "channel,note" (e.g. "2,33")
 * with value { x, y } relative to the anchor.
 */
export function buildLumatoneRawCoords(anchorChannel, anchorNote) {
  const anchorOff = LUMATONE_BLOCK_OFFSETS[anchorChannel - 1];
  const raw = new Map();

  for (let ch = 1; ch <= LUMATONE_BLOCKS; ch++) {
    const blk = LUMATONE_BLOCK_OFFSETS[ch - 1];
    const bx  = blk.x - anchorOff.x;
    const by  = blk.y - anchorOff.y;

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
 * Identical algorithm to axis49.js bestFitOffset.
 */
export function bestFitOffset(rawCoords, stepsTable, centerHexOffset) {
  const visible = new Set();
  for (const points of stepsTable.values()) {
    for (const p of points) visible.add(p.x + ',' + p.y);
  }

  const ox = centerHexOffset.x;
  const oy = centerHexOffset.y;
  let bestDx = 0, bestDy = 0, bestCount = -1, bestDist2 = Infinity;
  const RANGE = 10;

  for (let dx = -RANGE; dx <= RANGE; dx++) {
    for (let dy = -RANGE; dy <= RANGE; dy++) {
      let count = 0;
      for (const { x, y } of rawCoords.values()) {
        if (visible.has((x + ox + dx) + ',' + (y + oy + dy))) count++;
      }
      const dist2 = dx * dx + dy * dy;
      if (count > bestCount || (count === bestCount && dist2 < bestDist2)) {
        bestCount = count; bestDx = dx; bestDy = dy; bestDist2 = dist2;
      }
    }
  }
  return { dx: bestDx, dy: bestDy, count: bestCount };
}
