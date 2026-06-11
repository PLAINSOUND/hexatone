import { describe, expect, it } from "vitest";
import {
  deriveSequenceCueGroups,
  deriveSequenceEvents,
  deriveSnapshotTriggerGroups,
  sequenceNotesAtCueIndex,
  sequenceNotesAtCueTime,
} from "./trigger-groups.js";

describe("deriveSnapshotTriggerGroups", () => {
  it("groups by time and sorts attacks before releases, then by descending pitch", () => {
    const groups = deriveSnapshotTriggerGroups({
      id: 1,
      length: 1,
      notes: [
        {
          id: "high",
          midicents: 81,
          start: 0,
          end: 0.5,
          attackVelocity: 90,
          releaseVelocity: 31,
        },
        {
          id: "mid",
          midicents: 76,
          start: 0.5,
          end: 1,
          attackVelocity: 80,
          releaseVelocity: 41,
        },
        {
          id: "low",
          midicents: 72,
          start: 0.5,
          end: 1,
          attackVelocity: 70,
          releaseVelocity: 51,
        },
      ],
    });

    expect(groups.map((group) => group.time)).toEqual([0, 0.5, 1]);
    expect(groups[1].events.map((event) => `${event.kind}:${event.noteId}`)).toEqual([
      "attack:mid",
      "attack:low",
      "release:high",
    ]);
  });

  it("defaults note spans to start 0 and end snapshot length", () => {
    const groups = deriveSnapshotTriggerGroups({
      id: 1,
      length: 2,
      notes: [{ id: "root", midicents: 69, attackVelocity: 88, releaseVelocity: 22 }],
    });

    expect(groups).toHaveLength(2);
    expect(groups[0].time).toBe(0);
    expect(groups[1].time).toBe(2);
  });

  it("merges equal absolute positions across snapshots into shared sequence cues", () => {
    const groups = deriveSequenceCueGroups([
      {
        id: 1,
        length: 1,
        notes: [{ id: "first", midicents: 69, start: 0, end: 1 }],
      },
      {
        id: 2,
        length: 1,
        notes: [{ id: "second", midicents: 72, start: 0, end: 1 }],
      },
    ]);

    expect(groups.map((group) => group.time)).toEqual([1, 2, 3]);
    expect(groups[1].events.map((event) => `${event.kind}:${event.noteId}`)).toEqual([
      "attack:second",
      "release:first",
    ]);
    expect(groups[1].snapshotIndex).toBe(1);
  });

  it("derives the active note set after a shared cue position", () => {
    const notes = sequenceNotesAtCueTime([
      {
        id: 1,
        length: 1,
        notes: [{ id: "first", midicents: 69, start: 0, end: 1 }],
      },
      {
        id: 2,
        length: 1,
        notes: [{ id: "second", midicents: 72, start: 0, end: 1 }],
      },
    ], 2);

    expect(notes.map((note) => note.id)).toEqual(["second"]);
  });

  it("recomputes cue numbering when edited positions create new shared cues", () => {
    const events = deriveSequenceEvents([
      {
        id: 1,
        length: 1,
        notes: [
          { id: "a", midicents: 69, start: 0, end: 1.25 },
          { id: "b", midicents: 72, start: 0.5, end: 1 },
        ],
      },
      {
        id: 2,
        length: 1,
        notes: [
          { id: "c", midicents: 76, start: 0.25, end: 1 },
        ],
      },
    ]);

    expect(events.map((event) => [event.noteId, event.kind, event.absoluteTime, event.cueIndex])).toEqual([
      ["a", "attack", 1, 1],
      ["b", "attack", 1.5, 2],
      ["b", "release", 2, 3],
      ["c", "attack", 2.25, 4],
      ["a", "release", 2.25, 4],
      ["c", "release", 3, 5],
    ]);
  });

  it("walks active note sets through cues created by edited positions", () => {
    const snapshots = [
      {
        id: 1,
        length: 1,
        notes: [
          { id: "a", midicents: 69, start: 0, end: 1.25 },
          { id: "b", midicents: 72, start: 0.5, end: 1 },
        ],
      },
      {
        id: 2,
        length: 1,
        notes: [
          { id: "c", midicents: 76, start: 0.25, end: 1 },
        ],
      },
    ];

    expect(sequenceNotesAtCueTime(snapshots, 1).map((note) => note.id)).toEqual(["a"]);
    expect(sequenceNotesAtCueTime(snapshots, 1.5).map((note) => note.id)).toEqual(["a", "b"]);
    expect(sequenceNotesAtCueTime(snapshots, 2).map((note) => note.id)).toEqual(["a"]);
    expect(sequenceNotesAtCueTime(snapshots, 2.25).map((note) => note.id)).toEqual(["c"]);
    expect(sequenceNotesAtCueTime(snapshots, 3).map((note) => note.id)).toEqual([]);
  });

  it("derives cue playback targets by applying note-on and note-off events cue by cue", () => {
    const snapshots = [
      {
        id: 1,
        length: 1,
        notes: [
          { id: "a", midicents: 60, start: 0, end: 1 },
          { id: "b", midicents: 64, start: 0.2, end: 1 },
          { id: "c", midicents: 67, start: 0.3, end: 1 },
        ],
      },
      {
        id: 2,
        length: 1,
        notes: [{ id: "d", midicents: 72, start: 0, end: 1 }],
      },
    ];

    expect(sequenceNotesAtCueIndex(snapshots, 0).map((note) => note.midicents)).toEqual([60]);
    expect(sequenceNotesAtCueIndex(snapshots, 1).map((note) => note.midicents)).toEqual([64, 60]);
    expect(sequenceNotesAtCueIndex(snapshots, 2).map((note) => note.midicents)).toEqual([67, 64, 60]);
    expect(sequenceNotesAtCueIndex(snapshots, 3).map((note) => note.midicents)).toEqual([72]);
  });

  it("preserves same-pitch notes across same-time release and attack cue handoffs", () => {
    const snapshots = [
      {
        id: 1,
        length: 1,
        notes: [{ id: "a", midicents: 60, start: 0, end: 1, pressure: 10, timbre: 20 }],
      },
      {
        id: 2,
        length: 1,
        notes: [{ id: "b", midicents: 60, start: 0, end: 1, pressure: 55, timbre: 66 }],
      },
    ];

    expect(sequenceNotesAtCueIndex(snapshots, 0)).toMatchObject([
      { midicents: 60, pressure: 10, timbre: 20 },
    ]);
    expect(sequenceNotesAtCueIndex(snapshots, 1)).toMatchObject([
      { midicents: 60, pressure: 55, timbre: 66 },
    ]);
  });

  it("attaches integer-position bars to the preceding snapshot and keeps them ahead of the whole shared-time burst", () => {
    const events = deriveSequenceEvents(
      [
        {
          id: 1,
          length: 1,
          notes: [{ id: "a", midicents: 69, start: 0, end: 1 }],
        },
        {
          id: 2,
          length: 1,
          notes: [{ id: "b", midicents: 72, start: 0, end: 1 }],
        },
      ],
      [{ id: 100, position: 2 }],
    );

    expect(events.map((event) => [
      event.type,
      event.kind,
      event.absoluteTime,
      event.snapshotIndex,
      event.cueIndex,
    ])).toEqual([
      ["note", "attack", 1, 0, 1],
      ["bar", "bar", 2, 0, null],
      ["note", "attack", 2, 1, 2],
      ["note", "release", 2, 0, 2],
      ["note", "release", 3, 1, 3],
    ]);
  });
});
