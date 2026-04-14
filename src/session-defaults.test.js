/**
 * Tests for src/session-defaults.js
 *
 * Guards against the parseInt(...) || default pattern that collapses a stored
 * "0" to the fallback value. Each test populates sessionStorage with "0"
 * before importing the module (via vi.resetModules) and asserts the key
 * comes back as 0, not the default.
 */

import { describe, it, expect, vi } from "vitest";

// Keys that must survive a stored value of "0".
// Format: [sessionStorage key, expected restored value, wrong default if broken]
const INT_KEYS = [
  ["fluidsynth_channel", 0, -1],
  ["direct_channel", 0, -1],
  ["direct_device_id", 0, 127],
  ["direct_tuning_map_number", 0, 0], // default is also 0, but test that 0 is explicit
  ["mpe_lo_ch", 0, 2],
  ["mpe_hi_ch", 0, 8],
  ["mpe_pitchbend_range", 0, 48],
  ["mpe_pitchbend_range_manager", 0, 2],
  ["midiin_channel", 0, 0], // default is also 0 — still tests no NaN
  ["midi_channel", 0, 0],
  ["midi_velocity", 0, 72],
  ["sysex_type", 0, 126],
  ["device_id", 0, 127],
  ["tuning_map_number", 0, 0],
];

describe("session-defaults integer zero round-trip", () => {
  for (const [key, expected] of INT_KEYS) {
    it(`restores ${key} = 0 without collapsing to default`, async () => {
      // Populate before module evaluation
      sessionStorage.setItem(key, "0");

      // Force re-evaluation of the module so it reads the mocked sessionStorage
      vi.resetModules();
      const { default: sessionDefaults } = await import("./session-defaults.js");

      expect(sessionDefaults[key]).toBe(expected);

      // Clean up so tests don't bleed into each other
      sessionStorage.removeItem(key);
    });
  }
});

describe("session-defaults integer non-zero round-trip", () => {
  it("restores direct_device_id = 42", async () => {
    sessionStorage.setItem("direct_device_id", "42");
    vi.resetModules();
    const { default: sessionDefaults } = await import("./session-defaults.js");
    expect(sessionDefaults.direct_device_id).toBe(42);
    sessionStorage.removeItem("direct_device_id");
  });

  it("restores midi_velocity = 100", async () => {
    sessionStorage.setItem("midi_velocity", "100");
    vi.resetModules();
    const { default: sessionDefaults } = await import("./session-defaults.js");
    expect(sessionDefaults.midi_velocity).toBe(100);
    sessionStorage.removeItem("midi_velocity");
  });
});

describe("session-defaults fallback when key absent", () => {
  it("returns default -1 for direct_channel when not stored", async () => {
    sessionStorage.removeItem("direct_channel");
    vi.resetModules();
    const { default: sessionDefaults } = await import("./session-defaults.js");
    expect(sessionDefaults.direct_channel).toBe(-1);
  });

  it("returns default 127 for device_id when not stored", async () => {
    sessionStorage.removeItem("device_id");
    vi.resetModules();
    const { default: sessionDefaults } = await import("./session-defaults.js");
    expect(sessionDefaults.device_id).toBe(127);
  });

  it("returns default 72 for midi_velocity when not stored", async () => {
    sessionStorage.removeItem("midi_velocity");
    vi.resetModules();
    const { default: sessionDefaults } = await import("./session-defaults.js");
    expect(sessionDefaults.midi_velocity).toBe(72);
  });
});
