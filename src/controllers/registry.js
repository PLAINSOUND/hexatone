import { lumatoneNoteOffset, LUMATONE_BLOCK_OFFSETS, LUMATONE_NOTES_PER_BLOCK, LUMATONE_BLOCKS } from './lumatone.js';

/**
 * controllers/registry.js
 *
 * Database of known 2D isomorphic controller geometries.
 *
 * Each entry defines:
 *   id            – unique string key
 *   name          – display name
 *   detect(name)  – returns true if device name matches
 *   description   – shown in UI
 *   multiChannel  – true if channel encodes layout position (e.g. Lumatone blocks)
 *                   false if channel only carries step offset (AXIS-49, Push, etc.)
 *   mpe           – true if the controller sends MPE (per-channel per-voice pitch bend,
 *                   pressure, and CC74). When true, Hexatone should automatically enable
 *                   midiin_mpe_input so each channel's expression is routed to its hex.
 *                   false for single-channel or block-channel controllers.
 *   mpeVoiceChannels – { lo, hi } if the controller uses a fixed, known MPE voice
 *                   channel range (e.g. Exquis: { lo: 2, hi: 15 }). null means the
 *                   range is user-configurable and the UI picker is shown. Only
 *                   present on entries where mpe is true.
 *   anchor        – array of setting descriptors for the UI
 *   buildMap(anchorParams) → Map<"ch.note", {x,y}>
 *                   x,y are integer offsets from the anchor key in hex-grid units.
 *                   For single-channel controllers all keys use ch=1.
 *                   For multi-channel controllers ch matches the MIDI channel.
 *
 * Lookup key is always "ch.note" — callers normalise to ch=1 when
 * controller.multiChannel is false (ignoreChannel behaviour).
 *
 * To request a new geometry: https://github.com/PLAINSOUND/hexatone/issues/new
 * or email hexatone@plainsound.org — include controller name, MIDI note layout,
 * and a photo or diagram of the physical key arrangement.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a Map<"ch.note", {x,y}> from a flat array of {ch, note, x, y}.
 */
function makeMap(entries) {
  const m = new Map();
  for (const { ch, note, x, y } of entries) {
    m.set(`${ch}.${note}`, { x, y });
  };
  console.log("map built with", m.size, "entries");
  return m;
}

// ── AXIS-49 2A ────────────────────────────────────────────────────────────────
// https://www.c-thru-music.com/cgi/?page=prod_axis-49
//
// 14 columns × 7 rows, single MIDI channel (selfless mode, notes 1–98).
// Notes are numbered column-first: note = col * 7 + row + 1 (0-indexed col/row).
//
// Physical geometry (flat-top hexagons):
//   • Odd columns within each bank of 7 are staggered DOWN by 0.5 hex unit.
//   • Bank 2 (cols 7–13) is additionally shifted DOWN by 0.5 relative to Bank 1.
//   Continuous hex-space position: x = col, y = row + altOffset + bankOffset.
//
// The 0.5 offsets resolve to integer hex-grid cells via Math.round(y - anchorY),
// correctly mapping all 98 keys into hexatone's axial (r, dr) space where
// +r = right and +dr = down. rSteps / drSteps are irrelevant — this is geometry.

const AXIS49_ROWS          = 7;
const AXIS49_COLS          = 14;
const AXIS49_COLS_PER_BANK = 7;

function axis49HexSpace(col, row) {
  const bank      = Math.floor(col / AXIS49_COLS_PER_BANK);
  const colInBank = col % AXIS49_COLS_PER_BANK;
  return {
    x: col,
    y: row + (colInBank % 2 === 1 ? 0.5 : 0) + bank * 0.5,
  };
}

function buildAxis49Map(anchorNote) {
  const note1     = Math.max(1, Math.min(98, anchorNote));
  const anchorCol = Math.floor((note1 - 1) / AXIS49_ROWS);
  const anchorRow = (note1 - 1) % AXIS49_ROWS;
  const { x: axPhys, y: ayPhys } = axis49HexSpace(anchorCol, anchorRow);

  const entries = [];
  for (let col = 0; col < AXIS49_COLS; col++) {
    for (let row = 0; row < AXIS49_ROWS; row++) {
      const note = col * AXIS49_ROWS + row + 1;
      const { x: xPhys, y: yPhys } = axis49HexSpace(col, row);
      // Transform physical hex-space offsets to hexatone axial (r, dr) coords.
      // Basis vectors from AXIS-49 physical layout:
      //   down in same column  (Δx_phys=0, Δy_phys=1)  → hexatone (−1, +1)
      //   right even→odd col   (Δx_phys=1, Δy_phys=0.5)→ hexatone  (0, +1)
      // Solving gives the 2×2 linear map:
      //   hx = 0.5·Δx_phys − Δy_phys
      //   hy = 0.5·Δx_phys + Δy_phys
      const dx = xPhys - axPhys;
      const dy = yPhys - ayPhys;
      entries.push({ ch: 1, note, x: Math.round(0.5 * dx - dy), y: Math.round(0.5 * dx + dy) });
    }
  }
  return makeMap(entries);
}

