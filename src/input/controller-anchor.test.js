/**
 * Tests for input/controller-anchor.js
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSavedAnchor,
  loadSavedAnchorChannel,
  saveAnchor,
  saveAnchorChannel,
  loadSavedSeqAnchor,
  loadSavedSeqAnchorChannel,
  saveSeqAnchor,
  saveSeqAnchorChannel,
  loadAnchorSettingsUpdate,
  saveAnchorFromLearn,
} from './controller-anchor.js';

// ── Mock controllers ──────────────────────────────────────────────────────────

// Single-channel controller (no anchorChannelDefault)
const AXIS49 = {
  id: 'axis49',
  anchorDefault: 53,
  anchorChannelDefault: undefined,
  mpe: false,
  learnConstraints: {
    noteRange: { min: 1, max: 98 },
    channelRange: null,
    multiChannel: false,
  },
};

// Channel-aware controller (Lumatone)
const LUMATONE = {
  id: 'lumatone',
  anchorDefault: 26,
  anchorChannelDefault: 3,
  mpe: false,
  multiChannel: true,
  learnConstraints: {
    noteRange: { min: 0, max: 55 },
    channelRange: { min: 1, max: 5 },
    multiChannel: true,
  },
};

// MPE controller (LinnStrument) — user-configurable voice channel range
const LINNSTRUMENT = {
  id: 'linnstrument128',
  anchorDefault: 30,
  anchorChannelDefault: undefined,
  mpe: true,
  mpeVoiceChannels: null,
  learnConstraints: {
    noteRange: { min: 0, max: 127 },
    channelRange: { min: 1, max: 8 },
    multiChannel: true,
  },
};

// MPE controller with fixed hardware voice channel range + passthrough default (Exquis)
const EXQUIS = {
  id: 'exquis',
  anchorDefault: 0,
  anchorChannelDefault: undefined,
  mpe: true,
  mpeVoiceChannels: { lo: 2, hi: 15 },
  passthroughDefault: true,
  learnConstraints: {
    noteRange: { min: 0, max: 60 },
    channelRange: null,
    multiChannel: false,
  },
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

// ── Sequential anchors ────────────────────────────────────────────────────────

describe('loadSavedSeqAnchor', () => {
  it('returns anchorDefault when nothing stored', () => {
    expect(loadSavedSeqAnchor(AXIS49)).toBe(53);
  });

  it('returns stored value when present', () => {
    localStorage.setItem('axis49_seq_anchor', '60');
    expect(loadSavedSeqAnchor(AXIS49)).toBe(60);
  });
});

describe('loadSavedSeqAnchorChannel', () => {
  it('returns null for single-channel controllers', () => {
    expect(loadSavedSeqAnchorChannel(AXIS49)).toBeNull();
  });

  it('returns anchorChannelDefault when nothing stored (Lumatone)', () => {
    expect(loadSavedSeqAnchorChannel(LUMATONE)).toBe(3);
  });
});

describe('saveSeqAnchor / saveSeqAnchorChannel', () => {
  it('saves sequential anchor to localStorage', () => {
    saveSeqAnchor(AXIS49, 72);
    expect(localStorage.getItem('axis49_seq_anchor')).toBe('72');
  });

  it('saves sequential anchor channel to localStorage', () => {
    saveSeqAnchorChannel(LUMATONE, 4);
    expect(localStorage.getItem('lumatone_seq_anchor_channel')).toBe('4');
  });
});

// ── loadAnchorSettingsUpdate ─────────────────────────────────────────────────

describe('loadAnchorSettingsUpdate', () => {
  it('returns midiin_central_degree from stored sequential anchor', () => {
    localStorage.setItem('axis49_seq_anchor', '48');
    const update = loadAnchorSettingsUpdate(AXIS49);
    expect(update.midiin_central_degree).toBe(48);
    expect(update.midiin_mpe_input).toBe(false);
  });

  it('sets midiin_mpe_input=true for MPE controllers', () => {
    const update = loadAnchorSettingsUpdate(LINNSTRUMENT);
    expect(update.midiin_central_degree).toBe(30);
    expect(update.midiin_mpe_input).toBe(true);
  });

  it('includes lumatone_center_note and lumatone_center_channel for channel-aware controllers', () => {
    const update = loadAnchorSettingsUpdate(LUMATONE);
    expect(update.midiin_central_degree).toBe(26);
    expect(update.lumatone_center_note).toBe(26);
    expect(update.lumatone_center_channel).toBe(3);
    expect(update.midiin_mpe_input).toBe(false);
  });

  it('restores saved sequential anchor for midiin_central_degree', () => {
    localStorage.setItem('lumatone_seq_anchor', '10');
    const update = loadAnchorSettingsUpdate(LUMATONE);
    expect(update.midiin_central_degree).toBe(10);
  });

  it('restores saved geometry anchors separately', () => {
    localStorage.setItem('lumatone_anchor', '40');
    localStorage.setItem('lumatone_anchor_channel', '4');
    const update = loadAnchorSettingsUpdate(LUMATONE);
    expect(update.lumatone_center_note).toBe(40);
    expect(update.lumatone_center_channel).toBe(4);
  });

  it('includes lumatone_center_channel for Lumatone (multi-channel)', () => {
    const update = loadAnchorSettingsUpdate(LUMATONE);
    expect(update).toHaveProperty('lumatone_center_channel');
    expect(update.lumatone_center_channel).toBe(3);
  });

  it('lumatone_center_channel is null for single-channel controllers', () => {
    const update = loadAnchorSettingsUpdate(AXIS49);
    expect(update.lumatone_center_channel).toBeNull();
  });

  it('does not set mpe channel range for controllers with mpeVoiceChannels=null', () => {
    const update = loadAnchorSettingsUpdate(LINNSTRUMENT);
    expect(update).not.toHaveProperty('midiin_mpe_lo_ch');
    expect(update).not.toHaveProperty('midiin_mpe_hi_ch');
  });

  it('auto-applies fixed mpe channel range for controllers with mpeVoiceChannels', () => {
    const update = loadAnchorSettingsUpdate(EXQUIS);
    expect(update.midiin_mpe_input).toBe(true);
    expect(update.midiin_mpe_lo_ch).toBe(2);
    expect(update.midiin_mpe_hi_ch).toBe(15);
  });

  it('sets midi_passthrough=true for controllers with passthroughDefault', () => {
    const update = loadAnchorSettingsUpdate(EXQUIS);
    expect(update.midi_passthrough).toBe(true);
  });

  it('midi_passthrough defaults to false for controllers without passthroughDefault', () => {
    const update = loadAnchorSettingsUpdate(AXIS49);
    expect(update.midi_passthrough).toBe(false);
  });
});

// ── saveAnchorFromLearn ───────────────────────────────────────────────────────

describe('saveAnchorFromLearn', () => {
  it('in sequential mode, saves to seq_anchor and returns midiin_central_degree', () => {
    const result = saveAnchorFromLearn(AXIS49, 65, 1, true);
    expect(result.warning).toBeNull();
    expect(localStorage.getItem('axis49_seq_anchor')).toBe('65');
    expect(result.update.midiin_central_degree).toBe(65);
    expect(result.update.midiin_anchor_channel).toBe(1);
  });

  it('in 2D geometry mode for single-channel, saves to anchor', () => {
    const result = saveAnchorFromLearn(AXIS49, 65, 1, false);
    expect(result.warning).toBeNull();
    expect(localStorage.getItem('axis49_anchor')).toBe('65');
    expect(result.update.midiin_central_degree).toBe(65);
  });

  it('in sequential mode for Lumatone, saves to seq_anchors', () => {
    const result = saveAnchorFromLearn(LUMATONE, 20, 2, true);
    expect(result.warning).toBeNull();
    expect(localStorage.getItem('lumatone_seq_anchor')).toBe('20');
    expect(localStorage.getItem('lumatone_seq_anchor_channel')).toBe('2');
    expect(result.update.midiin_central_degree).toBe(20);
    expect(result.update.midiin_anchor_channel).toBe(2);
  });

  it('in 2D geometry mode for Lumatone, saves to geometry anchors', () => {
    const result = saveAnchorFromLearn(LUMATONE, 20, 2, false);
    expect(result.warning).toBeNull();
    expect(localStorage.getItem('lumatone_anchor')).toBe('20');
    expect(localStorage.getItem('lumatone_anchor_channel')).toBe('2');
    expect(result.update.lumatone_center_note).toBe(20);
    expect(result.update.lumatone_center_channel).toBe(2);
  });

  it('returns warning for out-of-range note in 2D geometry mode', () => {
    const result = saveAnchorFromLearn(LUMATONE, 60, 3, false);
    expect(result.warning).not.toBeNull();
    expect(result.update).toBeNull();
  });

  it('returns warning for out-of-range channel in 2D geometry mode', () => {
    const result = saveAnchorFromLearn(LUMATONE, 26, 6, false);
    expect(result.warning).not.toBeNull();
    expect(result.update).toBeNull();
  });

  it('accepts valid Lumatone 2D geometry values', () => {
    const result = saveAnchorFromLearn(LUMATONE, 55, 5, false);
    expect(result.warning).toBeNull();
    expect(result.update.lumatone_center_note).toBe(55);
    expect(result.update.lumatone_center_channel).toBe(5);
  });

  it('saves note 0 correctly', () => {
    const result = saveAnchorFromLearn(AXIS49, 0, 1, true);
    expect(localStorage.getItem('axis49_seq_anchor')).toBe('0');
  });
});
