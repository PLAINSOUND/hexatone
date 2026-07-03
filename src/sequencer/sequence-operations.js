import { normalizeSequenceNumber, noteIdentity, sortSnapshotNotes } from "./value-runtime.js";

export function applyNoteUpdateToSnapshot(targetSnapshot, buildNotes) {
  if (!targetSnapshot) return null;
  const length = Number.isFinite(Number(targetSnapshot?.length)) ? Number(targetSnapshot.length) : 1;
  return sortSnapshotNotes(buildNotes(targetSnapshot, length), length);
}

export function buildTransferredNote({
  sourceSnapshot,
  targetSnapshot,
  note,
  noteKey,
  snapshotIndexById,
  mutateNote,
}) {
  if (!sourceSnapshot || !targetSnapshot || !note) return null;

  const sourceLength = Number.isFinite(Number(sourceSnapshot?.length)) ? Number(sourceSnapshot.length) : 1;
  const sourceSnapshotNumber = snapshotIndexById.get(sourceSnapshot.id) ?? 1;
  const targetSnapshotNumber = snapshotIndexById.get(targetSnapshot.id) ?? 1;
  const start = Number.isFinite(Number(note?.start)) ? Number(note.start) : 0;
  const rawEnd = Number.isFinite(Number(note?.end)) ? Number(note.end) : sourceLength;
  const end = Math.max(start, rawEnd);
  const absoluteStart = normalizeSequenceNumber(sourceSnapshotNumber + start);
  const absoluteEnd = normalizeSequenceNumber(sourceSnapshotNumber + end);
  const targetLength = Number.isFinite(Number(targetSnapshot?.length)) ? Number(targetSnapshot.length) : 1;
  const baseMovedNote = {
    ...JSON.parse(JSON.stringify(note)),
    start: normalizeSequenceNumber(absoluteStart - targetSnapshotNumber),
    end: normalizeSequenceNumber(absoluteEnd - targetSnapshotNumber),
  };

  const movedNote = mutateNote(baseMovedNote, {
    sourceSnapshot,
    targetSnapshot,
    sourceSnapshotNumber,
    targetSnapshotNumber,
    absoluteStart,
    absoluteEnd,
    sourceLength,
    targetLength,
    noteKey,
  });

  return movedNote ? {
    movedNote,
    sourceSnapshotNumber,
    targetSnapshotNumber,
    absoluteStart,
    absoluteEnd,
  } : null;
}

export function applyTransferredNote({
  sourceSnapshot,
  targetSnapshot,
  noteKey,
  movedNote,
  duplicate = false,
  duplicateId = null,
}) {
  if (!sourceSnapshot || !targetSnapshot || !movedNote) return null;

  if (duplicate) {
    return {
      sourceNotes: null,
      targetNotes: applyNoteUpdateToSnapshot(targetSnapshot, (snapshot) => [
        ...(snapshot.notes ?? []),
        { ...movedNote, id: duplicateId ?? movedNote.id },
      ]),
      selectedSnapshotId: targetSnapshot.id,
      selectedTime: movedNote.start,
    };
  }

  if (sourceSnapshot.id === targetSnapshot.id) {
    return {
      sourceNotes: applyNoteUpdateToSnapshot(sourceSnapshot, (snapshot, length) => (
        (snapshot.notes ?? []).map((entry) => (
          noteIdentity(entry, length) === noteKey ? movedNote : entry
        ))
      )),
      targetNotes: null,
      selectedSnapshotId: targetSnapshot.id,
      selectedTime: movedNote.start,
    };
  }

  return {
    sourceNotes: applyNoteUpdateToSnapshot(sourceSnapshot, (snapshot, length) => (
      (snapshot.notes ?? []).filter((entry) => noteIdentity(entry, length) !== noteKey)
    )),
    targetNotes: applyNoteUpdateToSnapshot(targetSnapshot, (snapshot) => [
      ...(snapshot.notes ?? []),
      movedNote,
    ]),
    selectedSnapshotId: targetSnapshot.id,
    selectedTime: movedNote.start,
  };
}
