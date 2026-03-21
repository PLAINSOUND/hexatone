/**
 * AXIS-49 2A selfless mode geometry
 *
 * Physical layout: 14 columns (0–13), 7 rows (0–6), numbered column-by-column
 * top-to-bottom: note = col * 7 + row + 1  (note 1 = col 0 row 0, note 98 = col 13 row 6).
 *
 * rStep (physically right-up, +1 column):
 *   dest col ∈ {1, 3, 5, 8, 10, 12}  →  same row
 *   dest col ∉ that set               →  row − 1
 *
 * drStep (physically right-down, +1 column):
 *   same as rStep but row + 1:
 *   dest col ∈ {1, 3, 5, 8, 10, 12}  →  row + 1
 *   dest col ∉ that set               →  same row
 *
 * Coordinate formula (anchor note A at hexatone origin):
 *   Let RSUM[c] = cumulative rStep row-delta from col 0 to col c.
 *   For any note at (col, row):
 *     y = (row − row_A) − (RSUM[col] − RSUM[col_A])
 *     x = (col − col_A) − y
 *
 * RSUM derivation: rStep row-delta for entering column c =
 *   0 if c ∈ {1,3,5,8,10,12}, else −1
 */

export const AXIS49_NOTES   = 98;
export const AXIS49_COLS    = 14;
export const AXIS49_ROWS    = 7;

// Columns where rStep keeps same row (destination column is "down-shifted")
const DOWN_COLS = new Set([1, 3, 5, 7, 8, 10, 12]);

// RSUM[c] = cumulative rStep row-delta walking from col 0 to col c
// [0, 0, -1, -1, -2, -2, -3, -4, -4, -5, -5, -6, -6, -7]
export const AXIS49_RSUM = (() => {
  const a = new Array(AXIS49_COLS).fill(0);
  for (let c = 1; c < AXIS49_COLS; c++) {
    a[c] = a[c - 1] + (DOWN_COLS.has(c) ? -1 : 0);
  }
  return a;
})();

/**
 * Physical position of a note on the AXIS-49.
 * @param {number} note  1–98
 * @returns {{ col: number, row: number }}
 */
export function axis49Position(note) {
  const idx = note - 1;
  return { col: Math.floor(idx / AXIS49_ROWS), row: idx % AXIS49_ROWS };
}

/**
 * Build raw hexatone coords for all 98 notes relative to anchor A at (0, 0).
 * Returns a Map<note, {x, y}>.
 */
export function buildRawCoords(anchorNote) {
  const { col: col_A, row: row_A } = axis49Position(anchorNote);
  const rsum_A = AXIS49_RSUM[col_A];
  const raw = new Map();
  for (let note = 1; note <= AXIS49_NOTES; note++) {
    const { col, row } = axis49Position(note);
    const y = (row - row_A) - (AXIS49_RSUM[col] - rsum_A);
    const x = (col - col_A) - y;
    raw.set(note, { x, y });
  }
  return raw;
}

/**
 * Given the raw coords and the hexatone's visible step-set (from stepsTable),
 * find the integer offset (dx, dy) that maximises the number of AXIS-49 notes
 * landing on visible hexatone coords, with tie-break by smallest ||(dx,dy)||.
 *
 * The stepsTable maps steps→[coords], so the visible coord set is all coords
 * that appear as values in the Map.
 *
 * @param {Map<number,{x,y}>} rawCoords
 * @param {Map<number, Point[]>} stepsTable  from Keys.stepsTable
 * @param {{x:number,y:number}} centerHexOffset
 * @returns {{ dx: number, dy: number, count: number }}
 */
export function bestFitOffset(rawCoords, stepsTable, centerHexOffset) {
  // Build a Set of all visible hex coords as "x,y" strings for fast lookup
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