/**
 * TS41 MIDI keyboard Controller Mapping
 * https://tristanbay.com/gear/ts41-midi-keyboard/
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

const TS41_COLUMNS     = 37;
const TS41_ROWS        = 13;
export const TS41_TOTAL_NOTES = 126;

// note (1-126) → {col, row}
// columns repeat in patterns of 12 with the following number of notes in each column
// TS41_COLUMNS_PATTERN = [3, 4, 3, 3, 4, 3, 4, 3, 4, 3, 3, 4];
//
// TS41_COL_NOTE_START[c]: the note-number of the topmost key in column c (within a 41-note block).
// Used to find which column a note-in-block belongs to (findLastIndex where start < posInBlock).
const TS41_COL_NOTE_START = [3, 7, 10, 13, 17, 20, 24, 27, 31, 34, 37, 41];
// TS41_COL_ROW_START[col]: the physical row of the topmost key in that column (0-indexed, 37 columns total).
const TS41_COL_ROW_START = [1,0,1,2,1,2,1,2,1,2,3,2,3,2,3,4,3,4,3,4,3,4,5,4,5,4,5,6,5,6,5,6,5,6,7,6,7];

function noteToPhysical(note) {
  if (note < 1 || note > 126) return null;
  const block = Math.floor((note - 1) / 41);
  const posInBlock = ((note - 1) % 41) + 1;  // 1..41, avoids mod-41 === 0 edge case
  // colInBlock: 0-indexed column within the 12-column repeating block.
  // findLastIndex returns the index of the last column whose top-note start < posInBlock.
  const colInBlock = TS41_COL_NOTE_START.findLastIndex((noteStart) => noteStart < posInBlock) + 1;
  const col = 12 * block + colInBlock;
  // topRow: physical row of the topmost key in this column.
  const topRow = TS41_COL_ROW_START[col];
  // nextColNoteStart: note-number of the topmost key in the next column (= note-start of colInBlock+1).
  const nextColNoteStart = TS41_COL_NOTE_START[colInBlock];
  // rows are spaced 2 apart; the topmost key is at topRow, keys below are at topRow+2, topRow+4, ...
  const row = topRow + 2 * (nextColNoteStart - posInBlock);
  return { row, col };
}

// Physical {col, row} → hexatone axial (x, y) coords.
//
// TS41 Bosanquet basis vectors (physical → hex):
//   rStep:  Δcol=+2, Δrow=0  → hex (+1,  0)
//   drStep: Δcol=+1, Δrow=+1 → hex ( 0, +1)
//
// Inverting that 2×2 system:
//   hx = (col - row) / 2
//   hy = row
//
// col and row are always even+even or odd+odd (the layout guarantees col-row
// is always even), so (col - row) / 2 is always an integer — no rounding needed.

function physicalToHexSpace(col, row) {
  return { x: (col - row) / 2, y: row };
}

function buildTS41Map(anchorNote) {
  const note1 = Math.max(1, Math.min(TS41_TOTAL_NOTES, anchorNote));
  const anchorPhys = noteToPhysical(note1);
  const { x: ax, y: ay } = physicalToHexSpace(anchorPhys.col, anchorPhys.row);

  const entries = [];
  for (let note = 1; note <= TS41_TOTAL_NOTES; note++) {
    const phys = noteToPhysical(note);
    if (!phys) continue;
    const { x, y } = physicalToHexSpace(phys.col, phys.row);
    entries.push({ ch: 1, note, x: x - ax, y: y - ay });
  }
  return makeMap(entries);
}

// ── Intuitive Instruments Exquis ──────────────────────────────────────────────
// 61 keys (Rainbow Layout, Preset 6), single MIDI channel, notes 0–60.
// Notes are numbered column-first:
//   Even columns (0,2,4,6,8,10) have 6 keys each (notes at rows 0–5).
//   Odd columns  (1,3,5,7,9)    have 5 keys each (notes at rows 0–4).
// Column k starts at note: sum of sizes of all previous columns.
//   Even col c: offset = 6*(c/2) + 5*((c-1)/2+1)   simplified: 6*(c÷2) + 5*⌈c/2⌉
//   ...or precomputed: col 0→0, 1→6, 2→11, 3→17, 4→22, 5→28, 6→33, 7→39, 8→44, 9→50, 10→55.
//
// Physical geometry (pointy-top hexagons, same orientation as AXIS-49):
//   Odd columns are staggered DOWN by 0.5 hex unit.
//   x_phys = col,  y_phys = row + (col % 2 === 1 ? 0.5 : 0)
//
// Hexatone axial (r, dr) coordinates via same basis transform as AXIS-49:
//   hx = 0.5·Δx_phys − Δy_phys
//   hy = 0.5·Δx_phys + Δy_phys

// EXQUIS_COL_NOTE_START[c]: first MIDI note number assigned to column c (0-indexed, notes 0–60).
const EXQUIS_COL_NOTE_START = [0, 6, 11, 17, 22, 28, 33, 39, 44, 50, 55];
// EXQUIS_COL_SIZES[c]: number of keys in column c (even cols=6, odd cols=5).
const EXQUIS_COL_SIZES      = [6, 5, 6, 5, 6, 5, 6, 5, 6, 5, 6];

/** Convert Exquis note 0–60 → { col, row } in physical grid. */
function exquisNoteToColRow(note) {
  // Find which column the note falls in using the precomputed column note-starts.
  let col = 10;
  for (let c = 0; c < 11; c++) {
    if (note < EXQUIS_COL_NOTE_START[c] + EXQUIS_COL_SIZES[c]) { col = c; break; }
  }
  const row = note - EXQUIS_COL_NOTE_START[col];
  return { col, row };
}

