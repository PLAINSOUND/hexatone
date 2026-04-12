/**
 * Tests for src/settings/scale/index.js (the Scale settings panel)
 *
 * The component always shows the ScaleTable. When "Edit Scala File"
 * is clicked, ScalaImport is shown alongside (not instead of) the table.
 * The ScalaImport cancel button is labelled "Hide".
 * The ScalaImport confirm button is labelled "Build Layout".
 */

import { h } from 'preact';
import { render, screen, fireEvent } from '@testing-library/preact';
import Scale from './index';

const minimalSettings = {
  fundamental: 440,
  reference_degree: 0,
  equivSteps: 12,
  scale: ['100.', '200.', '300.', '400.', '500.', '600.',
          '700.', '800.', '900.', '1000.', '1100.', '1200.'],
  key_labels: 'no_labels',
  spectrum_colors: true,
  fundamental_color: '#ffffff',
  note_colors: Array(12).fill('#ffffff'),
  note_names: Array(12).fill(''),
};

describe('Scale panel — default state', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('renders the scale table by default', () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);
    expect(document.querySelector('table')).not.toBeNull();
  });

  it('renders the "View and Edit Scala File" button', () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);
    expect(screen.getByRole('button', { name: /edit scala file/i })).not.toBeNull();
  });

  it('does not show the scala import textarea initially', () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('highlights the Assigned Scale Degree row', () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);
    const label = screen.getByText('Assigned Scale Degree').closest('label');
    expect(label?.classList.contains('reference-degree-row')).toBe(true);
  });

  it('keeps settings through Key Labels visible when the table is collapsed', () => {
    sessionStorage.setItem('hexatone_scale_collapsed', 'true');
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);
    expect(document.querySelector('table')).toBeNull();
    expect(screen.getByText('Equave')).not.toBeNull();
    expect(screen.getByText('Key Labels')).not.toBeNull();
  });
});

describe('Scale panel — clicking import', () => {
  it('shows the import panel (with textarea) when the button is clicked', () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /edit scala file/i }));
    // ScalaImport renders alongside the table, not instead of it
    expect(document.querySelector('textarea')).not.toBeNull();
  });
});

describe('Scale panel — cancelling import', () => {
  it('hides the import panel when "Hide" is clicked', () => {
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /edit scala file/i }));
    fireEvent.click(screen.getByRole('button', { name: /^✕$/ }));
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('does not call onImport when cancelled', () => {
    const onImport = vi.fn();
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={onImport} />);
    fireEvent.click(screen.getByRole('button', { name: /edit scala file/i }));
    fireEvent.click(screen.getByRole('button', { name: /^✕$/ }));
    expect(onImport).not.toHaveBeenCalled();
  });
});

describe('Scale panel — completing import', () => {
  it('calls onImport and hides the import panel', () => {
    const onImport = vi.fn();
    render(<Scale settings={minimalSettings} onChange={() => {}} onImport={onImport} />);
    fireEvent.click(screen.getByRole('button', { name: /edit scala file/i }));
    fireEvent.click(screen.getByRole('button', { name: /build layout/i }));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
