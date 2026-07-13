import { describe, expect, it } from "vitest";
import {
  buildCueExpandedSnapshotIdsAt,
  deriveCueScrollAnchorTarget,
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

  it("derives compact-view expanded snapshots from the active cue and playhead state", () => {
    const cueExpandedSnapshotIdsAt = (index) => (index === 1 ? new Set(["s2", "s3"]) : new Set());
    expect(deriveExpandedSnapshotIds({
      showAllEvents: false,
      cueExpandedSnapshotIdsAt,
      playheadIsOff: false,
      playheadIsEnd: false,
      selectedSnapshotId: "s1",
      activeCueIndex: 2,
      cueExpandedSnapshotIds: new Set(["s1", "s2"]),
    })).toEqual(new Set(["s1", "s2"]));
  });

  it("derives cue scroll anchors for expanded and compact views", () => {
    expect(deriveCueScrollAnchorTarget({
      showAllEvents: true,
      activeCueIndex: 2,
      sequenceCueGroups: [{ snapshotIndex: 0 }, { snapshotIndex: 1 }],
      snapshots: [{ id: "s1" }, { id: "s2" }],
      cueExpandedSnapshotIds: new Set(["s1"]),
    })).toEqual({ kind: "snapshot", targetKey: "s1" });

    expect(deriveCueScrollAnchorTarget({
      showAllEvents: false,
      activeCueIndex: 2,
      sequenceCueGroups: [{ snapshotIndex: 0 }, { snapshotIndex: 1 }],
      snapshots: [{ id: "s1" }, { id: "s2" }],
      cueExpandedSnapshotIds: new Set(["s1"]),
    })).toEqual({ kind: "snapshot", targetKey: "s1" });
  });

  it("prefers the repeat-start marker as the cue scroll anchor at the repeat entry cue", () => {
    expect(deriveCueScrollAnchorTarget({
      showAllEvents: true,
      activeCueIndex: 1,
      sequenceCueGroups: [{ snapshotIndex: 0 }, { snapshotIndex: 1 }, { snapshotIndex: 2 }],
      snapshots: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
      cueExpandedSnapshotIds: new Set(["s2"]),
      repeatSections: [{
        startRepeatId: 77,
        startCueIndex: 0,
        endCueIndex: 1,
      }],
    })).toEqual({ kind: "structural", targetKey: "repeat-start:77" });
  });

  it("keeps later cues inside a repeat span anchored to sounding snapshots", () => {
    expect(deriveCueScrollAnchorTarget({
      showAllEvents: true,
      activeCueIndex: 2,
      sequenceCueGroups: [{ snapshotIndex: 0 }, { snapshotIndex: 1 }, { snapshotIndex: 2 }],
      snapshots: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
      cueExpandedSnapshotIds: new Set(["s2"]),
      repeatSections: [{
        startRepeatId: 77,
        startCueIndex: 0,
        endCueIndex: 1,
      }],
    })).toEqual({ kind: "snapshot", targetKey: "s2" });
  });

  it("compares snapshot sets by membership", () => {
    expect(sameSnapshotSet(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(sameSnapshotSet(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
  });
});
