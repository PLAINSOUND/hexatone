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
});
