// This hook owns draft editing state for sequencer rows.
// It centralizes the temporary Bar/Beat/Num/Den and cross-snapshot move/dup
// drafts so sequencer.jsx can stay focused on composition rather than editing
// bookkeeping and commit/cancel wiring.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { appendPersistedSequencerCrashDiagnostic } from "../debug/sequencer-crash-diagnostics.js";
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
import { normalizeSequenceNumber, noteIdentity } from "./value-runtime.js";

const DRAFT_COMMIT_EVENT = typeof window !== "undefined" && "PointerEvent" in window
  ? "pointerdown"
  : "mousedown";

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
  const snapshotsRef = useRef(snapshots);
  const sortedBarsRef = useRef(sortedBars);
  const terminalBarlinePositionRef = useRef(terminalBarlinePosition);
  const snapshotIndexByIdRef = useRef(snapshotIndexById);
  const barRelativeDraftsRef = useRef(barRelativeDrafts);
  const eventSequenceDraftsRef = useRef(eventSequenceDrafts);
  const tempoBarRelativeDraftsRef = useRef(tempoBarRelativeDrafts);
  const repeatBarRelativeDraftsRef = useRef(repeatBarRelativeDrafts);

  snapshotsRef.current = snapshots;
  sortedBarsRef.current = sortedBars;
  terminalBarlinePositionRef.current = terminalBarlinePosition;
  snapshotIndexByIdRef.current = snapshotIndexById;
  barRelativeDraftsRef.current = barRelativeDrafts;
  eventSequenceDraftsRef.current = eventSequenceDrafts;
  tempoBarRelativeDraftsRef.current = tempoBarRelativeDrafts;
  repeatBarRelativeDraftsRef.current = repeatBarRelativeDrafts;

  const setBarRelativeDraftsState = useCallback((updater) => {
    setBarRelativeDrafts((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      barRelativeDraftsRef.current = next;
      return next;
    });
  }, []);

  const setEventSequenceDraftsState = useCallback((updater) => {
    setEventSequenceDrafts((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      eventSequenceDraftsRef.current = next;
      return next;
    });
  }, []);

  const setTempoBarRelativeDraftsState = useCallback((updater) => {
    setTempoBarRelativeDrafts((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      tempoBarRelativeDraftsRef.current = next;
      return next;
    });
  }, []);

  const setRepeatBarRelativeDraftsState = useCallback((updater) => {
    setRepeatBarRelativeDrafts((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      repeatBarRelativeDraftsRef.current = next;
      return next;
    });
  }, []);

  const resetDraftEditingState = useCallback(() => {
    setBarRelativeDraftsState({});
    setEventSequenceDraftsState({});
    setTempoBarRelativeDraftsState({});
    setRepeatBarRelativeDraftsState({});
  }, [
    setBarRelativeDraftsState,
    setEventSequenceDraftsState,
    setTempoBarRelativeDraftsState,
    setRepeatBarRelativeDraftsState,
  ]);

  const updateEventSequenceDraftField = useCallback((draftKey, field, value, meta) => {
    setEventSequenceDraftsState((prev) => updateEventSequenceDrafts(prev, {
      draftKey,
      field,
      value,
      meta,
      snapshotCount: snapshotsRef.current.length,
    }));
  }, [setEventSequenceDraftsState]);

  const cancelEventSequenceDraft = useCallback((draftKey) => {
    setEventSequenceDraftsState((prev) => removeDraftEntry(prev, draftKey));
  }, [setEventSequenceDraftsState]);

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
    const resolved = resolveEventSequenceDraftTarget(draft, snapshotsRef.current);
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

    setEventSequenceDraftsState((prev) => removeDraftEntry(prev, draft.draftKey));
  }, [commitNoteTransfer, setEventSequenceDraftsState]);

  const beatsPerBarForBarNumber = useCallback(
    (barNumber) => Math.max(1, Math.round(Number(timingBarAtNumber(barNumber, sortedBarsRef.current)?.numerator) || 1)),
    [],
  );

  const applyTempoBarRelativeDraft = useCallback((draft) => {
    const position = resolveBarRelativeDraftPosition(
      draft,
      sortedBarsRef.current,
      terminalBarlinePositionRef.current,
    );
    if (position == null) return;
    onUpdateTempo?.(draft.tempoId, { position });
    setTempoBarRelativeDraftsState((prev) => removeDraftEntry(prev, draft.draftKey));
    notifyEditCommitted?.();
  }, [notifyEditCommitted, onUpdateTempo, setTempoBarRelativeDraftsState]);

  const applyRepeatBarRelativeDraft = useCallback((draft) => {
    const position = resolveBarRelativeDraftPosition(
      draft,
      sortedBarsRef.current,
      terminalBarlinePositionRef.current,
    );
    if (position == null) return;
    onUpdateRepeat?.(draft.repeatId, { position });
    setRepeatBarRelativeDraftsState((prev) => removeDraftEntry(prev, draft.draftKey));
    notifyEditCommitted?.();
  }, [notifyEditCommitted, onUpdateRepeat, setRepeatBarRelativeDraftsState]);

  const applyEventBarRelativeDraft = useCallback((draft) => {
    if (!draft) return;
    const snapshot = snapshotsRef.current.find((entry) => entry.id === draft.snapshotId);
    if (!snapshot) return;
    const absoluteTime = resolveBarRelativeDraftPosition(
      draft,
      sortedBarsRef.current,
      terminalBarlinePositionRef.current,
    );
    if (absoluteTime == null) return;
    const notes = applyEventBarRelativeDraftToSnapshot(
      snapshot,
      draft,
      absoluteTime,
      snapshotIndexByIdRef.current.get(snapshot.id) ?? 1,
    );
    const snapshotNumber = snapshotIndexByIdRef.current.get(snapshot.id) ?? 1;
    const snapshotLength = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
    const previousNote = (snapshot.notes ?? []).find((note) => noteIdentity(note, snapshotLength) === draft.noteKey) ?? null;
    const nextNote = (notes ?? []).find((note) => noteIdentity(note, snapshotLength) === draft.noteKey) ?? null;
    appendPersistedSequencerCrashDiagnostic({
      type: "event-bar-relative-commit",
      detail: "Committed sequencer bar-relative event timing",
      context: {
        source: "sequencer",
        snapshotId: draft.snapshotId,
        noteKey: draft.noteKey,
        kind: draft.kind,
        draftKey: draft.draftKey,
        barNumber: draft.barNumber,
        beat: draft.beat,
        numerator: draft.numerator,
        denominator: draft.denominator,
        absoluteTime,
        snapshotTime: absoluteTime - snapshotNumber,
        snapshotLength: snapshot?.length,
        previousStart: previousNote?.start,
        previousEnd: previousNote?.end,
        nextStart: nextNote?.start,
        nextEnd: nextNote?.end,
      },
    });
    onUpdateSnapshot(snapshot.id, { notes });
    setBarRelativeDraftsState((prev) => removeDraftEntry(prev, draft.draftKey));
    notifyEditCommitted?.();
  }, [notifyEditCommitted, onUpdateSnapshot, setBarRelativeDraftsState]);

  const updateEventBarRelativeDraftField = useCallback((draftKey, barBeat, field, value, meta) => {
    setBarRelativeDraftsState((prev) => updateBarRelativeDrafts(prev, {
      draftKey,
      barBeat,
      field,
      value,
      meta,
      scopePrefix: "event",
      beatsPerBarForBarNumber,
    }));
  }, [beatsPerBarForBarNumber, setBarRelativeDraftsState]);

  const cancelEventBarRelativeDraft = useCallback((draftKey) => {
    setBarRelativeDraftsState((prev) => removeDraftEntry(prev, draftKey));
  }, [setBarRelativeDraftsState]);

  const updateTempoBarRelativeDraftField = useCallback((draftKey, barBeat, field, value, meta) => {
    setTempoBarRelativeDraftsState((prev) => updateBarRelativeDrafts(prev, {
      draftKey,
      barBeat,
      field,
      value,
      meta,
      scopePrefix: "tempo",
      beatsPerBarForBarNumber,
    }));
  }, [beatsPerBarForBarNumber, setTempoBarRelativeDraftsState]);

  const cancelTempoBarRelativeDraft = useCallback((draftKey) => {
    setTempoBarRelativeDraftsState((prev) => removeDraftEntry(prev, draftKey));
  }, [setTempoBarRelativeDraftsState]);

  const updateRepeatBarRelativeDraftField = useCallback((draftKey, barBeat, field, value, meta) => {
    setRepeatBarRelativeDraftsState((prev) => updateBarRelativeDrafts(prev, {
      draftKey,
      barBeat,
      field,
      value,
      meta,
      scopePrefix: "repeat",
      beatsPerBarForBarNumber,
    }));
  }, [beatsPerBarForBarNumber, setRepeatBarRelativeDraftsState]);

  const cancelRepeatBarRelativeDraft = useCallback((draftKey) => {
    setRepeatBarRelativeDraftsState((prev) => removeDraftEntry(prev, draftKey));
  }, [setRepeatBarRelativeDraftsState]);

  const commitTempoBarRelativeDraft = useCallback((_tempoId, draftKey) => {
    const draft = tempoBarRelativeDraftsRef.current[draftKey];
    if (!draft) return;
    applyTempoBarRelativeDraft(draft);
  }, [applyTempoBarRelativeDraft]);

  const commitRepeatBarRelativeDraft = useCallback((_repeatId, draftKey) => {
    const draft = repeatBarRelativeDraftsRef.current[draftKey];
    if (!draft) return;
    applyRepeatBarRelativeDraft(draft);
  }, [applyRepeatBarRelativeDraft]);

  const commitEventBarRelativeDraft = useCallback((snapshot, noteKey, kind, draftKey) => {
    const draft = barRelativeDraftsRef.current[draftKey];
    if (!draft) return;
    applyEventBarRelativeDraft({
      ...draft,
      snapshotId: snapshot.id,
      noteKey,
      kind,
    });
  }, [applyEventBarRelativeDraft]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      const targetScope = resolveDraftScopeTarget(event, "data-event-sequence-draft-scope");
      commitForeignDrafts(eventSequenceDraftsRef.current, targetScope, applyEventSequenceDraft);
    };

    document.addEventListener(DRAFT_COMMIT_EVENT, handlePointerDown, true);
    return () => {
      document.removeEventListener(DRAFT_COMMIT_EVENT, handlePointerDown, true);
    };
  }, [applyEventSequenceDraft]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      const targetScope = resolveDraftScopeTarget(event, "data-bar-relative-draft-scope");
      commitForeignDrafts(barRelativeDraftsRef.current, targetScope, applyEventBarRelativeDraft);
      commitForeignDrafts(tempoBarRelativeDraftsRef.current, targetScope, applyTempoBarRelativeDraft);
      commitForeignDrafts(repeatBarRelativeDraftsRef.current, targetScope, applyRepeatBarRelativeDraft);
    };

    document.addEventListener(DRAFT_COMMIT_EVENT, handlePointerDown, true);
    return () => {
      document.removeEventListener(DRAFT_COMMIT_EVENT, handlePointerDown, true);
    };
  }, [applyEventBarRelativeDraft, applyTempoBarRelativeDraft, applyRepeatBarRelativeDraft]);

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
