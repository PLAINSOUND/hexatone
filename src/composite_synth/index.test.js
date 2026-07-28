import { describe, it, expect, vi } from "vitest";
import { create_composite_synth } from "./index.js";

describe("composite_synth controller-state replay", () => {
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

  it("exposes child families and forwards onset mod state", () => {
    const oscSetMod = vi.fn();
    const sampleSetMod = vi.fn();
    const synth = create_composite_synth([
      { family: "osc", makeHex: vi.fn(() => ({ coords: { x: 0, y: 0 }, cents: 0, noteOn: vi.fn(), noteOff: vi.fn() })), setMod: oscSetMod },
      { family: "sample", makeHex: vi.fn(() => ({ coords: { x: 0, y: 0 }, cents: 0, noteOn: vi.fn(), noteOff: vi.fn() })), setMod: sampleSetMod },
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
      coords: { x: 0, y: 0 }, cents: 0, note_played: 60,
      standardWheelPassthroughOnly: true,
      retune: vi.fn(),
    };
    const mtsHex = {
      coords: { x: 0, y: 0 }, cents: 0, note_played: 60,
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
