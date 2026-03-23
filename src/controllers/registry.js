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
  }
  return m;
}

// ── AXIS-49 2A ────────────────────────────────────────────────────────────────
// 14 columns × 7 rows, single MIDI channel (selfless mode, notes 1–98).
// Two banks of 7 columns; Bank 2 (cols 7-13) is staggered 0.5 rows down.
// Within each bank, odd columns stagger 0.5 rows down.
// note = col * 7 + row + 1  (col 0–13, row 0–6)

// THIS LOGIC IS FLAWED: THE APP ALREADY CAN PROCESS FROM COORDS, WE ONLY NEED TO CALCULATE COORDS!

function buildAxis49Map(anchorNote, anchorChannel, rSteps, drSteps) {
  // AXIS-49 Selfless mode: 14 cols × 7 rows, notes 1-98, single channel.
  // Anchor: the AXIS MIDI note that maps to the screen centre degree.
  // Physical layout: +1 col = ROWS notes apart. Each note = 1 chromatic step.
  //
  // Screen (x, y) formula — pitch steps from anchor = x*rSteps + y*drSteps:
  //   x = col - anchorCol          (column offset; 1 col = rSteps steps if rSteps=7)
  //   y = round((steps - x*rSteps) / drSteps)  (residual onto y axis)
  //
  // With rSteps=7, drSteps=4 (standard Wicki-Hayden Bosanquet):
  //   note 53 (anchor) → (0,0)
  //   note 60 (+7 steps, +1 col) → (1,0)
  //   note 57 (+4 steps, same col) → (0,1)

  const ROWS = 7, COLS = 14;
  const anchorNote1 = Math.max(1, Math.min(98, anchorNote));
  const anchorCol   = Math.floor((anchorNote1 - 1) / ROWS);
  const rs = rSteps  || 7;
  const ds = drSteps || 4;

  const entries = [];
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const note  = col * ROWS + row + 1;
      const steps = note - anchorNote1;       // chromatic steps from anchor
      const x     = col - anchorCol;          // column offset
      const y     = Math.round((steps - x * rs) / ds);
      entries.push({ ch: 1, note, x, y });
    }
  }
  return makeMap(entries);
}

// ── Lumatone ──────────────────────────────────────────────────────────────────
// 5 blocks × 56 keys, one MIDI channel per block (channels 1–5).
// Within-block formula (anchor note A, note N):
//   diff = N - A
//   x_raw = ((diff % 6) + 6) % 6; x = x_raw > 3 ? x_raw - 6 : x_raw  (-2..+3)
//   y = (diff - x) / 6  (-5..+4)
// Block offsets: each successive block shifts by +6 in x (horizontal staircase).
// Physical y-offset between blocks needs hardware calibration; default 0.

const LUMATONE_NOTES = 56;
const LUMATONE_BLOCKS = 5;
// Default inter-block offset in hex grid units [dx, dy] per block step
const BLOCK_OFFSETS = [
  { dx: 0,  dy: 0  }, // block 1 (channel 1) — anchor block
  { dx: 6,  dy: 0  }, // block 2
  { dx: 12, dy: 0  }, // block 3
  { dx: 18, dy: 0  }, // block 4
  { dx: 24, dy: 0  }, // block 5
];

function lumatoneNoteOffset(note, anchorNote) {
  const diff = note - anchorNote;
  let x = ((diff % 6) + 6) % 6;
  if (x > 3) x -= 6;
  const y = (diff - x) / 6;
  return { x, y };
}

function buildLumatoneMap(anchorChannel, anchorNote) {
  const entries = [];
  for (let block = 0; block < LUMATONE_BLOCKS; block++) {
    const ch = block + 1;                  // 1-based channel
    const bx = BLOCK_OFFSETS[block].dx;
    const by = BLOCK_OFFSETS[block].dy;
    for (let note = 0; note < LUMATONE_NOTES; note++) {
      // Offset within block relative to anchorNote (only meaningful for anchor block)
      const { x, y } = lumatoneNoteOffset(note, anchorNote);
      // Add block displacement relative to anchor block
      const anchorBlockDx = BLOCK_OFFSETS[anchorChannel - 1].dx;
      const anchorBlockDy = BLOCK_OFFSETS[anchorChannel - 1].dy;
      entries.push({
        ch, note,
        x: x + bx - anchorBlockDx,
        y: y + by - anchorBlockDy,
      });
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
    description: 'Selfless mode (single channel, notes 1–98). 14×7 isomorphic hex grid.',
    multiChannel: false,
    anchorDefault: 49,  // AXIS-49 physical note 49 is the centre key
    buildMap: (anchorNote, anchorChannel, rSteps, drSteps) => buildAxis49Map(anchorNote ?? 49, anchorChannel, rSteps, drSteps),
  },

  {
    id: 'lumatone',
    name: 'Lumatone',
    detect: name => name.includes('lumatone'),
    description: '5 blocks × 56 keys, channels 1–5 encode block position.',
    multiChannel: true,
    anchorDefault: 27,  // note 27 in centre block is the default centre key
    anchorChannelDefault: 3,  // centre block
    buildMap: (anchorNote, anchorChannel) => buildLumatoneMap(anchorChannel ?? 3, anchorNote ?? 27),
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