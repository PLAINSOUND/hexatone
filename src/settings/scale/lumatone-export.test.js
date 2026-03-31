import { describe, it, expect } from 'vitest';
import {
  BOARD_KEY_COORDS,
  keyStepsFromRef,
  equaveNoteChannel,
  DEFAULT_CENTRAL_BOARD,
  DEFAULT_CENTRAL_KEY,
  DEFAULT_CENTRAL_CHANNEL,
  DEFAULT_CENTRAL_NOTE,
  SLOT_MAX,
  cssToLtnColor,
  assignSlots,
  hexatoneMappingForLumatone,
  boardsToLtn,
  settingsToLtn,
} from './lumatone-export.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSettings(equivSteps, rSteps, drSteps, overrides = {}) {
  return {
    equivSteps, rSteps, drSteps,
    note_colors: Array.from({ length: equivSteps }, (_, i) =>
      i === 0 ? '#ffffff' : '#880000'
    ),
    fundamental_color: '#f4fafa',
    ...overrides,
  };
}

// 12-edo standard Wicki-Hayden
const S12 = makeSettings(12, 7, 5);
// 53-Tertial (user's reported case)
const S53 = makeSettings(53, 9, 4);

const CS = DEFAULT_CENTRAL_CHANNEL * 128 + DEFAULT_CENTRAL_NOTE; // 444

// ── BOARD_KEY_COORDS ──────────────────────────────────────────────────────────

describe('BOARD_KEY_COORDS', () => {
  it('has exactly 56 entries', () => {
    expect(BOARD_KEY_COORDS).toHaveLength(56);
  });

  it('key 17 is at (col=4, row=3) — internal reference', () => {
    expect(BOARD_KEY_COORDS[17]).toEqual([9, 3]);
  });

  it('key 27 is at (col=2, row=5) — default central key', () => {
    expect(BOARD_KEY_COORDS[27]).toEqual([5, 5]);
  });

  it('key 28 is immediately right of key 27 (col+1, same row)', () => {
    expect(BOARD_KEY_COORDS[28]).toEqual([7, 5]);
  });

  it('key 26 is immediately left of key 27 (col-1, same row)', () => {
    expect(BOARD_KEY_COORDS[26]).toEqual([3, 5]);
  });

  it('key 33 is down-left of key 27 (col-1, row+1)', () => {
    expect(BOARD_KEY_COORDS[33]).toEqual([4, 6]);
  });

  it('key 34 is down-right of key 27 (col+1, row+1)', () => {
    expect(BOARD_KEY_COORDS[34]).toEqual([6, 6]);
  });

  it('all cols are in range 0–6', () => {
    BOARD_KEY_COORDS.forEach(([col]) => {
      expect(col).toBeGreaterThanOrEqual(0);
      expect(col).toBeLessThanOrEqual(6);
    });
  });

  it('all rows are in range 0–10', () => {
    BOARD_KEY_COORDS.forEach(([, row]) => {
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThanOrEqual(10);
    });
  });

  it('row lengths are 2,5,6,6,6,6,6,6,6,5,2', () => {
    const expected = [2, 5, 6, 6, 6, 6, 6, 6, 6, 5, 2];
    const counts = new Array(11).fill(0);
    BOARD_KEY_COORDS.forEach(([, row]) => counts[row]++);
    expect(counts).toEqual(expected);
  });
});

// ── keyStepsFromRef ───────────────────────────────────────────────────────────

