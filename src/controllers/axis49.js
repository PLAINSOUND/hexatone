/**
 * AXIS-49 2A Controller Mapping
 * 
 * In "selfless mode", the AXIS-49 2A sends MIDI notes 1-98 on a single channel.
 * The physical layout is 14 columns of 7 hexagonal keys each.
 * 
 * Geometry (based on user description):
 * - The controller has TWO BANKS of 7 columns each:
 *   - Bank 1 (columns 1-7, notes 1-49): First bank
 *   - Bank 2 (columns 8-14, notes 50-98): Second bank, shifted down by half a hex
 * - Within each bank, odd columns are offset down by half a row from even columns
 * - This creates a honeycomb pattern within each bank
 * - The second bank continues the downward trend (doesn't reset up)
 * 
 * Visual representation (note numbers):
 * 
 *   Bank 1 (columns 0-6):          Bank 2 (columns 7-13):
 *   [1]   [8]  [15]  [22]  [29]  [36]  [43]    [50]  [57]  [64]  [71]  [78]  [85]  [92]
 *     [8]  [15]  [22]  [29]  [36]  [43]  [50]    [57]  [64]  [71]  [78]  [85]  [92]  [99]* (*note: 99 doesn't exist)
 *   [2]   [9]  [16]  [23]  [30]  [37]  [44]    [51]  [58]  [65]  [72]  [79]  [86]  [93]
 *     [9]  [16]  [23]  [30]  [37]  [44]  [51]    ...
 *   [3]  [10]  [17]  [24]  [31]  [38]  [45]    [52]  [59]  [66]  [73]  [80]  [87]  [94]
 *   ...
 * 
 * The second bank is shifted down by 1 half-row from the first bank.
 */

// AXIS-49 physical geometry constants
export const AXIS49_COLUMNS = 14;
export const AXIS49_ROWS = 7;
export const AXIS49_TOTAL_NOTES = 98;
export const COLUMNS_PER_BANK = 7;

/**
 * Build the AXIS-49 coordinate map.
 * Returns an array where index = MIDI note number (1-98),
 * value = { col, row } physical position on the controller.
 * 
 * Physical coordinates:
 * - col: 0-13 (left to right)
 * - row: 0-6 (top to bottom within column)
 * 
 * The honeycomb offset is implicit: even columns (0, 2, 4...) are at "up" position,
 * odd columns (1, 3, 5...) are offset down by half a row.
 */
function buildAxis49Map() {
  const map = new Array(AXIS49_TOTAL_NOTES + 1); // Index 0 unused, notes are 1-98
  
  for (let col = 0; col < AXIS49_COLUMNS; col++) {
    for (let row = 0; row < AXIS49_ROWS; row++) {
      const noteNumber = col * AXIS49_ROWS + row + 1; // Notes start at 1
      map[noteNumber] = { col, row };
    }
  }
  
  return map;
}

/**
 * Convert AXIS-49 physical coordinates to normalized "hex space" coordinates.
 * This accounts for the two-bank structure and honeycomb offsets.
 * 
 * Returns { x, y } where:
 * - x = column index (0-13)
 * - y = vertical position in continuous space (accounts for bank shift and half-row offsets)
 */
function axis49ToHexSpace(col, row) {
  // The AXIS-49 has two banks of 7 columns each.
  // Bank 2 (columns 7-13) is shifted down by 1 half-row from Bank 1 (columns 0-6).
  // Within each bank, odd-indexed columns (relative to bank start) are offset down by 0.5 rows.
  
  const bank = Math.floor(col / COLUMNS_PER_BANK);  // 0 for cols 0-6, 1 for cols 7-13
  const colInBank = col % COLUMNS_PER_BANK;          // 0-6 within each bank
  
  // Alternating offset within bank: odd columns within bank are shifted down by 0.5
  const altOffset = (colInBank % 2 === 1) ? 0.5 : 0;
  
  // Bank 2 is shifted down by 1 (one half-hex step)
  const bankOffset = bank * 1.0;
  
  // Total y offset: bank shift + alternating within bank + row position
  const yOffset = bankOffset + altOffset;
  
  return {
    x: col,
    y: row + yOffset
  };
}

/**
 * The AXIS-49 coordinate map (note number -> { col, row })
 * Built once at module load.
 */
export const AXIS49_MAP = buildAxis49Map();

