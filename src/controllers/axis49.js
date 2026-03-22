/**
 * AXIS-49 2A Controller Mapping
 *
 * buildRawCoords(anchorNote) — used by keys.js buildAxis49Table.
 * Returns a Map<noteNumber, {x,y}> of coordinates relative to the anchor
 * note's position, using the AXIS-49 physical geometry.
 *
 * bestFitOffset(rawCoords, stepsTable, centerHexOffset) — finds the
 * (dx,dy) translation that maximises how many AXIS-49 keys land on
 * visible hexatone coordinates.
 */

// ── Physical geometry ──────────────────────────────────────────────────────

const AXIS49_COLUMNS     = 14;
const AXIS49_ROWS        = 7;
export const AXIS49_TOTAL_NOTES = 98;
const COLUMNS_PER_BANK   = 7;

// note (1-98) → {col, row}
function noteToPhysical(note) {
  if (note < 1 || note > 98) return null;
  const col = Math.floor((note - 1) / AXIS49_ROWS);
  const row = (note - 1) % AXIS49_ROWS;
  return { col, row };
}

// Physical {col, row} → continuous hex-space {x, y} relative to an anchor.
// Bank 2 (cols 7-13) is shifted down 0.5 relative to Bank 1.
// Within each bank odd columns shift down 0.5.
function physicalToHexSpace(col, row) {
  const bank       = Math.floor(col / COLUMNS_PER_BANK);
  const colInBank  = col % COLUMNS_PER_BANK;
  const altOffset  = (colInBank % 2 === 1) ? 0.5 : 0;
  const bankOffset = bank * 0.5;
  return { x: col, y: row + altOffset + bankOffset };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Build relative hex coordinates for all 98 AXIS-49 keys,
 * with anchorNote positioned at (0, 0).
 *
 * @param {number} anchorNote  physical note (1-98) to treat as origin
 * @returns {Map<number, {x:number, y:number}>}
 */
export function buildRawCoords(anchorNote) {
  const anchor = noteToPhysical(anchorNote);
  if (!anchor) return new Map();

  const { x: ax, y: ay } = physicalToHexSpace(anchor.col, anchor.row);
  const result = new Map();

  for (let note = 1; note <= AXIS49_TOTAL_NOTES; note++) {
    const pos = noteToPhysical(note);
    if (!pos) continue;
    const { x, y } = physicalToHexSpace(pos.col, pos.row);
    result.set(note, { x: Math.round(x - ax), y: Math.round(y - ay) });
  }
  return result;
}

/**
 * Find the translation (dx, dy) that maximises how many raw coords
 * land on hexatone screen positions.
 *
 * @param {Map<number,{x,y}>} rawCoords   from buildRawCoords
 * @param {Map<number,Point[]>} stepsTable keys.js stepsTable (steps → coords[])
 * @param {{x:number,y:number}} centerHexOffset
 * @returns {{dx:number, dy:number, count:number}}
 */
export function bestFitOffset(rawCoords, stepsTable, centerHexOffset) {
  // Collect all (x,y) positions that exist on screen
  const onScreen = new Set();
  for (const coords of stepsTable.values()) {
    for (const p of coords) {
      onScreen.add(`${p.x - centerHexOffset.x},${p.y - centerHexOffset.y}`);
    }
  }

  let bestDx = 0, bestDy = 0, bestCount = 0;

  for (let dx = -4; dx <= 4; dx++) {
    for (let dy = -4; dy <= 4; dy++) {
      let count = 0;
      for (const { x, y } of rawCoords.values()) {
        if (onScreen.has(`${x + dx},${y + dy}`)) count++;
      }
      if (count > bestCount) {
        bestCount = count;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }
  return { dx: bestDx, dy: bestDy, count: bestCount };
}

// ── Legacy named exports (used by older code) ──────────────────────────────
export { noteToPhysical as getAxis49Position };
export const AXIS49_MAP = (() => {
  const m = new Array(AXIS49_TOTAL_NOTES + 1);
  for (let n = 1; n <= AXIS49_TOTAL_NOTES; n++) m[n] = noteToPhysical(n);
  return m;
})();