describe('keyStepsFromRef', () => {
  it('key 27 on board 2 = 0 (central reference)', () => {
    expect(keyStepsFromRef(27, 2, 7, 5)).toBe(0);
  });

  it('key 17 on board 2 = +11 (12-edo, from central key 27)', () => {
    expect(keyStepsFromRef(17, 2, 7, 5)).toBe(11);
  });

  it('12-edo: key 28 is +7 steps from key 27 (one rStep right)', () => {
    const s27 = keyStepsFromRef(27, 2, 7, 5);
    const s28 = keyStepsFromRef(28, 2, 7, 5);
    expect(s28 - s27).toBe(7);
  });

  it('12-edo: key 26 is −7 steps from key 27 (one rStep left)', () => {
    const s27 = keyStepsFromRef(27, 2, 7, 5);
    const s26 = keyStepsFromRef(26, 2, 7, 5);
    expect(s26 - s27).toBe(-7);
  });

  it('12-edo: key 33 is drSteps-rSteps from key 27 (down-left = drSteps-rSteps = 5-7 = -2)', () => {
    const s27 = keyStepsFromRef(27, 2, 7, 5);
    const s33 = keyStepsFromRef(33, 2, 7, 5);
    expect(s33 - s27).toBe(-5);
  });

  it('53-Tertial: key 28 is +9 steps from key 27', () => {
    const s27 = keyStepsFromRef(27, 2, 9, 4);
    const s28 = keyStepsFromRef(28, 2, 9, 4);
    expect(s28 - s27).toBe(9);
  });

  it('53-Tertial: key 26 is −9 steps from key 27', () => {
    const s27 = keyStepsFromRef(27, 2, 9, 4);
    const s26 = keyStepsFromRef(26, 2, 9, 4);
    expect(s26 - s27).toBe(-9);
  });

  it('53-Tertial: key 33 is drSteps-rSteps from key 27 (down-left = 4-9 = -5)', () => {
    const s27 = keyStepsFromRef(27, 2, 9, 4);
    const s33 = keyStepsFromRef(33, 2, 9, 4);
    expect(s33 - s27).toBe(-4);
  });

  it('12-edo: key 34 is +drSteps from key 27 (down-right = +5)', () => {
    const s27 = keyStepsFromRef(27, 2, 7, 5);
    const s34 = keyStepsFromRef(34, 2, 7, 5);
    expect(s34 - s27).toBe(5);
  });

  it('53-Tertial: key 34 is +drSteps from key 27 (down-right = +4)', () => {
    const s27 = keyStepsFromRef(27, 2, 9, 4);
    const s34 = keyStepsFromRef(34, 2, 9, 4);
    expect(s34 - s27).toBe(4);
  });

  it('board offset: board 3 key 27 is 5·rSteps+2·drSteps from board 2 key 27', () => {
    // Each board adds (col+12, row+2). Step diff = (12-2)/2·rSteps + 2·drSteps = 5r+2dr.
    const b2 = keyStepsFromRef(27, 2, 7, 5);
    const b3 = keyStepsFromRef(27, 3, 7, 5);
    expect(b3 - b2).toBe(5 * 7 + 2 * 5);  // = 45
  });

  it('within row 5 (keys 25-30), all consecutive diffs = +rSteps (12-edo)', () => {
    for (let k = 26; k <= 30; k++) {
      const diff = keyStepsFromRef(k, 2, 7, 5) - keyStepsFromRef(k-1, 2, 7, 5);
      expect(diff).toBe(7);
    }
  });

  it('within row 5 (keys 25-30), all consecutive diffs = +rSteps (53-Tertial)', () => {
    for (let k = 26; k <= 30; k++) {
      const diff = keyStepsFromRef(k, 2, 9, 4) - keyStepsFromRef(k-1, 2, 9, 4);
      expect(diff).toBe(9);
    }
  });
});

// ── Defaults ──────────────────────────────────────────────────────────────────

describe('exported defaults', () => {
  it('central board is 2',                            () => expect(DEFAULT_CENTRAL_BOARD).toBe(2));
  it('central key is 27',                             () => expect(DEFAULT_CENTRAL_KEY).toBe(27));
  it('central channel is 3 (0-indexed = MIDI ch 4)', () => expect(DEFAULT_CENTRAL_CHANNEL).toBe(3));
  it('central note is 60 (C4)',                       () => expect(DEFAULT_CENTRAL_NOTE).toBe(60));
  it('SLOT_MAX is 2047 (16 × 128 − 1)',               () => expect(SLOT_MAX).toBe(2047));
});

// ── cssToLtnColor ─────────────────────────────────────────────────────────────

