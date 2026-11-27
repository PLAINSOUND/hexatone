import { beforeEach, expect, it } from "vitest";
import { captureUserSound, normalizeUserSound, parseUserSounds, loadUserSounds, saveUserSounds } from "./user-sounds.js";
beforeEach(() => localStorage.clear());

it("round-trips all four sounds, live levels and SoundFont controls without unrelated settings", () => {
  localStorage.setItem("synth_volume", "0.31");
  localStorage.setItem("osc_volume_buzz", "0.18");
  localStorage.setItem("osc_brightness", "0.81");
  const sound = captureUserSound("  Organ and sine  ", {
    output_dsf: false, output_sample: true, output_fluidsynth: true, output_osc: true,
    dsf_attack: 73, dsf_timbreSustain: -0.8, dsf_partials: 512, instrument: "hammond",
    osc_retrigger_buzz_formant: true, osc_quick_release_time: 2,
    midiin_device: "Private MIDI port", scale: [1, 2], fundamental: 123,
    osc_bridge_url: "ws://private-host", bridge_token: "secret",
  }, {
    description: "Organ layered with sine\nFor rehearsal",
    engine: { soundfontSource: { name: "PlainsoundOrgan.sf2", arrayBuffer() {} },
      selectedPreset: { bank: 2, program: 7 }, volume: 63, reverb: 11,
      smoothing: { pressureMs: 300, expressionMs: 200, minimumMs: 40 } },
  });
  expect(sound.name).toBe("Organ and sine");
  expect(sound.description).toBe("Organ layered with sine\nFor rehearsal");
  expect(sound.settings).toMatchObject({ dsf_attack: 73, dsf_timbreSustain: -0.8,
    dsf_partials: 512, osc_volume_buzz: 0.18, osc_brightness: 0.81, instrument: "hammond",
    output_dsf: false, osc_quick_release_time: 2 });
  expect(sound.sampleVolume).toBe(0.31);
  expect(sound.soundfont).toEqual({ name: "PlainsoundOrgan.sf2", preset: "2:7", volume: 63,
    reverb: 11, smoothing: { pressureMs: 300, expressionMs: 200, minimumMs: 40 } });
  const json = JSON.stringify(sound);
  for (const excluded of ["private", "secret", "fundamental", "scale", "arrayBuffer"]) expect(json).not.toContain(excluded);
  expect(parseUserSounds(json)).toEqual([sound]);
  saveUserSounds([sound]);
  expect(loadUserSounds()).toEqual([sound]);
});

it("validates versions and sanitizes imported sound parameters", () => {
  for (const data of [{}, { format: "hexatone-user-sound", version: 2, name: "x", settings: {} }])
    expect(() => normalizeUserSound(data)).toThrow();
  const record = captureUserSound("test", {});
  delete record.description;
  record.settings.dsf_attack = 999999;
  record.settings.dsf_timbreSustain = -999;
  record.settings.output_mpe = true;
  record.soundfont.smoothing = { pressureMs: 100, expressionMs: 200, minimumMs: 500 };
  const result = normalizeUserSound(record);
  expect(result.description).toBe("");
  expect(result.settings.dsf_attack).toBe(2000);
  expect(result.settings.dsf_timbreSustain).toBe(-1);
  expect(result.settings.output_mpe).toBeUndefined();
  expect(result.soundfont.smoothing.minimumMs).toBe(100);
});

it("recovers from corrupt local storage and records a staged bank's intended preset", () => {
  localStorage.setItem("hexatone_user_sounds", "broken");
  expect(loadUserSounds()).toEqual([]);
  expect(captureUserSound("next", {}, { engine: {
    pendingSoundfont: { source: { name: "next.sf2" }, preferredPreset: "0:5" },
    soundfontSource: { name: "old.sf2" }, selectedPreset: { bank: 0, program: 1 },
  } }).soundfont).toMatchObject({ name: "next.sf2", preset: "0:5" });
});
