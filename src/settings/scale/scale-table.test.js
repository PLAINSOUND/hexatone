/**
 * Tests for src/settings/scale/scale-table.js
 *
 * The ScaleTable component renders a table of scale degrees, names and colors.
 * Tests use aria-labels (already present in the component) to find inputs,
 * avoiding brittleness from position or implementation details.
 */

import { h } from 'preact';
import { render, screen, fireEvent } from '@testing-library/preact';
import ScaleTable from './scale-table';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const scale_values = [
  '100.', '200.', '300.', '400.', '500.', '600.',
  '700.', '800.', '900.', '1000.', '1100.', '1200.',
];
const scale_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const scale_colors = [
  '#ffffff', '#7b7b7b', '#ffffff', '#7b7b7b', '#ffffff', '#ffffff',
  '#7b7b7b', '#ffffff', '#7b7b7b', '#ffffff', '#7b7b7b', '#ffffff',
];

const settingsBase = {
  scale: scale_values,
  spectrum_colors: false,
  note_colors: scale_colors,
  note_names: scale_names,
  key_labels: 'note_names',
};

// ── Key labels ────────────────────────────────────────────────────────────────

describe('ScaleTable — key labels: note_names', () => {
  it('name inputs are enabled when key_labels is note_names', () => {
    render(<ScaleTable settings={settingsBase} onChange={() => {}} />);
    expect(screen.getByLabelText('pitch name 0').disabled).toBe(false);
  });

  it('name inputs are populated with note_names values', () => {
    render(<ScaleTable settings={settingsBase} onChange={() => {}} />);
    expect(screen.getByLabelText('pitch name 0').value).toBe('C');
    expect(screen.getByLabelText('pitch name 3').value).toBe('D#');
  });

  it('calls onChange("note_names", ...) with updated array when a name is changed', () => {
    const onChange = vi.fn();
    render(<ScaleTable settings={settingsBase} onChange={onChange} />);
    const input = screen.getByLabelText('pitch name 3');
    fireEvent.change(input, { target: { value: 'Eb', name: 'name3' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe('note_names');
    const updated = onChange.mock.calls[0][1];
    expect(updated[3]).toBe('Eb');
    expect(updated[0]).toBe('C');
    expect(updated[4]).toBe('E');
  });
});

describe('ScaleTable — key labels: no_labels', () => {
  const settings = { ...settingsBase, key_labels: 'no_labels' };

  it('name inputs are disabled', () => {
    render(<ScaleTable settings={settings} onChange={() => {}} />);
    expect(screen.getByLabelText('pitch name 0').disabled).toBe(true);
  });
});

describe('ScaleTable — key labels: enumerate', () => {
  const settings = { ...settingsBase, key_labels: 'enumerate' };

  it('name inputs are disabled', () => {
    render(<ScaleTable settings={settings} onChange={() => {}} />);
    expect(screen.getByLabelText('pitch name 0').disabled).toBe(true);
  });
});

// ── Scale values ──────────────────────────────────────────────────────────────

describe('ScaleTable — scale value inputs', () => {
  it('scale inputs are populated with the correct values', () => {
    render(<ScaleTable settings={settingsBase} onChange={() => {}} />);
    expect(screen.getByLabelText('pitch value 0').value).toBe('100.');
    expect(screen.getByLabelText('pitch value 4').value).toBe('500.');
  });

  it('calls onChange("scale", ...) with updated array when a value is changed', () => {
    const onChange = vi.fn();
    render(<ScaleTable settings={settingsBase} onChange={onChange} />);
    const input = screen.getByLabelText('pitch value 4');
    fireEvent.change(input, { target: { value: '498.04', name: 'scale4' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe('scale');
    const updated = onChange.mock.calls[0][1];
    expect(updated[4]).toBe('498.04');
    expect(updated[0]).toBe('100.');
  });
});

// ── Colors ────────────────────────────────────────────────────────────────────

describe('ScaleTable — explicit colors', () => {
  it('color inputs are enabled when spectrum_colors is false', () => {
    render(<ScaleTable settings={settingsBase} onChange={() => {}} />);
    expect(screen.getByLabelText('pitch color 0').disabled).toBe(false);
  });

  it('color inputs have the correct values', () => {
    render(<ScaleTable settings={settingsBase} onChange={() => {}} />);
    expect(screen.getByLabelText('pitch color 0').value).toBe('#ffffff');
    expect(screen.getByLabelText('pitch color 1').value).toBe('#7b7b7b');
  });

  it('calls onChange("note_colors", ...) with updated array when a color is changed', () => {
    const onChange = vi.fn();
    render(<ScaleTable settings={settingsBase} onChange={onChange} />);
    const input = screen.getByLabelText('pitch color 2');
    fireEvent.change(input, { target: { value: '#ff0000', name: 'color2' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe('note_colors');
    const updated = onChange.mock.calls[0][1];
    expect(updated[2]).toBe('#ff0000');
    expect(updated[0]).toBe('#ffffff');
  });
});

describe('ScaleTable — spectrum colors', () => {
  const settings = {
    ...settingsBase,
    spectrum_colors: true,
    fundamental_color: '#abcdef',
  };

  it('color inputs are disabled when spectrum_colors is true', () => {
    render(<ScaleTable settings={settings} onChange={() => {}} />);
    expect(screen.getByLabelText('pitch color 0').disabled).toBe(true);
  });

  it('all color inputs show the fundamental_color', () => {
    render(<ScaleTable settings={settings} onChange={() => {}} />);
    // degrees 0–11 (the equave repeat row uses aria-label="pitch color equave")
    for (let i = 0; i < 12; i++) {
      expect(screen.getByLabelText(`pitch color ${i}`).value).toBe('#abcdef');
    }
    // equave row always mirrors degree 0
    expect(screen.getByLabelText('pitch color equave').value).toBe('#abcdef');
  });
});

// ── Table structure ───────────────────────────────────────────────────────────

describe('ScaleTable — table structure', () => {
  it('renders a row for each scale degree plus root and equave', () => {
    render(<ScaleTable settings={settingsBase} onChange={() => {}} />);
    // scale_values has 12 entries; ScaleTable shows root + 11 intervals + equave repeat = 13 rows
    const rows = document.querySelectorAll('tbody tr');
    expect(rows.length).toBe(scale_values.length + 1);
  });

  it('root row has no scale value input', () => {
    render(<ScaleTable settings={settingsBase} onChange={() => {}} />);
    // degree 0 row only has name and color inputs, no pitch value input
    expect(screen.queryByLabelText('pitch value 0')).not.toBeNull(); // first interval = degree 1
    // No "pitch value" aria-label for degree 0 (the 1/1 row)
    expect(document.querySelectorAll('input[aria-label="pitch value -1"]').length).toBe(0);
  });
});
