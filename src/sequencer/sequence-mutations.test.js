import { describe, expect, it } from "vitest";
import {
  applyEventBarRelativeDraftToSnapshot,
  commitEventPitchLabelInSnapshot,
  deleteEventNoteFromSnapshot,
  restoreEventPitchLabelInSnapshot,
  updateEventFieldInSnapshot,
} from "./sequence-mutations.js";

describe("sequencer sequence mutations", () => {
  const snapshot = {
    id: "s1",
    length: 2,
    notes: [
      { id: "a", midicents: 69, start: 0, end: 1, displayLabel: "A" },
      { id: "b", midicents: 72, start: 0.25, end: 1.5, displayLabel: "C" },
    ],
  };

  it("deletes a note from a snapshot", () => {
    const next = deleteEventNoteFromSnapshot(snapshot, "a");
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("b");
  });

  it("applies an event bar-relative draft to attack timing", () => {
    const next = applyEventBarRelativeDraftToSnapshot(
      snapshot,
      { noteKey: "a", kind: "attack", denominator: "8" },
      1.5,
      1,
    );
    expect(next[0]).toMatchObject({
      start: 0.5,
      end: 1,
      startFractionDenominator: 8,
    });
  });

  it("assigns a stable internal id when editing timing of a captured note without an id", () => {
    const next = applyEventBarRelativeDraftToSnapshot(
      {
        id: "s1",
        length: 1,
        notes: [{ midicents: 69, start: 0, end: 1 }],
      },
      { noteKey: "69:0:1", kind: "release", denominator: "4" },
      2.25,
      1,
    );

    expect(next[0]).toMatchObject({
      start: 0,
      end: 1.25,
      endFractionDenominator: 4,
    });
    expect(next[0].id).toMatch(/^__seq__:69:0:/);
  });

  it("matches a note by stable id before falling back to noteKey", () => {
    const next = applyEventBarRelativeDraftToSnapshot(
      {
        id: "s1",
        length: 1,
        notes: [{ id: "held", midicents: 69, start: 0, end: 1 }],
      },
      { noteId: "held", noteKey: "stale:key", kind: "release", denominator: "8" },
      2.5,
      1,
    );

    expect(next[0]).toMatchObject({
      id: "held",
      end: 1.5,
      endFractionDenominator: 8,
    });
  });

  it("marks pitch fields as edited only when changed", () => {
    const unchanged = updateEventFieldInSnapshot(snapshot, "a", "midicents", 69);
    expect(unchanged[0].displayLabelEdited).toBeUndefined();

    const changed = updateEventFieldInSnapshot(snapshot, "a", "midicents", 69.1);
    expect(changed[0]).toMatchObject({
      midicents: 69.1,
      displayLabel: "edited",
      displayLabelEdited: true,
      originalDisplayLabel: "A",
    });
  });

  it("restores captured pitch and name", () => {
    const editedSnapshot = {
      ...snapshot,
      notes: [
        {
          id: "a",
          midicents: 69.1,
          start: 0,
          end: 1,
          displayLabel: "edited",
          displayLabelEdited: true,
          originalMidicents: 69,
          originalDisplayLabel: "A",
        },
      ],
    };
    const restored = restoreEventPitchLabelInSnapshot(editedSnapshot, "a");
    expect(restored[0]).toMatchObject({
      midicents: 69,
      displayLabel: "A",
    });
    expect(restored[0].originalMidicents).toBeUndefined();
    expect(restored[0].displayLabelEdited).toBeUndefined();
  });

  it("edits an exact Scala ratio from 1/1 and commits its rational identity", () => {
    const framedSnapshot = {
      ...snapshot,
      pitchFrame: {
        id: "frame-1",
        referenceLabel: "A4",
        referenceFrequency: 441,
        referenceInterval: "27/16",
        hejiAnchorLabel: "*nE",
        hejiAnchorInterval: "81/64",
      },
      notes: [
        {
          ...snapshot.notes[0],
          midicents: 69 + 12 * Math.log2(441 / 440),
          displayLabel: "A4",
          hejiName: "A4",
          ratioText: "27/16",
        },
      ],
    };
    const edited = updateEventFieldInSnapshot(framedSnapshot, "a", "scalaInterval", "3/2");
    expect(edited[0]).toMatchObject({
      scalaIntervalDraft: "3/2",
      displayLabelEdited: true,
      ratioText: "27/16",
      displayLabel: "G4",
      hejiName: "G4",
    });
    expect(edited[0].midicents).toBeCloseTo(69 + 12 * Math.log2(392 / 440), 8);

    const committed = commitEventPitchLabelInSnapshot({ ...framedSnapshot, notes: edited }, "a");
    expect(committed[0].ratioText).toBe("3/2");
    expect(committed[0].hejiName).toBe("G4");
    expect(committed[0].monzo).toEqual([-1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(committed[0].scalaIntervalDraft).toBeUndefined();
    expect(committed[0].displayLabelEdited).toBeUndefined();
  });

  it("keeps Scala cents irrational and restores the captured rational identity on cancel", () => {
    const initialMidicents = 69 + 12 * Math.log2(441 / 440);
    const framedSnapshot = {
      ...snapshot,
      pitchFrame: {
        id: "frame-1",
        referenceLabel: "A4",
        referenceFrequency: 441,
        referenceInterval: "27/16",
        hejiAnchorLabel: "*nE",
        hejiAnchorInterval: "81/64",
      },
      notes: [
        {
          ...snapshot.notes[0],
          midicents: initialMidicents,
          displayLabel: "A4",
          hejiName: "A4",
          ratioText: "27/16",
          monzo: [-4, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        },
      ],
    };
    const edited = updateEventFieldInSnapshot(framedSnapshot, "a", "scalaInterval", "701.955");
    expect(edited[0].scalaIntervalDraft).toBe("701.955000");
    expect(edited[0].hejiName).toBe("G4−5.865003");
    const committed = commitEventPitchLabelInSnapshot({ ...framedSnapshot, notes: edited }, "a");
    expect(committed[0].ratioText).toBeUndefined();
    expect(committed[0].monzo).toBeUndefined();

    const restored = restoreEventPitchLabelInSnapshot({ ...framedSnapshot, notes: edited }, "a");
    expect(restored[0]).toMatchObject({
      midicents: initialMidicents,
      displayLabel: "A4",
      hejiName: "A4",
      ratioText: "27/16",
      monzo: framedSnapshot.notes[0].monzo,
    });
    expect(restored[0].scalaIntervalDraft).toBeUndefined();
  });

  it("commits edited pitch and name as the new snapshot baseline", () => {
    const editedSnapshot = {
      ...snapshot,
      notes: [
        {
          id: "a",
          midicents: 69.1,
          start: 0,
          end: 1,
          displayLabel: "La 441",
          displayLabelEdited: true,
          originalMidicents: 69,
          originalDisplayLabel: "A",
        },
      ],
    };
    const committed = commitEventPitchLabelInSnapshot(editedSnapshot, "a");
    expect(committed[0]).toMatchObject({
      midicents: 69.1,
      displayLabel: "La 441",
    });
    expect(committed[0].originalMidicents).toBeUndefined();
    expect(committed[0].originalDisplayLabel).toBeUndefined();
    expect(committed[0].displayLabelEdited).toBeUndefined();
  });

  it.each([
    {
      name: "41-limit F to C",
      originalLabel: "F",
      originalMidicents: 78.27107404676313,
      originalRatio: "369/256",
      originalMonzo: [-8, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
      nextLabel: "C",
      nextMidicents: 85.290624055417,
      expectedRatio: "1107/512",
      expectedMonzo: [-9, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
    },
    {
      name: "Pythagorean E to 17-limit E",
      originalLabel: "E",
      originalMidicents: 64.01955000865388,
      originalRatio: "81/64",
      originalMonzo: [-6, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      nextLabel: "E",
      nextMidicents: 65.06910410365795,
      expectedRatio: "1377/1024",
      expectedMonzo: [-10, 4, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    {
      name: "ordinary C to septimal C",
      originalLabel: "C",
      originalMidicents: 83.94134997403837,
      originalRatio: "1/1",
      originalMonzo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      nextLabel: "C",
      nextMidicents: 83.66870905603737,
      expectedRatio: "63/64",
      expectedMonzo: [-6, 2, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
  ])("rebuilds rational identity for a legacy Flight-style edit: $name", (fixture) => {
    const legacySnapshot = {
      id: "legacy",
      length: 1,
      notes: [
        {
          id: "a",
          midicents: fixture.originalMidicents,
          displayLabel: fixture.originalLabel,
          ratioText: fixture.originalRatio,
          monzo: fixture.originalMonzo,
        },
      ],
    };
    const pitchEdited = updateEventFieldInSnapshot(
      legacySnapshot,
      "a",
      "midicents",
      fixture.nextMidicents,
    );
    const nameEdited = updateEventFieldInSnapshot(
      { ...legacySnapshot, notes: pitchEdited },
      "a",
      "displayLabel",
      fixture.nextLabel,
    );
    const committed = commitEventPitchLabelInSnapshot(
      { ...legacySnapshot, notes: nameEdited },
      "a",
    );

    expect(committed[0]).toMatchObject({
      midicents: fixture.nextMidicents,
      displayLabel: fixture.nextLabel,
      ratioText: fixture.expectedRatio,
      monzo: fixture.expectedMonzo,
      rationalContext: {
        globalOffsetMonzo: expect.any(Array),
        midiCentsOffset: expect.any(Number),
      },
    });
  });

  it("removes stale rational identity when a changed pitch is committed with an arbitrary name", () => {
    const legacySnapshot = {
      id: "legacy",
      length: 1,
      notes: [
        {
          id: "a",
          midicents: 69,
          displayLabel: "A",
          ratioText: "1/1",
          monzo: new Array(17).fill(0),
        },
      ],
    };
    const pitchEdited = updateEventFieldInSnapshot(legacySnapshot, "a", "midicents", 69.25);
    const nameEdited = updateEventFieldInSnapshot(
      { ...legacySnapshot, notes: pitchEdited },
      "a",
      "displayLabel",
      "solo",
    );
    const committed = commitEventPitchLabelInSnapshot(
      { ...legacySnapshot, notes: nameEdited },
      "a",
    );

    expect(committed[0].ratioText).toBeUndefined();
    expect(committed[0].monzo).toBeUndefined();
    expect(committed[0].rationalContext).toBeUndefined();
  });

  it("restores a name-only edit when no pitch change was made", () => {
    const editedSnapshot = {
      ...snapshot,
      notes: [
        {
          id: "a",
          midicents: 69,
          start: 0,
          end: 1,
          displayLabel: "La 440",
          displayLabelEdited: true,
          originalDisplayLabel: "A",
        },
      ],
    };
    const restored = restoreEventPitchLabelInSnapshot(editedSnapshot, "a");
    expect(restored[0]).toMatchObject({
      midicents: 69,
      displayLabel: "A",
    });
    expect(restored[0].displayLabelEdited).toBeUndefined();
  });

  it("derives pitch from an octave-qualified name in the snapshot's own frame", () => {
    const framedSnapshot = {
      ...snapshot,
      pitchFrame: {
        id: "frame-1",
        referenceLabel: "A4",
        referenceFrequency: 441,
        referenceInterval: "27/16",
        hejiAnchorLabel: "*nE",
        hejiAnchorInterval: "81/64",
      },
    };
    const edited = updateEventFieldInSnapshot(framedSnapshot, "a", "displayLabel", "E4");
    expect(edited[0].midicents).toBeCloseTo(64.058851593, 8);
    expect(edited[0].displayLabelEdited).toBe(true);
    const committed = commitEventPitchLabelInSnapshot({ ...framedSnapshot, notes: edited }, "a");
    expect(committed[0]).toMatchObject({
      displayLabel: "E4",
      hejiName: "E4",
      ratioText: "81/64",
    });
    expect(committed[0].midicents).toBeCloseTo(64.058851593, 8);
  });

  it("drops exact identity for a tempered HEJI name with cents deviation", () => {
    const framedSnapshot = {
      ...snapshot,
      pitchFrame: {
        id: "frame-1",
        referenceLabel: "A4",
        referenceFrequency: 440,
        referenceInterval: "1/1",
        hejiAnchorLabel: "*nA",
        hejiAnchorInterval: "1/1",
      },
      notes: [{ ...snapshot.notes[0], ratioText: "1/1", monzo: new Array(17).fill(0) }],
    };
    const edited = updateEventFieldInSnapshot(framedSnapshot, "a", "displayLabel", "*stC5−12");
    const committed = commitEventPitchLabelInSnapshot({ ...framedSnapshot, notes: edited }, "a");
    expect(committed[0].hejiName).toBe("C5−12");
    expect(committed[0].ratioText).toBeUndefined();
    expect(committed[0].monzo).toBeUndefined();
  });

  it("normalizes a valid shorthand draft and restores an invalid replacement", () => {
    const framedSnapshot = {
      ...snapshot,
      pitchFrame: {
        id: "frame-1",
        referenceLabel: "A4",
        referenceFrequency: 440,
        referenceInterval: "1/1",
        hejiAnchorLabel: "*nA",
        hejiAnchorInterval: "1/1",
      },
      notes: [{ ...snapshot.notes[0], hejiName: "A4" }],
    };
    const valid = updateEventFieldInSnapshot(framedSnapshot, "a", "displayLabel", "h3");
    expect(valid[0]).toMatchObject({
      displayLabel: "B3",
      hejiName: "B3",
      displayLabelEdited: true,
    });
    const invalid = updateEventFieldInSnapshot(
      { ...framedSnapshot, notes: valid },
      "a",
      "displayLabel",
      "not-a-note",
    );
    expect(invalid[0]).toMatchObject({
      midicents: 69,
      displayLabel: "A",
      hejiName: "A4",
    });
    expect(invalid[0].displayLabelEdited).toBeUndefined();
  });

  it("uses the latest valid name draft across successive octave edits", () => {
    let framedSnapshot = {
      ...snapshot,
      pitchFrame: {
        id: "frame-1",
        referenceLabel: "A4",
        referenceFrequency: 440,
        referenceInterval: "1/1",
        hejiAnchorLabel: "*nA",
        hejiAnchorInterval: "1/1",
      },
      notes: [
        {
          ...snapshot.notes[0],
          midicents: 59,
          displayLabel: "B3",
          hejiName: "B3",
        },
      ],
    };
    for (const name of ["A4", "a2"]) {
      framedSnapshot = {
        ...framedSnapshot,
        notes: updateEventFieldInSnapshot(framedSnapshot, "a", "displayLabel", name),
      };
    }

    expect(framedSnapshot.notes[0]).toMatchObject({
      midicents: 45,
      displayLabel: "A2",
      hejiName: "A2",
      originalMidicents: 59,
      originalHejiName: "B3",
      displayLabelEdited: true,
    });

    framedSnapshot = {
      ...framedSnapshot,
      notes: updateEventFieldInSnapshot(framedSnapshot, "a", "displayLabel", "5"),
    };
    expect(framedSnapshot.notes[0]).toMatchObject({
      midicents: 81,
      displayLabel: "A5",
      hejiName: "A5",
      originalMidicents: 59,
      originalHejiName: "B3",
      displayLabelEdited: true,
    });
  });
});
