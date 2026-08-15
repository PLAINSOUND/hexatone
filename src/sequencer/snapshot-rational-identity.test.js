import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { rebuildSnapshotRationalIdentity } from "./snapshot-rational-identity.js";

const BUILT_IN_SEQUENCE_PATHS = [
  "src/sequencer/preset-sequences/marc-sabat/Flight.json",
  "src/sequencer/preset-sequences/marc-sabat/FALL.json",
  "src/sequencer/preset-sequences/marc-sabat/Seeds-of-Skies-Alibis.json",
];

describe("snapshot rational identity", () => {
  it.each(BUILT_IN_SEQUENCE_PATHS)(
    "keeps every HEJI note in %s reconstructible within 0.01 cents",
    (path) => {
      const sequence = JSON.parse(fs.readFileSync(path, "utf8"));
      for (const [snapshotIndex, snapshot] of sequence.snapshots.entries()) {
        for (const [noteIndex, note] of (snapshot.notes ?? []).entries()) {
          const rebuilt = rebuildSnapshotRationalIdentity(note, note.rationalContext);
          expect(rebuilt, `snapshot ${snapshotIndex + 1}, note ${noteIndex + 1}`).toBeTruthy();
          expect(
            rebuilt.pitchMatches,
            `snapshot ${snapshotIndex + 1}, note ${noteIndex + 1}: ${rebuilt.pitchErrorCents} cents`,
          ).toBe(true);
          expect(rebuilt.ratioText).toBe(note.ratioText);
          expect(rebuilt.monzo).toEqual(note.monzo);
          expect(note.rationalContext?.version).toBe(1);
        }
      }
    },
  );

  it("stores the two corrected FALL pitches at the exact 441 Hz Tree reference", () => {
    const sequence = JSON.parse(fs.readFileSync(BUILT_IN_SEQUENCE_PATHS[1], "utf8"));
    const cases = [
      { snapshotId: 112, noteIndex: 1, frequency: 228 + 2 / 3, ratioText: "7/8" },
      { snapshotId: 119, noteIndex: 0, frequency: 555 + 1 / 3, ratioText: "17/8" },
    ];
    for (const fixture of cases) {
      const note = sequence.snapshots.find((snapshot) => snapshot.id === fixture.snapshotId).notes[
        fixture.noteIndex
      ];
      const frequency = 440 * Math.pow(2, (note.midicents - 69) / 12);
      expect(frequency).toBeCloseTo(fixture.frequency, 9);
      expect(note.ratioText).toBe(fixture.ratioText);
    }
  });

  it("preserves the Seeds of Skies score structure and exact 440/27 reference", () => {
    const sequence = JSON.parse(fs.readFileSync(BUILT_IN_SEQUENCE_PATHS[2], "utf8"));
    expect(sequence.name).toBe("Seeds of Skies, Alibis");
    expect(sequence.snapshots).toHaveLength(278);
    expect(sequence.snapshots.filter((snapshot) => snapshot.notes.length === 0)).toHaveLength(30);
    expect(sequence.manualArpeggiation).toMatchObject({
      mode: "all",
      initialSpreadMs: 1500,
      spreadVariation: 0.5,
      timingVariation: 0.4,
      decayMode: "timed",
      decayMs: 5000,
      decayVariation: 0.35,
    });
    expect(sequence.legatoMode).toBe("off");

    const firstNote = sequence.snapshots[1].notes[0];
    const frequency = 440 * Math.pow(2, (firstNote.midicents - 69) / 12);
    expect(firstNote.ratioText).toBe("18/1");
    expect(frequency).toBeCloseTo((440 / 27) * 18, 10);

    const duplicateChord = sequence.snapshots.find(
      (snapshot) => snapshot.notes.filter((note) => note.ratioText === "18/1").length === 2,
    );
    expect(duplicateChord).toBeTruthy();
    expect(new Set(duplicateChord.notes.map((note) => note.instanceKey)).size).toBe(
      duplicateChord.notes.length,
    );

    const twoNoteChord = sequence.snapshots.find((snapshot) => snapshot.notes.length === 2);
    const fourNoteChord = sequence.snapshots.find((snapshot) => snapshot.notes.length === 4);
    expect(twoNoteChord.notes.map((note) => note.start)).toEqual([0, 0.25]);
    expect(fourNoteChord.notes.map((note) => note.start)).toEqual([0, 0.125, 0.25, 0.375]);
    expect(fourNoteChord.notes.map((note) => note.sequenceSlot)).toEqual([0, 1, 2, 3]);
  });
});
