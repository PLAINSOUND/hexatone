import { describe, expect, it } from "vitest";

import { deriveSequenceEvents } from "./trigger-groups.js";

function secondSnapshotAttack(snapshots, legatoMode) {
  return deriveSequenceEvents(snapshots, [], [], [], { legatoMode }).filter(
    (event) => event.type === "note" && event.kind === "attack" && event.snapshotIndex === 1,
  );
}

describe("sequence legato modes", () => {
  it("continues only an exact pitch in the same ordered slot in Per Note mode", () => {
    const snapshots = [
      {
        id: "first",
        notes: [
          { id: "a", sequenceSlot: 0, midicents: 60, start: 0, end: 1 },
          { id: "b", sequenceSlot: 1, midicents: 64, start: 0.25, end: 1.25 },
        ],
      },
      {
        id: "second",
        notes: [
          { id: "c", sequenceSlot: 0, midicents: 60, start: 0, end: 1 },
          { id: "d", sequenceSlot: 1, midicents: 67, start: 0.25, end: 1 },
        ],
      },
    ];

    expect(
      secondSnapshotAttack(snapshots, "per-note").map((event) => [
        event.midicents,
        event.legatoContinuation,
      ]),
    ).toEqual([
      [60, true],
      [67, false],
    ]);
  });

  it("allows a forced reattack to override an inferred Per Note continuation", () => {
    const snapshots = [
      { id: "first", notes: [{ sequenceSlot: 0, midicents: 60, start: 0, end: 1 }] },
      {
        id: "second",
        notes: [{ sequenceSlot: 0, midicents: 60, start: 0, end: 1, forceReattack: true }],
      },
    ];

    expect(secondSnapshotAttack(snapshots, "per-note")[0]).toMatchObject({
      perNoteLegatoCandidate: true,
      forceReattack: true,
      legatoContinuation: false,
    });
  });

  it("continues a common tone that moved slots only in All Common Tones mode", () => {
    const snapshots = [
      { id: "first", notes: [{ sequenceSlot: 0, midicents: 60, start: 0, end: 1.25 }] },
      {
        id: "second",
        notes: [
          { sequenceSlot: 0, midicents: 67, start: 0, end: 1 },
          { sequenceSlot: 1, midicents: 60, start: 0.25, end: 1 },
        ],
      },
    ];

    const perNote = secondSnapshotAttack(snapshots, "per-note").find(
      (event) => event.midicents === 60,
    );
    const allCommon = secondSnapshotAttack(snapshots, "all-common-tones").find(
      (event) => event.midicents === 60,
    );
    const off = secondSnapshotAttack(snapshots, "off").find((event) => event.midicents === 60);

    expect(perNote.legatoContinuation).toBe(false);
    expect(allCommon.legatoContinuation).toBe(true);
    expect(off.legatoContinuation).toBe(false);
  });
});
