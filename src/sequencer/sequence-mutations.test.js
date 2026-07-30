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
