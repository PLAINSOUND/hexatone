/**
 * Tests for src/app.jsx
 *
 * The App component has deep dependencies (WebMidi, AudioContext, canvas,
 * SVG imports) that make full integration testing expensive. These tests
 * cover what can be verified without a real browser environment:
 *
 * - The Loading spinner component renders
 * - The useQuery extractors used by App work correctly (covered in use-query.test.js)
 *
 * Broader App rendering tests (settings panel toggle, keyboard visibility)
 * require a more complete browser mock and are left as todos for future work.
 */

import { h } from 'preact';
import { render } from '@testing-library/preact';

// ── Loading spinner ───────────────────────────────────────────────────────────
// Loading is a trivially simple named export — just verify it renders without
// throwing. The SVG content is mocked by the asset stub.

vi.mock('./img/hex.svg?react', () => ({
  default: () => <svg data-testid="loading-icon" />,
}));

import { Loading } from './app';

describe('Loading', () => {
  it('renders without crashing', () => {
    const { container } = render(<Loading />);
    expect(container).not.toBeNull();
  });

  it('renders the loading icon SVG', () => {
    const { getByTestId } = render(<Loading />);
    expect(getByTestId('loading-icon')).not.toBeNull();
  });
});

// ── Full App rendering ────────────────────────────────────────────────────────
// Skipped: requires WebMidi, AudioContext, canvas and localStorage all stubbed.
// The original Enzyme tests for App were also mostly commented out for the
// same reason. Revisit once a more complete jsdom + WebMidi mock is in place.

describe.todo('App — settings panel toggle');
describe.todo('App — keyboard active/inactive state');
describe.todo('App — preset loading');
