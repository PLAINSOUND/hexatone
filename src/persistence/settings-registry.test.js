/**
 * Tests for persistence/settings-registry.js and persistence/storage-utils.js
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SETTINGS_REGISTRY,
  REGISTRY_BY_KEY,
  URL_KEYS,
  SESSION_KEYS,
  RUNTIME_KEYS,
  PRESET_SKIP_KEYS,
} from './settings-registry.js';

import {
  sessionInt, sessionFloat, sessionBool, sessionString,
  localInt, localFloat, localBool, localString,
} from './storage-utils.js';

// ── Registry structural integrity ────────────────────────────────────────────

describe('SETTINGS_REGISTRY structure', () => {
  const VALID_TIERS   = new Set(['url', 'session', 'local', 'runtime']);
  const VALID_TYPES   = new Set(['int', 'float', 'bool', 'string', 'joined']);

  it('has no duplicate keys', () => {
    const keys = SETTINGS_REGISTRY.map(e => e.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it('every entry has a valid tier', () => {
    for (const entry of SETTINGS_REGISTRY) {
      expect(VALID_TIERS, `key "${entry.key}" has invalid tier "${entry.tier}"`).toContain(entry.tier);
    }
  });

  it('every entry has a valid type', () => {
    for (const entry of SETTINGS_REGISTRY) {
      expect(VALID_TYPES, `key "${entry.key}" has invalid type "${entry.type}"`).toContain(entry.type);
    }
  });

  it('every entry has a default value (even if null)', () => {
    for (const entry of SETTINGS_REGISTRY) {
      expect(entry, `key "${entry.key}" is missing a default property`).toHaveProperty('default');
    }
  });

  it('integer entries have a numeric or null default', () => {
    for (const entry of SETTINGS_REGISTRY.filter(e => e.type === 'int')) {
      const ok = entry.default === null || typeof entry.default === 'number';
      expect(ok, `int key "${entry.key}" has non-numeric default "${entry.default}"`).toBe(true);
    }
  });

  it('float entries have a numeric or null default', () => {
    for (const entry of SETTINGS_REGISTRY.filter(e => e.type === 'float')) {
      const ok = entry.default === null || typeof entry.default === 'number';
      expect(ok, `float key "${entry.key}" has non-numeric default "${entry.default}"`).toBe(true);
    }
  });

  it('bool entries have a boolean or null default', () => {
    for (const entry of SETTINGS_REGISTRY.filter(e => e.type === 'bool')) {
      const ok = entry.default === null || typeof entry.default === 'boolean';
      expect(ok, `bool key "${entry.key}" has non-boolean default "${entry.default}"`).toBe(true);
    }
  });
});

// ── Derived maps ─────────────────────────────────────────────────────────────

describe('REGISTRY_BY_KEY', () => {
  it('contains every key in SETTINGS_REGISTRY', () => {
    for (const entry of SETTINGS_REGISTRY) {
      expect(REGISTRY_BY_KEY[entry.key]).toBe(entry);
    }
  });

  it('has the same number of entries as SETTINGS_REGISTRY', () => {
    expect(Object.keys(REGISTRY_BY_KEY).length).toBe(SETTINGS_REGISTRY.length);
  });
});

describe('URL_KEYS', () => {
  it('contains only entries with tier url', () => {
    for (const key of URL_KEYS) {
      expect(REGISTRY_BY_KEY[key].tier).toBe('url');
    }
  });
});

describe('SESSION_KEYS', () => {
  it('contains only entries with tier session', () => {
    for (const key of SESSION_KEYS) {
      expect(REGISTRY_BY_KEY[key].tier).toBe('session');
    }
  });

  it('includes retuning_mode so it is not shared via URL', () => {
    expect(SESSION_KEYS).toContain('retuning_mode');
    expect(URL_KEYS).not.toContain('retuning_mode');
  });
});

describe('RUNTIME_KEYS', () => {
  it('contains only entries with tier runtime', () => {
    for (const key of RUNTIME_KEYS) {
      expect(REGISTRY_BY_KEY[key].tier).toBe('runtime');
    }
  });
});

describe('PRESET_SKIP_KEYS', () => {
  it('contains only entries with presetSkip: true', () => {
    for (const key of PRESET_SKIP_KEYS) {
      expect(REGISTRY_BY_KEY[key].presetSkip).toBe(true);
    }
  });

  it('covers the expected scale/layout keys', () => {
    const expected = ['name', 'scale', 'equivSteps', 'rSteps', 'drSteps', 'hexSize'];
    for (const key of expected) {
      expect(PRESET_SKIP_KEYS).toContain(key);
    }
  });
});

// ── storage-utils: zero/falsy round-trip ─────────────────────────────────────

describe('sessionInt', () => {
  beforeEach(() => sessionStorage.clear());

  it('returns stored 0 (not the fallback)', () => {
    sessionStorage.setItem('test_int', '0');
    expect(sessionInt('test_int', 99)).toBe(0);
  });

  it('returns fallback when key is absent', () => {
    expect(sessionInt('test_int', 99)).toBe(99);
  });

  it('returns fallback when key is absent and fallback is 0', () => {
    expect(sessionInt('test_int', 0)).toBe(0);
  });

  it('returns a positive value correctly', () => {
    sessionStorage.setItem('test_int', '42');
    expect(sessionInt('test_int', 0)).toBe(42);
  });

  it('returns a negative value correctly', () => {
    sessionStorage.setItem('test_int', '-1');
    expect(sessionInt('test_int', 0)).toBe(-1);
  });
});

describe('sessionFloat', () => {
  beforeEach(() => sessionStorage.clear());

  it('returns stored 0.0 (not the fallback)', () => {
    sessionStorage.setItem('test_float', '0');
    expect(sessionFloat('test_float', 1.5)).toBe(0);
  });

  it('returns fallback when key is absent', () => {
    expect(sessionFloat('test_float', 1.5)).toBeCloseTo(1.5);
  });

  it('parses a decimal correctly', () => {
    sessionStorage.setItem('test_float', '440.5');
    expect(sessionFloat('test_float', 0)).toBeCloseTo(440.5);
  });
});

describe('sessionBool', () => {
  beforeEach(() => sessionStorage.clear());

  it('returns false when "false" is stored (not the fallback)', () => {
    sessionStorage.setItem('test_bool', 'false');
    expect(sessionBool('test_bool', true)).toBe(false);
  });

  it('returns true when "true" is stored', () => {
    sessionStorage.setItem('test_bool', 'true');
    expect(sessionBool('test_bool', false)).toBe(true);
  });

  it('returns fallback when key is absent', () => {
    expect(sessionBool('test_bool', true)).toBe(true);
  });
});

describe('sessionString', () => {
  beforeEach(() => sessionStorage.clear());

  it('returns empty string when "" is stored (not the fallback)', () => {
    sessionStorage.setItem('test_str', '');
    expect(sessionString('test_str', 'OFF')).toBe('');
  });

  it('returns fallback when key is absent', () => {
    expect(sessionString('test_str', 'OFF')).toBe('OFF');
  });

  it('returns stored value correctly', () => {
    sessionStorage.setItem('test_str', 'IAC Driver Bus 1');
    expect(sessionString('test_str', 'OFF')).toBe('IAC Driver Bus 1');
  });
});

describe('localInt', () => {
  beforeEach(() => localStorage.clear());

  it('returns stored 0 (not the fallback)', () => {
    localStorage.setItem('test_int', '0');
    expect(localInt('test_int', 60)).toBe(0);
  });

  it('returns fallback when key is absent', () => {
    expect(localInt('test_int', 60)).toBe(60);
  });
});

describe('localBool', () => {
  beforeEach(() => localStorage.clear());

  it('returns false when "false" is stored', () => {
    localStorage.setItem('test_bool', 'false');
    expect(localBool('test_bool', true)).toBe(false);
  });

  it('returns fallback when key is absent', () => {
    expect(localBool('test_bool', true)).toBe(true);
  });
});

describe('localString', () => {
  beforeEach(() => localStorage.clear());

  it('returns empty string when "" is stored', () => {
    localStorage.setItem('test_str', '');
    expect(localString('test_str', 'default')).toBe('');
  });

  it('returns fallback when key is absent', () => {
    expect(localString('test_str', 'default')).toBe('default');
  });
});