/**
 * Get the physical position of a MIDI note on the AXIS-49.
 * @param {number} noteNumber - MIDI note number (1-98)
 * @returns {{ col: number, row: number } | null}
 */
export function getAxis49Position(noteNumber) {
  if (noteNumber < 1 || noteNumber > 98) return null;
  return AXIS49_MAP[noteNumber];
}

/**
 * Get the MIDI note number for a physical position on the AXIS-49.
 * @param {number} col - Column index (0-13)
 * @param {number} row - Row index (0-6)
 * @returns {number | null} MIDI note number (1-98)
 */
export function getAxis49NoteNumber(col, row) {
  if (col < 0 || col >= AXIS49_COLUMNS || row < 0 || row >= AXIS49_ROWS) {
    return null;
  }
  return col * AXIS49_ROWS + row + 1;
}

/**
 * Map AXIS-49 physical coordinates to Hexatone logical coordinates.
 * 
 * The Hexatone keyboard uses (r, dr) coordinates where:
 * - r = horizontal distance from center (column displacement)
 * - dr = vertical distance from center (row displacement, accounting for honeycomb)
 * 
 * The key insight is that we use "virtual Y" which removes the bank offset,
 * so that keys on the same hex row have the same dr coordinate.
 * 
 * @param {number} col - AXIS-49 column (0-13)
 * @param {number} row - AXIS-49 row (0-6)
 * @param {Object} options
 * @param {number} options.centerCol - Column of the center key
 * @param {number} options.centerRow - Row of the center key
 * @returns {{ r: number, dr: number }} Hexatone logical coordinates
 */
export function axis49ToHexatoneCoords(col, row, options = {}) {
  const {
    centerCol = 7,   // Default center column (key 53 is at col 7, row 3)
    centerRow = 3,   // Default center row
    rSteps = 1,
    drSteps = 5,
  } = options;
  
  // Calculate virtual Y including bank offset and alternating offset
  // Bank 2 (columns 7-13) is shifted down by 0.5 relative to Bank 1
  // Within each bank, odd columns are shifted down by 0.5 relative to even columns
  const bank = Math.floor(col / COLUMNS_PER_BANK);
  const bankOffset = bank * 0.5;  // Bank 2 is 0.5 lower
  const colInBank = col % COLUMNS_PER_BANK;
  const altOffset = (colInBank % 2 === 1) ? 0.5 : 0;
  const virtualY = row + altOffset + bankOffset;
  
  // Calculate center virtual Y (with same bank offset logic)
  const centerBank = Math.floor(centerCol / COLUMNS_PER_BANK);
  const centerBankOffset = centerBank * 0.5;
  const centerColInBank = centerCol % COLUMNS_PER_BANK;
  const centerAltOffset = (centerColInBank % 2 === 1) ? 0.5 : 0;
  const centerVirtualY = centerRow + centerAltOffset + centerBankOffset;
  
  // Calculate hex coordinates
  // r = column displacement (horizontal movement)
  // dr = virtual Y displacement (vertical movement in hex space)
  const r = col - centerCol;
  const drCoord = Math.round(virtualY - centerVirtualY);
  
  return { r, dr: drCoord };
}

/**
 * Map Hexatone logical coordinates back to AXIS-49 physical coordinates.
 * 
 * @param {number} r - Hexatone r coordinate
 * @param {number} dr - Hexatone dr coordinate
 * @param {Object} options - Same options as axis49ToHexatoneCoords
 * @returns {{ col: number, row: number } | null} AXIS-49 position, or null if out of range
 */
export function hexatoneToAxis49Coords(r, dr, options = {}) {
  const {
    centerCol = 7,
    centerRow = 3,
  } = options;
  
  // Inverse of the mapping in axis49ToHexatoneCoords
  const col = centerCol + r;
  
  // Calculate the expected virtualY for center (including bank offset)
  const centerBank = Math.floor(centerCol / COLUMNS_PER_BANK);
  const centerBankOffset = centerBank * 0.5;
  const centerColInBank = centerCol % COLUMNS_PER_BANK;
  const centerAltOffset = (centerColInBank % 2 === 1) ? 0.5 : 0;
  const centerVirtualY = centerRow + centerAltOffset + centerBankOffset;
  
  // Calculate the altOffset and bankOffset for the target column
  const bank = Math.floor(col / COLUMNS_PER_BANK);
  const bankOffset = bank * 0.5;
  const colInBank = col % COLUMNS_PER_BANK;
  const altOffset = (colInBank % 2 === 1) ? 0.5 : 0;
  
  // virtualY = row + altOffset + bankOffset
  // dr = round(virtualY - centerVirtualY)
  // So: virtualY ≈ centerVirtualY + dr
  // row = virtualY - altOffset - bankOffset ≈ centerVirtualY + dr - altOffset - bankOffset
  const row = Math.round(centerVirtualY + dr - altOffset - bankOffset);
  
  // Check bounds
  if (col < 0 || col >= AXIS49_COLUMNS || row < 0 || row >= AXIS49_ROWS) {
    return null;
  }
  
  return { col, row };
}

