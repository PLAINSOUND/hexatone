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

// ── Generic Single-Channel Keyboard ──────────────────────────────────────────
// Any device sending 128 notes on a single MIDI channel.
// Notes are mapped linearly along the x-axis: note N → x = N − anchorNote, y = 0.
// Designed for use with DIRECT + Tuning Map output, where hexatone sends back
// the exact tuning for each received MIDI note number.

function buildGenericKeyboardMap(anchorNote) {
  const entries = [];
  for (let note = 0; note <= 127; note++) {
    entries.push({ ch: 1, note, x: note - anchorNote, y: 0 });
  }
  return makeMap(entries);
}

// ── Exquis ────────────────────────────────────────────────────────────────────
// Hexagonal grid 7 columns × 11 rows, single channel.
// Notes sent as standard MIDI 0–127, isomorphic layout configurable on device.
// Default: +1 col = +2 semitones, +1 row = +5 semitones.

function buildExquisMap(anchorNote, colStep = 2, rowStep = 5) {
  const COLS = 7, ROWS = 11;
  const entries = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const note = anchorNote + col * colStep + row * rowStep;
      if (note < 0 || note > 127) continue;
      entries.push({ ch: 1, note, x: col, y: row });
    }
  }
  return makeMap(entries);
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const CONTROLLER_REGISTRY = [
  {
    id: 'axis49',
    name: 'C-Thru AXIS-49 2A',
    detect: name => name.includes('axis-4') || name.includes('axis 4'),
    description: 'Selfless mode (Ch 1, Notes 1–98). 14×7 isomorphic hexes.',
    multiChannel: false,
    anchorDefault: 53,  // AXIS-49 physical note 49 is the centre key
    buildMap: (anchorNote) => buildAxis49Map(anchorNote ?? 53),
  },

  {
    id: 'lumatone',
    name: 'Lumatone',
    detect: name => name.includes('lumatone'),
    description: '5 blocks × 56 keys, channels 1–5 encode block position.',
    multiChannel: true,
    anchorDefault: 26,  // note 26 in centre block is the default centre key
    anchorChannelDefault: 3,  // centre block
    buildMap: (anchorNote, anchorChannel) => buildLumatoneMap(anchorChannel ?? 3, anchorNote ?? 26),
  },

  {
    id: 'linnstrument128',
    name: 'Roger Linn Design LinnStrument 128',
    detect: name => name.includes('linnstrument'),
    description: '16×8 grid, row per channel (ch1–8). Default 4ths tuning (+1 col = +1, +1 row = +5).',
    multiChannel: true,
    anchorDefault: 30,
    buildMap: (anchorNote) => buildLinnstrumentMap(anchorNote ?? 30),
  },

  {
    id: 'push2',
    name: 'Ableton Push 2 / Push 3',
    detect: name => name.includes('push 2') || name.includes('push 3') || name.includes('push2') || name.includes('push3'),
    description: '8×8 isomorphic grid, single channel. Default 4ths tuning.',
    multiChannel: false,
    anchorDefault: 36,
    buildMap: (anchorNote) => buildPushMap(anchorNote ?? 36),
  },

  {
    id: 'launchpad',
    name: 'Novation Launchpad (Pro / X / Mini mk3)',
    detect: name => name.includes('launchpad'),
    description: '8×8 grid in programmer mode. Set device to scale/isomorphic mode for best results.',
    multiChannel: false,
    anchorDefault: 36,
    buildMap: (anchorNote) => buildLaunchpadMap(anchorNote ?? 36),
  },

  {
    id: 'exquis',
    name: 'Exquis (Intuitive Instruments)',
    detect: name => name.includes('exquis'),
    description: '7×11 hex grid, single channel. Set device to isomorphic mode.',
    multiChannel: false,
    anchorDefault: 60,
    buildMap: (anchorNote) => buildExquisMap(anchorNote ?? 60),
  },

  {
    id: 'generic',
    name: 'Generic Single-Channel Keyboard',
    // Never auto-detected — selected manually via the controller override dropdown.
    detect: () => false,
    description: '128 notes on ch 1, mapped linearly around the anchor. Use with DIRECT + Tuning Map output.',
    multiChannel: false,
    anchorDefault: 60,
    buildMap: (anchorNote) => buildGenericKeyboardMap(anchorNote ?? 60),
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