/** Physical (col, row) → continuous hex-space (x_phys, y_phys). */
function exquisHexSpace(col, row) {
  return {
    x: col,
    y: row + (col % 2 === 1 ? 0.5 : 0),
  };
}

function buildExquisMap(anchorNote) {
  const note1 = Math.max(0, Math.min(60, anchorNote));
  const { col: anchorCol, row: anchorRow } = exquisNoteToColRow(note1);
  const { x: axPhys, y: ayPhys } = exquisHexSpace(anchorCol, anchorRow);

  const entries = [];
  for (let note = 0; note <= 60; note++) {
    const { col, row } = exquisNoteToColRow(note);
    const { x: xPhys, y: yPhys } = exquisHexSpace(col, row);
    // Same basis transform as AXIS-49 (pointy-top hex, same orientation):
    //   hx = 0.5·Δx_phys − Δy_phys
    //   hy = 0.5·Δx_phys + Δy_phys
    const dx = xPhys - axPhys;
    const dy = yPhys - ayPhys;
    entries.push({ ch: 1, note, x: Math.round(0.5 * dx - dy), y: Math.round(0.5 * dx + dy) });
  }
  return makeMap(entries);
}

// ── Lumatone ──────────────────────────────────────────────────────────────────
// 5 blocks × 56 keys, one MIDI channel per block (channels 1–5).
// Geometry and block offsets defined in lumatone.js; imported above.

function buildLumatoneMap(anchorChannel, anchorNote) {
  const anchorBlockOffset = LUMATONE_BLOCK_OFFSETS[anchorChannel - 1];
  const entries = [];
  for (let block = 0; block < LUMATONE_BLOCKS; block++) {
    const ch = block + 1;
    const bx = LUMATONE_BLOCK_OFFSETS[block].x - anchorBlockOffset.x;
    const by = LUMATONE_BLOCK_OFFSETS[block].y - anchorBlockOffset.y;
    for (let note = 0; note < LUMATONE_NOTES_PER_BLOCK; note++) {
      const { x, y } = lumatoneNoteOffset(note, anchorNote);
      entries.push({ ch, note, x: x + bx, y: y + by });
    }
  }
  return makeMap(entries);
}

// ── Tonal Plexus ──────────────────────────────────────────────────────────────
// First-pass geometry for the HPI Tonal Plexus / TPX.
//
// The hardware exposes 6 physical Bosanquet blocks across channel pairs:
//   3–4, 5–6, 7–8, 9–10, 11–12, 13–14
//
// Per block:
//   odd channel  = notes 0–104  (105 addresses)
//   even channel = notes 0–105  (106 addresses)
//   total MIDI addresses per block = 211
//
// The physical block has 205 keys, so 6 addresses are seam aliases. The exact
// aliasing visible in the supplied TPX diagram is not yet fully machine-read, so
// this implementation makes the seam assumptions explicit in one place and keeps
// the rest of the geometry deterministic and easy to refine after hardware tests.
//
// Geometry model:
//   • One TPX block is represented as two side-by-side half-fields:
//       6 odd-channel columns + 6 even-channel columns
//   • Columns use pointy-top hex staggering (same continuous hex-space model as
//     AXIS-49 / Exquis): x = col, y = row + (col % 2 === 1 ? 0.5 : 0)
//   • Six blocks are then laid out horizontally with a fixed block stride.
//
// This is sufficient for 2D key recognition and can be tightened later by
// adjusting only TPX_COLUMN_LAYOUT / TPX_SEAM_ALIASES / TPX_BLOCK_OFFSETS.

