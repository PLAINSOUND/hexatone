import { describe, expect, it } from "vitest";
import {
  applyNoteUpdateToSnapshot,
  applyTransferredNote,
  buildTransferredNote,
} from "./sequence-operations.js";

describe("sequencer sequence operations", () => {
  const sourceSnapshot = {
    id: "s1",
    length: 2,
    notes: [{ id: "a", midicents: 69, start: 0, end: 1 }],
  };
  const targetSnapshot = {
    id: "s2",
    length: 2,
    notes: [],
  };
  const snapshotIndexById = new Map([["s1", 1], ["s2", 2]]);

  it("applies note list updates with sequencer sorting", () => {
    const notes = applyNoteUpdateToSnapshot(sourceSnapshot, () => [
      { id: "b", midicents: 72, start: 0.5, end: 1.5 },
      { id: "a", midicents: 69, start: 0, end: 1 },
    ]);
    expect(notes.map((note) => note.id)).toEqual(["a", "b"]);
  });

  it("builds a transferred note in target-snapshot coordinates", () => {
    const result = buildTransferredNote({
      sourceSnapshot,
      targetSnapshot,
      note: sourceSnapshot.notes[0],
      noteRef: { noteId: "a", noteKey: "a" },
      snapshotIndexById,
      mutateNote: (note) => note,
    });
    expect(result.movedNote).toMatchObject({
      start: -1,
      end: 0,
    });
  });

  it("assigns a stable internal id when transferring a captured note without an id", () => {
    const result = buildTransferredNote({
      sourceSnapshot: {
        id: "s1",
        length: 1,
        notes: [{ midicents: 69, start: 0, end: 1 }],
      },
      targetSnapshot,
      note: { midicents: 69, start: 0, end: 1 },
      noteRef: { noteKey: "69:0:1" },
      snapshotIndexById,
      mutateNote: (note) => note,
    });

    expect(result.movedNote.id).toBe("__seq__:69:0:1");
  });

  it("applies duplicate and move transfer plans", () => {
    const movedNote = { id: "a", midicents: 69, start: 0.25, end: 1.25 };
    const duplicatePlan = applyTransferredNote({
      sourceSnapshot,
      targetSnapshot,
      noteRef: { noteId: "a", noteKey: "a" },
      movedNote,
      duplicate: true,
      duplicateId: "a-copy",
    });
    expect(duplicatePlan.targetNotes[0].id).toBe("a-copy");

    const movePlan = applyTransferredNote({
      sourceSnapshot,
      targetSnapshot,
      noteRef: { noteId: "a", noteKey: "a" },
      movedNote,
    });
    expect(movePlan.sourceNotes).toEqual([]);
    expect(movePlan.targetNotes[0].id).toBe("a");
  });
});
