import { describe, expect, it, vi } from "vitest";
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

  it("shifts structural markers by the full inserted block length", () => {
    const result = shiftStructuralMarkersAfterSnapshotInsertion({
      bars: [{ id: 1, position: 1 }, { id: 2, position: 3 }],
      tempi: [{ id: 1, position: 2.5 }, { id: 2, position: 3 }],
      repeats: [{ id: 1, position: 3, kind: "start", repeatCount: null }],
      insertionPosition: 2,
      snapshotCount: 3,
    });

    expect(result.bars.map((bar) => bar.position)).toEqual([1, 6]);
    expect(result.tempi.map((tempo) => tempo.position)).toEqual([5.5, 6]);
    expect(result.repeats.map((repeat) => repeat.position)).toEqual([6]);
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
      mode: "gradual",
    });

    expect(result.at(-1)).toMatchObject({
      id: 2,
      position: 2,
      bpm: 72,
      beatNumerator: 1,
      beatDenominator: 4,
      mode: "gradual",
    });
  });

  it("normalizes tempo marker updates", () => {
    const result = updateSequenceTempoMarker({
      tempi: [{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1, mode: "immediate" }],
      tempoId: 1,
      updates: { position: 1.5, bpm: 80, mode: "gradual" },
    });

    expect(result).toEqual([expect.objectContaining({
      id: 1,
      position: 1.5,
      bpm: 80,
      mode: "gradual",
    })]);
  });

  it("materializes the implicit opening tempo when it is edited", () => {
    const result = updateSequenceTempoMarker({
      tempi: [{ id: 4, position: 3, bpm: 72, beatNumerator: 1, beatDenominator: 8 }],
      tempoId: "tempo:default",
      updates: { bpm: 90, beatNumerator: 3, beatDenominator: 8 },
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: 5,
        position: 1,
        bpm: 90,
        beatNumerator: 3,
        beatDenominator: 8,
        beatLength: 1.5,
        mode: "immediate",
      }),
      expect.objectContaining({ id: 4, position: 3, bpm: 72 }),
    ]);
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
    const confirmReplace = vi.fn(() => true);
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
      confirmReplace,
    });

    expect(result.bars.find((bar) => bar.id === 2)?.position).toBe(4);
    expect(result.nextBarId).toBe(2);
    expect(confirmReplace).not.toHaveBeenCalled();
  });

  it("preserves root-bar replacement semantics while ignoring the implicit terminal slot", () => {
    const confirmReplace = vi.fn(() => true);
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
      confirmReplace,
    });

    expect(result.bars.find((bar) => bar.id === 3)).toMatchObject({
      position: 4,
      numerator: 3,
      denominator: 2,
    });
    expect(result.nextBarId).toBe(3);
    expect(confirmReplace).not.toHaveBeenCalled();
  });

  it("does not prompt when moving a bar anywhere in the implicit tail beyond the terminal slot", () => {
    const confirmReplace = vi.fn(() => true);
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
      position: 5,
      nextBarId: 2,
      confirmReplace,
    });

    expect(result.bars.find((bar) => bar.id === 2)?.position).toBe(5);
    expect(confirmReplace).not.toHaveBeenCalled();
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
