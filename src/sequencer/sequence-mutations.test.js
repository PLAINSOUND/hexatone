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
});