describe('cssToLtnColor', () => {
  it('converts 6-digit lowercase', () => expect(cssToLtnColor('#e1e1f8')).toBe('E1E1F8'));
  it('converts 6-digit uppercase', () => expect(cssToLtnColor('#E1E1F8')).toBe('E1E1F8'));
  it('expands 3-digit hex',        () => expect(cssToLtnColor('#abc')).toBe('AABBCC'));
  it('#fff → FFFFFF',              () => expect(cssToLtnColor('#fff')).toBe('FFFFFF'));
  it('null → 000000',              () => expect(cssToLtnColor(null)).toBe('000000'));
  it('empty string → 000000',      () => expect(cssToLtnColor('')).toBe('000000'));
  it('named colour → 000000',      () => expect(cssToLtnColor('red')).toBe('000000'));
});

// ── equaveNoteChannel ─────────────────────────────────────────────────────────

describe('equaveNoteChannel', () => {
  const CC = DEFAULT_CENTRAL_CHANNEL; // 3
  const CN = DEFAULT_CENTRAL_NOTE;    // 60
  const ES = 53;
  const centralAbsP = CN + CC * ES;   // 60 + 3*53 = 219

  it('central key: note=60, ch=4', () => {
    const r = equaveNoteChannel(centralAbsP, CC, ES);
    expect(r.note).toBe(60);
    expect(r.ch0).toBe(3);
  });

  it('right of central (S=+9): note=69, ch=4 (same channel)', () => {
    const r = equaveNoteChannel(centralAbsP + 9, CC, ES);
    expect(r.note).toBe(69);
    expect(r.ch0).toBe(3);
  });

  it('left of central (S=−9): note=51, ch=4 (wraps within equave, same channel)', () => {
    const r = equaveNoteChannel(centralAbsP - 9, CC, ES);
    expect(r.note).toBe(51);
    expect(r.ch0).toBe(3);
  });

  it('one equave below central (S=−53): note=7, ch=4 (stays on ch 4)', () => {
    // absolutePitch = 219−53=166. note=166−3*53=7. ch0=3.
    const r = equaveNoteChannel(centralAbsP - 53, CC, ES);
    expect(r.note).toBe(7);
    expect(r.ch0).toBe(3);
  });

  it('left of (note=7, ch=4): note=51, ch=3 (the reported bug case)', () => {
    // absolutePitch = 219−53−9 = 157. note=157−2*53=51. ch0=2 → ch=3.
    const r = equaveNoteChannel(centralAbsP - 62, CC, ES);
    expect(r.note).toBe(51);
    expect(r.ch0).toBe(2);
  });

  it('always returns note in 0..127', () => {
    for (let absP = 0; absP <= 400; absP += 7) {
      const r = equaveNoteChannel(absP, CC, ES);
      if (r) {
        expect(r.note).toBeGreaterThanOrEqual(0);
        expect(r.note).toBeLessThanOrEqual(127);
      }
    }
  });
});

// ── assignSlots ───────────────────────────────────────────────────────────────

