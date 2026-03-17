/**
 * Tests for src/settings/scale/colors.js
 *
 * The Colors component renders:
 *   - a "Use Spectrum Colors" checkbox (always visible)
 *   - a ColorCell for "Choose Central Hue" (only when spectrum_colors is true)
 *
 * The ColorCell hex text input commits on blur (not change).
 */

import { h } from 'preact';
import { render, screen, fireEvent } from '@testing-library/preact';
import Colors from './colors';

const baseSettings = { spectrum_colors: false, fundamental_color: '#abcdef' };

describe('Colors — spectrum colors off', () => {
  it('renders the spectrum colors checkbox unchecked', () => {
    render(<Colors settings={baseSettings} onChange={() => {}} />);
    const checkbox = screen.getByRole('checkbox', { name: /spectrum colors/i });
    expect(checkbox.checked).toBe(false);
  });

  it('does not render the hue picker when spectrum is off', () => {
    render(<Colors settings={baseSettings} onChange={() => {}} />);
    expect(screen.queryByLabelText(/central hue/i)).toBeNull();
  });
});

describe('Colors — spectrum colors on', () => {
  const settings = { spectrum_colors: true, fundamental_color: '#abcdef' };

  it('renders the hue picker when spectrum is on', () => {
    render(<Colors settings={settings} onChange={() => {}} />);
    expect(screen.getByLabelText('hex colour for central hue')).not.toBeNull();
  });

  it('hue picker has the correct value', () => {
    render(<Colors settings={settings} onChange={() => {}} />);
    expect(screen.getByLabelText('hex colour for central hue').value).toBe('#abcdef');
  });
});

describe('Colors — interactions', () => {
  it('calls onChange with spectrum_colors=true when checkbox is ticked', () => {
    const onChange = vi.fn();
    render(<Colors settings={baseSettings} onChange={onChange} />);
    const checkbox = screen.getByRole('checkbox', { name: /spectrum colors/i });
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith('spectrum_colors', true);
  });

  it('calls onChange with new color when hue text input is committed', () => {
    const onChange = vi.fn();
    const settings = { spectrum_colors: true, fundamental_color: '#abcdef' };
    render(<Colors settings={settings} onChange={onChange} />);
    const input = screen.getByLabelText('hex colour for central hue');
    // Simulate user typing a new value
    fireEvent.input(input, { target: { value: '#ff0000' } });
    // Blur triggers handleTextBlur which calls onChange
    input.blur();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('fundamental_color', '#ff0000');
  });
});