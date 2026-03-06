/**
 * Tests for src/settings/scale/parse-scale.js
 *
 * Covers: parseScale, scalaToCents, scalaToLabels, parsedScaleToLabels
 *
 * NOTE: normaliseDegree, settingsToHexatonScala, fileToPreset are tested in
 * parse-scale-extended.test.js once those functions are deployed to source.
 */

import {
  parseScale,
  scalaToCents,
  scalaToLabels,
  parsedScaleToLabels,
} from './parse-scale';

// ── scalaToCents ──────────────────────────────────────────────────────────────

describe('scalaToCents', () => {
  it('converts a pure fifth ratio 3/2 to ~701.955 cents', () => {
    expect(scalaToCents('3/2')).toBeCloseTo(701.955, 2);
  });

  it('converts an octave ratio 2/1 to 1200 cents', () => {
    expect(scalaToCents('2/1')).toBeCloseTo(1200, 5);
  });

  it('converts a unison ratio 1/1 to 0 cents', () => {
    expect(scalaToCents('1/1')).toBeCloseTo(0, 5);
  });

  it('converts a decimal cents string directly', () => {
    expect(scalaToCents('701.955')).toBeCloseTo(701.955, 3);
  });

  it('converts 0.0 cents to 0', () => {
    expect(scalaToCents('0.0')).toBe(0);
  });

  it('converts 7\\12 EDO step to ~700 cents', () => {
    expect(scalaToCents('7\\12')).toBeCloseTo(700, 5);
  });

  it('converts 1\\12 EDO step to 100 cents', () => {
    expect(scalaToCents('1\\12')).toBeCloseTo(100, 5);
  });

  it('converts 31 EDO step 18\\31 to ~696.77 cents', () => {
    expect(scalaToCents('18\\31')).toBeCloseTo(696.774, 2);
  });

  it('converts a plain integer 3 as implicit ratio 3/1', () => {
    expect(scalaToCents('3')).toBeCloseTo(scalaToCents('3/1'), 5);
  });

  it('converts numeric value directly when passed as number', () => {
    expect(scalaToCents(1.5)).toBeCloseTo(701.955, 2);
  });
});

// ── scalaToLabels ─────────────────────────────────────────────────────────────

describe('scalaToLabels', () => {
  it('returns short ratios as-is', () => {
    expect(scalaToLabels('3/2')).toBe('3/2');
    expect(scalaToLabels('2/1')).toBe('2/1');
  });

  it('converts long ratios to rounded cents string', () => {
    // 128/125 is 6 chars — short enough to keep
    expect(scalaToLabels('128/125')).toBe('128/125');
    // 1024/729 is 8 chars — too long, convert to cents
    expect(scalaToLabels('1024/729')).toMatch(/^\s*\d+\.$/);
  });

  it('converts EDO steps to rounded cents string', () => {
    expect(scalaToLabels('7\\12')).toBe(' 700.');
    expect(scalaToLabels('1\\12')).toBe(' 100.');
  });

  it('converts decimal cents to rounded cents string', () => {
    expect(scalaToLabels('701.955')).toBe(' 702.');
    expect(scalaToLabels('100.0')).toBe(' 100.');
  });

  it('converts plain integers to ratio form', () => {
    expect(scalaToLabels('3')).toBe('3/1');
    expect(scalaToLabels('2')).toBe('2/1');
  });
});

// ── parsedScaleToLabels ───────────────────────────────────────────────────────

describe('parsedScaleToLabels', () => {
  it('maps each scale degree to a label', () => {
    const result = parsedScaleToLabels(['9/8', '5/4', '3/2', '2/1']);
    expect(result).toHaveLength(4);
    expect(result[0]).toBe('9/8');
    expect(result[2]).toBe('3/2');
  });

  it('returns an array, not undefined', () => {
    expect(Array.isArray(parsedScaleToLabels(['2/1']))).toBe(true);
  });
});

// ── parseScale ────────────────────────────────────────────────────────────────

