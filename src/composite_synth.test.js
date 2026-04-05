import { describe, it, expect, vi } from "vitest";
import { create_composite_synth } from "./composite_synth/index.js";

describe("composite_synth controller-state replay", () => {
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