/**
 * Calculate the MIDI note number for an AXIS-49 key based on Hexatone settings.
 * 
 * This maps the isomorphic layout so that pressing a key on the AXIS-49
 * produces the same pitch as the corresponding hex on the Hexatone keyboard.
 * 
 * @param {number} axisNoteNumber - Original AXIS-49 MIDI note (1-98)
 * @param {Object} settings - Hexatone settings object
 * @param {number[]} settings.scale - Scale degrees in cents (Scala format strings)
 * @param {number} settings.fundamental - Reference frequency in Hz
 * @param {number} settings.reference_degree - Which scale degree maps to fundamental
 * @param {number} settings.rSteps - Scale steps per radial movement
 * @param {number} settings.drSteps - Scale steps per angular movement
 * @param {number} settings.centerMidiNote - MIDI note number for center degree (default: 60)
 * @param {Object} options - AXIS-49 mapping options
 * @returns {{ midiNote: number, pitchBend: number, cents: number, scaleDegree: number }}
 */
export function mapAxis49ToMidi(axisNoteNumber, settings, options = {}) {
  const pos = getAxis49Position(axisNoteNumber);
  if (!pos) return null;
  
  const {
    scale = [],
    rSteps = 1,
    drSteps = 5,
    centerMidiNote = 60,  // Middle C
    centerCol = 6.5,
    centerRow = 3,
  } = settings;
  
  // Get Hexatone coordinates
  const hexCoords = axis49ToHexatoneCoords(pos.col, pos.row, {
    centerCol,
    centerRow,
    rSteps,
    drSteps,
  });
  
  // Calculate scale degree from hex coordinates
  const equivSteps = scale.length || 12;
  const totalSteps = hexCoords.r * rSteps + hexCoords.dr * drSteps;
  
  // Handle equave wrapping
  const equaves = Math.floor(totalSteps / equivSteps);
  const reducedSteps = ((totalSteps % equivSteps) + equivSteps) % equivSteps;
  
  // Get cents from scale (scale[0] is implicit 0)
  let cents = equaves * 1200;  // Assuming 1200 cent equave (octave)
  if (reducedSteps > 0 && scale[reducedSteps - 1]) {
    cents += parseFloat(scale[reducedSteps - 1]) || 0;
  }
  
  // Convert to MIDI note + pitch bend
  const semitones = cents / 100;
  const midiNote = Math.round(centerMidiNote + semitones);
  const centsOff = cents - (midiNote - centerMidiNote) * 100;
  
  // Pitch bend in range -1 to 1 (will be scaled to MIDI pitch bend range)
  const pitchBend = centsOff / 50;  // Assuming ±50 cent range = pitch bend ±1
  
  return {
    midiNote,
    pitchBend,
    cents,
    scaleDegree: reducedSteps,
    hexCoords,
    axisPosition: pos,
  };
}

/**
 * Create a complete mapping table for the AXIS-49 controller.
 * Useful for debugging and visualization.
 * 
 * @param {Object} settings - Hexatone settings
 * @param {Object} options - AXIS-49 mapping options
 * @returns {Array} Array of mapping objects for each note 1-98
 */
export function createAxis49MappingTable(settings, options = {}) {
  const table = [];
  
  for (let note = 1; note <= 98; note++) {
    const mapping = mapAxis49ToMidi(note, settings, options);
    table.push({
      axisNote: note,
      ...mapping,
    });
  }
  
  return table;
}

/**
 * Find adjacent keys on the AXIS-49 for a given note.
 * Returns the 6 neighboring keys (or fewer if at edge).
 * 
 * @param {number} noteNumber - MIDI note number (1-98)
 * @returns {Array<{ noteNumber: number, direction: string }>}
 */
