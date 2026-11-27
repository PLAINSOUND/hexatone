import { beforeEach, expect, it } from "vitest";
import { BUILTIN_USER_SOUNDS, availableUserSoundName, captureUserSound, normalizeUserSound, parseUserSounds, loadUserSounds, saveUserSounds, userSoundHasChanges } from "./user-sounds.js";
import { builtinSoundDefinitions } from "./builtin-user-sounds.js";
beforeEach(() => localStorage.clear());

it("keeps copy names unique within the saved format's length limit", () => {
  const base = "x".repeat(200);
  const records = [{ name: base }, ...Array.from({ length: 8 }, (_, i) => ({ name: `${base.slice(0, 198)} ${i + 2}` }))];
  const name = availableUserSoundName(base, records);
  expect(name).toBe(`${base.slice(0, 197)} 10`);
  expect(name).toHaveLength(200);
  const sound = captureUserSound(name, {});
  expect(normalizeUserSound(sound).name).toBe(name);
});

it("normalizes truncated names idempotently when the cutoff lands on whitespace", () => {
  const sound = captureUserSound(`${"x".repeat(199)} more`, {});
  expect(sound.name).toBe("x".repeat(199));
  expect(normalizeUserSound(sound)).toEqual(sound);
});

it.each([
  ["Windows NT", "PlainsoundOrgan.sf2", "PlainsoundOrganPrincipal.sf2"],
  ["iPhone", "PlainsoundOrganPrincipal.sf2", "PlainsoundOrgan.sf2"],
  ["Android", "PlainsoundOrganPrincipal.sf2", "PlainsoundOrgan.sf2"],
])("prefers the appropriate Baroque Organ bank on %s", (userAgent, primary, fallback) => {
  const sounds = builtinSoundDefinitions({ userAgent });
  const index = sounds.findIndex(sound => sound.name === "Baroque Organ");
  expect(sounds[index - 1].name).toBe("Hammond");
  expect(sounds[index].soundfont).toMatchObject({ name: primary, preset: "0:3",
    fallback: { name: fallback, preset: "0:3" } });
});

it.each(["Windows NT", "iPhone", "Android"])("uses the corresponding Lute program in either Harpsichord bank on %s", userAgent => {
  const { soundfont } = builtinSoundDefinitions({ userAgent }).find(sound => sound.name === "Harpsichord");
  const full = { name: "PlainsoundHarpsichord.sf2", preset: "0:3" };
  const slim = { name: "PlainsoundHarpsichordLute.sf2", preset: "0:0" };
  expect(soundfont).toEqual(userAgent === "Windows NT" ? { ...full, fallback: slim } : { ...slim, fallback: full });
});

it.each(["Default", "Harpsichord"])("captures the equivalent %s bank and drops its fallback after a patch edit", name => {
  const saved = BUILTIN_USER_SOUNDS.find(sound => sound.name === name);
  const [bank, program] = saved.soundfont.fallback.preset.split(":").map(Number);
  const engine = { soundfontSource: { name: saved.soundfont.fallback.name },
    selectedPreset: { bank, program } };
  const options = { engine, referenceSoundfont: saved.soundfont };
  const captured = captureUserSound(saved.name, saved.settings, options);
  expect(captured).toEqual(saved);
  expect(userSoundHasChanges(captured, saved)).toBe(false);
  engine.selectedPreset.program = 7;
  const edited = captureUserSound(saved.name, saved.settings, options);
  expect(edited.soundfont.fallback).toBeUndefined();
  expect(edited.soundfont.preset).toBe("0:7");
  expect(userSoundHasChanges(edited, saved)).toBe(true);
});

it("compares sound settings independently of object property order", () => {
  const saved = captureUserSound("Same sound", {});
  const current = { ...saved, settings: Object.fromEntries(Object.entries(saved.settings).reverse()) };
  expect(userSoundHasChanges(current, saved)).toBe(false);
  current.settings.dsf_timbre = 0.9;
  expect(userSoundHasChanges(current, saved)).toBe(true);
});

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
