import { describe, expect, it } from "vitest";
import {
  buildCueExpandedSnapshotIdsAt,
  deriveCueExpandedSnapshotIds,
  deriveCueScrollAnchorTarget,
  deriveExpandedSnapshotIds,
  deriveSoundingAttackEventIds,
  firstSnapshotIdForCueIndex,
  firstSnapshotIdInSet,
  resolveCueAnchorSnapshotId,
  sameSnapshotSet,
} from "./view-runtime.js";

describe("sequencer view runtime", () => {
  it("finds the first snapshot id present in a set", () => {
    expect(firstSnapshotIdInSet(new Set(["s2", "s3"]), [{ id: "s1" }, { id: "s2" }, { id: "s3" }])).toBe("s2");
  });

  it("finds the first snapshot that actually carries a cue index", () => {
    expect(firstSnapshotIdForCueIndex(13, [
      { type: "note", cueIndex: 4, snapshotId: "s1" },
      { type: "note", cueIndex: 13, snapshotId: "s3" },
      { type: "note", cueIndex: 13, snapshotId: "s4" },
    ], [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }])).toBe("s3");
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

  it("derives active cue-expanded snapshots from preview rows before falling back to sounding attacks", () => {
    const cueExpandedSnapshotIdsAt = (index) => (index === 1 ? new Set(["s2", "s3"]) : new Set());
    expect(deriveCueExpandedSnapshotIds({
      activeCueIndex: 2,
      cueExpandedSnapshotIdsAt,
      sequenceEvents: [],
      soundingAttackEventIds: new Set(["unused"]),
    })).toEqual(new Set(["s2", "s3"]));

    expect(deriveCueExpandedSnapshotIds({
      activeCueIndex: 3,
      cueExpandedSnapshotIdsAt: () => new Set(),
      sequenceEvents: [
        { type: "note", kind: "attack", cueIndex: 3, snapshotId: "s4" },
        { type: "note", kind: "attack", cueIndex: 1, snapshotId: "s1", eventId: "s1:a" },
      ],
      soundingAttackEventIds: new Set(["s1:a"]),
    })).toEqual(new Set(["s4", "s1"]));
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
      sequenceEvents: [
        { type: "note", cueIndex: 1, snapshotId: "s1", eventId: "s1:c1" },
        { type: "note", cueIndex: 2, snapshotId: "s2", eventId: "s2:c2" },
      ],
      snapshots: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
      cueExpandedSnapshotIds: new Set(["s2"]),
      repeatSections: [{
        startRepeatId: 77,
        startCueIndex: 0,
        endCueIndex: 1,
      }],
    })).toEqual({ kind: "snapshot", targetKey: "s2" });
  });

  it("anchors cue scrolling to the earliest expanded snapshot whose notes sound in the selected cue", () => {
    expect(deriveCueScrollAnchorTarget({
      showAllEvents: true,
      activeCueIndex: 13,
      sequenceCueGroups: [
        { snapshotIndex: 0 },
        { snapshotIndex: 1 },
        { snapshotIndex: 2 },
      ],
      sequenceEvents: [
        { type: "note", cueIndex: 4, snapshotId: "s1", eventId: "s1:c4" },
        { type: "note", cueIndex: 13, snapshotId: "s3", eventId: "s3:c13" },
        { type: "note", cueIndex: 13, snapshotId: "s4", eventId: "s4:c13" },
      ],
      snapshots: [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }],
      cueExpandedSnapshotIds: new Set(["s1", "s3", "s4"]),
    })).toEqual({ kind: "snapshot", targetKey: "s1" });
  });

  it("resolves cue anchor snapshots with the same precedence used by app and autoscroll", () => {
    expect(resolveCueAnchorSnapshotId({
      activeCueIndex: 13,
      sequenceCueGroups: [
        { snapshotIndex: 0 },
        { snapshotIndex: 1 },
        { snapshotIndex: 2 },
      ],
      sequenceEvents: [
        { type: "note", cueIndex: 13, snapshotId: "s3", eventId: "s3:c13" },
      ],
      snapshots: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
      cueExpandedSnapshotIds: new Set(["s1", "s3"]),
    })).toBe("s1");

    expect(resolveCueAnchorSnapshotId({
      activeCueIndex: 13,
      sequenceCueGroups: [
        { snapshotIndex: 0 },
        { snapshotIndex: 1 },
        { snapshotIndex: 2 },
      ],
      sequenceEvents: [
        { type: "note", cueIndex: 13, snapshotId: "s3", eventId: "s3:c13" },
      ],
      snapshots: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
      cueExpandedSnapshotIds: new Set(),
    })).toBe("s3");
  });

  it("compares snapshot sets by membership", () => {
    expect(sameSnapshotSet(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(sameSnapshotSet(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
  });
});