export function getAxis49Neighbors(noteNumber) {
  const pos = getAxis49Position(noteNumber);
  if (!pos) return [];
  
  const neighbors = [];
  const { col, row } = pos;
  
  // Up and Down (same column) - these are always straightforward
  const upNote = getAxis49NoteNumber(col, row - 1);
  const downNote = getAxis49NoteNumber(col, row + 1);
  
  if (upNote) neighbors.push({ noteNumber: upNote, direction: 'up' });
  if (downNote) neighbors.push({ noteNumber: downNote, direction: 'down' });
  
  // For horizontal neighbors, we need to find keys that are at r+1, dr+0 and r+1, dr+1
  // This requires calculating virtualY for both current and neighbor positions
  
  // Calculate virtualY for current position
  const bank = Math.floor(col / COLUMNS_PER_BANK);
  const bankOffset = bank * 0.5;
  const colInBank = col % COLUMNS_PER_BANK;
  const altOffset = (colInBank % 2 === 1) ? 0.5 : 0;
  const virtualY = row + altOffset + bankOffset;
  
  // Left column neighbors (if not at left edge)
  if (col > 0) {
    const leftBank = Math.floor((col - 1) / COLUMNS_PER_BANK);
    const leftBankOffset = leftBank * 0.5;
    const leftColInBank = (col - 1) % COLUMNS_PER_BANK;
    
    // For r-1, dr+0: find key with virtualY ≈ current virtualY
    // For r-1, dr-1: find key with virtualY ≈ current virtualY - 1
    
    // The alternating offset for left column
    const leftAltOffset = (leftColInBank % 2 === 1) ? 0.5 : 0;
    
    // For dr = 0: row where virtualY_neighbor ≈ virtualY
    const baseRow = virtualY - leftAltOffset - leftBankOffset;
    const upLeftRow = Math.floor(baseRow);
    const downLeftRow = Math.floor(baseRow) + 1;
    
    const upLeftNote = getAxis49NoteNumber(col - 1, upLeftRow);
    const downLeftNote = getAxis49NoteNumber(col - 1, downLeftRow);
    
    if (upLeftNote) neighbors.push({ noteNumber: upLeftNote, direction: 'up-left' });
    if (downLeftNote) neighbors.push({ noteNumber: downLeftNote, direction: 'down-left' });
  }
  
  // Right column neighbors (if not at right edge)
  if (col < AXIS49_COLUMNS - 1) {
    const rightBank = Math.floor((col + 1) / COLUMNS_PER_BANK);
    const rightBankOffset = rightBank * 0.5;
    const rightColInBank = (col + 1) % COLUMNS_PER_BANK;
    
    // For r+1, dr+0: find key with virtualY ≈ current virtualY
    // For r+1, dr+1: find key with virtualY ≈ current virtualY + 1
    
    // The alternating offset for right column
    const rightAltOffset = (rightColInBank % 2 === 1) ? 0.5 : 0;
    
    // For dr = 0: row where virtualY_neighbor ≈ virtualY
    // row + rightAltOffset + rightBankOffset ≈ virtualY
    // row ≈ virtualY - rightAltOffset - rightBankOffset
    // Use floor to get the row with virtualY just at or below target
    const baseRow = virtualY - rightAltOffset - rightBankOffset;
    const upRightRow = Math.floor(baseRow);
    const downRightRow = Math.floor(baseRow) + 1;
    
    const upRightNote = getAxis49NoteNumber(col + 1, upRightRow);
    const downRightNote = getAxis49NoteNumber(col + 1, downRightRow);
    
    if (upRightNote) neighbors.push({ noteNumber: upRightNote, direction: 'up-right' });
    if (downRightNote) neighbors.push({ noteNumber: downRightNote, direction: 'down-right' });
  }
  
  return neighbors;
}

/**
 * Default export: the complete AXIS-49 mapping module
 */
export default {
  AXIS49_MAP,
  getAxis49Position,
  getAxis49NoteNumber,
  axis49ToHexatoneCoords,
  hexatoneToAxis49Coords,
  mapAxis49ToMidi,
  createAxis49MappingTable,
  getAxis49Neighbors,
  AXIS49_COLUMNS,
  AXIS49_ROWS,
  AXIS49_TOTAL_NOTES,
  COLUMNS_PER_BANK,
};