describe('assignSlots', () => {
  const CC = DEFAULT_CENTRAL_CHANNEL; // 3 (0-indexed)
  const CN = DEFAULT_CENTRAL_NOTE;    // 60

  it('returns a 5×56 grid', () => {
    const grid = assignSlots(9, 4, 53, CC, CN);
    expect(grid).toHaveLength(5);
    grid.forEach(row => expect(row).toHaveLength(56));
  });

  it('central key gets (centralNote, centralChannel) — 53-Tertial', () => {
    const grid = assignSlots(9, 4, 53, CC, CN);
    const slot = grid[2][27];
    expect(slot % 128).toBe(CN);
    expect(Math.floor(slot / 128) + 1).toBe(CC + 1);   // 1-indexed ch
  });

  it('53-Tertial: key right of central = note 69, ch 4', () => {
    const grid = assignSlots(9, 4, 53, CC, CN);
    const slot = grid[2][28];
    expect(slot % 128).toBe(69);
    expect(Math.floor(slot / 128) + 1).toBe(4);
  });

  it('53-Tertial: key left of (note=7, ch=4) = note 51, ch 3 (equave boundary)', () => {
    const grid = assignSlots(9, 4, 53, CC, CN);
    // Find key at S = −53 (note=7, ch=4): board 1, key 27
    const slot7 = grid[1][27];
    expect(slot7 % 128).toBe(7);
    expect(Math.floor(slot7 / 128) + 1).toBe(4);
    // Its left neighbour (S = −62): board 1, key 26
    const slotL = grid[1][26];
    expect(slotL % 128).toBe(51);
    expect(Math.floor(slotL / 128) + 1).toBe(3);
  });

  for (const [r, dr, es] of [[9,4,53],[9,4,41],[9,4,81],[7,5,31]]) {
    it(`produces 280 unique in-range slots (rSteps=${r}, es=${es})`, () => {
      const slots = assignSlots(r, dr, es, CC, CN).flat().filter(s => s >= 0);
      expect(new Set(slots).size).toBe(slots.length);
      slots.forEach(s => {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(SLOT_MAX);
      });
    });
  }

  it('same-pitch keys get same note number (53-Tertial)', () => {
    const grid = assignSlots(9, 4, 53, CC, CN);
    const pitchNotes = new Map();
    for (let b = 0; b < 5; b++) {
      for (let k = 0; k < 56; k++) {
        if (grid[b][k] < 0) continue;
        const s = keyStepsFromRef(k, b, 9, 4);
        if (!pitchNotes.has(s)) pitchNotes.set(s, new Set());
        pitchNotes.get(s).add(grid[b][k] % 128);
      }
    }
    pitchNotes.forEach(noteSet => expect(noteSet.size).toBe(1));
  });

  it('same-pitch keys get different channels (53-Tertial)', () => {
    const grid = assignSlots(9, 4, 53, CC, CN);
    const pitchChannels = new Map();
    for (let b = 0; b < 5; b++) {
      for (let k = 0; k < 56; k++) {
        if (grid[b][k] < 0) continue;
        const s = keyStepsFromRef(k, b, 9, 4);
        if (!pitchChannels.has(s)) pitchChannels.set(s, []);
        pitchChannels.get(s).push(Math.floor(grid[b][k] / 128));
      }
    }
    pitchChannels.forEach(chs => expect(new Set(chs).size).toBe(chs.length));
  });
});

// ── hexatoneMappingForLumatone ────────────────────────────────────────────────

