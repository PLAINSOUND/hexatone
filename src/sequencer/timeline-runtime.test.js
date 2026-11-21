import { deriveSelectedCueAbsoluteTime } from "./transport-selection.js";
import { describe, expect, it } from "vitest";
import {
  buildCueExpandedSnapshotIds,
  buildFirstSnapshotCueEventIds,
  buildSnapshotEventsById,
} from "./timeline-runtime.js";

describe("sequencer timeline runtime", () => {
  it("groups snapshot events while suppressing structural markers that coincide with snapshot starts", () => {
    const groups = buildSnapshotEventsById([
      {
        type: "tempo",
        snapshotId: "s1",
        snapshotIndex: 0,
        absoluteTime: 1,
        eventId: "tempo:start",
      },
      { type: "bar", snapshotId: "s1", snapshotIndex: 0, absoluteTime: 1, eventId: "bar:start" },
      { type: "note", snapshotId: "s1", snapshotIndex: 0, absoluteTime: 1, eventId: "note:1" },
      {
        type: "tempo",
        snapshotId: "s1",
        snapshotIndex: 0,
        absoluteTime: 1.5,
        eventId: "tempo:mid",
      },
      { type: "note", snapshotId: "s2", snapshotIndex: 1, absoluteTime: 2.25, eventId: "note:2" },
    ]);

    expect(groups.get("s1")).toEqual([
      { type: "note", snapshotId: "s1", snapshotIndex: 0, absoluteTime: 1, eventId: "note:1" },
      {
        type: "tempo",
        snapshotId: "s1",
        snapshotIndex: 0,
        absoluteTime: 1.5,
        eventId: "tempo:mid",
      },
    ]);
    expect(groups.get("s2")).toEqual([
      { type: "note", snapshotId: "s2", snapshotIndex: 1, absoluteTime: 2.25, eventId: "note:2" },
    ]);
  });

  it("tracks the first event per snapshot per cue for courtesy markers", () => {
    const snapshotEventsById = new Map([
      [
        "s1",
        [
          { type: "note", cueIndex: 1, eventId: "s1:e1" },
          { type: "note", cueIndex: 1, eventId: "s1:e2" },
          { type: "note", cueIndex: 2, eventId: "s1:e3" },
        ],
      ],
      [
        "s2",
        [
          { type: "note", cueIndex: 2, eventId: "s2:e1" },
          { type: "note", cueIndex: 2, eventId: "s2:e2" },
        ],
      ],
    ]);

    expect(buildFirstSnapshotCueEventIds(snapshotEventsById)).toEqual(
      new Map([
        ["s1:1", "s1:e1"],
        ["s1:2", "s1:e3"],
        ["s2:2", "s2:e1"],
      ]),
    );
  });

  it("expands snapshots relevant to the active cue and still shows sustained attacks", () => {
    const ids = buildCueExpandedSnapshotIds(
      5,
      [
        {
          type: "note",
          cueIndex: 5,
          kind: "attack",
          noteKey: "a",
          snapshotId: "s1",
          eventId: "attack:a",
        },
        {
          type: "note",
          cueIndex: 6,
          kind: "attack",
          noteKey: "held",
          snapshotId: "s2",
          eventId: "attack:held",
        },
        {
          type: "note",
          cueIndex: 6,
          kind: "release",
          noteKey: "held",
          snapshotId: "s3",
          eventId: "release:held",
        },
      ],
      new Set(["attack:held"]),
    );

    expect(ids).toEqual(new Set(["s1", "s2"]));
  });

  it("derives the selected cue absolute time from either the selected marker or the playhead cue", () => {
    const snapshotIndexById = new Map([["s1", 1]]);
    const cueGroups = [{ time: 1.25 }, { time: 2.5 }];

    expect(
      deriveSelectedCueAbsoluteTime(
        { snapshotId: "s1", time: 0.375 },
        null,
        cueGroups,
        snapshotIndexById,
      ),
    ).toBe(1.375);

    expect(deriveSelectedCueAbsoluteTime(null, 1, cueGroups, snapshotIndexById)).toBe(2.5);
  });
});
