import { describe, expect, it } from "vitest";
import { chooseChordSteps, clampChordDrift } from "./chord-snap.js";
import { findNearestDegree } from "../input/scale-mapper.js";
import { remapSequenceSnapshotsToRuntime, resolveLiveSequencePitch, withSequenceSnapGroup } from "./runtime-pitch-map.js";

const runtime = { scale: [0, 10, 696, 710], equivInterval: 1200, fundamental: 440, referenceDegree: 0 };
const options = { chordAware: true, chordDrift: 20 };
const note = cents => ({ midicents: 69 + cents / 100 });

describe("chord drift prototype", () => {
  it("defaults to 33 cents and clamps the fader to 0–66", () => {
    expect(clampChordDrift(undefined)).toBe(33);
    expect(clampChordDrift(-1)).toBe(0);
    expect(clampChordDrift(66)).toBe(66);
    expect(clampChordDrift(100)).toBe(66);
  });

  it("keeps ordinary Snap at zero, including ties and equave wrapping", () => {
    const pitches = [-5, 0, 5, 700, 1199, 1205];
    expect(chooseChordSteps(pitches, runtime, 0)).toEqual(pitches.map(pitch =>
      findNearestDegree(pitch, runtime.scale, 1200, Infinity, "accept").steps));
  });

  it("finds a better interval pattern through a shared upward or downward search", () => {
    expect(chooseChordSteps([0, 700], runtime, 0)).toEqual([0, 2]);
    expect(chooseChordSteps([0, 700], runtime, 20)).toEqual([1, 3]);
    expect(chooseChordSteps([10, 706], runtime, 20)).toEqual([0, 2]);
    expect(chooseChordSteps([0, 700], runtime, 5)).toEqual([0, 2]);
  });

  it("leaves single notes and already matching chords alone", () => {
    expect(chooseChordSteps([700], runtime, 50)).toEqual([2]);
    expect(chooseChordSteps([10, 710], runtime, 50)).toEqual([1, 3]);
  });

  it("favours interval stability between two held continuations", () => {
    const tuning = { ...runtime, scale: [0, 10, 386, 400, 696, 710] };
    const pitches = [0, 384, 702];
    expect(chooseChordSteps(pitches, tuning, 20)).toEqual([1, 2, 5]);
    expect(chooseChordSteps(pitches, tuning, 20, [true, true, false])).toEqual([1, 3, 5]);
  });

  it("bounds cold work for large formations", () => {
    const pitches = Array.from({ length: 33 }, (_, index) => index * 100);
    expect(chooseChordSteps(pitches, runtime, 50)).toEqual(chooseChordSteps(pitches, runtime, 0));
  });

  it("resolves partial arpeggios with the complete source chord and restores raw pitches", () => {
    const source = [note(0), note(700)];
    const grouped = withSequenceSnapGroup(source);
    const first = resolveLiveSequencePitch(grouped[0], runtime, 0, options);
    const second = resolveLiveSequencePitch(grouped[1], runtime, 0, options);
    expect(first.midicents).toBeCloseTo(69.1);
    expect(second.midicents).toBeCloseTo(76.1);
    expect(resolveLiveSequencePitch(second, runtime, 0, options).midicents).toBeCloseTo(76.1);
    expect(resolveLiveSequencePitch(second, runtime, 0, { ...options, chordDrift: 0 }).midicents).toBeCloseTo(75.96);
    expect(resolveLiveSequencePitch(second, null).midicents).toBe(76);
    expect(resolveLiveSequencePitch(second, runtime, 100, options).midicents).toBeCloseTo(77.1);
    expect(source).toEqual([note(0), note(700)]);
  });

  it("keeps saved data intact and recomputes when tuning or drift changes", () => {
    const snapshots = [{ id: "chord", notes: [note(0), note(700)] }];
    const mapped = remapSequenceSnapshotsToRuntime(snapshots, runtime, options);
    expect(mapped[0].notes.map(n => n.midicents)).toEqual([69.1, 76.1]);
    expect(remapSequenceSnapshotsToRuntime(snapshots, runtime, { ...options, chordDrift: 0 })[0].notes[1].midicents).toBeCloseTo(75.96);
    expect(remapSequenceSnapshotsToRuntime(snapshots, { ...runtime, scale: [0, 700] }, options)[0].notes[1].midicents).toBeCloseTo(76);
    expect(snapshots[0].notes).toEqual([note(0), note(700)]);
  });
});
