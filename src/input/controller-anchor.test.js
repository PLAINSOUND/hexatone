/**
 * Tests for input/controller-anchor.js
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSavedAnchor,
  loadSavedAnchorChannel,
  saveAnchor,
  saveAnchorChannel,
  loadAnchorSettingsUpdate,
  saveAnchorFromLearn,
} from './controller-anchor.js';

// ── Mock controllers ──────────────────────────────────────────────────────────

// Single-channel controller (no anchorChannelDefault)
const AXIS49 = {
  id: 'axis49',
  anchorDefault: 53,
  anchorChannelDefault: undefined,
};

// Channel-aware controller (Lumatone)
const LUMATONE = {
  id: 'lumatone',
  anchorDefault: 26,
  anchorChannelDefault: 3,
};

beforeEach(() => {
  localStorage.clear();
});

// ── loadSavedAnchor ───────────────────────────────────────────────────────────

describe('loadSavedAnchor', () => {
  it('returns anchorDefault when nothing is stored', () => {
    expect(loadSavedAnchor(AXIS49)).toBe(53);
  });

  it('returns the stored value when present', () => {
    localStorage.setItem('axis49_anchor', '60');
    expect(loadSavedAnchor(AXIS49)).toBe(60);
  });

  it('returns 0 correctly (does not collapse to anchorDefault)', () => {
    localStorage.setItem('axis49_anchor', '0');
    expect(loadSavedAnchor(AXIS49)).toBe(0);
  });

  it('works for Lumatone', () => {
    localStorage.setItem('lumatone_anchor', '30');
    expect(loadSavedAnchor(LUMATONE)).toBe(30);
  });

  it('falls back to Lumatone anchorDefault when nothing stored', () => {
    expect(loadSavedAnchor(LUMATONE)).toBe(26);
  });
});

// ── loadSavedAnchorChannel ────────────────────────────────────────────────────

describe('loadSavedAnchorChannel', () => {
  it('returns null for single-channel controllers', () => {
    expect(loadSavedAnchorChannel(AXIS49)).toBeNull();
  });

  it('returns anchorChannelDefault when nothing stored (Lumatone)', () => {
    expect(loadSavedAnchorChannel(LUMATONE)).toBe(3);
  });

  it('returns stored channel when present', () => {
    localStorage.setItem('lumatone_anchor_channel', '2');
    expect(loadSavedAnchorChannel(LUMATONE)).toBe(2);
  });

  it('returns channel 1 correctly (does not collapse to anchorChannelDefault)', () => {
    localStorage.setItem('lumatone_anchor_channel', '1');
    expect(loadSavedAnchorChannel(LUMATONE)).toBe(1);
  });
});

// ── saveAnchor ────────────────────────────────────────────────────────────────

describe('saveAnchor', () => {
  it('writes to localStorage under the correct key', () => {
    saveAnchor(AXIS49, 72);
    expect(localStorage.getItem('axis49_anchor')).toBe('72');
  });

  it('saves 0 correctly', () => {
    saveAnchor(AXIS49, 0);
    expect(localStorage.getItem('axis49_anchor')).toBe('0');
  });
});

// ── saveAnchorChannel ─────────────────────────────────────────────────────────

describe('saveAnchorChannel', () => {
  it('writes to localStorage under the correct key for Lumatone', () => {
    saveAnchorChannel(LUMATONE, 5);
    expect(localStorage.getItem('lumatone_anchor_channel')).toBe('5');
  });

  it('is a no-op for single-channel controllers', () => {
    saveAnchorChannel(AXIS49, 2);
    expect(localStorage.getItem('axis49_anchor_channel')).toBeNull();
  });
});

// ── loadAnchorSettingsUpdate ──────────────────────────────────────────────────

describe('loadAnchorSettingsUpdate', () => {
  it('returns midiin_central_degree from anchorDefault when nothing stored', () => {
    const update = loadAnchorSettingsUpdate(AXIS49);
    expect(update).toEqual({ midiin_central_degree: 53 });
  });

  it('returns midiin_central_degree from stored value', () => {
    localStorage.setItem('axis49_anchor', '48');
    const update = loadAnchorSettingsUpdate(AXIS49);
    expect(update).toEqual({ midiin_central_degree: 48 });
  });

  it('includes lumatone_center_channel for channel-aware controllers', () => {
    const update = loadAnchorSettingsUpdate(LUMATONE);
    expect(update.midiin_central_degree).toBe(26);
    expect(update.lumatone_center_channel).toBe(3);
  });

  it('restores saved channel for Lumatone', () => {
    localStorage.setItem('lumatone_anchor', '10');
    localStorage.setItem('lumatone_anchor_channel', '4');
    const update = loadAnchorSettingsUpdate(LUMATONE);
    expect(update.midiin_central_degree).toBe(10);
    expect(update.lumatone_center_channel).toBe(4);
  });

  it('does not include lumatone_center_channel for single-channel controllers', () => {
    const update = loadAnchorSettingsUpdate(AXIS49);
    expect(update).not.toHaveProperty('lumatone_center_channel');
  });
});

// ── saveAnchorFromLearn ───────────────────────────────────────────────────────

describe('saveAnchorFromLearn', () => {
  it('saves to localStorage and returns the settings update', () => {
    const update = saveAnchorFromLearn(AXIS49, 65, 1);
    expect(localStorage.getItem('axis49_anchor')).toBe('65');
    expect(update.midiin_central_degree).toBe(65);
    expect(update.midiin_anchor_channel).toBe(1);
    expect(update).not.toHaveProperty('lumatone_center_channel');
  });

  it('includes lumatone keys for channel-aware controllers', () => {
    const update = saveAnchorFromLearn(LUMATONE, 20, 2);
    expect(localStorage.getItem('lumatone_anchor')).toBe('20');
    expect(localStorage.getItem('lumatone_anchor_channel')).toBe('2');
    expect(update.midiin_central_degree).toBe(20);
    expect(update.midiin_anchor_channel).toBe(2);
    expect(update.lumatone_center_channel).toBe(2);
    expect(update.lumatone_center_note).toBe(20);
  });

  it('saves note 0 correctly', () => {
    saveAnchorFromLearn(AXIS49, 0, 1);
    expect(localStorage.getItem('axis49_anchor')).toBe('0');
  });
});
