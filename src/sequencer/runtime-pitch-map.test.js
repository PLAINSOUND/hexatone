import { describe, expect, it } from "vitest";
import { parseExactInterval } from "../tuning/interval.js";
import { captureSnapshot } from "./snapshots.js";
import { remapSequenceSnapshotsToRuntime } from "./runtime-pitch-map.js";
import { buildSequenceRuntimeModel } from "./runtime-model.js";

describe("runtime-pitch-map", () => {
  it("keeps legacy voice identities through snapping, including pitches merging onto one degree", () => {
    const snapshots = [
      {
        id: "legacy",
        length: 2,
        notes: [
          { midicents: 70.4, start: 0 },
          { midicents: 70.5, start: 0 },
        ],
      },
    ];
    const mapped = remapSequenceSnapshotsToRuntime(snapshots, {
      scale: [0, 200],
      equivInterval: 1200,
      referenceDegree: 0,
      fundamental: 440,
    });
    const sourceModel = buildSequenceRuntimeModel({ snapshots });
    const snappedModel = buildSequenceRuntimeModel({ snapshots: mapped });
    // Pitch sorting can change when notes converge; voice membership must not.
    const identities = (model) =>
      model.playbackNotesByCueIndex.map((notes) => notes.map((note) => note.instanceKey).sort());
    expect(identities(snappedModel)).toEqual(identities(sourceModel));
    expect(snappedModel.playbackNotesByCueIndex[0]).toHaveLength(2);
    expect(mapped[0].notes.map(note => note.midicents)).toEqual([71, 71]);
    expect(snapshots[0].notes.map(note => note.id)).toEqual([undefined, undefined]);
    expect(snapshots[0].notes.map(note => note.midicents)).toEqual([70.4, 70.5]);
  });
  it("snaps stored sequence notes to the nearest degree of the current tuning", () => {
    const snapshots = [
      {
        id: 1,
        length: 1,
        notes: [
          {
            id: "a",
            midicents: 69.12,
            displayLabel: "captured",
            hejiName: "*nE4",
            start: 0,
            end: 1,
          },
        ],
      },
    ];
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
    expect(remapped[0].notes[0].hejiName).toBe("A");
    expect(snapshots[0].notes[0].hejiName).toBe("*nE4");
    const hejiMapped = remapSequenceSnapshotsToRuntime(snapshots, runtime, {
      hejiNames: ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "*nA", "Bb", "B"],
    });
    expect(hejiMapped[0].notes[0].hejiName).toBe("*nA");
    const model = buildSequenceRuntimeModel({ snapshots: hejiMapped });
    expect(model.sequenceEvents.find(event => event.kind === "attack").hejiName).toBe("*nA");
  });

  it("preserves snapshot structure while remapping note pitch data", () => {
    const snapshots = [
      {
        id: 7,
        length: 2,
        description: "shape",
        notes: [
          {
            id: "n1",
            midicents: 61.2,
            displayLabel: "old",
            start: 0.25,
            end: 1.75,
            attackVelocity: 90,
          },
        ],
      },
    ];

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

  it("recomputes exact destination identities for captured snapped notes", () => {
    const destinationIntervals = [
      parseExactInterval("1/1"),
      parseExactInterval("5/4"),
      parseExactInterval("3/2"),
    ];
    const equaveIdentity = parseExactInterval("2/1");
    const snapshots = [
      {
        id: 1,
        length: 1,
        notes: [
          {
            id: "a",
            midicents: 72.8,
            displayLabel: "source",
            ratioText: "9/8",
            monzo: parseExactInterval("9/8").monzo,
            modulationRatioText: "81/80",
            modulationMonzo: parseExactInterval("81/80").monzo,
            attackVelocity: 96,
          },
        ],
      },
    ];
    const runtime = {
      scale: destinationIntervals.map((interval) => interval.cents),
      equivInterval: equaveIdentity.cents,
      referenceDegree: 0,
      fundamental: 440,
      degreeIntervals: destinationIntervals,
      equaveIdentity,
    };

    const remapped = remapSequenceSnapshotsToRuntime(snapshots, runtime, {
      noteNames: ["A", "C♯", "E"],
    });
    const snappedNote = remapped[0].notes[0];
    const captured = captureSnapshot({
      settings: { midi_velocity: 72 },
      state: { sustainedNotes: [] },
      _allActiveHexes: () => [],
      _snapshotNotes: [snappedNote],
      _snapshotHexes: [],
    });

    expect(snappedNote).toMatchObject({
      displayLabel: "C♯",
      ratioText: "5/4",
      monzo: destinationIntervals[1].monzo,
      modulationRatioText: undefined,
      modulationMonzo: undefined,
    });
    expect(captured[0]).toMatchObject({
      midicents: expect.closeTo(69 + Math.log2(5 / 4) * 12, 8),
      displayLabel: "C♯",
      ratioText: "5/4",
      monzo: destinationIntervals[1].monzo,
      attackVelocity: 96,
    });
    expect(captured[0]).not.toHaveProperty("modulationRatioText");
    expect(captured[0]).not.toHaveProperty("modulationMonzo");
    expect(captured[0]).not.toHaveProperty("rationalContext");
  });

  it("removes stale exact identities when the destination degree is not exact", () => {
    const remapped = remapSequenceSnapshotsToRuntime(
      [
        {
          id: 1,
          notes: [
            {
              midicents: 70,
              ratioText: "9/8",
              monzo: parseExactInterval("9/8").monzo,
            },
          ],
        },
      ],
      {
        scale: [0, 100, 200],
        equivInterval: 1200,
        referenceDegree: 0,
        fundamental: 440,
      },
    );

    expect(remapped[0].notes[0]).toMatchObject({
      ratioText: undefined,
      monzo: undefined,
    });
  });
});
