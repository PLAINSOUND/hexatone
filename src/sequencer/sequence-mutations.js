import {
  clamp,
  frequencyToMidicents,
  noteIdentity,
  sortSnapshotNotes,
} from "./value-runtime.js";

export function deleteEventNoteFromSnapshot(snapshot, noteKey) {
  if (!snapshot) return null;
  const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
  const nextNotes = (snapshot.notes ?? []).filter((note) => noteIdentity(note, length) !== noteKey);
  return sortSnapshotNotes(nextNotes, length);
}

export function applyEventBarRelativeDraftToSnapshot(snapshot, draft, absoluteTime, snapshotNumber) {
  if (!snapshot || !draft || !Number.isFinite(absoluteTime)) return null;
  const denominator = Math.max(1, Math.round(Number(draft.denominator) || 1));
  const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
  return (snapshot.notes ?? []).map((note) => {
    if (noteIdentity(note, length) !== draft.noteKey) return note;
    const nextRelativeTime = Math.round((absoluteTime - snapshotNumber) * 1000000) / 1000000;
    if (draft.kind === "attack") {
      return {
        ...note,
        start: nextRelativeTime,
        end: Math.max(
          nextRelativeTime,
          Number.isFinite(Number(note?.end)) ? Number(note.end) : length,
        ),
        startFractionDenominator: denominator,
      };
    }
    return {
      ...note,
      end: Math.max(
        Number.isFinite(Number(note?.start)) ? Number(note.start) : 0,
        nextRelativeTime,
      ),
      endFractionDenominator: denominator,
    };
  });
}

export function updateEventFieldInSnapshot(snapshot, noteKey, field, rawValue) {
  if (!snapshot) return null;
  if (field === "displayLabel") {
    const nextLabel = String(rawValue ?? "");
    const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
    return (snapshot.notes ?? []).map((note) => {
      if (noteIdentity(note, length) !== noteKey) return note;
      if ((note.displayLabel ?? "") === nextLabel) return note;
      const originalDisplayLabel = note.originalDisplayLabel ?? note.displayLabel ?? "";
      return {
        ...note,
        originalDisplayLabel,
        displayLabel: nextLabel,
        displayLabelEdited: true,
      };
    });
  }
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) return null;
  const pitchUnchanged = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0000005;
  const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;

  return (snapshot.notes ?? []).map((note) => {
    if (noteIdentity(note, length) !== noteKey) return note;

    const originalMidicents = Number.isFinite(Number(note.originalMidicents))
      ? Number(note.originalMidicents)
      : Number(note.midicents);
    const originalDisplayLabel = note.originalDisplayLabel ?? note.displayLabel ?? "";

    if (field === "midicents") {
      if (pitchUnchanged(numeric, note.midicents)) return note;
      return {
        ...note,
        midicents: numeric,
        originalMidicents,
        originalDisplayLabel,
        displayLabel: "edited",
        displayLabelEdited: true,
      };
    }
    if (field === "frequency") {
      const midicents = frequencyToMidicents(numeric);
      if (midicents == null || pitchUnchanged(midicents, note.midicents)) return note;
      return {
        ...note,
        midicents,
        originalMidicents,
        originalDisplayLabel,
        displayLabel: "edited",
        displayLabelEdited: true,
      };
    }
    if (field === "attackVelocity") {
      return { ...note, attackVelocity: clamp(Math.round(numeric), 0, 127) };
    }
    if (field === "releaseVelocity") {
      return { ...note, releaseVelocity: clamp(Math.round(numeric), 0, 127) };
    }
    if (field === "pressure") {
      return { ...note, pressure: clamp(Math.round(numeric), 0, 127) };
    }
    if (field === "timbre") {
      return { ...note, timbre: clamp(Math.round(numeric), 0, 127) };
    }
    return note;
  });
}

export function commitEventPitchLabelInSnapshot(snapshot, noteKey) {
  if (!snapshot) return null;
  const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
  return (snapshot.notes ?? []).map((note) => {
    if (noteIdentity(note, length) !== noteKey) return note;
    const {
      originalMidicents: _originalMidicents,
      originalDisplayLabel: _originalDisplayLabel,
      displayLabelEdited: _displayLabelEdited,
      ...rest
    } = note;
    return rest;
  });
}

export function restoreEventPitchLabelInSnapshot(snapshot, noteKey) {
  if (!snapshot) return null;
  const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
  return (snapshot.notes ?? []).map((note) => {
    if (noteIdentity(note, length) !== noteKey) return note;
    const originalMidicents = Number(note.originalMidicents);
    const canRestorePitch = Number.isFinite(originalMidicents);
    const canRestoreLabel = note.displayLabelEdited === true && note.originalDisplayLabel != null;
    if (!canRestorePitch && !canRestoreLabel) return note;
    const {
      originalMidicents: _originalMidicents,
      originalDisplayLabel,
      displayLabelEdited: _displayLabelEdited,
      ...rest
    } = note;
    return {
      ...rest,
      midicents: canRestorePitch ? originalMidicents : note.midicents,
      displayLabel: originalDisplayLabel ?? "",
    };
  });
}
