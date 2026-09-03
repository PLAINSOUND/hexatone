// This module owns direct note-row mutations inside a snapshot.
// It updates editable pitch/name/timing fields and note deletion in the shape
// expected by the sequencer UI, while leaving cross-snapshot moves to the
// higher-level sequence-operations helpers.

import {
  assignStableSequencerNoteIds,
  clamp,
  frequencyToMidicents,
  noteMatchesReference,
  sortSnapshotNotes,
} from "./value-runtime.js";
import {
  buildSnapshotRationalContext,
  rebuildSnapshotRationalIdentity,
} from "./snapshot-rational-identity.js";
import {
  normalizeSequenceHejiName,
  resolveSequenceHejiName,
  splitOctaveHejiName,
} from "./pitch-frame.js";

function editableNameOctave(note) {
  const existing = splitOctaveHejiName(note?.hejiName ?? note?.displayLabel);
  if (existing) return existing.octave;
  const pitch = Number(note?.originalMidicents ?? note?.midicents);
  return Number.isFinite(pitch) ? Math.floor(Math.round(pitch) / 12) - 1 : 4;
}

function editableNameOptions(note) {
  return {
    fallbackOctave: editableNameOctave(note),
    fallbackName: note?.hejiName ?? note?.displayLabel ?? null,
  };
}

function restoreEditedName(note) {
  const originalMidicents = Number(note?.originalMidicents);
  const {
    originalMidicents: _originalMidicents,
    originalDisplayLabel,
    originalHejiName,
    displayLabelEdited: _displayLabelEdited,
    ...rest
  } = note;
  return {
    ...rest,
    midicents: Number.isFinite(originalMidicents) ? originalMidicents : note.midicents,
    displayLabel: originalDisplayLabel ?? note.displayLabel,
    hejiName: originalHejiName ?? originalDisplayLabel ?? note.hejiName ?? note.displayLabel,
  };
}

function rationalContextBeforeEdit(note) {
  return buildSnapshotRationalContext({
    displayLabel: note?.originalDisplayLabel ?? note?.displayLabel,
    monzo: note?.monzo,
    midicents: note?.originalMidicents ?? note?.midicents,
    existingContext: note?.rationalContext,
  });
}

export function deleteEventNoteFromSnapshot(snapshot, noteRef) {
  if (!snapshot) return null;
  const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
  const nextNotes = (snapshot.notes ?? []).filter(
    (note) => !noteMatchesReference(note, noteRef, length),
  );
  return sortSnapshotNotes(assignStableSequencerNoteIds(nextNotes, length), length);
}

export function applyEventBarRelativeDraftToSnapshot(
  snapshot,
  draft,
  absoluteTime,
  snapshotNumber,
) {
  if (!snapshot || !draft || !Number.isFinite(absoluteTime)) return null;
  const denominator = Math.max(1, Math.round(Number(draft.denominator) || 1));
  const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
  return assignStableSequencerNoteIds(
    (snapshot.notes ?? []).map((note) => {
      if (!noteMatchesReference(note, draft, length)) return note;
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
    }),
    length,
  );
}

export function updateEventFieldInSnapshot(snapshot, noteKey, field, rawValue) {
  if (!snapshot) return null;
  if (field === "displayLabel") {
    const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
    return assignStableSequencerNoteIds(
      (snapshot.notes ?? []).map((note) => {
        if (!noteMatchesReference(note, noteKey, length)) return note;
        const options = editableNameOptions(note);
        const nextLabel = snapshot.pitchFrame
          ? normalizeSequenceHejiName(rawValue, options)
          : String(rawValue ?? "");
        if (!nextLabel) return restoreEditedName(note);
        if ((note.displayLabel ?? "") === nextLabel) return note;
        const originalDisplayLabel = note.originalDisplayLabel ?? note.displayLabel ?? "";
        const originalHejiName = note.originalHejiName ?? note.hejiName ?? originalDisplayLabel;
        const originalMidicents = Number.isFinite(Number(note.originalMidicents))
          ? Number(note.originalMidicents)
          : Number(note.midicents);
        const namedPitch = resolveSequenceHejiName(nextLabel, snapshot.pitchFrame, options);
        const nextIdentity = namedPitch?.ratioText
          ? {
              ratioText: namedPitch.ratioText,
              ...(namedPitch.monzo ? { monzo: namedPitch.monzo } : {}),
            }
          : {};
        const {
          ratioText: _ratioText,
          monzo: _monzo,
          rationalContext: _rationalContext,
          ...withoutIdentity
        } = note;
        return {
          ...withoutIdentity,
          originalDisplayLabel,
          originalHejiName,
          originalMidicents,
          displayLabel: nextLabel,
          hejiName: nextLabel,
          displayLabelEdited: true,
          midicents: namedPitch?.midicents ?? note.midicents,
          ...nextIdentity,
          rationalContext: rationalContextBeforeEdit(note) ?? note.rationalContext,
        };
      }),
      length,
    );
  }
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) return null;
  const pitchUnchanged = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0000005;
  const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;

  return assignStableSequencerNoteIds(
    (snapshot.notes ?? []).map((note) => {
      if (!noteMatchesReference(note, noteKey, length)) return note;

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
          rationalContext: rationalContextBeforeEdit(note) ?? note.rationalContext,
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
          rationalContext: rationalContextBeforeEdit(note) ?? note.rationalContext,
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
    }),
    length,
  );
}

