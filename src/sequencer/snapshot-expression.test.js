import { expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { clampExpression, expressionToMidi, normalizeNoteExpression,
  readSnapshotExpression, snapshotMidiExpression } from "./snapshot-expression.js";
import { normalizeSequenceRecord } from "./sequence-library.jsx";
import { normalizeSequenceWorkspaceRecord, serializeSequenceWorkspace } from "./session-persistence.js";
import { updateEventFieldInSnapshot } from "./sequence-mutations.js";
import { deriveSnapshotTriggerGroups, deriveSequenceCueGroups } from "./trigger-groups.js";
import { applySequenceTimbreModWheelToNote } from "./playback-modifiers-runtime.js";

it("imports legacy expression once, preferring fine data except contradictory zero placeholders", () => {
  expect(normalizeNoteExpression({ pressure: 100, pressure14: 0, timbre: 80, timbre14: 0 }))
    .toEqual({ expression: { pressure: 100 / 127, timbre: 80 / 127 } });
  expect(readSnapshotExpression({ pressure: 64, pressure14: 8200, timbre: 91, timbre14: 12000 }))
    .toEqual({ pressure: 8200 / 16256, timbre: 12000 / 16256 });
  expect(readSnapshotExpression({ pressure: 0, pressure14: 0 })).toEqual({ pressure: 0, timbre: 0 });
  expect(clampExpression(Infinity)).toBe(0);
  expect(clampExpression(-1)).toBe(0);
  expect(clampExpression(2)).toBe(1);
});

it("round-trips every supported 7/14-bit expression value through JSON without a one-step error", () => {
  for (const maximum of [127, 16256, 16383]) {
    for (let value = 0; value <= maximum; value++) {
      const normalized = JSON.parse(JSON.stringify(value / maximum));
      expect(expressionToMidi(normalized, maximum)).toBe(value);
    }
  }
  for (const maximum of [2 ** 21 - 1, 2 ** 32 - 1]) {
    for (const value of [0, 1, 127, maximum - 1, maximum, ...Array.from({ length: 256 }, (_, i) => Math.floor(maximum * i / 255))]) {
      expect(expressionToMidi(JSON.parse(JSON.stringify(value / maximum)), maximum)).toBe(value);
    }
  }
});

it("saves and restores only normalized expression, without mutating the imported record", () => {
  const record = { name: "Legacy", snapshots: [{ id: 1, length: 1,
    notes: [{ midicents: 69, pressure: 100, pressure14: 0, timbre: 80 }] }] };
  const normalized = normalizeSequenceRecord(record);
  expect(normalized.version).toBe(6);
  expect(normalized.snapshots[0].notes[0]).toMatchObject({ expression: { pressure: 100 / 127, timbre: 80 / 127 } });
  expect(normalized.snapshots[0].notes[0]).not.toHaveProperty("pressure14");
  expect(normalizeSequenceWorkspaceRecord(record).snapshots[0].notes[0].expression.pressure).toBe(100 / 127);
  expect(serializeSequenceWorkspace(record).snapshots[0].notes[0]).not.toHaveProperty("pressure");
  expect(record.snapshots[0].notes[0].pressure14).toBe(0);
});

it("edits normalized floats without retaining stale fine-resolution fields", () => {
  const snapshot = { id: 1, length: 1, notes: [{ id: "a", midicents: 69, pressure: 100, pressure14: 12800, timbre: 80 }] };
  const edited = updateEventFieldInSnapshot(snapshot, "a", "pressure", "0.123456789")[0];
  expect(edited.expression).toEqual({ pressure: 0.123456789, timbre: 80 / 127 });
  expect(edited).not.toHaveProperty("pressure14");
  expect(edited).not.toHaveProperty("pressure");
  const zero = updateEventFieldInSnapshot({ ...snapshot, notes: [edited] }, "a", "pressure", "0")[0];
  expect(zero.expression.pressure).toBe(0);
});

it("preserves floats through cue derivation and live timbre shaping", () => {
  const note = { id: "a", midicents: 69, expression: { pressure: 0.123456789, timbre: 0.987654321 } };
  const groups = deriveSnapshotTriggerGroups({ id: 1, length: 1, notes: [note] });
  expect(groups[0].events[0].expression).toEqual(note.expression);
  expect(groups[0].events[0]).not.toHaveProperty("pressure14");
  const low = applySequenceTimbreModWheelToNote(note, 32);
  const restored = applySequenceTimbreModWheelToNote(low, 64);
  expect(low.expression.timbre).toBe(note.expression.timbre / 2);
  expect(restored.expression).toEqual(note.expression);
  expect(snapshotMidiExpression(note).pressure).toBe(Math.round(note.expression.pressure * 127));
  expect(deriveSequenceCueGroups).toBeTypeOf("function");
});

it("all built-in sequence notes contain only valid normalized expression", () => {
  const directory = "src/sequencer/preset-sequences/marc-sabat";
  let count = 0;
  const audit = value => {
    if (!value || typeof value !== "object") return;
    for (const field of ["pressure", "pressure14", "timbre", "timbre14"]) {
      if (value.midicents != null) expect(value).not.toHaveProperty(field);
    }
    if (value.expression) {
      expect(value.expression.pressure).toBeGreaterThanOrEqual(0);
      expect(value.expression.pressure).toBeLessThanOrEqual(1);
      expect(value.expression.timbre).toBeGreaterThanOrEqual(0);
      expect(value.expression.timbre).toBeLessThanOrEqual(1);
      count++;
    }
    Object.values(value).forEach(audit);
  };
  for (const name of readdirSync(directory).filter(name => name.endsWith(".json"))) {
    const sequence = JSON.parse(readFileSync(`${directory}/${name}`, "utf8"));
    expect(sequence.version).toBe(6);
    audit(sequence);
  }
  expect(count).toBeGreaterThan(1000);
});
