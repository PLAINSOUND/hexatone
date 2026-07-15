import { describe, expect, it } from "vitest";

import {
  appendSnapshotToWorkspace,
  buildClearedSequenceWorkspaceState,
  deleteSnapshotFromWorkspace,
  duplicateSnapshotInWorkspace,
  moveSnapshotInWorkspace,
  resetSnapshotDescriptionInWorkspace,
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
});
