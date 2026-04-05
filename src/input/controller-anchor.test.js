/**
 * Tests for input/controller-anchor.js
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getControllerMode,
  loadSavedAnchor,
  loadSavedAnchorChannel,
  saveAnchor,
  saveAnchorChannel,
  saveControllerPref,
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
};

// Channel-aware controller (Lumatone)
const LUMATONE = {
  id: 'lumatone',
  anchorDefault: 26,
  anchorChannelDefault: 3,
  mpe: false,
};

// MPE controller (LinnStrument) — user-configurable voice channel range
const LINNSTRUMENT = {
  id: 'linnstrument128',
  anchorDefault: 30,
  anchorChannelDefault: undefined,
  mpe: true,
  mpeVoiceChannels: null,
};

// MPE controller with fixed hardware voice channel range + passthrough default (Exquis)
const EXQUIS = {
  id: 'exquis',
  anchorDefault: 19,
  anchorChannelDefault: undefined,
  mpe: true,
  mpeVoiceChannels: { lo: 2, hi: 15 },
  defaultMode: 'mpe',
  modes: {
    layout2d: {
      defaultPrefs: {
        anchorNote: 19,
        midi_passthrough: false,
        midiin_mpe_input: true,
        midiin_bend_flip: true,
      },
    },
    bypass: {
      defaultPrefs: {
        anchorNote: 19,
        midi_passthrough: true,
        midiin_mpe_input: false,
        midiin_bend_flip: false,
      },
    },
  },
  resolveMode: (settings = {}) => (settings.midi_passthrough ? 'bypass' : 'layout2d'),
};

beforeEach(() => {
  localStorage.clear();
});

describe('getControllerMode', () => {
  it('defaults Exquis to layout2d mode on first connect', () => {
    expect(getControllerMode(EXQUIS)).toBe('layout2d');
  });

  it('uses the stored active mode when present', () => {
    localStorage.setItem('exquis__active_mode', 'bypass');
    expect(getControllerMode(EXQUIS)).toBe('bypass');
  });
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

  it('loads Exquis anchors per mode', () => {
    localStorage.setItem('exquis__layout2d__anchor', '21');
    localStorage.setItem('exquis__bypass__anchor', '9');
    localStorage.setItem('exquis__active_mode', 'layout2d');
    expect(loadSavedAnchor(EXQUIS)).toBe(21);
    localStorage.setItem('exquis__active_mode', 'bypass');
    expect(loadSavedAnchor(EXQUIS)).toBe(9);
  });

  it('falls back to legacy Exquis anchor if no mode-specific anchor exists', () => {
    localStorage.setItem('exquis_anchor', '17');
    expect(loadSavedAnchor(EXQUIS)).toBe(17);
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

  it('stores Exquis anchor in the active mode bucket', () => {
    saveAnchor(EXQUIS, 22, { midi_passthrough: false });
    saveAnchor(EXQUIS, 11, { midi_passthrough: true });
    expect(localStorage.getItem('exquis__layout2d__anchor')).toBe('22');
    expect(localStorage.getItem('exquis__bypass__anchor')).toBe('11');
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

describe('saveControllerPref', () => {
  it('stores Exquis geometry-switch prefs in the target mode bucket and remembers the mode', () => {
    saveControllerPref(EXQUIS, 'midi_passthrough', true, { midi_passthrough: false }, { midi_passthrough: true });
    expect(localStorage.getItem('exquis__bypass__midi_passthrough')).toBe('true');
    expect(localStorage.getItem('exquis__active_mode')).toBe('bypass');
  });
});

// ── loadAnchorSettingsUpdate ──────────────────────────────────────────────────

describe('loadAnchorSettingsUpdate', () => {
  it('returns midiin_central_degree and mpe=false from anchorDefault when nothing stored', () => {
    const update = loadAnchorSettingsUpdate(AXIS49);
    expect(update).toMatchObject({ midiin_central_degree: 53, midiin_mpe_input: false });
  });

  it('returns midiin_central_degree from stored value', () => {
    localStorage.setItem('axis49_anchor', '48');
    const update = loadAnchorSettingsUpdate(AXIS49);
    expect(update.midiin_central_degree).toBe(48);
    expect(update.midiin_mpe_input).toBe(false);
  });

  it('sets midiin_mpe_input=true for MPE controllers', () => {
    const update = loadAnchorSettingsUpdate(LINNSTRUMENT);
    expect(update.midiin_central_degree).toBe(30);
    expect(update.midiin_mpe_input).toBe(true);
  });

  it('includes lumatone_center_channel for channel-aware controllers', () => {
    const update = loadAnchorSettingsUpdate(LUMATONE);
    expect(update.midiin_central_degree).toBe(26);
    expect(update.lumatone_center_channel).toBe(3);
    expect(update.midiin_mpe_input).toBe(false);
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

  it('does not set mpe channel range for controllers with mpeVoiceChannels=null', () => {
    const update = loadAnchorSettingsUpdate(LINNSTRUMENT);
    expect(update).not.toHaveProperty('midiin_mpe_lo_ch');
    expect(update).not.toHaveProperty('midiin_mpe_hi_ch');
  });

  it('auto-applies fixed mpe channel range for controllers with mpeVoiceChannels', () => {
    const update = loadAnchorSettingsUpdate(EXQUIS);
    expect(update.midiin_mpe_input).toBe(true);
    expect(update.midiin_bend_flip).toBe(true);
    expect(update.midi_passthrough).toBe(false);
    expect(update.midiin_mpe_lo_ch).toBe(2);
    expect(update.midiin_mpe_hi_ch).toBe(15);
  });

  it('defaults Exquis to 2D geometry on first connect when nothing is stored', () => {
    const update = loadAnchorSettingsUpdate(EXQUIS, { midiin_mpe_input: false, midi_passthrough: false });
    expect(update.midiin_mpe_input).toBe(true);
  });

  it('loads Exquis bypass mode when it is the stored active mode', () => {
    localStorage.setItem('exquis__active_mode', 'bypass');
    localStorage.setItem('exquis__bypass__anchor', '12');
    const update = loadAnchorSettingsUpdate(EXQUIS);
    expect(update.midi_passthrough).toBe(true);
    expect(update.midiin_mpe_input).toBe(false);
    expect(update.midiin_bend_flip).toBe(false);
    expect(update.midiin_central_degree).toBe(12);
  });

  it('keeps the same Exquis 2D anchor when toggling MPE inside 2D geometry', () => {
    saveAnchor(EXQUIS, 23, { midi_passthrough: false, midiin_mpe_input: true });
    const update = loadAnchorSettingsUpdate(EXQUIS, { midi_passthrough: false, midiin_mpe_input: false });
    expect(update.midiin_central_degree).toBe(23);
  });

  it('defaults midi_passthrough to false for controllers without passthroughDefault', () => {
    const update = loadAnchorSettingsUpdate(AXIS49);
    expect(update.midi_passthrough).toBe(false);
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

  it('saves Exquis learned anchors into the current mode bucket', () => {
    saveAnchorFromLearn(EXQUIS, 18, 1, { midi_passthrough: false });
    saveAnchorFromLearn(EXQUIS, 8, 1, { midi_passthrough: true });
    expect(localStorage.getItem('exquis__layout2d__anchor')).toBe('18');
    expect(localStorage.getItem('exquis__bypass__anchor')).toBe('8');
  });
});
