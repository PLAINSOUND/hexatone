import { describe, expect, it } from "vitest";
import {
  addBarsBeforeSnapshots,
  addSequenceBarMarker,
  addSequenceRepeatMarker,
  addSequenceTempoMarker,
  moveSequenceBarMarker,
  shiftStructuralMarkersAfterSnapshotDeletion,
  shiftStructuralMarkersAfterSnapshotInsertion,
  updateSequenceRepeatMarker,
  updateSequenceBarMarker,
  updateSequenceTempoMarker,
} from "./structure-editing.js";

describe("structure editing", () => {
  it("shifts bars and tempi at or after a duplicated snapshot insertion point", () => {
    const result = shiftStructuralMarkersAfterSnapshotInsertion({
      bars: [
        { id: 1, position: 1, numerator: 4, denominator: 4 },
        { id: 2, position: 2, numerator: 3, denominator: 2 },
        { id: 3, position: 4, numerator: 5, denominator: 4 },
      ],
      tempi: [
        { id: 1, position: 1, bpm: 60 },
        { id: 2, position: 2, bpm: 72 },
        { id: 3, position: 3.5, bpm: 80 },
      ],
      repeats: [
        { id: 1, position: 1.5, kind: "start", repeatCount: null },
        { id: 2, position: 2, kind: "end", repeatCount: 2 },
        { id: 3, position: 5, kind: "start", repeatCount: null },
      ],
      insertionPosition: 2,
    });

    expect(result.bars.map((bar) => bar.position)).toEqual([1, 3, 5]);
    expect(result.tempi.map((tempo) => tempo.position)).toEqual([1, 3, 4.5]);
    expect(result.repeats.map((repeat) => repeat.position)).toEqual([1.5, 3, 6]);
  });

  it("leaves earlier structural markers untouched", () => {
    const result = shiftStructuralMarkersAfterSnapshotInsertion({
      bars: [{ id: 1, position: 1 }, { id: 2, position: 3 }],
      tempi: [{ id: 1, position: 1.5 }, { id: 2, position: 3 }],
      repeats: [{ id: 1, position: 2.5, kind: "start", repeatCount: null }, { id: 2, position: 3, kind: "end", repeatCount: 3 }],
      insertionPosition: 3,
    });

    expect(result.bars.map((bar) => bar.position)).toEqual([1, 4]);
    expect(result.tempi.map((tempo) => tempo.position)).toEqual([1.5, 4]);
    expect(result.repeats.map((repeat) => repeat.position)).toEqual([2.5, 4]);
  });

  it("decrements later structural markers after deleting a snapshot and gives later bars/tempi precedence on collisions", () => {
    const result = shiftStructuralMarkersAfterSnapshotDeletion({
      bars: [
        { id: 1, position: 1, numerator: 4, denominator: 4 },
        { id: 2, position: 2, numerator: 3, denominator: 2 },
        { id: 3, position: 3, numerator: 5, denominator: 4 },
      ],
      tempi: [
        { id: 1, position: 1, bpm: 60 },
        { id: 2, position: 2, bpm: 72 },
        { id: 3, position: 3, bpm: 80 },
      ],
      repeats: [
        { id: 1, position: 2.25, kind: "start", repeatCount: null },
        { id: 2, position: 3, kind: "end", repeatCount: 2 },
      ],
      deletionPosition: 2,
    });

    expect(result.bars.map((bar) => ({ id: bar.id, position: bar.position }))).toEqual([
      { id: 1, position: 1 },
      { id: 3, position: 2 },
    ]);
    expect(result.tempi.map((tempo) => ({ id: tempo.id, position: tempo.position }))).toEqual([
      { id: 1, position: 1 },
      { id: 3, position: 2 },
    ]);
    expect(result.repeats.map((repeat) => ({ id: repeat.id, position: repeat.position }))).toEqual([
      { id: 1, position: 2 },
      { id: 2, position: 2 },
    ]);
  });

  it("adds missing bars before snapshots and advances the bar id seed", () => {
    const result = addBarsBeforeSnapshots({
      bars: [{ id: 1, position: 1 }, { id: 3, position: 3 }],
      snapshotCount: 4,
      nextBarId: 3,
    });

    expect(result.bars.map((bar) => ({ id: bar.id, position: bar.position }))).toEqual([
      { id: 1, position: 1 },
      { id: 3, position: 3 },
      { id: 4, position: 2 },
      { id: 5, position: 4 },
    ]);
    expect(result.nextBarId).toBe(5);
  });

  it("adds a normalized tempo marker with the requested mode", () => {
    const result = addSequenceTempoMarker({
      tempi: [{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1, mode: "immediate" }],
      position: 2,
      bpm: 72,
      mode: "transition",
    });

    expect(result.at(-1)).toMatchObject({
      id: 2,
      position: 2,
      bpm: 72,
      beatNumerator: 1,
      beatDenominator: 4,
      mode: "transition",
    });
  });

  it("normalizes tempo marker updates", () => {
    const result = updateSequenceTempoMarker({
      tempi: [{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1, mode: "immediate" }],
      tempoId: 1,
      updates: { position: 1.5, bpm: 80, mode: "transition" },
    });

    expect(result).toEqual([expect.objectContaining({
      id: 1,
      position: 1.5,
      bpm: 80,
      mode: "transition",
    })]);
  });

  it("adds an end repeat with its implicit start marker", () => {
    const result = addSequenceRepeatMarker({
      repeats: [],
      position: 2,
      kind: "end",
    });

    expect(result).toEqual([
      expect.objectContaining({ kind: "start", position: 1 }),
      expect.objectContaining({ kind: "end", position: 2, repeatCount: 2 }),
    ]);
  });

  it("prevents an end repeat from moving to or before the sequence start", () => {
    const marker = { id: 2, position: 2, kind: "end", repeatCount: 3 };
    const result = updateSequenceRepeatMarker({
      repeats: [marker],
      repeatId: 2,
      updates: { position: 1 },
    });

    expect(result).toEqual([marker]);
  });

  it("normalizes repeat-count updates to a minimum of two", () => {
    const result = updateSequenceRepeatMarker({
      repeats: [{ id: 2, position: 2, kind: "end", repeatCount: 3 }],
      repeatId: 2,
      updates: { repeatCount: 1.2 },
    });

    expect(result).toEqual([expect.objectContaining({
      id: 2,
      kind: "end",
      repeatCount: 2,
    })]);
  });

  it("allows moving a bar to the implicit terminal position without treating it as a collision", () => {
    const result = moveSequenceBarMarker({
      bars: [
        { id: 1, position: 1, numerator: 4, denominator: 4 },
        { id: 2, position: 3, numerator: 4, denominator: 4 },
      ],
      snapshots: [
        { id: "s1", length: 1, notes: [] },
        { id: "s2", length: 1, notes: [] },
      ],
      barId: 2,
      position: 4,
      nextBarId: 2,
    });

    expect(result.bars.find((bar) => bar.id === 2)?.position).toBe(4);
    expect(result.nextBarId).toBe(2);
  });

  it("preserves root-bar replacement semantics while ignoring the implicit terminal slot", () => {
    const result = updateSequenceBarMarker({
      bars: [
        { id: 1, position: 1, numerator: 4, denominator: 4 },
        { id: 2, position: 3, numerator: 4, denominator: 4 },
      ],
      snapshots: [
        { id: "s1", length: 1, notes: [] },
        { id: "s2", length: 1, notes: [] },
      ],
      barId: 1,
      updates: { position: 4, numerator: 3, denominator: 2 },
      nextBarId: 2,
    });

    expect(result.bars.find((bar) => bar.id === 3)).toMatchObject({
      position: 4,
      numerator: 3,
      denominator: 2,
    });
    expect(result.nextBarId).toBe(3);
  });

  it("returns the decremented id seed when adding a duplicate bar is cancelled", () => {
    const result = addSequenceBarMarker({
      bars: [{ id: 1, position: 1 }],
      nextBarId: 2,
      position: 1,
      confirmReplace: () => false,
    });

    expect(result.bars).toEqual([{ id: 1, position: 1 }]);
    expect(result.nextBarId).toBe(1);
  });
});
