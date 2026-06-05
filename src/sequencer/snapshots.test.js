import { describe, expect, it, vi } from "vitest";
import { captureSnapshot, playSnapshot, stopSnapshot } from "./snapshots.js";

function makeRuntime(overrides = {}) {
  return {
    settings: {
      reference_degree: 0,
      fundamental: 440,
      midi_velocity: 72,
      ...overrides.settings,
    },
    tuning: {
      scale: [0, 100, 200],
      equivSteps: 3,
      degree0toRef_asArray: [0, 1],
      ...overrides.tuning,
    },
    state: {
      sustainedNotes: [],
      ...overrides.state,
    },
    synth: overrides.synth,
    stopSnapshot: overrides.stopSnapshot ?? vi.fn(),
    _allActiveHexes: overrides._allActiveHexes ?? (() => []),
  };
}

describe("sequencer snapshots", () => {
  it("captures active note pitch and attack/release velocities", () => {
    const runtime = makeRuntime({
      _allActiveHexes: () => [{ cents: 0, velocity: 113 }],
    });

    expect(captureSnapshot(runtime)).toEqual([
      {
        midicents: 69,
        attackVelocity: 113,
        releaseVelocity: 113,
        velocity: 113,
      },
    ]);
  });

  it("uses sustained release velocity separately from attack velocity", () => {
    const runtime = makeRuntime({
      state: {
        sustainedNotes: [[{ cents: 0, velocity_played: 101 }, 35]],
      },
    });

    expect(captureSnapshot(runtime)[0]).toMatchObject({
      attackVelocity: 101,
      releaseVelocity: 35,
      velocity: 101,
    });
  });

  it("captures current pressure and timbre expression when present", () => {
    const runtime = makeRuntime({
      _allActiveHexes: () => [{
        cents: 0,
        velocity: 113,
        _lastAftertouch: 64,
        _lastAftertouch14: 8200,
        _lastCC74: 91,
        _lastCC7414: 12000,
      }],
    });

    expect(captureSnapshot(runtime)[0]).toMatchObject({
      pressure: 64,
      pressure14: 8200,
      timbre: 91,
      timbre14: 12000,
    });
  });

  it("plays with attack velocity and stops with release velocity", () => {
    const noteOn = vi.fn();
    const noteOff = vi.fn();
    const synth = {
      makeHex: vi.fn(() => ({ noteOn, noteOff })),
    };
    const runtime = makeRuntime({ synth });

    const hexes = playSnapshot(runtime, [
      { midicents: 69, attackVelocity: 120, releaseVelocity: 44 },
    ]);
    stopSnapshot(hexes);

    expect(runtime.stopSnapshot).toHaveBeenCalledTimes(1);
    expect(synth.makeHex.mock.calls[0][8]).toBe(120);
    expect(noteOn).toHaveBeenCalledTimes(1);
    expect(noteOff).toHaveBeenCalledWith(44);
  });

  it("replays pressure as aftertouch and timbre through the MPE-only hook", () => {
    const noteOn = vi.fn();
    const aftertouch = vi.fn();
    const mpeTimbre = vi.fn();
    const cc74 = vi.fn();
    const synth = {
      makeHex: vi.fn(() => ({
        noteOn,
        noteOff: vi.fn(),
        aftertouch,
        mpeTimbre,
        cc74,
      })),
    };
    const runtime = makeRuntime({ synth });

    playSnapshot(runtime, [
      {
        midicents: 69,
        attackVelocity: 120,
        releaseVelocity: 44,
        pressure: 64,
        pressure14: 8200,
        timbre: 91,
        timbre14: 12000,
      },
    ]);

    expect(noteOn).toHaveBeenCalledTimes(1);
    expect(aftertouch).toHaveBeenCalledWith(64, 8200);
    expect(mpeTimbre).toHaveBeenCalledWith(91, 12000);
    expect(cc74).not.toHaveBeenCalled();
  });
});
