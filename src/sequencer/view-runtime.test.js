import { describe, expect, it } from "vitest";
import {
  buildCueExpandedSnapshotIdsAt,
  deriveCueScrollAnchorSnapshotId,
  deriveExpandedSnapshotIds,
  deriveSoundingAttackEventIds,
  firstSnapshotIdInSet,
  sameSnapshotSet,
} from "./view-runtime.js";

describe("sequencer view runtime", () => {
  it("finds the first snapshot id present in a set", () => {
    expect(firstSnapshotIdInSet(new Set(["s2", "s3"]), [{ id: "s1" }, { id: "s2" }, { id: "s3" }])).toBe("s2");
  });

  it("derives sounding attack ids for active cue and active snapshot playback", () => {
    const snapshots = [
      { id: "s1", notes: [{ id: "n1", midicents: 69, start: 0, end: 1 }] },
      { id: "s2", notes: [{ id: "n2", midicents: 72, start: 0.25, end: 1 }] },
    ];
    expect(deriveSoundingAttackEventIds({
      sequencePlaybackActive: true,
      playheadMarkerIndex: null,
      renderedSnapshots: snapshots,
      sortedBars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
      sortedTempi: [],
      activeSnapshotId: "s2",
      playingSnapshotId: null,
    })).toEqual(new Set(["s2:n2:attack:0.25"]));
  });

  it("builds cue-expanded snapshot ids at a cue index", () => {
    const snapshots = [
      { id: "s1", length: 2, notes: [{ id: "a", midicents: 69, start: 0, end: 1.25 }] },
      { id: "s2", length: 1, notes: [{ id: "b", midicents: 72, start: 0.25, end: 1 }] },
    ];
    const bars = [{ id: 1, position: 1, numerator: 4, denominator: 4 }];
    const tempi = [];
    const sequenceEvents = [
      { type: "note", cueIndex: 1, kind: "attack", snapshotId: "s1", eventId: "s1:a:attack:0" },
      { type: "note", cueIndex: 1, kind: "attack", snapshotId: "s2", eventId: "s2:b:attack:0.25" },
      { type: "note", cueIndex: 2, kind: "release", snapshotId: "s1", eventId: "s1:a:release:1.25" },
    ];
    expect(buildCueExpandedSnapshotIdsAt(0, snapshots, bars, tempi, sequenceEvents)).toEqual(new Set(["s1", "s2"]));
  });

  it("derives compact-view expanded snapshots from pending cue preview and playhead state", () => {
    const cueExpandedSnapshotIdsAt = (index) => (index === 1 ? new Set(["s2", "s3"]) : new Set());
    expect(deriveExpandedSnapshotIds({
      showAllEvents: false,
      pendingCueJumpIndex: "1",
      cueExpandedSnapshotIdsAt,
      playheadIsOff: false,
      playheadIsEnd: false,
      selectedSnapshotId: "s1",
      activeCueIndex: 2,
      cueExpandedSnapshotIds: new Set(["s1", "s2"]),
    })).toEqual(new Set(["s2", "s3"]));
  });

  it("derives cue scroll anchors for expanded and compact views", () => {
    expect(deriveCueScrollAnchorSnapshotId({
      showAllEvents: true,
      activeCueIndex: 2,
      sequenceCueGroups: [{ snapshotIndex: 0 }, { snapshotIndex: 1 }],
      snapshots: [{ id: "s1" }, { id: "s2" }],
      cueExpandedSnapshotIds: new Set(["s1"]),
    })).toBe("s2");

    expect(deriveCueScrollAnchorSnapshotId({
      showAllEvents: false,
      activeCueIndex: 2,
      sequenceCueGroups: [{ snapshotIndex: 0 }, { snapshotIndex: 1 }],
      snapshots: [{ id: "s1" }, { id: "s2" }],
      cueExpandedSnapshotIds: new Set(["s1"]),
    })).toBe("s1");
  });

  it("compares snapshot sets by membership", () => {
    expect(sameSnapshotSet(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(sameSnapshotSet(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
  });
});
