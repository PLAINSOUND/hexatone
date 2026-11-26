/**
 * Tests for src/settings/session-defaults.js
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
  ["mts_bulk_channel", 0, -1],
  ["mts_bulk_device_id", 0, 127],
  ["mts_bulk_tuning_map_number", 0, 0], // default is also 0, but test that 0 is explicit
  ["mpe_lo_ch", 0, 2],
  ["mpe_hi_ch", 0, 8],
  ["mpe_pitchbend_range", 0, 48],
  ["mpe_pitchbend_range_manager", 0, 2],
  ["midi_channel", 0, 0],
  ["midi_velocity", 0, 72],
  ["sysex_type", 0, 126],
  ["device_id", 0, 127],
  ["tuning_map_number", 0, 0],
];

describe("session-defaults integer zero round-trip", () => {
  it.each([
    [null, "1", 1],
    ["71", "1", 71],
    ["0", "71", 0],
  ])("restores ExpressionY CC with legacy compatibility (new: %s, old: %s)", async (current, legacy, expected) => {
    sessionStorage.setItem("mono_slide_cc", legacy);
    if (current == null) sessionStorage.removeItem("mono_expression_y_cc");
    else sessionStorage.setItem("mono_expression_y_cc", current);
    try {
      vi.resetModules();
      const { default: defaults } = await import("./session-defaults.js");
      expect(defaults.mono_expression_y_cc).toBe(expected);
      expect(defaults).not.toHaveProperty("mono_slide_cc");
    } finally {
      sessionStorage.removeItem("mono_slide_cc");
      sessionStorage.removeItem("mono_expression_y_cc");
    }
  });

  it("applies opt-out before reading stored MIDI defaults on reload", async () => {
    localStorage.setItem("hexatone_restore_io_on_reload", "false");
    sessionStorage.setItem("output_mpe", "true");
    sessionStorage.setItem("mpe_device", "missing-port");
    sessionStorage.setItem("webmidi_enabled", "true");
    sessionStorage.setItem("mono_slide_cc", "1");
    sessionStorage.setItem("mono_expression_y_cc", "71");
    const navigation = vi
      .spyOn(performance, "getEntriesByType")
      .mockReturnValue([{ type: "reload" }]);
    try {
      vi.resetModules();
      const { default: defaults } = await import("./session-defaults.js");
      expect(defaults.output_mpe).toBe(false);
      expect(defaults.mpe_device).toBe("OFF");
      expect(defaults.webmidi_enabled).toBe(false);
      expect(defaults.mono_expression_y_cc).toBe(74);
    } finally {
      navigation.mockRestore();
      localStorage.removeItem("hexatone_restore_io_on_reload");
    }
  });
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
  it("restores mts_bulk_device_id = 42", async () => {
    sessionStorage.setItem("mts_bulk_device_id", "42");
    vi.resetModules();
    const { default: sessionDefaults } = await import("./session-defaults.js");
    expect(sessionDefaults.mts_bulk_device_id).toBe(42);
    sessionStorage.removeItem("mts_bulk_device_id");
  });

  it("restores midi_velocity = 100", async () => {
    sessionStorage.setItem("midi_velocity", "100");
    vi.resetModules();
    const { default: sessionDefaults } = await import("./session-defaults.js");
    expect(sessionDefaults.midi_velocity).toBe(100);
    sessionStorage.removeItem("midi_velocity");
  });
});

describe("session-defaults HEJI palette round-trip", () => {
  it("restores palette display preferences but clears its constructed spelling", async () => {
    sessionStorage.setItem("heji_palette_visible", "true");
    sessionStorage.setItem("heji_palette_structure", '{"letter":"A"}');
    sessionStorage.setItem("heji_palette_deviation", "+17");
    sessionStorage.setItem("heji_palette_decimals", "3");
    vi.resetModules();

    const { default: sessionDefaults } = await import("./session-defaults.js");

    expect(sessionDefaults.heji_palette_visible).toBe(true);
    expect(sessionDefaults.heji_palette_structure).toBeUndefined();
    expect(sessionDefaults.heji_palette_deviation).toBeUndefined();
    expect(sessionDefaults.heji_palette_decimals).toBe(3);

    sessionStorage.removeItem("heji_palette_visible");
    sessionStorage.removeItem("heji_palette_structure");
    sessionStorage.removeItem("heji_palette_deviation");
    sessionStorage.removeItem("heji_palette_decimals");
  });
});

describe("session-defaults fallback when key absent", () => {
  it("returns default -1 for mts_bulk_channel when not stored", async () => {
    sessionStorage.removeItem("mts_bulk_channel");
    vi.resetModules();
    const { default: sessionDefaults } = await import("./session-defaults.js");
    expect(sessionDefaults.mts_bulk_channel).toBe(-1);
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
it.each([["true", 1], ["false", 0], ["0", 0], ["0.37", .37], ["1", 1]])(
  "restores ISO compensation from saved %s", async (raw, expected) => {
    const previous = localStorage.getItem("dsf_iso226");
    try {
      localStorage.setItem("dsf_iso226", raw);
      vi.resetModules();
      const { default: defaults } = await import("./session-defaults.js");
      expect(defaults.dsf_iso226).toBe(expected);
    } finally {
      if (previous === null) localStorage.removeItem("dsf_iso226");
      else localStorage.setItem("dsf_iso226", previous);
    }
  },
);
it.each([["false", null, false], ["true", null, true], ["false", "true", true], ["true", "false", false]])(
  "restores independent release velocity with old velocity %s and new value %s", async (velocity, release, expected) => {
    const previousVelocity = localStorage.getItem("dsf_velocity");
    const previousRelease = localStorage.getItem("dsf_releaseVelocity");
    try {
      localStorage.setItem("dsf_velocity", velocity);
      if (release === null) localStorage.removeItem("dsf_releaseVelocity");
      else localStorage.setItem("dsf_releaseVelocity", release);
      vi.resetModules();
      const { default: defaults } = await import("./session-defaults.js");
      expect(defaults.dsf_releaseVelocity).toBe(expected);
    } finally {
      if (previousVelocity === null) localStorage.removeItem("dsf_velocity");
      else localStorage.setItem("dsf_velocity", previousVelocity);
      if (previousRelease === null) localStorage.removeItem("dsf_releaseVelocity");
      else localStorage.setItem("dsf_releaseVelocity", previousRelease);
    }
  },
);

it("migrates the old velocity switch and restores independent amounts", async () => {
  const keys = ["dsf_velocity", "dsf_velocityVolume", "dsf_velocityTimbre", "dsf_velocityAttack"];
  const previous = keys.map(key => localStorage.getItem(key));
  try {
    localStorage.setItem("dsf_velocity", "false");
    localStorage.removeItem("dsf_velocityVolume");
    localStorage.removeItem("dsf_velocityTimbre");
    localStorage.removeItem("dsf_velocityAttack");
    vi.resetModules();
    let defaults = (await import("./session-defaults.js")).default;
    expect(defaults.dsf_velocityVolume).toBe(0);
    expect(defaults.dsf_velocityTimbre).toBe(0);
    expect(defaults.dsf_velocityAttack).toBe(0);
    localStorage.setItem("dsf_velocityVolume", "0.35");
    localStorage.setItem("dsf_velocityTimbre", "1");
    vi.resetModules();
    defaults = (await import("./session-defaults.js")).default;
    expect(defaults.dsf_velocityVolume).toBe(.35);
    expect(defaults.dsf_velocityTimbre).toBe(1);
  } finally {
    keys.forEach((key, i) => previous[i] === null ? localStorage.removeItem(key) : localStorage.setItem(key, previous[i]));
  }
});

it("uses the DSF sound defaults when no DSF settings or legacy switches are saved", async () => {
  const { DSF_DEFAULTS } = await import("../dsf_synth/controls.js");
  const keys = Object.keys(DSF_DEFAULTS).map(key => `dsf_${key}`);
  const saved = keys.map(key => localStorage.getItem(key));
  try {
    keys.forEach(key => localStorage.removeItem(key));
    vi.resetModules();
    const defaults = (await import("./session-defaults.js")).default;
    for (const [key, value] of Object.entries(DSF_DEFAULTS))
      expect(defaults[`dsf_${key}`]).toBe(value);
  } finally {
    keys.forEach((key, i) => saved[i] === null ? localStorage.removeItem(key) : localStorage.setItem(key, saved[i]));
  }
});