describe('hexatoneMappingForLumatone', () => {
  const boards12 = hexatoneMappingForLumatone(S12);

  it('returns 5 boards of 56 keys each', () => {
    expect(boards12).toHaveLength(5);
    boards12.forEach(b => expect(b).toHaveLength(56));
  });

  it('each key has note, channel, color, ktyp fields', () => {
    boards12.forEach(b => b.forEach(k => {
      expect(k).toHaveProperty('note');
      expect(k).toHaveProperty('channel');
      expect(k).toHaveProperty('color');
      expect(k).toHaveProperty('ktyp');
    }));
  });

  it('active keys have note in 0–127', () => {
    boards12.forEach(b => b.forEach(k => {
      if (k.ktyp !== 0) {
        expect(k.note).toBeGreaterThanOrEqual(0);
        expect(k.note).toBeLessThanOrEqual(127);
      }
    }));
  });

  it('active keys have channel in 1–16', () => {
    boards12.forEach(b => b.forEach(k => {
      if (k.ktyp !== 0) {
        expect(k.channel).toBeGreaterThanOrEqual(1);
        expect(k.channel).toBeLessThanOrEqual(16);
      }
    }));
  });

  it('all color values are 6-char uppercase hex', () => {
    boards12.forEach(b => b.forEach(k => {
      expect(k.color).toMatch(/^[0-9A-F]{6}$/);
    }));
  });

  it('central key (B2K27): note=60, channel=4 (12-edo)', () => {
    expect(boards12[2][27].note).toBe(60);
    expect(boards12[2][27].channel).toBe(4);
    expect(boards12[2][27].ktyp).toBe(1);
  });

  it('central key (B2K27) uses LUMATONE_TONIC colour when colorTransfer=true', () => {
    // LUMATONE_TONIC = '#df270e'
    expect(boards12[2][27].color).toBe('DF270E');
  });

  it('central key uses fundamental_color when colorTransfer=false', () => {
    const b = hexatoneMappingForLumatone(S12, { colorTransfer: false });
    expect(b[2][27].color).toBe(cssToLtnColor(S12.fundamental_color));
  });

  it('non-central degree-0 keys use LUMATONE_TONIC_OTHER when colorTransfer=true', () => {
    // LUMATONE_TONIC_OTHER = '#902e20'
    const tonicOtherLtn = '902E20';
    for (let b = 0; b < 5; b++) {
      for (let k = 0; k < 56; k++) {
        if (b === 2 && k === 27) continue;  // skip the reference key itself
        const s = keyStepsFromRef(k, b, 7, 5);
        const degree = ((s % 12) + 12) % 12;
        if (degree === 0) {
          expect(boards12[b][k].color).toBe(tonicOtherLtn);
        }
      }
    }
  });

  it('degree 0 keys all use fundamental_color when colorTransfer=false (12-edo)', () => {
    const bNoTransfer = hexatoneMappingForLumatone(S12, { colorTransfer: false });
    for (let b = 0; b < 5; b++) {
      for (let k = 0; k < 56; k++) {
        const s      = keyStepsFromRef(k, b, 7, 5);
        const degree = ((s % 12) + 12) % 12;
        if (degree === 0) {
          expect(bNoTransfer[b][k].color).toBe(cssToLtnColor(S12.fundamental_color));
        }
      }
    }
  });

  it('no two active keys share (note, channel) — 12-edo', () => {
    const pairs = boards12.flat().filter(k => k.ktyp !== 0).map(k => `${k.channel}:${k.note}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('no two active keys share (note, channel) — 5-edo', () => {
    const b5 = hexatoneMappingForLumatone(makeSettings(5, 7, 5));
    const pairs = b5.flat().filter(k => k.ktyp !== 0).map(k => `${k.channel}:${k.note}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('no two active keys share (note, channel) — 53-Tertial', () => {
    const b53 = hexatoneMappingForLumatone(S53);
    const pairs = b53.flat().filter(k => k.ktyp !== 0).map(k => `${k.channel}:${k.note}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('53-Tertial: key 28 (right of central) = note 69, channel 4', () => {
    const b53 = hexatoneMappingForLumatone(S53);
    expect(b53[2][27].note).toBe(60);
    expect(b53[2][27].channel).toBe(4);
    expect(b53[2][28].note).toBe(69);   // 60 + 9 = 69
    expect(b53[2][28].channel).toBe(4); // same channel (no overflow)
  });

  it('53-Tertial: key 26 (left of central) = note 51, channel 4', () => {
    const b53 = hexatoneMappingForLumatone(S53);
    expect(b53[2][26].note).toBe(51);   // 60 - 9 = 51
    expect(b53[2][26].channel).toBe(4);
  });

  it('degree 0 keys always use fundamental_color (12-edo)', () => {
    for (let b = 0; b < 5; b++) {
      for (let k = 0; k < 56; k++) {
        const s      = keyStepsFromRef(k, b, 7, 5);  // already relative to central (board2,key27)
        const degree = ((s % 12) + 12) % 12;
        if (degree === 0) {
          expect(boards12[b][k].color).toBe(cssToLtnColor(S12.fundamental_color));
        }
      }
    }
  });

  describe('custom options', () => {
    it('respects centralNote=48', () => {
      const b = hexatoneMappingForLumatone(S12, { centralNote: 48 });
      expect(b[2][27].note).toBe(48);
      expect(b[2][27].channel).toBe(4);
    });

    it('respects centralChannel=2 (0-indexed) → ch 3', () => {
      const b = hexatoneMappingForLumatone(S12, { centralChannel: 2 });
      expect(b[2][27].channel).toBe(3);
      expect(b[2][27].note).toBe(60);
    });

    it('respects custom centralKeyIndex=17', () => {
      const b = hexatoneMappingForLumatone(S12, { centralKeyIndex: 17 });
      expect(b[2][17].note).toBe(60);
      expect(b[2][17].channel).toBe(4);
    });
  });
});

// ── boardsToLtn ───────────────────────────────────────────────────────────────

describe('boardsToLtn', () => {
  const ltn = boardsToLtn(hexatoneMappingForLumatone(S12));

  it('contains [Board0] through [Board4]', () => {
    for (let b = 0; b < 5; b++) expect(ltn).toContain(`[Board${b}]`);
  });

  it('uses Windows CRLF line endings', () => {
    expect(ltn).toContain('\r\n');
  });

  it('has exactly 280 Key_ entries', () => {
    expect(ltn.match(/^Key_\d+=\d+/gm)).toHaveLength(280);
  });

  it('has exactly 280 Chan_ entries', () => {
    expect(ltn.match(/^Chan_\d+=\d+/gm)).toHaveLength(280);
  });

  it('has exactly 280 Col_ entries', () => {
    expect(ltn.match(/^Col_\d+=[0-9A-F]{6}/gm)).toHaveLength(280);
  });

  it('has exactly 280 CCInvert_ lines', () => {
    expect(ltn.match(/^CCInvert_\d+$/gm)).toHaveLength(280);
  });

  it('active keys (ktyp=1) emit no KTyp line', () => {
    const simple = [[{ note: 60, channel: 4, color: 'FFFFFF', ktyp: 1 }]];
    expect(boardsToLtn(simple)).not.toContain('KTyp_0=');
  });

  it('disabled keys (ktyp=0) emit KTyp_N=0', () => {
    const simple = [[{ note: 0, channel: 1, color: '000000', ktyp: 0 }]];
    expect(boardsToLtn(simple)).toContain('KTyp_0=0');
  });

  it('contains the global footer', () => {
    expect(ltn).toContain('AfterTouchActive=1');
    expect(ltn).toContain('VelocityIntrvlTbl=');
    expect(ltn).toContain('LumaTouchConfig=');
  });
});

// ── settingsToLtn (integration) ───────────────────────────────────────────────

describe('settingsToLtn', () => {
  it('produces 5 board sections and 280 keys for 12-edo', () => {
    const ltn = settingsToLtn(S12);
    expect(ltn.match(/\[Board\d+\]/g)).toHaveLength(5);
    expect(ltn.match(/^Key_\d+=\d+/gm)).toHaveLength(280);
  });

  it('central key: note=60 chan=4 (12-edo)', () => {
    const ltn    = settingsToLtn(S12);
    const board2 = ltn.split(/\[Board2\]/)[1].split(/\[Board3\]/)[0];
    expect(Number(board2.match(/Key_27=(\d+)/)[1])).toBe(60);
    expect(Number(board2.match(/Chan_27=(\d+)/)[1])).toBe(4);
  });

  it('53-Tertial regression: key 28 (right of central) = note 69, chan 4', () => {
    const ltn    = settingsToLtn(S53);
    const board2 = ltn.split(/\[Board2\]/)[1].split(/\[Board3\]/)[0];
    expect(Number(board2.match(/Key_27=(\d+)/)[1])).toBe(60);
    expect(Number(board2.match(/Chan_27=(\d+)/)[1])).toBe(4);
    expect(Number(board2.match(/Key_28=(\d+)/)[1])).toBe(69);
    expect(Number(board2.match(/Chan_28=(\d+)/)[1])).toBe(4);
  });

  it('no (note, channel) collisions in output for 53-Tertial', () => {
    const ltn   = settingsToLtn(S53);
    const pairs = new Set();
    ltn.split(/\[Board\d+\]/).slice(1).forEach(section => {
      const keys  = [...section.matchAll(/Key_(\d+)=(\d+)/gm)].map(m => +m[2]);
      const chans = [...section.matchAll(/Chan_(\d+)=(\d+)/gm)].map(m => +m[2]);
      keys.forEach((note, i) => pairs.add(`${chans[i]}:${note}`));
    });
    expect(pairs.size).toBe(280);
  });

  it('custom centralNote threaded through (53-Tertial)', () => {
    const ltn    = settingsToLtn(S53, { centralNote: 48 });
    const board2 = ltn.split(/\[Board2\]/)[1].split(/\[Board3\]/)[0];
    expect(Number(board2.match(/Key_27=(\d+)/)[1])).toBe(48);
  });

  it('works for 81-edo', () => {
    const ltn = settingsToLtn(makeSettings(81, 9, 4));
    expect(ltn.match(/^Key_\d+=\d+/gm)).toHaveLength(280);
  });
});
