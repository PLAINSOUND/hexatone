import { describe, expect, it } from "vitest";
import {
  shiftStructuralMarkersAfterSnapshotDeletion,
  shiftStructuralMarkersAfterSnapshotInsertion,
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
});