export function commitEventPitchLabelInSnapshot(snapshot, noteKey) {
  if (!snapshot) return null;
  const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
  return assignStableSequencerNoteIds(
    (snapshot.notes ?? []).map((note) => {
      if (!noteMatchesReference(note, noteKey, length)) return note;
      const namedPitch = resolveSequenceHejiName(note.displayLabel, snapshot.pitchFrame, {
        ...editableNameOptions(note),
      });
      if (snapshot.pitchFrame && !namedPitch) {
        return restoreEditedName(note);
      }
      if (namedPitch) {
        const {
          originalMidicents: _originalMidicents,
          originalDisplayLabel: _originalDisplayLabel,
          originalHejiName: _originalHejiName,
          displayLabelEdited: _displayLabelEdited,
          rationalContext: _rationalContext,
          ratioText: _ratioText,
          monzo: _monzo,
          ...rest
        } = note;
        return {
          ...rest,
          midicents: namedPitch.midicents,
          displayLabel: namedPitch.hejiName,
          hejiName: namedPitch.hejiName,
          ...(namedPitch.ratioText ? { ratioText: namedPitch.ratioText } : {}),
          ...(namedPitch.monzo ? { monzo: namedPitch.monzo } : {}),
        };
      }
      const pitchChanged =
        Number.isFinite(Number(note.originalMidicents)) &&
        Math.abs(Number(note.originalMidicents) - Number(note.midicents)) >= 0.0000005;
      const rebuilt = rebuildSnapshotRationalIdentity(note);
      const {
        originalMidicents: _originalMidicents,
        originalDisplayLabel: _originalDisplayLabel,
        originalHejiName: _originalHejiName,
        displayLabelEdited: _displayLabelEdited,
        ...rest
      } = note;
      if (rebuilt?.pitchMatches) {
        return {
          ...rest,
          ratioText: rebuilt.ratioText,
          monzo: rebuilt.monzo,
          rationalContext: rebuilt.rationalContext,
        };
      }
      if (pitchChanged || (rebuilt && !rebuilt.pitchMatches)) {
        const {
          ratioText: _ratioText,
          monzo: _monzo,
          rationalContext: _rationalContext,
          ...withoutStaleIdentity
        } = rest;
        return withoutStaleIdentity;
      }
      return rest;
    }),
    length,
  );
}

export function restoreEventPitchLabelInSnapshot(snapshot, noteKey) {
  if (!snapshot) return null;
  const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
  return assignStableSequencerNoteIds(
    (snapshot.notes ?? []).map((note) => {
      if (!noteMatchesReference(note, noteKey, length)) return note;
      const originalMidicents = Number(note.originalMidicents);
      const canRestorePitch = Number.isFinite(originalMidicents);
      const canRestoreLabel = note.displayLabelEdited === true && note.originalDisplayLabel != null;
      if (!canRestorePitch && !canRestoreLabel) return note;
      const {
        originalMidicents: _originalMidicents,
        originalDisplayLabel,
        originalHejiName,
        displayLabelEdited: _displayLabelEdited,
        ...rest
      } = note;
      return {
        ...rest,
        midicents: canRestorePitch ? originalMidicents : note.midicents,
        displayLabel: originalDisplayLabel ?? "",
        hejiName: originalHejiName ?? originalDisplayLabel ?? "",
      };
    }),
    length,
  );
}