const TPX_CHANNEL_PAIRS = [
  { odd: 3,  even: 4  },
  { odd: 5,  even: 6  },
  { odd: 7,  even: 8  },
  { odd: 9,  even: 10 },
  { odd: 11, even: 12 },
  { odd: 13, even: 14 },
];

const TPX_BLOCK_STRIDE_X = 14;
const TPX_BLOCK_OFFSETS = TPX_CHANNEL_PAIRS.map((_, index) => ({
  x: index * TPX_BLOCK_STRIDE_X,
  y: 0,
}));

const TPX_COLUMN_LAYOUT = [
  { channelKind: 'odd',  x: 0,  start: 0,  length: 18 },
  { channelKind: 'odd',  x: 1,  start: 18, length: 18 },
  { channelKind: 'odd',  x: 2,  start: 36, length: 16 },
  { channelKind: 'odd',  x: 3,  start: 52, length: 17 },
  { channelKind: 'odd',  x: 4,  start: 69, length: 19 },
  { channelKind: 'odd',  x: 5,  start: 88, length: 17 },
  { channelKind: 'even', x: 6,  start: 0,  length: 18 },
  { channelKind: 'even', x: 7,  start: 18, length: 18 },
  { channelKind: 'even', x: 8,  start: 36, length: 16 },
  { channelKind: 'even', x: 9,  start: 52, length: 18 },
  { channelKind: 'even', x: 10, start: 70, length: 18 },
  { channelKind: 'even', x: 11, start: 88, length: 18 },
];

// Inferred duplicate-note aliases from the TPX reference image and user notes.
// The currently confirmed duplicates are the repeated note numbers on the odd
// channel. These addresses collapse onto the same physical hex.
const TPX_SEAM_ALIASES = new Map([
  ['odd.18', 'odd.17'],
  ['odd.36', 'odd.35'],
  ['odd.52', 'odd.51'],
  ['odd.69', 'odd.68'],
  ['odd.88', 'odd.87'],
]);

function tpxHexSpace(col, row) {
  return {
    x: col,
    y: row + (col % 2 === 1 ? 0.5 : 0),
  };
}

function buildTonalPlexusBlockAddressMap() {
  const block = new Map();

  for (const { channelKind, x: col, start, length } of TPX_COLUMN_LAYOUT) {
    for (let offset = 0; offset < length; offset++) {
      const note = start + offset;
      const key = `${channelKind}.${note}`;
      const coords = tpxHexSpace(col, offset);
      block.set(key, coords);
    }
  }

  for (const [targetKey, sourceKey] of TPX_SEAM_ALIASES) {
    const sourceCoords = block.get(sourceKey);
    if (!sourceCoords) {
      throw new Error(`TPX seam alias source missing: ${sourceKey}`);
    }
    block.set(targetKey, sourceCoords);
  }

  return block;
}

const TPX_BLOCK_ADDRESS_MAP = buildTonalPlexusBlockAddressMap();

function buildTonalPlexusMap(anchorChannel, anchorNote) {
  const anchorPairIndex = TPX_CHANNEL_PAIRS.findIndex(
    ({ odd, even }) => anchorChannel === odd || anchorChannel === even,
  );
  const safePairIndex = anchorPairIndex >= 0 ? anchorPairIndex : 2;
  const safeAnchorChannel = anchorPairIndex >= 0 ? anchorChannel : TPX_CHANNEL_PAIRS[safePairIndex].even;
  const anchorChannelKind = safeAnchorChannel % 2 === 1 ? 'odd' : 'even';
  const anchorLocal = TPX_BLOCK_ADDRESS_MAP.get(`${anchorChannelKind}.${anchorNote}`)
    ?? TPX_BLOCK_ADDRESS_MAP.get(`even.${anchorNote}`)
    ?? TPX_BLOCK_ADDRESS_MAP.get(`odd.${anchorNote}`)
    ?? TPX_BLOCK_ADDRESS_MAP.get('even.60');
  const anchorBlockOffset = TPX_BLOCK_OFFSETS[safePairIndex];
  const anchorWorldX = anchorLocal.x + anchorBlockOffset.x;
  const anchorWorldY = anchorLocal.y + anchorBlockOffset.y;

  const entries = [];
  for (let pairIndex = 0; pairIndex < TPX_CHANNEL_PAIRS.length; pairIndex++) {
    const pair = TPX_CHANNEL_PAIRS[pairIndex];
    const blockOffset = TPX_BLOCK_OFFSETS[pairIndex];
    for (const [key, local] of TPX_BLOCK_ADDRESS_MAP.entries()) {
      const [channelKind, noteString] = key.split('.');
      const note = Number(noteString);
      const ch = channelKind === 'odd' ? pair.odd : pair.even;
      entries.push({
        ch,
        note,
        x: Math.round(local.x + blockOffset.x - anchorWorldX),
        y: Math.round(local.y + blockOffset.y - anchorWorldY),
      });
    }
  }

  return makeMap(entries);
}

