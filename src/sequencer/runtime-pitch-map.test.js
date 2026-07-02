import { describe, expect, it } from "vitest";
import { remapSequenceSnapshotsToRuntime } from "./runtime-pitch-map.js";

describe("runtime-pitch-map", () => {
  it("snaps stored sequence notes to the nearest degree of the current tuning", () => {
    const snapshots = [{
      id: 1,
      length: 1,
      notes: [{
        id: "a",
        midicents: 69.12,
        displayLabel: "captured",
        start: 0,
        end: 1,
      }],
    }];
    const runtime = {
      scale: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
      equivInterval: 1200,
      referenceDegree: 9,
      fundamental: 440,
    };

    const remapped = remapSequenceSnapshotsToRuntime(snapshots, runtime, {
      noteNames: ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"],
    });

    expect(remapped[0].notes[0].midicents).toBeCloseTo(69, 6);
    expect(remapped[0].notes[0].frequency).toBeCloseTo(440, 6);
    expect(remapped[0].notes[0].displayLabel).toBe("A");
  });

  it("preserves snapshot structure while remapping note pitch data", () => {
    const snapshots = [{
      id: 7,
      length: 2,
      description: "shape",
      notes: [{
        id: "n1",
        midicents: 61.2,
        displayLabel: "old",
        start: 0.25,
        end: 1.75,
        attackVelocity: 90,
      }],
    }];

    const remapped = remapSequenceSnapshotsToRuntime(snapshots, {
      scale: [0, 200, 400, 500, 700, 900, 1100],
      equivInterval: 1200,
      referenceDegree: 5,
      fundamental: 440,
    });

    expect(remapped[0]).not.toBe(snapshots[0]);
    expect(remapped[0].notes[0]).toMatchObject({
      id: "n1",
      start: 0.25,
      end: 1.75,
      attackVelocity: 90,
    });
  });
});
