import { describe, expect, it } from "vitest";
import {
  clamp,
  commitTextInput,
  displayValue,
  formatDisplaySequenceOffset,
  formatEditableFrequency,
  formatEditableMidicents,
  formatFrequency,
  formatMidicents,
  formatSequenceOffset,
  formatSequenceTime,
  frequencyToMidicents,
  isOutOfSnapshotRange,
  normalizeSequenceNumber,
  noteIdentity,
  sortSnapshotNotes,
  structuralEventInstanceKey,
  structuralEventRenderKey,
} from "./value-runtime.js";

describe("sequencer value runtime", () => {
  it("formats sequence positions for display and editing", () => {
    expect(formatSequenceTime(2, 0.375)).toBe("2.375000");
    expect(formatSequenceOffset(0.375)).toBe("0.375000");
    expect(formatDisplaySequenceOffset(0.375)).toBe("0.375");
    expect(formatMidicents(69.12345)).toBe("69.123");
    expect(formatEditableMidicents(69.12345)).toBe("69.123450");
    expect(formatFrequency(441.234)).toBe("441.2");
    expect(formatEditableFrequency(441.234)).toBe("441.234000");
  });

  it("handles generic value helpers and snapshot bounds", () => {
    expect(displayValue(null)).toBe("--");
    expect(displayValue(12)).toBe("12");
    expect(clamp(9, 0, 7)).toBe(7);
    expect(normalizeSequenceNumber(1.23456789)).toBe(1.234568);
    expect(isOutOfSnapshotRange({ length: 1 }, -0.1)).toBe(true);
    expect(isOutOfSnapshotRange({ length: 1 }, 0.5)).toBe(false);
  });

  it("reports whether an input value produced a new commit", () => {
    const input = document.createElement("input");
    input.value = "12";
    const commit = vi.fn(() => ({ transactionId: "tempo-position:1" }));

    expect(commitTextInput(input, commit)).toEqual({
      committed: true,
      metadata: { transactionId: "tempo-position:1" },
    });
    expect(commitTextInput(input, commit)).toEqual({ committed: false, metadata: null });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("derives note identity, note ordering, and midicents from frequency", () => {
    expect(noteIdentity({ id: "a", midicents: 69, start: 0, end: 1 })).toBe("a");
    expect(noteIdentity({ midicents: 69, start: 0, end: 1 })).toBe("69:0:1");
    expect(frequencyToMidicents(440)).toBe(69);

    const notes = sortSnapshotNotes([
      { id: "low", midicents: 60, start: 0.25, end: 0.75 },
      { id: "high", midicents: 72, start: 0.25, end: 0.75 },
      { id: "early", midicents: 64, start: 0, end: 0.5 },
    ]);

    expect(notes.map((note) => note.id)).toEqual(["early", "high", "low"]);
  });

  it("builds stable structural render and instance keys", () => {
    expect(structuralEventRenderKey({ structuralType: "bar", id: "b1" })).toBe("bar:b1");
    expect(structuralEventRenderKey({ structuralType: "tempo", id: "t1" })).toBe("tempo:t1");
    expect(
      structuralEventInstanceKey({
        structuralType: "bar",
        id: "b1",
        position: 2,
        numerator: 3,
        denominator: 4,
      }),
    ).toBe("bar:b1:2.000000:3:4");
    expect(
      structuralEventInstanceKey({
        structuralType: "tempo",
        id: "t1",
        position: 2,
        bpm: 58,
        beatNumerator: 1,
        beatDenominator: 4,
      }),
    ).toBe("tempo:t1:2.000000:58:1:4");
  });
});
