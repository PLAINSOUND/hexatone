import { describe, expect, it } from "vitest";
import {
  buildCueExpandedSnapshotIds,
  buildFirstCueIndexBySnapshotIndex,
  buildFirstCueTimeBySnapshotIndex,
  buildFirstEventIdByCueIndex,
  buildFirstSnapshotEventIds,
  buildSnapshotEventsById,
  buildSnapshotStartCueIndexes,
  deriveSelectedCueAbsoluteTime,
} from "./timeline-runtime.js";

describe("sequencer timeline runtime", () => {
  it("groups snapshot events while suppressing structural markers that coincide with snapshot starts", () => {
    const groups = buildSnapshotEventsById([
      { type: "tempo", snapshotId: "s1", snapshotIndex: 0, absoluteTime: 1, eventId: "tempo:start" },
      { type: "bar", snapshotId: "s1", snapshotIndex: 0, absoluteTime: 1, eventId: "bar:start" },
      { type: "note", snapshotId: "s1", snapshotIndex: 0, absoluteTime: 1, eventId: "note:1" },
      { type: "tempo", snapshotId: "s1", snapshotIndex: 0, absoluteTime: 1.5, eventId: "tempo:mid" },
      { type: "note", snapshotId: "s2", snapshotIndex: 1, absoluteTime: 2.25, eventId: "note:2" },
    ]);

    expect(groups.get("s1")).toEqual([
      { type: "note", snapshotId: "s1", snapshotIndex: 0, absoluteTime: 1, eventId: "note:1" },
      { type: "tempo", snapshotId: "s1", snapshotIndex: 0, absoluteTime: 1.5, eventId: "tempo:mid" },
    ]);
    expect(groups.get("s2")).toEqual([
      { type: "note", snapshotId: "s2", snapshotIndex: 1, absoluteTime: 2.25, eventId: "note:2" },
    ]);
  });

  it("derives first note events per snapshot and their starting cue indexes", () => {
    const snapshotEventsById = new Map([
      ["s1", [
        { type: "tempo", eventId: "tempo:1" },
        { type: "note", eventId: "note:1" },
      ]],
      ["s2", [
        { type: "note", eventId: "note:2" },
      ]],
    ]);
    const sequenceEvents = [
      { type: "note", eventId: "note:1", cueIndex: 4 },
      { type: "note", eventId: "note:2", cueIndex: 7 },
    ];

    const firstSnapshotEventIds = buildFirstSnapshotEventIds(snapshotEventsById);
    expect(firstSnapshotEventIds).toEqual(new Map([
      ["s1", "note:1"],
      ["s2", "note:2"],
    ]));

    expect(buildSnapshotStartCueIndexes(firstSnapshotEventIds, sequenceEvents)).toEqual(new Map([
      ["s1", 4],
      ["s2", 7],
    ]));
  });

  it("builds first-event and first-cue indexes for transport navigation", () => {
    expect(buildFirstEventIdByCueIndex([
      { type: "note", cueIndex: 2, eventId: "e2a" },
      { type: "note", cueIndex: 2, eventId: "e2b" },
      { type: "note", cueIndex: 3, eventId: "e3a" },
      { type: "tempo", cueIndex: 1, eventId: "tempo" },
    ])).toEqual(new Map([
      [2, "e2a"],
      [3, "e3a"],
    ]));

    const cueGroups = [
      { snapshotIndex: 0, time: 1.125 },
      { snapshotIndex: 0, time: 1.5 },
      { snapshotIndex: 2, time: 3.25 },
    ];

    expect(buildFirstCueIndexBySnapshotIndex(cueGroups)).toEqual(new Map([
      [0, 0],
      [2, 2],
    ]));
    expect(buildFirstCueTimeBySnapshotIndex(cueGroups)).toEqual(new Map([
      [0, 1.125],
      [2, 3.25],
    ]));
  });

  it("expands snapshots relevant to the active cue and still shows sustained attacks", () => {
    const ids = buildCueExpandedSnapshotIds(5, [
      { type: "note", cueIndex: 5, kind: "attack", noteKey: "a", snapshotId: "s1", eventId: "attack:a" },
      { type: "note", cueIndex: 6, kind: "attack", noteKey: "held", snapshotId: "s2", eventId: "attack:held" },
      { type: "note", cueIndex: 6, kind: "release", noteKey: "held", snapshotId: "s3", eventId: "release:held" },
    ], new Set(["attack:held"]));

    expect(ids).toEqual(new Set(["s1", "s2"]));
  });

  it("derives the selected cue absolute time from either the selected marker or the playhead cue", () => {
    const snapshotIndexById = new Map([["s1", 1]]);
    const cueGroups = [{ time: 1.25 }, { time: 2.5 }];

    expect(deriveSelectedCueAbsoluteTime(
      { snapshotId: "s1", time: 0.375 },
      null,
      cueGroups,
      snapshotIndexById,
    )).toBe(1.375);

    expect(deriveSelectedCueAbsoluteTime(
      null,
      1,
      cueGroups,
      snapshotIndexById,
    )).toBe(2.5);
  });
});
