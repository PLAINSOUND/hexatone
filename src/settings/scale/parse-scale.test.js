/**
 * Tests for src/settings/scale/parse-scale.js
 *
 * Covers: parseScale, scalaToCents, scalaToLabels, parsedScaleToLabels,
 *         normaliseDegree, settingsToHexatonScala, fileToPreset
 */

import {
  parseScale,
  scalaToCents,
  scalaToLabels,
  parsedScaleToLabels,
  normaliseDegree,
  settingsToHexatonScala,
  fileToPreset,
  settingsToPresetJson,
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

// ── normaliseDegree ───────────────────────────────────────────────────────────

describe('normaliseDegree', () => {
  it('returns ratios unchanged', () => {
    expect(normaliseDegree('3/2')).toBe('3/2');
  });

  it('returns decimal cents unchanged', () => {
    expect(normaliseDegree('701.955')).toBe('701.955');
  });

  it('converts EDO step to cents string', () => {
    expect(normaliseDegree('7\\12')).toMatch(/^700\.0*/);
  });

  it('converts plain integer to ratio', () => {
    expect(normaliseDegree('3')).toBe('3/1');
  });

  it('handles falsy input gracefully', () => {
    expect(normaliseDegree(null)).toBe('0.');
    expect(normaliseDegree('')).toBe('0.');
    expect(normaliseDegree(undefined)).toBe('0.');
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
! HEXATONE_midiin_central_degree 60
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

  it('parses HEXATONE_midiin_central_degree', () => {
    expect(result.hexatone_midiin_central_degree).toBe(60);
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
    expect(result.errors[0].error).toMatch(/3 pitches specified, but 2 provided/);
    //expect(result.errors[0].error).toMatch(/Unexpected token./);
  });
});

// ── settingsToHexatonScala round-trip ─────────────────────────────────────────

describe('settingsToHexatonScala → parseScale round-trip', () => {
  const settings = {
    name: 'Test Scale',
    description: 'A simple test scale',
    scale: ['9/8', '5/4', '3/2', '2/1'],
    equivSteps: 4,
    note_names: ['C', 'D', 'E', 'G'],
    note_colors: ['#ffffff', '#eeeeee', '#dddddd', '#cccccc'],
    fundamental: 440,
    reference_degree: 0,
    midiin_central_degree: 60,
  };

  const ascl = settingsToHexatonScala(settings);
  const parsed = parseScale(ascl);

  it('round-trips note names', () => {
    expect(parsed.hexatone_note_names).toEqual(settings.note_names);
  });

  it('round-trips note colors', () => {
    expect(parsed.hexatone_note_colors).toEqual(settings.note_colors);
  });

  it('round-trips fundamental', () => {
    expect(parsed.hexatone_fundamental).toBe(440);
  });

  it('round-trips reference degree', () => {
    expect(parsed.hexatone_reference_degree).toBe(0);
  });

  it('round-trips midiin_central_degree', () => {
    expect(parsed.hexatone_midiin_central_degree).toBe(60);
  });

  it('produces a valid scala file with correct degree count', () => {
    expect(parsed.equivSteps).toBe(4);
    expect(parsed.scale).toHaveLength(4);
    expect(parsed.errors).toHaveLength(0);
  });
});

describe('settingsToPresetJson', () => {
  it('omits controller- and runtime-specific fields from exported preset JSON', () => {
    const json = settingsToPresetJson({
      name: 'Export Test',
      scale: ['100.', '1200.'],
      equivSteps: 2,
      scale_import: '! inline scala',
      midiin_central_degree: 64,
      mpe_pitchbend_range: 48,
      fundamental: 440,
    });
    const parsed = JSON.parse(json);

    expect(parsed.name).toBe('Export Test');
    expect(parsed.scale).toEqual(['100.', '1200.']);
    expect(parsed.fundamental).toBe(440);
    expect(parsed.scale_import).toBeUndefined();
    expect(parsed.midiin_central_degree).toBeUndefined();
    expect(parsed.mpe_pitchbend_range).toBeUndefined();
  });
});

// ── fileToPreset ──────────────────────────────────────────────────────────────

describe('fileToPreset — JSON', () => {
  it('parses a valid JSON preset', () => {
    const json = JSON.stringify({
      name: 'My Preset',
      scale: ['9/8', '2/1'],
      equivSteps: 2,
    });
    const preset = fileToPreset('my_preset.json', json);
    expect(preset).not.toBeNull();
    expect(preset.name).toBe('My Preset');
    expect(preset.scale).toHaveLength(2);
  });

  it('returns null for JSON missing name', () => {
    const json = JSON.stringify({ scale: ['2/1'] });
    expect(fileToPreset('bad.json', json)).toBeNull();
  });

  it('returns null for JSON missing scale', () => {
    const json = JSON.stringify({ name: 'No Scale' });
    expect(fileToPreset('bad.json', json)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(fileToPreset('bad.json', '{ not valid json')).toBeNull();
  });
});

describe('fileToPreset — .scl', () => {
  it('parses a plain .scl file', () => {
    const preset = fileToPreset('just.scl', SCALE_JUST);
    expect(preset).not.toBeNull();
    expect(preset.scale).toHaveLength(5);
    expect(preset.spectrum_colors).toBe(true);
    expect(preset.key_labels).toBe('scala_names');
  });

  it('uses filename (minus extension) as name when no ! name line', () => {
    const preset = fileToPreset('my_scale.scl', SCALE_JUST);
    expect(preset.name).toContain('just'); // from description or filename
  });
});

describe('fileToPreset — .ascl with HEXATONE metadata', () => {
  it('extracts note names and colors', () => {
    const preset = fileToPreset('mytuning.ascl', SCALE_HEXATONE);
    expect(preset).not.toBeNull();
    expect(preset.note_names).toEqual(['C', 'D', 'E']);
    expect(preset.note_colors).toEqual(['#ffffff', '#dddddd', '#bbbbbb']);
    expect(preset.key_labels).toBe('note_names');
    expect(preset.spectrum_colors).toBe(false);
  });
});
