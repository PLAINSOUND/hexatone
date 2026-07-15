// This hook owns draft editing state for sequencer rows.
// It centralizes the temporary Bar/Beat/Num/Den and cross-snapshot move/dup
// drafts so sequencer.jsx can stay focused on composition rather than editing
// bookkeeping and commit/cancel wiring.

import { useCallback, useEffect, useState } from "preact/hooks";
import { timingBarAtNumber } from "./transport.js";
import {
  applyEventBarRelativeDraftToSnapshot,
  deleteEventNoteFromSnapshot,
} from "./sequence-mutations.js";
import {
  applyTransferredNote,
  buildTransferredNote,
} from "./sequence-operations.js";
import {
  commitForeignDrafts,
  removeDraftEntry,
  resolveBarRelativeDraftPosition,
  resolveDraftScopeTarget,
  resolveEventSequenceDraftTarget,
  updateBarRelativeDrafts,
  updateEventSequenceDrafts,
} from "./sequence-drafts.js";
import { normalizeSequenceNumber } from "./value-runtime.js";

export default function useDraftEditingController({
  snapshots,
  sortedBars,
  terminalBarlinePosition,
  snapshotIndexById,
  findSnapshotById,
  findNoteInSnapshot,
  nextDuplicateNoteId,
  onUpdateSnapshot,
  onSelectMarker,
  onSelectSnapshot,
  onUpdateTempo,
  onUpdateRepeat,
  notifyEditCommitted,
} = {}) {
  const [barRelativeDrafts, setBarRelativeDrafts] = useState({});
  const [eventSequenceDrafts, setEventSequenceDrafts] = useState({});
  const [tempoBarRelativeDrafts, setTempoBarRelativeDrafts] = useState({});
  const [repeatBarRelativeDrafts, setRepeatBarRelativeDrafts] = useState({});

  const resetDraftEditingState = useCallback(() => {
    setBarRelativeDrafts({});
    setEventSequenceDrafts({});
    setTempoBarRelativeDrafts({});
    setRepeatBarRelativeDrafts({});
  }, []);

  const updateEventSequenceDraftField = useCallback((draftKey, field, value, meta) => {
    setEventSequenceDrafts((prev) => updateEventSequenceDrafts(prev, {
      draftKey,
      field,
      value,
      meta,
      snapshotCount: snapshots.length,
    }));
  }, [snapshots.length]);

  const cancelEventSequenceDraft = useCallback((draftKey) => {
    setEventSequenceDrafts((prev) => removeDraftEntry(prev, draftKey));
  }, []);

  const commitNoteTransfer = useCallback((sourceSnapshotId, noteKey, targetSnapshotId, mutateNote, options = {}) => {
    const sourceSnapshot = findSnapshotById(sourceSnapshotId);
    const targetSnapshot = findSnapshotById(targetSnapshotId);
    if (!sourceSnapshot || !targetSnapshot) return;

    const sourceFound = findNoteInSnapshot(sourceSnapshot, noteKey);
    if (!sourceFound) return;
    const { note } = sourceFound;
    const transferred = buildTransferredNote({
      sourceSnapshot,
      targetSnapshot,
      note,
      noteKey,
      snapshotIndexById,
      mutateNote,
    });
    if (!transferred) return;

    const movedNote = options.selectKind === "release"
      ? { ...transferred.movedNote, __selectedTime: transferred.movedNote.end }
      : transferred.movedNote;
    const applied = applyTransferredNote({
      sourceSnapshot,
      targetSnapshot,
      noteKey,
      movedNote,
      duplicate: options.duplicate === true,
      duplicateId: options.duplicate ? nextDuplicateNoteId(note.id ?? noteKey) : null,
    });
    if (!applied) return;

    if (applied.sourceNotes != null) {
      onUpdateSnapshot(sourceSnapshot.id, { notes: applied.sourceNotes });
    }
    if (applied.targetNotes != null) {
      onUpdateSnapshot(targetSnapshot.id, { notes: applied.targetNotes });
    }

    onSelectSnapshot?.(applied.selectedSnapshotId);
    onSelectMarker?.(applied.selectedSnapshotId, options.selectKind === "release" ? movedNote.end : movedNote.start);
    notifyEditCommitted?.();
  }, [
    findNoteInSnapshot,
    findSnapshotById,
    nextDuplicateNoteId,
    notifyEditCommitted,
    onSelectMarker,
    onSelectSnapshot,
    onUpdateSnapshot,
    snapshotIndexById,
  ]);

  const deleteEventNote = useCallback((snapshotId, noteKey) => {
    const snapshot = findSnapshotById(snapshotId);
    if (!snapshot) return;
    const notes = deleteEventNoteFromSnapshot(snapshot, noteKey);
    onUpdateSnapshot(snapshot.id, { notes });
    notifyEditCommitted?.();
  }, [findSnapshotById, notifyEditCommitted, onUpdateSnapshot]);

  const moveEventNoteToSnapshot = useCallback((sourceSnapshotId, noteKey, targetSnapshotId, selectKind = "attack") => {
    if (sourceSnapshotId === targetSnapshotId) return;
    commitNoteTransfer(sourceSnapshotId, noteKey, targetSnapshotId, (note) => note, { selectKind });
  }, [commitNoteTransfer]);

  const duplicateEventNoteToSnapshot = useCallback((sourceSnapshotId, noteKey, targetSnapshotId, selectKind = "attack") => {
    commitNoteTransfer(sourceSnapshotId, noteKey, targetSnapshotId, (note) => note, {
      duplicate: true,
      selectKind,
    });
  }, [commitNoteTransfer]);

  const applyEventSequenceDraft = useCallback((draft) => {
    const resolved = resolveEventSequenceDraftTarget(draft, snapshots);
    if (!resolved) return;
    const { targetSnapshot, nextAbsoluteTime } = resolved;

    commitNoteTransfer(
      draft.snapshotId,
      draft.noteKey,
      targetSnapshot.id,
      (note, context) => {
        const nextStartAbsolute = draft.kind === "attack" ? nextAbsoluteTime : context.absoluteStart;
        const nextEndAbsolute = draft.kind === "release"
          ? Math.max(nextAbsoluteTime, nextStartAbsolute)
          : Math.max(context.absoluteEnd, nextStartAbsolute);
        return {
          ...note,
          start: normalizeSequenceNumber(nextStartAbsolute - context.targetSnapshotNumber),
          end: normalizeSequenceNumber(nextEndAbsolute - context.targetSnapshotNumber),
        };
      },
      { selectKind: draft.kind },
    );

    setEventSequenceDrafts((prev) => removeDraftEntry(prev, draft.draftKey));
  }, [commitNoteTransfer, snapshots]);

  const beatsPerBarForBarNumber = useCallback(
    (barNumber) => Math.max(1, Math.round(Number(timingBarAtNumber(barNumber, sortedBars)?.numerator) || 1)),
    [sortedBars],
  );

  const applyTempoBarRelativeDraft = useCallback((draft) => {
    const position = resolveBarRelativeDraftPosition(draft, sortedBars, terminalBarlinePosition);
    if (position == null) return;
    onUpdateTempo?.(draft.tempoId, { position });
    setTempoBarRelativeDrafts((prev) => removeDraftEntry(prev, draft.draftKey));
    notifyEditCommitted?.();
  }, [notifyEditCommitted, onUpdateTempo, sortedBars, terminalBarlinePosition]);

  const applyRepeatBarRelativeDraft = useCallback((draft) => {
    const position = resolveBarRelativeDraftPosition(draft, sortedBars, terminalBarlinePosition);
    if (position == null) return;
    onUpdateRepeat?.(draft.repeatId, { position });
    setRepeatBarRelativeDrafts((prev) => removeDraftEntry(prev, draft.draftKey));
    notifyEditCommitted?.();
  }, [notifyEditCommitted, onUpdateRepeat, sortedBars, terminalBarlinePosition]);

  const applyEventBarRelativeDraft = useCallback((draft) => {
    if (!draft) return;
    const snapshot = snapshots.find((entry) => entry.id === draft.snapshotId);
    if (!snapshot) return;
    const absoluteTime = resolveBarRelativeDraftPosition(draft, sortedBars, terminalBarlinePosition);
    if (absoluteTime == null) return;
    const notes = applyEventBarRelativeDraftToSnapshot(
      snapshot,
      draft,
      absoluteTime,
      snapshotIndexById.get(snapshot.id) ?? 1,
    );
    onUpdateSnapshot(snapshot.id, { notes });
    setBarRelativeDrafts((prev) => removeDraftEntry(prev, draft.draftKey));
    notifyEditCommitted?.();
  }, [notifyEditCommitted, onUpdateSnapshot, snapshots, sortedBars, snapshotIndexById, terminalBarlinePosition]);

  const updateEventBarRelativeDraftField = useCallback((draftKey, barBeat, field, value, meta) => {
    setBarRelativeDrafts((prev) => updateBarRelativeDrafts(prev, {
      draftKey,
      barBeat,
      field,
      value,
      meta,
      scopePrefix: "event",
      beatsPerBarForBarNumber,
    }));
  }, [beatsPerBarForBarNumber]);

  const cancelEventBarRelativeDraft = useCallback((draftKey) => {
    setBarRelativeDrafts((prev) => removeDraftEntry(prev, draftKey));
  }, []);

  const updateTempoBarRelativeDraftField = useCallback((draftKey, barBeat, field, value, meta) => {
    setTempoBarRelativeDrafts((prev) => updateBarRelativeDrafts(prev, {
      draftKey,
      barBeat,
      field,
      value,
      meta,
      scopePrefix: "tempo",
      beatsPerBarForBarNumber,
    }));
  }, [beatsPerBarForBarNumber]);

  const cancelTempoBarRelativeDraft = useCallback((draftKey) => {
    setTempoBarRelativeDrafts((prev) => removeDraftEntry(prev, draftKey));
  }, []);

  const updateRepeatBarRelativeDraftField = useCallback((draftKey, barBeat, field, value, meta) => {
    setRepeatBarRelativeDrafts((prev) => updateBarRelativeDrafts(prev, {
      draftKey,
      barBeat,
      field,
      value,
      meta,
      scopePrefix: "repeat",
      beatsPerBarForBarNumber,
    }));
  }, [beatsPerBarForBarNumber]);

  const cancelRepeatBarRelativeDraft = useCallback((draftKey) => {
    setRepeatBarRelativeDrafts((prev) => removeDraftEntry(prev, draftKey));
  }, []);

  const commitTempoBarRelativeDraft = useCallback((_tempoId, draftKey) => {
    const draft = tempoBarRelativeDrafts[draftKey];
    if (!draft) return;
    applyTempoBarRelativeDraft(draft);
  }, [applyTempoBarRelativeDraft, tempoBarRelativeDrafts]);

  const commitRepeatBarRelativeDraft = useCallback((_repeatId, draftKey) => {
    const draft = repeatBarRelativeDrafts[draftKey];
    if (!draft) return;
    applyRepeatBarRelativeDraft(draft);
  }, [applyRepeatBarRelativeDraft, repeatBarRelativeDrafts]);

  const commitEventBarRelativeDraft = useCallback((snapshot, noteKey, kind, draftKey) => {
    const draft = barRelativeDrafts[draftKey];
    if (!draft) return;
    applyEventBarRelativeDraft({
      ...draft,
      snapshotId: snapshot.id,
      noteKey,
      kind,
    });
  }, [applyEventBarRelativeDraft, barRelativeDrafts]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      const targetScope = resolveDraftScopeTarget(event, "data-event-sequence-draft-scope");
      commitForeignDrafts(eventSequenceDrafts, targetScope, applyEventSequenceDraft);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("mousedown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("mousedown", handlePointerDown, true);
    };
  }, [applyEventSequenceDraft, eventSequenceDrafts]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      const targetScope = resolveDraftScopeTarget(event, "data-bar-relative-draft-scope");
      commitForeignDrafts(barRelativeDrafts, targetScope, applyEventBarRelativeDraft);
      commitForeignDrafts(tempoBarRelativeDrafts, targetScope, applyTempoBarRelativeDraft);
      commitForeignDrafts(repeatBarRelativeDrafts, targetScope, applyRepeatBarRelativeDraft);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("mousedown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("mousedown", handlePointerDown, true);
    };
  }, [barRelativeDrafts, tempoBarRelativeDrafts, repeatBarRelativeDrafts, applyEventBarRelativeDraft, applyTempoBarRelativeDraft, applyRepeatBarRelativeDraft]);

  return {
    barRelativeDrafts,
    eventSequenceDrafts,
    tempoBarRelativeDrafts,
    repeatBarRelativeDrafts,
    resetDraftEditingState,
    deleteEventNote,
    moveEventNoteToSnapshot,
    duplicateEventNoteToSnapshot,
    updateEventSequenceDraftField,
    applyEventSequenceDraft,
    cancelEventSequenceDraft,
    updateEventBarRelativeDraftField,
    cancelEventBarRelativeDraft,
    updateTempoBarRelativeDraftField,
    cancelTempoBarRelativeDraft,
    updateRepeatBarRelativeDraftField,
    cancelRepeatBarRelativeDraft,
    commitTempoBarRelativeDraft,
    commitRepeatBarRelativeDraft,
    commitEventBarRelativeDraft,
  };
}
