// This hook owns sequencer post-commit crash diagnostics.
// It derives the first stable event/view state after an edit commit and writes
// persisted diagnostics so intermittent sequencing crashes remain traceable.

import { useEffect, useRef } from "preact/hooks";
import {
  appendPersistedSequencerCrashDiagnostic,
  isSequencerCrashDiagnosticsEnabled,
  loadPersistedSequencerCrashDiagnostics,
} from "../debug/sequencer-crash-diagnostics.js";
import { absolutePositionToBarBeat } from "./transport.js";

export default function useSequencerPostCommitDiagnostics({
  editCommitTick,
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

  useEffect(() => {
    if (!isSequencerCrashDiagnosticsEnabled()) return;
    const persisted = loadPersistedSequencerCrashDiagnostics();
    const lastCommitEntry = [...(persisted?.state?.entries ?? [])]
      .reverse()
      .find((entry) => entry?.type === "event-bar-relative-commit") ?? null;
    if (!lastCommitEntry) return;
    const context = lastCommitEntry.context ?? null;
    if (!context?.snapshotId || !context?.kind) return;
    const matchingEvent = sequenceEvents.find((event) => (
      event?.type === "note"
      && String(event.snapshotId) === String(context.snapshotId)
      && event.kind === context.kind
      && (
        (typeof context.resolvedNoteId === "string" && context.resolvedNoteId
          ? event.noteId === context.resolvedNoteId
          : false)
        || (typeof context.noteId === "string" && context.noteId
          ? event.noteId === context.noteId
          : false)
        || (typeof context.noteKey === "string" && context.noteKey
          ? event.noteKey === context.noteKey
          : false)
      )
    )) ?? null;
    if (!matchingEvent) return;
    const barBeat = absolutePositionToBarBeat(
      matchingEvent.absoluteTime,
      sortedBars,
      matchingEvent.fractionDenominator,
      9,
      terminalBarlinePosition,
      matchingEvent.kind === "release",
      true,
    );
    const courtesyStart = (
      !matchingEvent.cueDisplayLead
      && firstSnapshotCueEventIds.get(`${matchingEvent.snapshotId}:${matchingEvent.cueIndex}`) === matchingEvent.eventId
    );
    appendPersistedSequencerCrashDiagnostic({
      type: "event-derived-post-commit",
      detail: "Derived sequencer event after bar-relative commit",
      context: {
        ...context,
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
      appendPersistedSequencerCrashDiagnostic({
        type: "sequencer-post-commit-frame",
        detail: "Reached first animation frame after edit commit",
        context: {
          source: "sequencer",
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
    expandedIds,
    playheadStepIndex,
    selectedBarIndex,
    selectedSnapshotId,
    sequenceCueGroups.length,
    sequenceEvents.length,
    showAllEvents,
  ]);
}