const SCALE_12EDO = `! 12edo.scl
!
12-tone equal temperament
12
!
 100.
 200.
 300.
 400.
 500.
 600.
 700.
 800.
 900.
 1000.
 1100.
 1200.`.trimEnd();

const SCALE_JUST = `! just.scl
!
5-limit just intonation
5
!
 9/8
 5/4
 4/3
 3/2
 2/1`.trimEnd();

const SCALE_WITH_NAMES_COLORS = `! named.scl
!
Scale with names and colors
3
!
 386.314 C #ffffff
 701.955 G #ff0000
 1200.   A #0000ff
`;

const SCALE_HEXATONE = `! mytuning.ascl
!
! HEXATONE_REFERENCE_PITCH 9 440
! HEXATONE_MIDIIN_DEGREE0 60
! HEXATONE_NOTE_NAMES C, D, E
! HEXATONE_NOTE_COLORS #ffffff, #dddddd, #bbbbbb
!
My tuning
3
!
 9/8
 5/4
 2/1
`;

describe('parseScale — 12edo', () => {
  const result = parseScale(SCALE_12EDO);

  it('parses the filename', () => {
    expect(result.filename).toBe('12edo.scl');
  });

  it('parses the description', () => {
    expect(result.description).toBe('12-tone equal temperament');
  });

  it('parses equivSteps', () => {
    expect(result.equivSteps).toBe(12);
  });

  it('parses 12 scale degrees', () => {
    expect(result.scale).toHaveLength(12);
  });

  it('first degree is 100.', () => {
    expect(result.scale[0]).toBe('100.');
  });

  it('last degree is 1200.', () => {
    expect(result.scale[11]).toBe('1200.');
  });

  it('has no errors', () => {
    expect(result.errors).toHaveLength(0);
  });
});

describe('parseScale — just intonation ratios', () => {
  const result = parseScale(SCALE_JUST);

  it('parses 5 degrees', () => {
    expect(result.scale).toHaveLength(5);
  });

  it('parses ratio strings correctly', () => {
    expect(result.scale[0]).toBe('9/8');
    expect(result.scale[4]).toBe('2/1');
  });

  it('has no errors', () => {
    expect(result.errors).toHaveLength(0);
  });
});

describe('parseScale — inline names and colors', () => {
  const result = parseScale(SCALE_WITH_NAMES_COLORS);

  it('parses labels', () => {
    expect(result.labels[0]).toBe('C');
    expect(result.labels[1]).toBe('G');
  });

  it('parses colors', () => {
    expect(result.colors[0]).toBe('#ffffff');
    expect(result.colors[1]).toBe('#ff0000');
    expect(result.colors[2]).toBe('#0000ff');
  });
});

describe('parseScale — HEXATONE metadata', () => {
  const result = parseScale(SCALE_HEXATONE);

  it('parses HEXATONE_REFERENCE_PITCH', () => {
    expect(result.hexatone_reference_degree).toBe(9);
    expect(result.hexatone_fundamental).toBe(440);
  });

  it('parses HEXATONE_MIDIIN_DEGREE0', () => {
    expect(result.hexatone_midiin_degree0).toBe(60);
  });

  it('parses HEXATONE_NOTE_NAMES', () => {
    expect(result.hexatone_note_names).toEqual(['C', 'D', 'E']);
  });

  it('parses HEXATONE_NOTE_COLORS', () => {
    expect(result.hexatone_note_colors).toEqual(['#ffffff', '#dddddd', '#bbbbbb']);
  });

  it('still parses the scale itself', () => {
    expect(result.scale).toHaveLength(3);
    expect(result.scale[0]).toBe('9/8');
  });
});

describe('parseScale — error handling', () => {
  it('reports a mismatch between declared and actual degree count', () => {
    const bad = `! bad.scl\nBad scale\n3\n 100.\n 200.\n`; // declares 3, provides 2
    const result = parseScale(bad);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].error).toMatch(/Unexpected token/);
  });
});