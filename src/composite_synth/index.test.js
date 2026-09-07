import { describe, it, expect, vi } from "vitest";
import { create_composite_synth } from "./index.js";

describe("composite_synth controller-state replay", () => {
  it("keeps held sample voices through repeated sound changes and uses the latest sound on reattack", () => {
    const makeEngine = (family) => {
      const hex = { noteOn: vi.fn(), noteOff: vi.fn(), retune: vi.fn(), aftertouch: vi.fn() };
      return { family, makeHex: vi.fn(() => hex), hex };
    };
    const old = makeEngine("sample");
    const intermediate = makeEngine("sample");
    const latest = makeEngine("sample");
    const midi = makeEngine("mpe");
    const voice = create_composite_synth([old, midi]).makeHex(null, 100);
    voice.noteOn(1000);
    voice.reconcileSynths([intermediate, midi], 1020);
    voice.reconcileSynths([latest, midi], 1040);
    voice.aftertouch(64);
    expect(old.hex.noteOff).not.toHaveBeenCalled();
    expect(old.hex.aftertouch).toHaveBeenCalledWith(64, null);
    expect(intermediate.makeHex).not.toHaveBeenCalled();
    expect(latest.makeHex).not.toHaveBeenCalled();
    expect(midi.hex.noteOn).toHaveBeenCalledTimes(1);
    voice.noteOff(32, 1100);
    expect(old.hex.noteOff).toHaveBeenCalledWith(32, 1100);
    voice.noteOn(1200);
    expect(latest.hex.noteOn).toHaveBeenCalledWith(1200);
    expect(old.hex.noteOn).toHaveBeenCalledTimes(1);
    expect(intermediate.makeHex).not.toHaveBeenCalled();
  });

  it("releases a retained sample when its output is disabled", () => {
    const oldHex = { noteOn: vi.fn(), noteOff: vi.fn() };
    const old = { family: "sample", makeHex: () => oldHex };
    const replacement = { family: "sample", makeHex: vi.fn() };
    const voice = create_composite_synth([old]).makeHex();
    voice.noteOn();
    voice.reconcileSynths([replacement], 100);
    voice.reconcileSynths([], 200);
    expect(oldHex.noteOff).toHaveBeenCalledWith(0, 200);
    expect(replacement.makeHex).not.toHaveBeenCalled();
  });

  it("keeps volume and panic connected to retiring samples and prunes completed tails", () => {
    const old = { hasVoices: vi.fn(() => true), setVolume: vi.fn(), allSoundOff: vi.fn() };
    const ended = { hasVoices: () => false, setVolume: vi.fn() };
    const current = { family: "sample", makeHex: vi.fn(() => ({})), allSoundOff: vi.fn() };
    const retired = new Set([old, ended]);
    const synth = create_composite_synth([current], retired);
    synth.makeHex();
    expect(current.makeHex).toHaveBeenCalledOnce();
    synth.setVolume(0.5);
    expect(old.setVolume).toHaveBeenCalledWith(0.5);
    expect(ended.setVolume).not.toHaveBeenCalled();
    expect(retired.has(ended)).toBe(false);
    synth.allSoundOff();
    expect(old.allSoundOff).toHaveBeenCalledOnce();
    expect(current.allSoundOff).toHaveBeenCalledOnce();
    expect(retired.size).toBe(0);
  });

  it("exposes child velocities on the wrapper hex for snapshot capture", () => {
    const aHex = {
      coords: { x: 0, y: 0 },
      cents: 0,
      release: false,
      note_played: 60,
      velocity: 96,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
    };
    const bHex = {
      coords: { x: 0, y: 0 },
      cents: 0,
      release: false,
      note_played: 60,
      velocity_played: 117,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
    };
    const synth = create_composite_synth([
      { makeHex: vi.fn(() => aHex) },
      { makeHex: vi.fn(() => bHex) },
    ]);

    const hex = synth.makeHex();

    expect(hex.velocity_played).toBe(117);
    expect(hex.velocity).toBe(96);
  });

  it("fans out remembered and replayed controller state to child synths", () => {
    const a = {
      rememberControllerState: vi.fn(),
      applyControllerState: vi.fn(),
    };
    const b = {
      rememberControllerState: vi.fn(),
      applyControllerState: vi.fn(),
    };
    const state = {
      ccValues: { 1: 96, 64: 127 },
      channelPressure: 55,
      pitchBend14: 9216,
    };

    const synth = create_composite_synth([a, b]);
    synth.rememberControllerState(state);
    synth.applyControllerState(state);

    expect(a.rememberControllerState).toHaveBeenCalledWith(state);
    expect(b.rememberControllerState).toHaveBeenCalledWith(state);
    expect(a.applyControllerState).toHaveBeenCalledWith(state);
    expect(b.applyControllerState).toHaveBeenCalledWith(state);
  });

  it("fans out a zone-wide Mod Wheel update once per capable child synth", () => {
    const sample = { applyZoneModwheel: vi.fn() };
    const osc = { applyZoneModwheel: vi.fn() };
    const mpe = {};
    const synth = create_composite_synth([sample, osc, mpe]);

    synth.applyZoneModwheel(91);

    expect(sample.applyZoneModwheel).toHaveBeenCalledOnce();
    expect(sample.applyZoneModwheel).toHaveBeenCalledWith(91);
    expect(osc.applyZoneModwheel).toHaveBeenCalledOnce();
    expect(osc.applyZoneModwheel).toHaveBeenCalledWith(91);
  });

  it("allows stored sequence timbre to override a preceding zone-wide Mod Wheel update", () => {
    const noteModwheel = vi.fn();
    const applyZoneModwheel = vi.fn();
    const synth = create_composite_synth([
      {
        applyZoneModwheel,
        makeHex: vi.fn(() => ({
          coords: { x: 0, y: 0 },
          cents: 0,
          modwheel: noteModwheel,
        })),
      },
    ]);
    const hex = synth.makeHex();

    hex.modwheel(80);
    synth.applyZoneModwheel(127);
    hex.modwheel(80);

    expect(applyZoneModwheel).toHaveBeenCalledWith(127);
    expect(noteModwheel.mock.calls).toEqual([[80], [80]]);
  });

  it("deduplicates repeated zone-wide expression emitted through different chord voices", () => {
    const mpeModwheel = vi.fn();
    const mpeExpression = vi.fn();
    const synth = create_composite_synth([
      {
        makeHex: vi.fn(() => ({
          coords: { x: 0, y: 0 },
          cents: 0,
          modwheel: mpeModwheel,
          expression: mpeExpression,
        })),
      },
    ]);
    const first = synth.makeHex();
    const second = synth.makeHex();

    first.modwheel(73);
    second.modwheel(73);
    second.modwheel(74);
    first.expression(91);
    second.expression(91);

    expect(mpeModwheel.mock.calls).toEqual([[73], [74]]);
    expect(mpeExpression.mock.calls).toEqual([[91]]);
  });

  it("forwards a shared chord timestamp to every child note-on", () => {
    const firstNoteOn = vi.fn();
    const secondNoteOn = vi.fn();
    const wrapper = create_composite_synth([
      {
        makeHex: () => ({ coords: { x: 0, y: 0 }, cents: 0, noteOn: firstNoteOn }),
      },
      {
        makeHex: () => ({ coords: { x: 0, y: 0 }, cents: 0, noteOn: secondNoteOn }),
      },
    ]).makeHex();

    wrapper.noteOn(1234.5);

    expect(firstNoteOn).toHaveBeenCalledWith(1234.5);
    expect(secondNoteOn).toHaveBeenCalledWith(1234.5);
  });

  it("adds a newly enabled output to an already sounding voice", () => {
    const firstHex = {
      coords: { x: 0, y: 0 },
      cents: 100,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      retune: vi.fn(),
      applySnapshotPressure: vi.fn(),
      polyTimbre: vi.fn(),
    };
    const secondHex = {
      coords: { x: 0, y: 0 },
      cents: 100,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      retune: vi.fn(),
      applySnapshotPressure: vi.fn(),
      polyTimbre: vi.fn(),
    };
    const first = { makeHex: vi.fn(() => firstHex) };
    const second = { makeHex: vi.fn(() => secondHex) };
    const wrapper = create_composite_synth([first]).makeHex(null, 100);

    wrapper.noteOn(1000);
    wrapper.applySnapshotPressure(73);
    wrapper.polyTimbre(81);
    wrapper.reconcileSynths([first, second], 1020);

    expect(firstHex.noteOn).toHaveBeenCalledOnce();
    expect(second.makeHex).toHaveBeenCalledOnce();
    expect(secondHex.noteOn).toHaveBeenCalledWith(1020);
    expect(secondHex.applySnapshotPressure).toHaveBeenCalledWith(73, null);
    expect(secondHex.polyTimbre).toHaveBeenCalledWith(81, null);
  });

  it("lets a silent logical voice join an output enabled later", () => {
    const childHex = {
      coords: { x: 1, y: 2 },
      cents: 300,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      retune: vi.fn(),
    };
    const output = { makeHex: vi.fn(() => childHex) };
    const wrapper = create_composite_synth([]).makeHex({ x: 1, y: 2 }, 300);

    wrapper.noteOn(1000);
    wrapper.reconcileSynths([output], 1020);

    expect(output.makeHex).toHaveBeenCalledOnce();
    expect(childHex.noteOn).toHaveBeenCalledWith(1020);
  });

  it("removes a disabled output without reattacking retained outputs", () => {
    const firstHex = {
      coords: { x: 0, y: 0 },
      cents: 0,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
    };
    const secondHex = {
      coords: { x: 0, y: 0 },
      cents: 0,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
    };
    const first = { makeHex: () => firstHex };
    const second = { makeHex: () => secondHex };
    const wrapper = create_composite_synth([first, second]).makeHex();

    wrapper.noteOn(1000);
    wrapper.reconcileSynths([first], 1020);

    expect(firstHex.noteOn).toHaveBeenCalledOnce();
    expect(firstHex.noteOff).not.toHaveBeenCalled();
    expect(secondHex.noteOff).toHaveBeenCalledWith(0, 1020);
  });

  it("routes polyphonic timbre only to non-MTS child outputs", () => {
    const mpeHex = {
      coords: { x: 0, y: 0 },
      cents: 0,
      release: false,
      note_played: 60,
      polyTimbre: vi.fn(),
    };
    const mtsHex = {
      coords: { x: 0, y: 0 },
      cents: 0,
      release: false,
      note_played: 60,
      isMtsOutput: true,
      cc74: vi.fn(),
    };
    const sampleHex = {
      coords: { x: 0, y: 0 },
      cents: 0,
      release: false,
      note_played: 60,
      cc74: vi.fn(),
    };
    const synth = create_composite_synth([
      { makeHex: vi.fn(() => mpeHex) },
      { makeHex: vi.fn(() => mtsHex) },
      { makeHex: vi.fn(() => sampleHex) },
    ]);

    const hex = synth.makeHex();
    hex.polyTimbre(91, 12000);

    expect(mpeHex.polyTimbre).toHaveBeenCalledWith(91, 12000);
    expect(mtsHex.cc74).not.toHaveBeenCalled();
    expect(sampleHex.cc74).toHaveBeenCalledWith(91, 12000);
  });

  it("uses the snapshot-pressure hook only on children that provide it", () => {
    const first = {
      coords: { x: 0, y: 0 },
      cents: 0,
      note_played: 60,
      applySnapshotPressure: vi.fn(),
    };
    const second = {
      coords: { x: 0, y: 0 },
      cents: 0,
      note_played: 60,
      aftertouch: vi.fn(),
    };
    const wrapper = create_composite_synth([
      { makeHex: () => first },
      { makeHex: () => second },
    ]).makeHex();

    wrapper.applySnapshotPressure(0, null);

    expect(first.applySnapshotPressure).toHaveBeenCalledWith(0, null);
    expect(second.aftertouch).toHaveBeenCalledWith(0, null);
  });

  it("recovers only a displaced child output", () => {
    const recover = vi.fn(() => true);
    const mpeHex = {
      coords: { x: 0, y: 0 },
      cents: 0,
      hasDisplacedVoice: () => true,
      displacedVoiceAt: () => 42,
      recoverDisplacedVoice: recover,
    };
    const mtsHex = {
      coords: { x: 0, y: 0 },
      cents: 0,
      noteOn: vi.fn(),
    };
    const wrapper = create_composite_synth([
      { makeHex: () => mpeHex },
      { makeHex: () => mtsHex },
    ]).makeHex();
    const note = { midicents: 76, attackVelocity: 66 };

    expect(wrapper.hasDisplacedVoice()).toBe(true);
    expect(wrapper.displacedVoiceAt()).toBe(42);
    expect(wrapper.recoverDisplacedVoice(note, 1234)).toBe(true);
    expect(recover).toHaveBeenCalledWith(note, 1234);
    expect(mtsHex.noteOn).not.toHaveBeenCalled();
  });

  it("exposes child families and forwards onset mod state", () => {
    const oscSetMod = vi.fn();
    const sampleSetMod = vi.fn();
    const synth = create_composite_synth([
      {
        family: "osc",
        makeHex: vi.fn(() => ({
          coords: { x: 0, y: 0 },
          cents: 0,
          noteOn: vi.fn(),
          noteOff: vi.fn(),
        })),
        setMod: oscSetMod,
      },
      {
        family: "sample",
        makeHex: vi.fn(() => ({
          coords: { x: 0, y: 0 },
          cents: 0,
          noteOn: vi.fn(),
          noteOff: vi.fn(),
        })),
        setMod: sampleSetMod,
      },
    ]);

    expect(synth.family).toBe("composite");
    expect(synth.families).toEqual(["osc", "sample"]);
    expect(synth.containsFamily("osc")).toBe(true);
    expect(synth.containsFamily("mpe")).toBe(false);

    synth.setMod(1.75);
    expect(oscSetMod).toHaveBeenCalledWith(1.75);
    expect(sampleSetMod).toHaveBeenCalledWith(1.75);
  });

  it("falls back to child retune for standard wheel fan-out when a child lacks standardWheelRetune", () => {
    const sampleHex = {
      coords: { x: 0, y: 0 },
      cents: 0,
      release: false,
      note_played: 60,
      standardWheelRetune: vi.fn(),
    };
    const mtsOrOscHex = {
      coords: { x: 0, y: 0 },
      cents: 0,
      release: false,
      note_played: 60,
      retune: vi.fn(),
    };
    const synth = create_composite_synth([
      { makeHex: vi.fn(() => sampleHex) },
      { makeHex: vi.fn(() => mtsOrOscHex) },
    ]);

    const hex = synth.makeHex();
    hex.standardWheelRetune(1234);

    expect(sampleHex.standardWheelRetune).toHaveBeenCalledWith(1234);
    expect(mtsOrOscHex.retune).toHaveBeenCalledWith(1234, true);
  });

  it("sends absolute sequencer targets to every child without wheel passthrough", () => {
    const mpeHex = {
      coords: { x: 0, y: 0 },
      cents: 0,
      note_played: 60,
      standardWheelPassthroughOnly: true,
      retune: vi.fn(),
    };
    const mtsHex = {
      coords: { x: 0, y: 0 },
      cents: 0,
      note_played: 60,
      sequenceRetune: vi.fn(),
    };
    const wrapper = create_composite_synth([
      { makeHex: vi.fn(() => mpeHex) },
      { makeHex: vi.fn(() => mtsHex) },
    ]).makeHex();

    wrapper.sequenceRetune(147);

    expect(mpeHex.retune).toHaveBeenCalledWith(147, true);
    expect(mtsHex.sequenceRetune).toHaveBeenCalledWith(147);
  });
});