const TPX_41_EVEN_GROUPS = [
  [0, 4], [5, 9], [10, 14], [15, 20], [21, 25],
  [26, 30], [31, 35], [36, 40], [41, 45], [46, 50],
  [51, 55], [56, 60], [61, 65], [66, 71], [72, 76],
  [77, 81], [82, 86], [87, 91], [92, 96], [97, 101],
];

const TPX_41_ODD_GROUPS = [
  [3, 7], [8, 12], [13, 17], [18, 22], [23, 27],
  [28, 32], [33, 38], [39, 43], [44, 48], [49, 54],
  [55, 59], [60, 64], [65, 69], [70, 74], [75, 79],
  [80, 84], [85, 90], [91, 95], [96, 100], [101, 105],
];

export function getTonalPlexusInputMode(settings = {}) {
  return settings.tonalplexus_input_mode || 'blocks_41';
}

function getTonalPlexus41ExtraCounts(settings = {}) {
  const equivSteps = settings.equivSteps ?? 41;
  const extraSteps = Math.max(0, Math.min(10, equivSteps - 41));
  if (extraSteps <= 4) {
    return {
      topExtraCount: extraSteps,
      bottomExtraCount: 0,
    };
  }
  if (extraSteps <= 8) {
    return {
      topExtraCount: 4,
      bottomExtraCount: extraSteps - 4,
    };
  }
  if (extraSteps === 9) {
    return {
      topExtraCount: 5,
      bottomExtraCount: 4,
    };
  }
  return {
    topExtraCount: 5,
    bottomExtraCount: 5,
  };
}

function findTonalPlexusGroupIndex(note, groups) {
  return groups.findIndex(([lo, hi]) => note >= lo && note <= hi);
}

export function normalizeTonalPlexus41Input(channel, note) {
  return normalizeTonalPlexus41InputWithSettings(channel, note, {});
}

export function normalizeTonalPlexus205Degree(channel, note) {
  const channel0 = channel - 1;
  if (channel0 < 2 || channel0 > 13) return null;

  const blockIndex = Math.floor((channel0 - 2) / 2);
  const isEvenChannel = channel0 % 2 === 0;

  if (isEvenChannel) {
    if (note < 0 || note > 104) return null;
    let degree = note - 7;
    if (note >= 18) degree -= 1;
    if (note >= 69) degree -= 1;
    return { block: blockIndex, degree };
  }

  if (note < 0 || note > 105) return null;
  let degree = 95 + note;
  if (note >= 36) degree -= 1;
  if (note >= 52) degree -= 1;
  if (note >= 88) degree -= 1;
  return { block: blockIndex, degree };
}

export function normalizeTonalPlexus41InputWithSettings(channel, note, settings = {}) {
  const channel0 = channel - 1;
  if (channel0 < 2 || channel0 > 13) return null;

  const blockIndex = Math.floor((channel0 - 2) / 2);
  const isEvenChannel = channel0 % 2 === 0;
  const { topExtraCount, bottomExtraCount } = getTonalPlexus41ExtraCounts(settings);

  if (isEvenChannel) {
    if (note >= 0 && note < bottomExtraCount) {
      return { channel: blockIndex + 1, note: note - bottomExtraCount + 1 };
    }
    if (note >= 102 && note <= 104) return { channel: blockIndex + 1, note: 21 };
    const groupIndex = findTonalPlexusGroupIndex(note, TPX_41_EVEN_GROUPS);
    return groupIndex >= 0 ? { channel: blockIndex + 1, note: groupIndex + 1 } : null;
  }

  if (note >= 0 && note <= 2) return { channel: blockIndex + 1, note: 21 };
  if (topExtraCount > 0) {
    const topExtraStart = 106 - topExtraCount;
    if (note >= topExtraStart && note <= 105) {
      return { channel: blockIndex + 1, note: 42 + (note - topExtraStart) };
    }
  }
  const groupIndex = findTonalPlexusGroupIndex(note, TPX_41_ODD_GROUPS);
  return groupIndex >= 0 ? { channel: blockIndex + 1, note: groupIndex + 22 } : null;
}

