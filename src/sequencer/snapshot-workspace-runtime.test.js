import { describe, expect, it } from "vitest";

import {
  appendSnapshotToWorkspace,
  buildSnapshotCopyBlock,
  buildClearedSequenceWorkspaceState,
  deleteSnapshotRangeFromWorkspace,
  deleteSnapshotFromWorkspace,
  duplicateSnapshotInWorkspace,
  insertSnapshotCopyBlock,
  moveSnapshotInWorkspace,
  resetSnapshotRangeNoteOffsetsInWorkspace,
  resolveSnapshotCopyRange,
  resetSnapshotDescriptionInWorkspace,
  restoreSnapshotsInWorkspace,
  setSnapshotRangeArticulationInWorkspace,
  updateSnapshotInWorkspace,
} from "./snapshot-workspace-runtime.js";

describe("snapshot workspace runtime", () => {
  it("appends a snapshot and auto-creates a matching bar when needed", () => {
    const result = appendSnapshotToWorkspace({
      snapshots: [{ id: 1, length: 1, description: "a", descriptionManual: false, notes: [] }],
      notes: [{ midicents: 6900 }],
      snapshotLabelMode: "proportion",
      sequenceAutoCreateBars: true,
      sequenceBars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
      nextSnapshotId: 2,
      nextBarId: 1,
    });

    expect(result.snapshots.at(-1)).toMatchObject({
      id: 2,
      descriptionManual: false,
    });
    expect(result.bars.at(-1)).toEqual({
      id: 2,
      position: 2,
      numerator: 4,
      denominator: 4,
    });
    expect(result.ids).toEqual({ snapshotId: 2, barId: 2 });
  });

  it("deletes a snapshot and shifts structural markers", () => {
    const result = deleteSnapshotFromWorkspace({
      snapshots: [{ id: 1 }, { id: 2 }, { id: 3 }],
      bars: [
        { id: 1, position: 1, numerator: 4, denominator: 4 },
        { id: 2, position: 3, numerator: 4, denominator: 4 },
      ],
      tempi: [{ id: 1, position: 3, bpm: 72 }],
      repeats: [{ id: 1, position: 2.5, kind: "end", repeatCount: 2 }],
      snapshotId: 2,
      selectedSnapshotId: 2,
      selectedSnapshotMarker: { snapshotId: 2, time: 0 },
    });

    expect(result.snapshots.map((snapshot) => snapshot.id)).toEqual([1, 3]);
    expect(result.bars.map((bar) => bar.position)).toEqual([1, 2]);
    expect(result.tempi.map((tempo) => tempo.position)).toEqual([2]);
    expect(result.repeats.map((repeat) => repeat.position)).toEqual([2]);
    expect(result.selectedSnapshotId).toBe(1);
    expect(result.selectedSnapshotMarker).toBeNull();
  });

  it("builds the cleared workspace state", () => {
    expect(buildClearedSequenceWorkspaceState()).toEqual({
      snapshots: [],
      selectedSnapshotId: null,
      selectedSnapshotMarker: null,
      bars: [],
      tempi: [],
      repeats: [],
      ids: {
        snapshotId: 0,
        barId: 0,
      },
      activeSequenceSource: "",
      activeSequenceBuiltInName: "",
      activeSequenceName: "",
      activeSequenceSavedName: "",
      activeSequenceDescription: "",
      manualArpeggiation: {
        mode: "off",
        styleId: "positional",
        initialSpreadMs: 2000,
        spreadVariation: 0.3,
        timingVariation: 0.5,
        decayMs: 5000,
        decayVariation: 0.75,
        styleParameters: {},
      },
    });
  });

  it("moves and duplicates snapshots while keeping ids stable", () => {
    const moved = moveSnapshotInWorkspace({
      snapshots: [{ id: 1 }, { id: 2 }, { id: 3 }],
      fromId: 1,
      toId: 3,
      side: "after",
    });
    expect(moved.map((snapshot) => snapshot.id)).toEqual([2, 3, 1]);

    const duplicated = duplicateSnapshotInWorkspace({
      snapshots: [{ id: 1, length: 1, notes: [] }, { id: 2, length: 1, notes: [] }],
      bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
      tempi: [{ id: 1, position: 2, bpm: 60 }],
      repeats: [{ id: 1, position: 2, kind: "end", repeatCount: 2 }],
      fromId: 1,
      toId: 2,
      side: "before",
      nextSnapshotId: 3,
    });
    expect(duplicated.snapshots.map((snapshot) => snapshot.id)).toEqual([1, 3, 2]);
    expect(duplicated.bars.map((bar) => bar.position)).toEqual([1]);
    expect(duplicated.tempi.map((tempo) => tempo.position)).toEqual([3]);
    expect(duplicated.repeats.map((repeat) => repeat.position)).toEqual([3]);
    expect(duplicated.ids.snapshotId).toBe(3);
  });

  it("updates and resets derived descriptions", () => {
    const snapshots = [{
      id: 1,
      length: 1,
      description: "old",
      descriptionManual: false,
      notes: [{ midicents: 6900 }],
    }];
    const updated = updateSnapshotInWorkspace({
      snapshots,
      snapshotId: 1,
      updates: { description: "manual" },
      snapshotLabelMode: "proportion",
    });
    expect(updated[0]).toMatchObject({
      description: "manual",
      descriptionManual: true,
    });

    const reset = resetSnapshotDescriptionInWorkspace({
      snapshots: updated,
      snapshotId: 1,
      snapshotLabelMode: "proportion",
    });
    expect(reset[0].descriptionManual).toBe(false);
  });

  it("expands a copied snapshot range to full bar boundaries when requested", () => {
    const range = resolveSnapshotCopyRange({
      snapshots: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
      bars: [
        { id: 1, position: 1, numerator: 4, denominator: 4 },
        { id: 2, position: 3, numerator: 3, denominator: 2 },
        { id: 3, position: 5, numerator: 5, denominator: 4 },
      ],
      startPosition: 2,
      endPosition: 4,
      includeBars: true,
    });

    expect(range).toMatchObject({
      startPosition: 1,
      endPosition: 4,
      length: 4,
      includeBars: true,
    });
  });

  it("builds a copied block with expanded bars, optional markers, and reset note offsets", () => {
    const block = buildSnapshotCopyBlock({
      snapshots: [
        { id: 1, length: 1, description: "a", notes: [{ id: "n1", start: 0.25, end: 0.75, startFractionDenominator: 4, endFractionDenominator: 4 }] },
        { id: 2, length: 1, description: "b", notes: [{ id: "n2", start: 0.5, end: 0.9, startFractionDenominator: 6, endFractionDenominator: 6 }] },
        { id: 3, length: 1, description: "c", notes: [] },
        { id: 4, length: 1, description: "d", notes: [] },
      ],
      bars: [
        { id: 1, position: 1, numerator: 4, denominator: 4 },
        { id: 2, position: 3, numerator: 3, denominator: 2 },
      ],
      tempi: [{ id: 1, position: 2.5, bpm: 72 }],
      repeats: [{ id: 1, position: 3, kind: "end", repeatCount: 2 }],
      startPosition: 2,
      endPosition: 3,
      includeBars: true,
      includeTempi: true,
      includeRepeats: true,
      resetNoteOffsets: true,
    });

    expect(block?.range).toMatchObject({ startPosition: 1, endPosition: 4 });
    expect(block?.snapshots).toHaveLength(4);
    expect(block?.snapshots[0].notes[0]).toMatchObject({
      start: 0,
      end: 1,
      startFractionDenominator: 1,
      endFractionDenominator: 1,
    });
    expect(block?.bars.map((bar) => bar.position)).toEqual([1, 3]);
    expect(block?.tempi.map((tempo) => tempo.position)).toEqual([2.5]);
    expect(block?.repeats.map((repeat) => repeat.position)).toEqual([3]);
  });

  it("sets articulation across a selected snapshot range while preserving trigger styles", () => {
    const snapshots = [
      { id: 1, manualTrigger: { articulation: "chord", styleId: "one", styleParameters: { a: 1 } } },
      { id: 2, manualTrigger: { articulation: "chord", styleId: "two", styleParameters: { b: 2 } } },
      { id: 3, manualTrigger: { articulation: "chord", styleId: "three", styleParameters: null } },
    ];

    const result = setSnapshotRangeArticulationInWorkspace({
      snapshots,
      startPosition: 1,
      endPosition: 2,
      articulation: "arpeggiate",
    });

    expect(result.error).toBeNull();
    expect(result.snapshots[0].manualTrigger).toEqual({
      articulation: "arpeggiate",
      styleId: "one",
      styleParameters: { a: 1 },
    });
    expect(result.snapshots[1].manualTrigger).toEqual({
      articulation: "arpeggiate",
      styleId: "two",
      styleParameters: { b: 2 },
    });
    expect(result.snapshots[2]).toBe(snapshots[2]);
  });

  it("restores snapshots by identity without disturbing the rest of the workspace", () => {
    const original = {
      id: 2,
      notes: [{ id: "n2", start: 0.25, end: 0.75 }],
      manualTrigger: { articulation: "chord", styleId: "positional" },
    };
    const result = restoreSnapshotsInWorkspace({
      snapshots: [
        { id: 1, notes: [] },
        {
          id: 2,
          notes: [{ id: "n2", start: 0, end: 1 }],
          manualTrigger: { articulation: "arpeggiate", styleId: "positional" },
        },
        { id: 3, notes: [] },
      ],
      replacements: [original],
    });

    expect(result.error).toBeNull();
    expect(result.snapshots[1]).toEqual(original);
    expect(result.snapshots[1]).not.toBe(original);
    expect(result.snapshots.map(({ id }) => id)).toEqual([1, 2, 3]);
  });

  it("inserts a snapshot-only copied block and shifts later markers by its length", () => {
    const block = buildSnapshotCopyBlock({
      snapshots: [
        { id: 1, length: 1, description: "a", notes: [] },
        { id: 2, length: 1, description: "b", notes: [] },
        { id: 3, length: 1, description: "c", notes: [] },
      ],
      startPosition: 1,
      endPosition: 2,
    });

    const result = insertSnapshotCopyBlock({
      snapshots: [{ id: 10 }, { id: 11 }, { id: 12 }],
      bars: [{ id: 1, position: 2, numerator: 4, denominator: 4 }],
      tempi: [{ id: 1, position: 3, bpm: 60 }],
      repeats: [{ id: 1, position: 2.5, kind: "start", repeatCount: null }],
      block,
      insertionPosition: 2,
      nextSnapshotId: 20,
      nextBarId: 1,
    });

    expect(result.error).toBeNull();
    expect(result.snapshots.map((snapshot) => snapshot.id)).toEqual([10, 20, 21, 11, 12]);
    expect(result.bars.map((bar) => bar.position)).toEqual([4]);
    expect(result.tempi.map((tempo) => tempo.position)).toEqual([5]);
    expect(result.repeats.map((repeat) => repeat.position)).toEqual([4.5]);
    expect(result.selectedSnapshotId).toBe(20);
  });

  it("inserts a bar-bounded copied block with copied bars, tempi, and repeats", () => {
    const block = buildSnapshotCopyBlock({
      snapshots: [
        { id: 1, length: 1, description: "a", notes: [] },
        { id: 2, length: 1, description: "b", notes: [] },
        { id: 3, length: 1, description: "c", notes: [] },
        { id: 4, length: 1, description: "d", notes: [] },
      ],
      bars: [
        { id: 1, position: 1, numerator: 4, denominator: 4 },
        { id: 2, position: 3, numerator: 3, denominator: 2 },
      ],
      tempi: [{ id: 5, position: 2, bpm: 90 }],
      repeats: [{ id: 6, position: 3, kind: "end", repeatCount: 2 }],
      startPosition: 1,
      endPosition: 4,
      includeBars: true,
      includeTempi: true,
      includeRepeats: true,
    });

    const result = insertSnapshotCopyBlock({
      snapshots: [{ id: 10 }, { id: 11 }, { id: 12 }, { id: 13 }],
      bars: [
        { id: 1, position: 1, numerator: 4, denominator: 4 },
        { id: 2, position: 3, numerator: 3, denominator: 2 },
      ],
      tempi: [{ id: 1, position: 3.5, bpm: 60 }],
      repeats: [{ id: 1, position: 3, kind: "start", repeatCount: null }],
      block,
      insertionPosition: 3,
      nextSnapshotId: 20,
      nextBarId: 2,
    });

    expect(result.error).toBeNull();
    expect(result.snapshots.map((snapshot) => snapshot.id)).toEqual([10, 11, 20, 21, 22, 23, 12, 13]);
    expect(result.bars.map((bar) => ({ id: bar.id, position: bar.position }))).toEqual([
      { id: 1, position: 1 },
      { id: 3, position: 3 },
      { id: 4, position: 5 },
      { id: 2, position: 7 },
    ]);
    expect(result.tempi.map((tempo) => tempo.position)).toEqual([4, 7.5]);
    expect(result.repeats.map((repeat) => repeat.position)).toEqual([5, 7]);
    expect(result.ids).toEqual({ snapshotId: 23, barId: 4 });
  });

  it("keeps end repeats and gradual tempi at the insertion point before the inserted block", () => {
    const block = buildSnapshotCopyBlock({
      snapshots: [
        { id: 1, length: 1, description: "a", notes: [] },
        { id: 2, length: 1, description: "b", notes: [] },
      ],
      startPosition: 1,
      endPosition: 2,
    });

    const result = insertSnapshotCopyBlock({
      snapshots: [{ id: 10 }, { id: 11 }, { id: 12 }],
      bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
      tempi: [{ id: 1, position: 2, bpm: 72, beatLength: 1, mode: "gradual" }],
      repeats: [{ id: 1, position: 2, kind: "end", repeatCount: 2 }],
      block,
      insertionPosition: 2,
      nextSnapshotId: 20,
      nextBarId: 1,
    });

    expect(result.tempi.map((tempo) => tempo.position)).toEqual([2]);
    expect(result.repeats.map((repeat) => repeat.position)).toEqual([2]);
  });

  it("bumps bars and immediate tempi at the insertion point to the end of the inserted block", () => {
    const block = buildSnapshotCopyBlock({
      snapshots: [
        { id: 1, length: 1, description: "a", notes: [] },
        { id: 2, length: 1, description: "b", notes: [] },
      ],
      startPosition: 1,
      endPosition: 2,
    });

    const result = insertSnapshotCopyBlock({
      snapshots: [{ id: 10 }, { id: 11 }, { id: 12 }],
      bars: [
        { id: 1, position: 1, numerator: 4, denominator: 4 },
        { id: 2, position: 2, numerator: 3, denominator: 4 },
      ],
      tempi: [{ id: 1, position: 2, bpm: 60, beatLength: 1, mode: "immediate" }],
      repeats: [],
      block,
      insertionPosition: 2,
      nextSnapshotId: 20,
      nextBarId: 2,
    });

    expect(result.bars.map((bar) => bar.position)).toEqual([1, 4]);
    expect(result.tempi.map((tempo) => tempo.position)).toEqual([4]);
  });

  it("rejects inserting a bar-bounded block away from a bar boundary", () => {
    const block = buildSnapshotCopyBlock({
      snapshots: [{ id: 1, length: 1, description: "a", notes: [] }],
      bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
      startPosition: 1,
      endPosition: 1,
      includeBars: true,
    });

    const result = insertSnapshotCopyBlock({
      snapshots: [{ id: 10 }, { id: 11 }, { id: 12 }],
      bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }, { id: 2, position: 3, numerator: 3, denominator: 2 }],
      block,
      insertionPosition: 2,
      nextSnapshotId: 20,
      nextBarId: 2,
    });

    expect(result.error).toBe("bar-boundary-required");
    expect(result.snapshots.map((snapshot) => snapshot.id)).toEqual([10, 11, 12]);
  });

  it("resets note offsets in place across the resolved selection range", () => {
    const result = resetSnapshotRangeNoteOffsetsInWorkspace({
      snapshots: [
        { id: 1, notes: [{ id: "a", start: 0.25, end: 0.75, startFractionDenominator: 4, endFractionDenominator: 4 }] },
        { id: 2, notes: [{ id: "b", start: 0.5, end: 0.9, startFractionDenominator: 6, endFractionDenominator: 6 }] },
        { id: 3, notes: [{ id: "c", start: 0.1, end: 1, startFractionDenominator: 8, endFractionDenominator: 1 }] },
      ],
      bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
      startPosition: 2,
      endPosition: 3,
    });

    expect(result.error).toBeNull();
    expect(result.snapshots[0].notes[0]).toMatchObject({ start: 0.25, end: 0.75 });
    expect(result.snapshots[1].notes[0]).toMatchObject({ start: 0, end: 1, startFractionDenominator: 1, endFractionDenominator: 1 });
    expect(result.snapshots[2].notes[0]).toMatchObject({ start: 0, end: 1, startFractionDenominator: 1, endFractionDenominator: 1 });
  });

  it("deletes a selected snapshot range and optionally removes structural markers in that range", () => {
    const result = deleteSnapshotRangeFromWorkspace({
      snapshots: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
      bars: [
        { id: 1, position: 1, numerator: 4, denominator: 4 },
        { id: 2, position: 3, numerator: 3, denominator: 4 },
        { id: 3, position: 5, numerator: 5, denominator: 4 },
      ],
      tempi: [
        { id: 1, position: 2.5, bpm: 72 },
        { id: 2, position: 5, bpm: 84 },
      ],
      repeats: [
        { id: 1, position: 3, kind: "start", repeatCount: null },
        { id: 2, position: 4.5, kind: "end", repeatCount: 2 },
      ],
      startPosition: 2,
      endPosition: 4,
      includeBars: true,
      includeTempi: true,
      includeRepeats: false,
      selectedSnapshotId: 3,
      selectedSnapshotMarker: { snapshotId: 4, time: 0 },
    });

    expect(result.error).toBeNull();
    expect(result.snapshots.map((snapshot) => snapshot.id)).toEqual([5]);
    expect(result.bars.map((bar) => bar.position)).toEqual([1]);
    expect(result.tempi.map((tempo) => tempo.position)).toEqual([1]);
    expect(result.repeats.map((repeat) => repeat.position)).toEqual([1, 1]);
    expect(result.selectedSnapshotId).toBe(5);
    expect(result.selectedSnapshotMarker).toBeNull();
  });
});
