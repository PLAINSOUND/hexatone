import { describe, expect, it, vi } from "vitest";
import { captureSnapshot, playSnapshot, retuneSnapshotHexes, stopSnapshot } from "./snapshots.js";

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
    _frequencyForHex: overrides._frequencyForHex,
    _allActiveHexes: overrides._allActiveHexes ?? (() => []),
    _snapshotNotes: overrides._snapshotNotes ?? [],
    _snapshotHexes: overrides._snapshotHexes ?? [],
    _snapshotCoordSeed: overrides._snapshotCoordSeed ?? 0,
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
        pressure: 0,
        timbre: 0,
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
      pressure: 0,
      timbre: 0,
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

  it("captures current CC1 controller state as timbre when a non-MPE hex has no local CC74 history", () => {
    const runtime = makeRuntime({
      _allActiveHexes: () => [{
        cents: 0,
        velocity: 113,
      }],
    });
    runtime._controllerCCValues = new Map([[1, 87]]);

    expect(captureSnapshot(runtime)[0]).toMatchObject({
      timbre: 87,
    });
  });

  it("captures exact JI identity for snapshot proportion labels", () => {
    const runtime = makeRuntime({
      _allActiveHexes: () => [{
        cents: 0,
        velocity: 113,
        _noteContext: {
          displayLabel: "A",
          scaleRatioText: "5/4",
          scaleMonzo: [-2, 0, 1],
          ratioText: "3/2",
          monzo: [-1, 1, 0],
        },
      }],
    });

    expect(captureSnapshot(runtime)[0]).toMatchObject({
      displayLabel: "A",
      ratioText: "5/4",
      monzo: [-2, 0, 1],
      modulationRatioText: "3/2",
      modulationMonzo: [-1, 1, 0],
    });
  });

  it("captures sounded pitch from the live hex frequency helper when present", () => {
    const runtime = makeRuntime({
      _frequencyForHex: () => 441,
      _allActiveHexes: () => [{
        cents: 12,
        velocity: 113,
      }],
    });

    expect(captureSnapshot(runtime)[0]).toMatchObject({
      midicents: expect.closeTo(69 + Math.log2(441 / 440) * 12, 8),
      attackVelocity: 113,
      releaseVelocity: 113,
      velocity: 113,
    });
  });

  it("includes currently playing snapshot hexes when capturing a new snapshot", () => {
    const runtime = makeRuntime({
      _allActiveHexes: () => [{ cents: 100, velocity: 101 }],
      _snapshotHexes: [
        {
          cents: 0,
          velocity: 90,
          _snapshotReleaseVelocity: 44,
          _lastAftertouch: 55,
        },
      ],
    });

    const snapshot = captureSnapshot(runtime);

    expect(snapshot).toHaveLength(2);
    expect(snapshot.map((note) => Math.round(note.midicents * 1000) / 1000)).toEqual([70, 69]);
    expect(snapshot[1]).toMatchObject({
      attackVelocity: 90,
      releaseVelocity: 44,
      pressure: 55,
    });
  });

  it("includes currently playing snapshot note data when capturing a new snapshot", () => {
    const runtime = makeRuntime({
      _allActiveHexes: () => [{ cents: 100, velocity: 101 }],
      _snapshotNotes: [
        {
          midicents: 69,
          attackVelocity: 90,
          releaseVelocity: 44,
          pressure: 55,
          timbre: 80,
        },
      ],
    });

    const snapshot = captureSnapshot(runtime);

    expect(snapshot).toHaveLength(2);
    expect(snapshot.map((note) => Math.round(note.midicents * 1000) / 1000)).toEqual([70, 69]);
    expect(snapshot[1]).toMatchObject({
      attackVelocity: 90,
      releaseVelocity: 44,
      pressure: 55,
      timbre: 80,
    });
  });

  it("lets newly played material win when it duplicates a playing snapshot pitch", () => {
    const runtime = makeRuntime({
      _allActiveHexes: () => [{ cents: 0, velocity: 120 }],
      _snapshotNotes: [{ midicents: 69, attackVelocity: 70, releaseVelocity: 33 }],
      _snapshotHexes: [{ cents: 0, velocity: 60, _snapshotReleaseVelocity: 22 }],
    });

    expect(captureSnapshot(runtime)).toEqual([
      {
        midicents: 69,
        attackVelocity: 120,
        releaseVelocity: 120,
        velocity: 120,
        pressure: 0,
        timbre: 0,
      },
    ]);
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

  it("reconstructs snapshot playback cents from the normalized degree-0 reference offset", () => {
    const synth = {
      makeHex: vi.fn(() => ({ noteOn: vi.fn(), noteOff: vi.fn() })),
    };
    const runtime = makeRuntime({
      settings: {
        reference_degree: 2,
        fundamental: 441,
      },
      tuning: {
        scale: [0, 100, 203.91],
        degree0toRef_asArray: [203.91, 2 ** (203.91 / 1200)],
      },
      synth,
    });

    const targetFrequency = 441;
    const targetMidicents = 69 + Math.log2(targetFrequency / 440) * 12;
    playSnapshot(runtime, [
      { midicents: targetMidicents, attackVelocity: 120, releaseVelocity: 44 },
    ]);

    expect(synth.makeHex).toHaveBeenCalledTimes(1);
    expect(synth.makeHex.mock.calls[0][1]).toBeCloseTo(203.91, 6);
  });

  it("replays pressure as aftertouch and timbre through the polyphonic timbre hook", () => {
    const noteOn = vi.fn();
    const aftertouch = vi.fn();
    const polyTimbre = vi.fn();
    const cc74 = vi.fn();
    const synth = {
      makeHex: vi.fn(() => ({
        noteOn,
        noteOff: vi.fn(),
        aftertouch,
        polyTimbre,
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
    expect(polyTimbre).toHaveBeenCalledWith(91, 12000);
    expect(cc74).not.toHaveBeenCalled();
  });

  it("falls back to cc74 when replaying timbre on synths without polyphonic timbre", () => {
    const noteOn = vi.fn();
    const aftertouch = vi.fn();
    const cc74 = vi.fn();
    const setMod = vi.fn();
    const synth = {
      setMod,
      makeHex: vi.fn(() => ({
        noteOn,
        noteOff: vi.fn(),
        aftertouch,
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
    expect(setMod).toHaveBeenCalledWith(1 + (12000 / 16256));
    expect(cc74).toHaveBeenCalledWith(91, 12000);
  });

  it("does not pre-seed onset modulation when no timbre is stored", () => {
    const noteOn = vi.fn();
    const setMod = vi.fn();
    const synth = {
      setMod,
      makeHex: vi.fn(() => ({
        noteOn,
        noteOff: vi.fn(),
        aftertouch: vi.fn(),
        cc74: vi.fn(),
      })),
    };
    const runtime = makeRuntime({ synth });

    playSnapshot(runtime, [
      {
        midicents: 69,
        attackVelocity: 120,
        releaseVelocity: 44,
        pressure: 64,
      },
    ]);

    expect(noteOn).toHaveBeenCalledTimes(1);
    expect(setMod).not.toHaveBeenCalled();
  });

  it("re-triggers a same-pitch legato note when cue playback marks it as a reattack", () => {
    const oldNoteOff = vi.fn();
    const oldHex = {
      _snapshotPitchKey: "69.000",
      _snapshotMidicents: 69,
      _snapshotReleaseVelocity: 33,
      noteOff: oldNoteOff,
      polyTimbre: vi.fn(),
    };
    const newNoteOn = vi.fn();
    const newPolyTimbre = vi.fn();
    const synth = {
      makeHex: vi.fn(() => ({
        noteOn: newNoteOn,
        noteOff: vi.fn(),
        polyTimbre: newPolyTimbre,
      })),
    };
    const runtime = makeRuntime({
      synth,
      _snapshotHexes: [oldHex],
    });

    const nextHexes = playSnapshot(runtime, [
      {
        midicents: 69,
        attackVelocity: 120,
        releaseVelocity: 44,
        timbre: 91,
        reattack: true,
      },
    ], { legato: true });

    expect(oldNoteOff).toHaveBeenCalledWith(33);
    expect(synth.makeHex).toHaveBeenCalledTimes(1);
    expect(newNoteOn).toHaveBeenCalledTimes(1);
    expect(newPolyTimbre).toHaveBeenCalledWith(91);
    expect(nextHexes).toHaveLength(1);
    expect(nextHexes[0]).not.toBe(oldHex);
  });

  it("keeps same-pitch notes sustaining in legato mode and updates expression only", () => {
    const reusedHex = {
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      aftertouch: vi.fn(),
      polyTimbre: vi.fn(),
      _snapshotPitchKey: "69.000",
      _snapshotMidicents: 69,
      _snapshotReleaseVelocity: 30,
    };
    const synth = {
      makeHex: vi.fn(() => ({
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        aftertouch: vi.fn(),
        polyTimbre: vi.fn(),
      })),
    };
    const runtime = makeRuntime({
      synth,
      stopSnapshot: vi.fn(),
      _snapshotHexes: [reusedHex],
    });

    const nextHexes = playSnapshot(runtime, [
      {
        midicents: 69,
        attackVelocity: 120,
        releaseVelocity: 44,
        pressure: 64,
        timbre: 91,
      },
    ], { legato: true });

    expect(runtime.stopSnapshot).not.toHaveBeenCalled();
    expect(synth.makeHex).not.toHaveBeenCalled();
    expect(reusedHex.noteOn).not.toHaveBeenCalled();
    expect(reusedHex.noteOff).not.toHaveBeenCalled();
    expect(reusedHex.aftertouch).toHaveBeenCalledWith(64);
    expect(reusedHex.polyTimbre).toHaveBeenCalledWith(91);
    expect(reusedHex._snapshotReleaseVelocity).toBe(44);
    expect(nextHexes).toEqual([reusedHex]);
  });

  it("retunes a reused legato note when its playback pitch changes", () => {
    const reusedHex = {
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      aftertouch: vi.fn(),
      polyTimbre: vi.fn(),
      retune: vi.fn(),
      _snapshotPitchKey: "69.000",
      _snapshotMidicents: 69,
      _snapshotReleaseVelocity: 30,
      _snapshotInstanceKey: "s:note",
    };
    const runtime = makeRuntime({
      stopSnapshot: vi.fn(),
      _snapshotHexes: [reusedHex],
    });

    const nextHexes = playSnapshot(runtime, [
      {
        noteId: "note",
        snapshotId: "s",
        midicents: 70,
        attackVelocity: 120,
        releaseVelocity: 44,
      },
    ], { legato: true });

    expect(runtime.stopSnapshot).not.toHaveBeenCalled();
    expect(reusedHex.noteOn).not.toHaveBeenCalled();
    expect(reusedHex.noteOff).not.toHaveBeenCalled();
    expect(reusedHex.retune).toHaveBeenCalledTimes(1);
    expect(reusedHex._snapshotMidicents).toBe(70);
    expect(reusedHex._baseCents).toBeCloseTo(100, 6);
    expect(nextHexes).toEqual([reusedHex]);
  });

  it("marks slider-style reused retunes as bend-only", () => {
    const reusedHex = {
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      aftertouch: vi.fn(),
      polyTimbre: vi.fn(),
      retune: vi.fn(),
      _snapshotPitchKey: "69.000",
      _snapshotMidicents: 69,
      _snapshotReleaseVelocity: 30,
      _snapshotInstanceKey: "s:note",
    };
    const runtime = makeRuntime({
      stopSnapshot: vi.fn(),
      _snapshotHexes: [reusedHex],
    });

    playSnapshot(runtime, [
      {
        noteId: "note",
        snapshotId: "s",
        midicents: 70,
        attackVelocity: 120,
        releaseVelocity: 44,
      },
    ], { legato: true, bendOnlyRetune: true });

    expect(reusedHex.retune).toHaveBeenCalledTimes(1);
    expect(reusedHex.retune.mock.calls[0][0]).toBeCloseTo(100, 6);
    expect(reusedHex.retune.mock.calls[0][1]).toBe(true);
  });

  it("prefers standard wheel retune for bend-only snapshot retunes", () => {
    const reusedHex = {
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      aftertouch: vi.fn(),
      polyTimbre: vi.fn(),
      retune: vi.fn(),
      standardWheelRetune: vi.fn(),
      _snapshotPitchKey: "69.000",
      _snapshotMidicents: 69,
      _snapshotReleaseVelocity: 30,
      _snapshotInstanceKey: "s:note",
    };
    const runtime = makeRuntime({
      stopSnapshot: vi.fn(),
      _snapshotHexes: [reusedHex],
    });

    playSnapshot(runtime, [
      {
        noteId: "note",
        snapshotId: "s",
        midicents: 70,
        attackVelocity: 120,
        releaseVelocity: 44,
      },
    ], { legato: true, bendOnlyRetune: true });

    expect(reusedHex.standardWheelRetune).toHaveBeenCalledTimes(1);
    expect(reusedHex.standardWheelRetune.mock.calls[0][0]).toBeCloseTo(100, 6);
    expect(reusedHex.retune).not.toHaveBeenCalled();
  });

  it("retunes currently sounding snapshot hexes in place for pitch modifiers", () => {
    const reusedHex = {
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      aftertouch: vi.fn(),
      polyTimbre: vi.fn(),
      retune: vi.fn(),
      _snapshotPitchKey: "69.000",
      _snapshotMidicents: 69,
      _snapshotReleaseVelocity: 30,
      _snapshotInstanceKey: "s:note",
    };
    const runtime = makeRuntime({
      _snapshotHexes: [reusedHex],
    });

    retuneSnapshotHexes(runtime, [
      {
        noteId: "note",
        snapshotId: "s",
        midicents: 70,
        attackVelocity: 120,
        releaseVelocity: 44,
      },
    ], { bendOnly: true });

    expect(reusedHex.noteOn).not.toHaveBeenCalled();
    expect(reusedHex.noteOff).not.toHaveBeenCalled();
    expect(reusedHex.retune).toHaveBeenCalledTimes(1);
    expect(reusedHex.retune.mock.calls[0][0]).toBeCloseTo(100, 6);
    expect(reusedHex.retune.mock.calls[0][1]).toBe(true);
    expect(reusedHex._snapshotMidicents).toBe(70);
    expect(reusedHex._baseCents).toBeCloseTo(100, 6);
  });

  it("uses standard wheel retune for in-place pitch modifier bends when available", () => {
    const reusedHex = {
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      aftertouch: vi.fn(),
      polyTimbre: vi.fn(),
      retune: vi.fn(),
      standardWheelRetune: vi.fn(),
      _snapshotPitchKey: "69.000",
      _snapshotMidicents: 69,
      _snapshotReleaseVelocity: 30,
      _snapshotInstanceKey: "s:note",
    };
    const runtime = makeRuntime({
      _snapshotHexes: [reusedHex],
    });

    retuneSnapshotHexes(runtime, [
      {
        noteId: "note",
        snapshotId: "s",
        midicents: 70,
        attackVelocity: 120,
        releaseVelocity: 44,
      },
    ], { bendOnly: true });

    expect(reusedHex.standardWheelRetune).toHaveBeenCalledTimes(1);
    expect(reusedHex.standardWheelRetune.mock.calls[0][0]).toBeCloseTo(100, 6);
    expect(reusedHex.retune).not.toHaveBeenCalled();
  });

  it("does not bend an unrelated sounding voice for a newly entering note", () => {
    const soundingHex = {
      retune: vi.fn(),
      standardWheelRetune: vi.fn(),
      _snapshotPitchKey: "69.000",
      _snapshotMidicents: 69,
      _snapshotInstanceKey: "old:note",
    };
    const runtime = makeRuntime({
      _snapshotHexes: [soundingHex],
    });

    retuneSnapshotHexes(runtime, [
      {
        noteId: "note",
        snapshotId: "new",
        midicents: 72,
      },
    ], { bendOnly: true });

    expect(soundingHex.standardWheelRetune).not.toHaveBeenCalled();
    expect(soundingHex.retune).not.toHaveBeenCalled();
    expect(soundingHex._snapshotMidicents).toBe(69);
    expect(soundingHex._snapshotInstanceKey).toBe("old:note");
  });

  it("reuses a legato note by standard sequence id when pitch changes", () => {
    const reusedHex = {
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      aftertouch: vi.fn(),
      polyTimbre: vi.fn(),
      retune: vi.fn(),
      _snapshotPitchKey: "69.000",
      _snapshotMidicents: 69,
      _snapshotReleaseVelocity: 30,
      _snapshotInstanceKey: ":note-a",
    };
    const runtime = makeRuntime({
      stopSnapshot: vi.fn(),
      _snapshotHexes: [reusedHex],
    });

    const nextHexes = playSnapshot(runtime, [
      {
        id: "note-a",
        midicents: 70,
        attackVelocity: 120,
        releaseVelocity: 44,
      },
    ], { legato: true });

    expect(reusedHex.noteOn).not.toHaveBeenCalled();
    expect(reusedHex.noteOff).not.toHaveBeenCalled();
    expect(reusedHex.retune).toHaveBeenCalledTimes(1);
    expect(nextHexes).toEqual([reusedHex]);
  });

  it("releases removed notes and creates only genuinely new notes in legato mode", () => {
    const heldA = {
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      aftertouch: vi.fn(),
      polyTimbre: vi.fn(),
      _snapshotPitchKey: "69.000",
      _snapshotMidicents: 69,
      _snapshotReleaseVelocity: 31,
    };
    const heldB = {
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      aftertouch: vi.fn(),
      polyTimbre: vi.fn(),
      _snapshotPitchKey: "71.000",
      _snapshotMidicents: 71,
      _snapshotReleaseVelocity: 55,
    };
    const newHex = {
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      aftertouch: vi.fn(),
      polyTimbre: vi.fn(),
    };
    const synth = {
      makeHex: vi.fn(() => newHex),
    };
    const runtime = makeRuntime({
      synth,
      stopSnapshot: vi.fn(),
      _snapshotHexes: [heldA, heldB],
    });

    const nextHexes = playSnapshot(runtime, [
      {
        midicents: 69,
        attackVelocity: 100,
        releaseVelocity: 40,
      },
      {
        midicents: 72,
        attackVelocity: 88,
        releaseVelocity: 33,
      },
    ], { legato: true });

    expect(heldA.noteOff).not.toHaveBeenCalled();
    expect(heldB.noteOff).toHaveBeenCalledWith(55);
    expect(synth.makeHex).toHaveBeenCalledTimes(1);
    expect(newHex.noteOn).toHaveBeenCalledTimes(1);
    expect(nextHexes).toEqual([heldA, newHex]);
  });

  it("prefers stable note identity over pitch when legato voices overlap", () => {
    const heldA = {
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      aftertouch: vi.fn(),
      polyTimbre: vi.fn(),
      _snapshotPitchKey: "69.000",
      _snapshotMidicents: 69,
      _snapshotInstanceKey: "s1:a",
      _snapshotReleaseVelocity: 31,
    };
    const heldB = {
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      aftertouch: vi.fn(),
      polyTimbre: vi.fn(),
      _snapshotPitchKey: "69.000",
      _snapshotMidicents: 69,
      _snapshotInstanceKey: "s2:b",
      _snapshotReleaseVelocity: 47,
    };
    const runtime = makeRuntime({
      stopSnapshot: vi.fn(),
      _snapshotHexes: [heldA, heldB],
      synth: {
        makeHex: vi.fn(() => ({
          noteOn: vi.fn(),
          noteOff: vi.fn(),
          aftertouch: vi.fn(),
          polyTimbre: vi.fn(),
        })),
      },
    });

    const nextHexes = playSnapshot(runtime, [
      {
        midicents: 69,
        attackVelocity: 100,
        releaseVelocity: 40,
        snapshotId: "s2",
        noteId: "b",
        pressure: 55,
      },
    ], { legato: true });

    expect(heldA.noteOff).toHaveBeenCalledWith(31);
    expect(heldB.noteOff).not.toHaveBeenCalled();
    expect(heldB.aftertouch).toHaveBeenCalledWith(55);
    expect(nextHexes).toEqual([heldB]);
  });

  it("transitions deterministically across successive legato cue steps", () => {
    const makeRuntimeHex = (name) => ({
      name,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      aftertouch: vi.fn(),
      polyTimbre: vi.fn(),
    });

    const hex60 = makeRuntimeHex("60");
    const hex64 = makeRuntimeHex("64");
    const hex67 = makeRuntimeHex("67");
    const synth = {
      makeHex: vi.fn()
        .mockReturnValueOnce(hex60)
        .mockReturnValueOnce(hex64)
        .mockReturnValueOnce(hex67),
    };
    const runtime = makeRuntime({
      synth,
      stopSnapshot: vi.fn(),
      _snapshotHexes: [],
    });

    runtime._snapshotHexes = playSnapshot(runtime, [
      { midicents: 60, attackVelocity: 100, releaseVelocity: 40, pressure: 10 },
    ], { legato: true });
    expect(runtime._snapshotHexes).toEqual([hex60]);

    runtime._snapshotHexes = playSnapshot(runtime, [
      { midicents: 64, attackVelocity: 90, releaseVelocity: 30, pressure: 20 },
      { midicents: 60, attackVelocity: 100, releaseVelocity: 40, pressure: 11 },
    ], { legato: true });
    expect(hex60.noteOff).not.toHaveBeenCalled();
    expect(hex60.noteOn).toHaveBeenCalledTimes(1);
    expect(hex60.aftertouch).toHaveBeenLastCalledWith(11);
    expect(hex64.noteOn).toHaveBeenCalledTimes(1);
    expect(runtime._snapshotHexes).toEqual([hex64, hex60]);

    runtime._snapshotHexes = playSnapshot(runtime, [
      { midicents: 67, attackVelocity: 80, releaseVelocity: 20, pressure: 30 },
      { midicents: 64, attackVelocity: 90, releaseVelocity: 30, pressure: 21 },
      { midicents: 60, attackVelocity: 100, releaseVelocity: 40, pressure: 12 },
    ], { legato: true });
    expect(hex60.noteOff).not.toHaveBeenCalled();
    expect(hex64.noteOff).not.toHaveBeenCalled();
    expect(hex67.noteOn).toHaveBeenCalledTimes(1);
    expect(runtime._snapshotHexes).toEqual([hex67, hex64, hex60]);

    runtime._snapshotHexes = playSnapshot(runtime, [
      { midicents: 64, attackVelocity: 90, releaseVelocity: 30, pressure: 22 },
      { midicents: 60, attackVelocity: 100, releaseVelocity: 40, pressure: 13 },
    ], { legato: true });
    expect(hex67.noteOff).toHaveBeenCalledWith(20);
    expect(hex64.noteOff).not.toHaveBeenCalled();
    expect(hex60.noteOff).not.toHaveBeenCalled();
    expect(runtime._snapshotHexes).toEqual([hex64, hex60]);
  });

  it("allocates unique snapshot coords for new legato notes across cue steps", () => {
    const coordsSeen = [];
    const synth = {
      makeHex: vi.fn((coords) => {
        coordsSeen.push(`${coords.x},${coords.y}`);
        return {
          coords,
          noteOn: vi.fn(),
          noteOff: vi.fn(),
          aftertouch: vi.fn(),
          polyTimbre: vi.fn(),
        };
      }),
    };
    const runtime = makeRuntime({
      synth,
      stopSnapshot: vi.fn(),
      _snapshotHexes: [],
    });

    runtime._snapshotHexes = playSnapshot(runtime, [
      { midicents: 60, attackVelocity: 100, releaseVelocity: 40 },
    ], { legato: true });
    runtime._snapshotHexes = playSnapshot(runtime, [
      { midicents: 64, attackVelocity: 90, releaseVelocity: 30 },
      { midicents: 60, attackVelocity: 100, releaseVelocity: 40 },
    ], { legato: true });
    runtime._snapshotHexes = playSnapshot(runtime, [
      { midicents: 67, attackVelocity: 80, releaseVelocity: 20 },
      { midicents: 64, attackVelocity: 90, releaseVelocity: 30 },
      { midicents: 60, attackVelocity: 100, releaseVelocity: 40 },
    ], { legato: true });

    expect(coordsSeen).toEqual(["9000,9000", "9001,9001", "9002,9002"]);
  });
});