// ── LinnStrument 128 ──────────────────────────────────────────────────────────
// 16 columns × 8 rows, multi-channel (each row = one channel, channels 1–8).
// Default note layout: each column = +1 semitone, each row = +5 semitones up.
// note = anchorNote + col * colStep + (row-anchorRow) * rowStep
// colStep = 1, rowStep = 5 (standard 4ths tuning, configurable on device).

function buildLinnstrumentMap(anchorNote, colStep = 1, rowStep = 5) {
  const COLS = 16, ROWS = 8;
  // LinnStrument sends note on channel = row+1 (row 0 = ch1)
  // Find anchor row and col from anchorNote (assume anchor is at row 0 col 0)
  const entries = [];
  for (let row = 0; row < ROWS; row++) {
    const ch = row + 1;
    for (let col = 0; col < COLS; col++) {
      const note = anchorNote + col * colStep + row * rowStep;
      if (note < 0 || note > 127) continue;
      entries.push({ ch, note, x: col, y: -row }); // y inverted: higher row = higher pitch
    }
  }
  return makeMap(entries);
}

// ── Ableton Push 2 ────────────────────────────────────────────────────────────
// 8×8 grid, single channel. Default isomorphic layout: +1 col = +1 semitone,
// +1 row up = +5 semitones (4ths). Notes start at bottom-left = anchorNote.

function buildPushMap(anchorNote, colStep = 1, rowStep = 5) {
  const SIZE = 8;
  const entries = [];
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const note = anchorNote + col * colStep + row * rowStep;
      if (note < 0 || note > 127) continue;
      entries.push({ ch: 1, note, x: col, y: row });
    }
  }
  return makeMap(entries);
}

// ── Novation Launchpad (Pro / X / Mini mk3) ───────────────────────────────────
// 8×8 performance grid (notes 11–88 in default session layout, or custom).
// In "programmer mode" notes are 11 + row*10 + col (row/col 1-indexed).
// Single channel, isomorphic when set to scale mode (+1 col = +2, +1 row = +5).

