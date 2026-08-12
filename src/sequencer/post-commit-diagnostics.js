// This hook owns sequencer post-commit crash diagnostics.
// It derives the first stable event/view state after an edit commit and writes
// persisted diagnostics so intermittent sequencing crashes remain traceable.

import { useEffect, useRef } from "preact/hooks";
import {
  appendPersistedSequenceRuntimeDiagnostic,
  isSequenceRuntimeDiagnosticsEnabled,
} from "../debug/sequence-runtime-diagnostics.js";
import {
  appendPersistedSequencerCrashDiagnostic,
  isSequencerCrashDiagnosticsEnabled,
  loadPersistedSequencerCrashDiagnostics,
  readSequencerDiagnosticMemory,
} from "../debug/sequencer-crash-diagnostics.js";
import { absolutePositionToBarBeat } from "./transport.js";

export default function useSequencerPostCommitDiagnostics({
  editCommitTick,
  editCommitContext,
  sequenceEvents,
  sortedBars,
  terminalBarlinePosition,
  firstSnapshotCueEventIds,
  snapshotIndexById,
  selectedSnapshotId,
  activeCueIndex,
  playheadStepIndex,
  selectedBarIndex,
  expandedIds,
  sequenceCueGroups,
  showAllEvents,
} = {}) {
  const lastPostCommitFrameLoggedRef = useRef(0);
  const lastUiCommitLoggedRef = useRef(0);
  const lastDerivedTransactionIdRef = useRef(null);
  const commitPerformanceStartRef = useRef(0);

  useEffect(() => {
    if (!isSequenceRuntimeDiagnosticsEnabled()) return;
    if (editCommitTick <= 0) return;
    if (lastUiCommitLoggedRef.current === editCommitTick) return;
    lastUiCommitLoggedRef.current = editCommitTick;
    const now = performance.now();
    commitPerformanceStartRef.current = editCommitContext?.committedAtMs ?? now;
    appendPersistedSequenceRuntimeDiagnostic({
      type: "ui-commit",
      step: "sequencer-post-commit-state",
      durationMs: Math.max(0, now - commitPerformanceStartRef.current),
      snapshotCount: snapshotIndexById.size,
      eventCount: sequenceEvents.length,
      cueCount: sequenceCueGroups.length,
      expandedCount: expandedIds.size,
      detail: "post-commit state",
    });
  }, [
    editCommitTick,
    editCommitContext?.committedAtMs,
    expandedIds.size,
    sequenceCueGroups.length,
    sequenceEvents.length,
    snapshotIndexById.size,
  ]);

  useEffect(() => {
    if (!isSequencerCrashDiagnosticsEnabled()) return;
    const transactionId = editCommitContext?.transactionId ?? null;
    if (!transactionId || lastDerivedTransactionIdRef.current === transactionId) return;
    const persisted = loadPersistedSequencerCrashDiagnostics();
    const lastCommitEntry =
      [...(persisted?.state?.entries ?? [])]
        .reverse()
        .find(
          (entry) =>
            entry?.type === "event-bar-relative-commit" &&
            entry?.context?.transactionId === transactionId,
        ) ?? null;
    if (!lastCommitEntry) return;
    const context = lastCommitEntry.context ?? null;
    if (!context?.snapshotId || !context?.kind) return;
    const matchingEvent =
      sequenceEvents.find(
        (event) =>
          event?.type === "note" &&
          String(event.snapshotId) === String(context.snapshotId) &&
          event.kind === context.kind &&
          ((typeof context.resolvedNoteId === "string" && context.resolvedNoteId
            ? event.noteId === context.resolvedNoteId
            : false) ||
            (typeof context.noteId === "string" && context.noteId
              ? event.noteId === context.noteId
              : false) ||
            (typeof context.noteKey === "string" && context.noteKey
              ? event.noteKey === context.noteKey
              : false)),
      ) ?? null;
    if (!matchingEvent) return;
    lastDerivedTransactionIdRef.current = transactionId;
    const barBeat = absolutePositionToBarBeat(
      matchingEvent.absoluteTime,
      sortedBars,
      matchingEvent.fractionDenominator,
      9,
      terminalBarlinePosition,
      matchingEvent.kind === "release",
      true,
    );
    const courtesyStart =
      !matchingEvent.cueDisplayLead &&
      firstSnapshotCueEventIds.get(`${matchingEvent.snapshotId}:${matchingEvent.cueIndex}`) ===
        matchingEvent.eventId;
    appendPersistedSequencerCrashDiagnostic({
      type: "event-derived-post-commit",
      detail: "Derived sequencer event after bar-relative commit",
      context: {
        ...context,
        commitToEffectMs: Math.max(
          0,
          performance.now() - (editCommitContext?.committedAtMs ?? performance.now()),
        ),
        ...readSequencerDiagnosticMemory(),
        eventRelativeTime: matchingEvent.relativeTime,
        eventAbsoluteTime: matchingEvent.absoluteTime,
        snapshotIndex: (snapshotIndexById.get(matchingEvent.snapshotId) ?? 1) - 1,
        cueIndex: matchingEvent.cueIndex,
        cueDisplayLead: matchingEvent.cueDisplayLead === true,
        courtesyStart,
        derivedBarNumber: barBeat?.barNumber,
        derivedBeat: barBeat?.beat,
        derivedNumerator: barBeat?.numerator,
        derivedDenominator: barBeat?.denominator,
      },
    });
  }, [
    editCommitTick,
    editCommitContext?.committedAtMs,
    editCommitContext?.transactionId,
    firstSnapshotCueEventIds,
    sequenceEvents,
    snapshotIndexById,
    sortedBars,
    terminalBarlinePosition,
  ]);

  useEffect(() => {
    if (!isSequencerCrashDiagnosticsEnabled()) return undefined;
    if (editCommitTick <= 0) return undefined;
    if (lastPostCommitFrameLoggedRef.current === editCommitTick) return undefined;
    lastPostCommitFrameLoggedRef.current = editCommitTick;
    appendPersistedSequencerCrashDiagnostic({
      type: "sequencer-post-commit-state",
      detail: "Derived sequencer UI state after edit commit",
      context: {
        source: "sequencer",
        transactionId: editCommitContext?.transactionId,
        commitKind: editCommitContext?.commitKind,
        commitToEffectMs: Math.max(
          0,
          performance.now() - (editCommitContext?.committedAtMs ?? performance.now()),
        ),
        ...readSequencerDiagnosticMemory(),
        effectStage: "state",
        selectedSnapshotId,
        activeCueIndex,
        playheadStepIndex,
        playheadBarIndex: selectedBarIndex,
        expandedCount: expandedIds.size,
        sequenceEventCount: sequenceEvents.length,
        cueGroupCount: sequenceCueGroups.length,
        showAllEvents,
      },
    });
    const frame = window.requestAnimationFrame(() => {
      if (isSequenceRuntimeDiagnosticsEnabled()) {
        appendPersistedSequenceRuntimeDiagnostic({
          type: "ui-frame",
          step: "sequencer-post-commit-frame",
          latencyMs: performance.now() - commitPerformanceStartRef.current,
          snapshotCount: snapshotIndexById.size,
          eventCount: sequenceEvents.length,
          cueCount: sequenceCueGroups.length,
          expandedCount: expandedIds.size,
          detail: "first frame after commit",
        });
      }
      appendPersistedSequencerCrashDiagnostic({
        type: "sequencer-post-commit-frame",
        detail: "Reached first animation frame after edit commit",
        context: {
          source: "sequencer",
          transactionId: editCommitContext?.transactionId,
          commitKind: editCommitContext?.commitKind,
          commitToFrameMs: Math.max(
            0,
            performance.now() - (editCommitContext?.committedAtMs ?? performance.now()),
          ),
          ...readSequencerDiagnosticMemory(),
          effectStage: "frame",
          selectedSnapshotId,
          activeCueIndex,
          playheadStepIndex,
          playheadBarIndex: selectedBarIndex,
          expandedCount: expandedIds.size,
          sequenceEventCount: sequenceEvents.length,
          cueGroupCount: sequenceCueGroups.length,
          showAllEvents,
        },
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeCueIndex,
    editCommitTick,
    editCommitContext?.commitKind,
    editCommitContext?.committedAtMs,
    editCommitContext?.transactionId,
    expandedIds,
    playheadStepIndex,
    selectedBarIndex,
    selectedSnapshotId,
    snapshotIndexById.size,
    sequenceCueGroups.length,
    sequenceEvents.length,
    showAllEvents,
  ]);
}
