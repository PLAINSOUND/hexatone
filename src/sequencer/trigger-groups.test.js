import { describe, expect, it } from "vitest";
import { deriveSnapshotTriggerGroups } from "./trigger-groups.js";

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
});