function buildLaunchpadMap(anchorNote, colStep = 2, rowStep = 5) {
  const entries = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      // Programmer mode: note = 11 + row*10 + col (bottom-left = note 11)
      const physNote = 11 + row * 10 + col;
      // Map to pitch offset from anchor
      const note = physNote; // we store the physical note as-is
      const x = col * colStep - (col * colStep);  // relative to anchor col=0
      entries.push({ ch: 1, note: physNote, x: col, y: row });
    }
  }
  // Re-centre around anchorNote
  const anchorRow = Math.floor((anchorNote - 11) / 10);
  const anchorCol = (anchorNote - 11) % 10;
  const result = new Map();
  for (const [key, val] of makeMap(entries)) {
    const [ch, note] = key.split('.').map(Number);
    const row = Math.floor((note - 11) / 10);
    const col = (note - 11) % 10;
    result.set(key, { x: col - anchorCol, y: row - anchorRow });
  }
  return result;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const CONTROLLER_REGISTRY = [
  {
    id: 'tonalplexus',
    name: 'Tonal Plexus',
    detect: name => name.includes('tonal plexus') || name.includes('tonalplexus') || name.includes('tpx'),
    description: '6 Bosanquet blocks across channel pairs 3–14.',
    multiChannel: true,
    mpe: false,
    anchorDefault: 7,
    anchorChannelDefault: 9,
    sequentialTransposeDefault: null,
    sequentialChannelGroupSize: 1,
    sequentialLegacyDefault: false,
    learnConstraints: {
      noteRange:    { min: 0, max: 105 },
      channelRange: { min: 3, max: 14 },
      multiChannel: true,
    },
    defaultMode: 'blocks41',
    modes: {
      blocks41: {
        defaultPrefs: {
          anchorNote: 7,
          anchorChannel: 9,
          midi_passthrough: true,
          tonalplexus_input_mode: 'blocks_41',
        },
      },
      layout205: {
        defaultPrefs: {
          anchorNote: 7,
          anchorChannel: 9,
          midi_passthrough: false,
          tonalplexus_input_mode: 'layout_205',
        },
      },
    },
    resolveMode: (settings = {}) => (getTonalPlexusInputMode(settings) === 'layout_205' ? 'layout205' : 'blocks41'),
    normalizeInput: (channel, note, settings = {}) => (
      getTonalPlexusInputMode(settings) === 'blocks_41'
        ? normalizeTonalPlexus41InputWithSettings(channel, note, settings)
        : { channel, note }
    ),
    resolveScaleInputPitchCents: (channel, note, settings = {}) => {
      if (getTonalPlexusInputMode(settings) !== 'layout_205') return null;
      const normalized = normalizeTonalPlexus205Degree(channel, note);
      if (!normalized) return null;
      return normalized.degree * (1200 / 205);
    },
    buildMap: (anchorNote, anchorChannel) => buildTonalPlexusMap(anchorChannel ?? 9, anchorNote ?? 7),
  },

  {
    id: 'axis49',
    name: 'C-Thru AXIS-49 2A',
    detect: name => name.includes('axis-4') || name.includes('axis 4'),
    description: 'Selfless mode (Ch 1, Notes 1–98). 14×7 isomorphic hexes.',
    multiChannel: false,
    mpe: false,
    anchorDefault: 53,  // note 53 is the centre key in selfless mode
    defaultMode: 'layout2d',
    modes: {
      layout2d: {
        defaultPrefs: {
          anchorNote:       53,
          midi_passthrough: false,
        },
      },
      bypass: {
        defaultPrefs: {
          anchorNote:       50,  // centre of the 0–127 MIDI range
          midi_passthrough: true,
        },
      },
    },
    resolveMode: (settings = {}) => (settings.midi_passthrough ? 'bypass' : 'layout2d'),
    buildMap: (anchorNote) => buildAxis49Map(anchorNote ?? 53),
  },

  {
    id: 'ts41',
    name: 'TS41 MIDI Keyboard',
    detect: name => name.includes('ts41'),
    description: '41edo mode (Ch 1, Notes 1–126). Bosanquet Layout.',
    multiChannel: false,
    mpe: false,
    anchorDefault: 36,
    defaultMode: 'layout2d',
    modes: {
      layout2d: {
        defaultPrefs: {
          anchorNote:       36,
          midi_passthrough: false,
        },
      },
      bypass: {
        defaultPrefs: {
          anchorNote:       60,
          midi_passthrough: true,
        },
      },
    },
    resolveMode: (settings = {}) => (settings.midi_passthrough ? 'bypass' : 'layout2d'),
    buildMap: (anchorNote) => buildTS41Map(anchorNote ?? 36),
  },

  {
    id: 'lumatone',
    name: 'Lumatone',
    detect: name => name.includes('lumatone') || name.includes('midi function'),
    description: '5 blocks × 56 keys, channels 1–5 encode block position.',
    multiChannel: true,
    mpe: false,  // channels encode block geometry, not per-voice MPE expression
    anchorDefault: 26,  // note 26 in centre block is the default centre key
    anchorChannelDefault: 3,  // centre block
    // In sequential/bypass mode: channels 1–5 map to blocks — transposition by equave
    // and mod-8 wrapping are both needed for correct note mapping.
    sequentialTransposeDefault: null,  // null = equave (one equave per channel)
    sequentialLegacyDefault: true,     // wrap channels 9–16 → 1–8
    buildMap: (anchorNote, anchorChannel) => buildLumatoneMap(anchorChannel ?? 3, anchorNote ?? 26),
    learnConstraints: {
      noteRange:     { min: 0, max: 55 },
      channelRange:  { min: 1, max: 5 },
      multiChannel:  true,
    },
    // Mode-aware persistence: separate anchor and prefs for 2D geometry vs bypass.
    // Anchor note (0–55 within block) and channel (1–5) both differ between modes.
    defaultMode: 'layout2d',
    modes: {
      layout2d: {
        defaultPrefs: {
          anchorNote:    26,  // note 26 within the centre block
          anchorChannel: 3,   // block 3 = centre block
          midi_passthrough: false,
        },
      },
      bypass: {
        defaultPrefs: {
          anchorNote:    60,  // MIDI note 60 in sequential mode (full 0–127 range)
          anchorChannel: 4,
          midi_passthrough: true,
        },
      },
    },
    resolveMode: (settings = {}) => (settings.midi_passthrough ? 'bypass' : 'layout2d'),
  },

  {
    id: 'linnstrument128',
    name: 'Roger Linn Design LinnStrument 128',
    detect: name => name.includes('linnstrument'),
    description: '16×8 grid, row per channel (ch1–8). Sends MPE: per-voice pitch bend, pressure, and CC74.',
    multiChannel: true,
    mpe: true,  // each row's channel carries per-voice expression for that voice
    // LinnStrument uses ch 1–8 (one per row); configurable on device but 1–8 is the default.
    // null here means user-configurable — the MPE channel range picker is shown in the UI.
    mpeVoiceChannels: null,
    anchorDefault: 30,
    buildMap: (anchorNote) => buildLinnstrumentMap(anchorNote ?? 30),
  },

  {
    id: 'push2',
    name: 'Ableton Push 2 / Push 3',
    detect: name => name.includes('push 2') || name.includes('push 3') || name.includes('push2') || name.includes('push3'),
    description: '8×8 isomorphic grid, single channel. Default 4ths tuning.',
    multiChannel: false,
    mpe: false,
    anchorDefault: 36,
    defaultMode: 'layout2d',
    modes: {
      layout2d: {
        defaultPrefs: {
          anchorNote:       36,
          midi_passthrough: false,
        },
      },
      bypass: {
        defaultPrefs: {
          anchorNote:       60,
          midi_passthrough: true,
        },
      },
    },
    resolveMode: (settings = {}) => (settings.midi_passthrough ? 'bypass' : 'layout2d'),
    buildMap: (anchorNote) => buildPushMap(anchorNote ?? 36),
  },

  {
    id: 'launchpad',
    name: 'Novation Launchpad (Pro / X / Mini mk3)',
    detect: name => name.includes('launchpad'),
    description: '8×8 grid in programmer mode. Set device to scale/isomorphic mode for best results.',
    multiChannel: false,
    mpe: false,
    anchorDefault: 36,
    defaultMode: 'layout2d',
    modes: {
      layout2d: {
        defaultPrefs: {
          anchorNote:       36,
          midi_passthrough: false,
        },
      },
      bypass: {
        defaultPrefs: {
          anchorNote:       60,
          midi_passthrough: true,
        },
      },
    },
    resolveMode: (settings = {}) => (settings.midi_passthrough ? 'bypass' : 'layout2d'),
    buildMap: (anchorNote) => buildLaunchpadMap(anchorNote ?? 36),
  },

  {
    id: 'exquis',
    name: 'Exquis (Intuitive Instruments)',
    detect: name => name.includes('exquis'),
    description: '61-note hexagonal grid. Hexatone maps layout and colours automatically and toggles MPE mode. In MPE mode set Pitch Bend Range on Exquis to 48 (Settings 2, Encoder 2).',
    descriptionScale: '61-note hexagonal grid. User may choose Exquis Layout and MPE/Polytouch mode manually on their device. Set Exquis Pitch Bend Range to 48 (Settings 2, Encoder 2).',
    multiChannel: false,
    mpe: true,  // Exquis sends MPE (per-note pitch bend and pressure on individual channels)
    // In Rainbow Layout the Exquis always uses ch 2–15 for MPE voices.
    // This is fixed by the device — the channel range picker is hidden in the UI.
    mpeVoiceChannels: { lo: 2, hi: 15 },
    anchorDefault: 19,
    defaultMode: 'layout2d',
    modes: {
      layout2d: {
        defaultPrefs: {
          anchorNote: 19,
          midi_passthrough: false,
          midiin_mpe_input: true,
          midiin_bend_flip: true,
        },
      },
      bypass: {
        defaultPrefs: {
          anchorNote: 19,
          midi_passthrough: true,
          midiin_mpe_input: false,
          midiin_bend_flip: false,
        },
      },
    },
    resolveMode: (settings = {}) => (settings.midi_passthrough ? 'bypass' : 'layout2d'),
    buildMap: (anchorNote) => buildExquisMap(anchorNote ?? 19),
  },

  {
    id: 'generic',
    name: 'Generic Single-Channel Keyboard',
    // Never auto-detected — selected manually via the controller override dropdown.
    detect: () => false,
    description: '1D keyboard input. 2D geometry is bypassed; anchor channel and per-channel offset are user-configurable.',
    multiChannel: false,
    mpe: false,
    anchorDefault: 60,
    anchorChannelDefault: 1,
    supportsSequentialChannelOffset: true,
  },
];

/**
 * Find the registry entry for a device name, or null if unknown.
 * @param {string} deviceName  lowercase device name
 * @returns {object|null}
 */
export function detectController(deviceName) {
  if (!deviceName) return null;
  const name = deviceName.toLowerCase();
  return CONTROLLER_REGISTRY.find(c => c.detect(name)) ?? null;
}

export function getControllerById(id) {
  if (!id) return null;
  return CONTROLLER_REGISTRY.find((controller) => controller.id === id) ?? null;
}

/**
 * Get the anchor MIDI note for a controller from settings.
 * Universal: always uses midiin_central_degree (the MIDI note → central screen degree mapping).
 * Falls back to controller's anchorDefault if not set.
 */
export function getAnchorNote(controller, settings) {
  if (settings.midiin_central_degree != null) return settings.midiin_central_degree;
  return controller.anchorDefault ?? 60;
}

/** Legacy alias */
export function getAnchorParams(controller, settings) {
  return { anchorNote: getAnchorNote(controller, settings) };
}
