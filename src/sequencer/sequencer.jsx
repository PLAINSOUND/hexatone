import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import SequenceInfo from "./sequence-info.jsx";
import SequenceLibrary from "./sequence-library.jsx";
import SequenceControls from "./sequence-controls.jsx";
import SnapshotSequenceItem from "./snapshot-sequence-item.jsx";
import BarRow from "./bar-row.jsx";
import TempoRow from "./tempo-row.jsx";
import RepeatRow from "./repeat-row.jsx";
import {
  buildSnapshotCopyBlock,
  resolveSnapshotCopyRange,
} from "./snapshot-workspace-runtime.js";
import {
  absolutePositionToBarBeat,
} from "./transport.js";
import {
  barDisplayBucket,
  buildBarNumberById,
  buildStructuralMarkersByDisplayBucket,
  normalizeTempoBeatFraction,
} from "./transport-runtime.js";
import {
  buildFirstCueTimeBySnapshotIndex,
  buildFirstEventIdByCueIndex,
  buildFirstSnapshotCueEventIds,
  buildSnapshotEventsById,
} from "./timeline-runtime.js";
import { derivePlayheadNavigationState } from "./playhead-runtime.js";
import { deriveTempoAtSequencePosition } from "./playback-timeline.js";
import { buildDependencyToken } from "./dependency-token.js";
import { buildSequenceRuntimeModel } from "./runtime-model.js";
import useTimedTransportController from "./timed-transport-controller.js";
import { createTimedPlaybackVisualPresenter } from "./timed-playback-visual-presenter.js";
import useSequencerAutoscroll from "./autoscroll-controller.js";
import useDraftEditingController from "./draft-editing-controller.js";
import useEditCommitTransportController from "./edit-commit-transport-controller.js";
import useSequencerPostCommitDiagnostics from "./post-commit-diagnostics.js";
import useTimedUiDiagnostics from "./timed-ui-diagnostics.js";
import {
  estimateSequenceGroupHeight,
  useSequenceVirtualization,
} from "./sequence-virtualization.js";
import {
  buildCueExpandedSnapshotIdsAt,
  deriveCueExpandedSnapshotIds,
  deriveExpandedSnapshotIds,
  deriveSoundingAttackEventIds,
  sameSnapshotSet,
} from "./view-runtime.js";
import {
  commitTextInput,
  noteMatchesReference,
  structuralEventInstanceKey,
  structuralEventRenderKey,
} from "./value-runtime.js";
import {
  eventBarRelativeDraftKey,
  eventSequenceDraftKey,
  repeatBarRelativeDraftKey,
  tempoBarRelativeDraftKey,
} from "./sequence-drafts.js";
import {
  commitEventPitchLabelInSnapshot,
  restoreEventPitchLabelInSnapshot,
  updateEventFieldInSnapshot,
} from "./sequence-mutations.js";

/**
 * Sequencer — sidebar workspace for building, editing, and auditioning
 * sequence structure from captured snapshots while keeping the live Hexatone
 * canvas active.
 */
const Sequencer = ({
  snapshots,
  runtimeModel = null,
  displaySnapshots,
  playbackSnapshots,
  bars,
  repeats,
  tempi,
  snapshotLabelMode,
  activeSequenceSource,
  activeSequenceBuiltInName,
  activeSequenceName,
  activeSequenceSavedName,
  activeSequenceDescription,
  sequenceLegato,
  sequencePlaybackSpeed = 1,
  sequencePlaybackPitchOffset = 0,
  sequencePlayRepeats = true,
  snapSequenceToCurrentTuning,
  sequenceAutoCreateBars,
  selectedSnapshotId,
  selectedMarker,
  pendingTransportSelection = null,
  playingSnapshotId,
  playhead,
  onTakeSnapshot,
  onAddEmptySnapshot,
  onLoadSequence,
  onSequenceNameChange,
  onSequenceDescriptionChange,
  onSequenceSaved,
  onSequenceLegatoChange,
  onSequencePlaybackSpeedChange,
  onSequencePlaybackPitchOffsetChange,
  onSequencePlaybackPitchOffsetPreview,
  onSequencePlayRepeatsChange,
  onSnapSequenceToCurrentTuningChange,
  onSequenceAutoCreateBarsChange,
  onSetSnapshotLabelMode,
  onSelectSnapshot,
  onSelectMarker,
  onPlaySnapshot,
  onStopSnapshot,
  onSelectSequenceBar,
  onCueSequenceSnapshot,
  onCueSequenceCue,
  onStepSequence,
  onStepSequenceMarker,
  onJumpSequenceSnapshot,
  onJumpSequenceCue,
  onPlaySequence,
  onPlayCue,
  onPlayTimedCue,
  onResetSequencePlayhead,
  onJumpSequenceEnd,
  getTimedTransportClockSeconds,
  onAddBar,
  onAddTempo,
  onAddRepeat,
  onAddBarsBeforeSnapshots,
  onDeleteBar,
  onDeleteTempo,
  onDeleteRepeat,
  onUpdateBar,
  onUpdateTempo,
  onUpdateRepeat,
  onMoveBar,
  onDeleteSnapshot,
  onDeleteAllSnapshots,
  onClearSequence,
  onMoveSnapshot,
  onDuplicateSnapshot,
  onInsertSnapshotCopyBlock,
  onResetSnapshotRangeNoteOffsetsInPlace,
  onDeleteSnapshotRange,
  onUpdateSnapshot,
  onResetSnapshotDescription,
}) => {
  const renderStartedAtMs = performance.now();
  const formatTransportClock = useCallback((seconds) => {
    const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const secs = String(totalSeconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${secs}`;
  }, []);

  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [showAllEvents, setShowAllEvents] = useState(true);
  const [sequenceSaveActionState, setSequenceSaveActionState] = useState({
    visible: false,
    label: "",
    action: null,
  });
  const [topSequenceSaveVisible, setTopSequenceSaveVisible] = useState(false);
  const [newBarPosition, setNewBarPosition] = useState("1");
  const [newTempoPosition, setNewTempoPosition] = useState("1.000000");
  const [newRepeatPosition, setNewRepeatPosition] = useState("1.000000");
  const [newTempoBpm, setNewTempoBpm] = useState("60");
  const [newBarNumerator, setNewBarNumerator] = useState("4");
  const [newBarDenominator, setNewBarDenominator] = useState("4");
  const [newBarPositionIsSuggested, setNewBarPositionIsSuggested] = useState(true);
  const [newBarMeterIsSuggested, setNewBarMeterIsSuggested] = useState(true);
  const [confirmClearSnapshots, setConfirmClearSnapshots] = useState(false);
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverSide, setDragOverSide] = useState("before");
  const [draggedId, setDraggedId] = useState(null);
  const [draggedBarId, setDraggedBarId] = useState(null);
  const [draggedEventId, setDraggedEventId] = useState(null);
  const [eventPane, setEventPane] = useState("timing");
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [compactSelectionPreviewSuppressedId, setCompactSelectionPreviewSuppressedId] = useState(null);
  const [copyRangeStart, setCopyRangeStart] = useState("1");
  const [copyRangeEnd, setCopyRangeEnd] = useState("1");
  const [copyInsertPosition, setCopyInsertPosition] = useState("1");
  const [copyInsertBarNumber, setCopyInsertBarNumber] = useState("1");
  const [copyIncludeBars, setCopyIncludeBars] = useState(false);
  const [copyIncludeTempi, setCopyIncludeTempi] = useState(false);
  const [copyIncludeRepeats, setCopyIncludeRepeats] = useState(false);
  const [copyResetNoteOffsets, setCopyResetNoteOffsets] = useState(false);
  const [copiedSnapshotBlock, setCopiedSnapshotBlock] = useState(null);
  const [copyInsertStatus, setCopyInsertStatus] = useState("");
  const dragIdRef = useRef(null);
  const barDragIdRef = useRef(null);
  const eventDragRef = useRef(null);
  const timedVisualCueHandlerRef = useRef(null);
  const timedVisualPresenterRef = useRef(null);
  const duplicateNoteIdRef = useRef(0);

  // Derived sequence/timeline state.
  const sequenceRuntime = useMemo(() => (
    runtimeModel ?? buildSequenceRuntimeModel({
      snapshots,
      displaySnapshots,
      playbackSnapshots,
      bars,
      tempi,
      repeats,
      sequenceLegato,
      source: "sequencer",
    })
  ), [
    bars,
    displaySnapshots,
    playbackSnapshots,
    repeats,
    runtimeModel,
    sequenceLegato,
    snapshots,
    tempi,
  ]);
  const renderedSnapshots = sequenceRuntime.renderedSnapshots;
  const effectivePlaybackSnapshotSource = playbackSnapshots ?? snapshots;
  const playbackRuntimeToken = useMemo(() => buildDependencyToken([
    effectivePlaybackSnapshotSource,
    bars,
    tempi,
    repeats,
  ]), [
    bars,
    effectivePlaybackSnapshotSource,
    repeats,
    tempi,
  ]);
  const timedTriggerToken = useMemo(() => buildDependencyToken([
    playbackRuntimeToken,
    sequenceLegato,
  ]), [playbackRuntimeToken, sequenceLegato]);
  const sortedBars = sequenceRuntime.sortedBars;
  const suggestedBarPosition = useMemo(() => {
    const snapshotEndPosition = Math.max(1, snapshots.length + 1);
    const lastBarPosition = sortedBars.length > 0
      ? Math.max(...sortedBars.map((bar) => Math.round(Number(bar?.position) || 1)))
      : 0;
    return String(Math.max(snapshotEndPosition, lastBarPosition + 1));
  }, [snapshots.length, sortedBars]);
  const suggestedBarMeter = useMemo(() => {
    const targetPosition = Math.max(1, Number(suggestedBarPosition) || 1);
    const previousBar = [...sortedBars]
      .filter((bar) => Number(bar.position) < targetPosition)
      .at(-1);
    return {
      numerator: String(previousBar?.numerator ?? 4),
      denominator: String(previousBar?.denominator ?? 4),
    };
  }, [sortedBars, suggestedBarPosition]);
  const sortedTempi = sequenceRuntime.sortedTempi;
  const sequenceEvents = sequenceRuntime.sequenceEvents;
  const sequenceCueGroups = sequenceRuntime.sequenceCueGroups;
  const terminalBarlinePosition = sequenceRuntime.terminalBarlinePosition;
  const tempoTransitionCueMap = sequenceRuntime.tempoTransitionCueMap;
  const explicitBarPositions = useMemo(() => sortedBars.map((bar) => ({
    position: Math.round(Number(bar?.position) || 1),
    barNumber: absolutePositionToBarBeat(Number(bar?.position) || 1, sortedBars, 1, 9, terminalBarlinePosition)?.barNumber ?? 1,
  })), [sortedBars, terminalBarlinePosition]);
  const formatTransportBarBeat = useCallback((position) => {
    const resolved = absolutePositionToBarBeat(position, sortedBars, 1, 9, terminalBarlinePosition);
    if (!resolved) return "1:1";
    const fraction = resolved.numerator > 0 ? ` ${resolved.numerator}/${resolved.denominator}` : "";
    return `${resolved.barNumber}:${resolved.beat}${fraction}`;
  }, [sortedBars, terminalBarlinePosition]);
  const describeTransportTempo = useCallback((position, speedMultiplier = 1) => {
    const tempo = deriveTempoAtSequencePosition(
      position,
      sortedTempi,
      sortedBars,
      terminalBarlinePosition,
    );
    if (!tempo) return null;
    return {
      ...tempo,
      effectiveBpm: Math.round(tempo.bpm * Math.max(0, Number(speedMultiplier) || 1) * 10) / 10,
    };
  }, [sortedBars, sortedTempi, terminalBarlinePosition]);
  const sequenceRepeatSections = sequenceRuntime.sequenceRepeatSections;
  const timedPlaybackBursts = sequenceRuntime.timedPlaybackBursts;
  const timedCueTriggers = sequenceRuntime.timedCueTriggers;
  const timedCueTriggerBySourceIndex = sequenceRuntime.timedCueTriggerBySourceIndex;

  const {
    playheadIsOff,
    playheadIsEnd,
    playheadStepIndex,
    playheadMarkerIndex,
    selectedBarIndex,
    nextCueIndexFromBar,
    nextSnapshotIndexFromBar,
    selectedSnapshotPosition,
    activeNavigationMode,
    activeCueIndex,
    activeSnapshotId,
    snapshotSelectValue,
    cueSelectValue,
    impliedPendingSnapshotIndex,
    impliedPendingCueIndex,
    terminalSequenceTarget,
  } = useMemo(() => derivePlayheadNavigationState({
    playhead,
    sortedBars,
    sequenceCueGroups,
    snapshots,
    selectedSnapshotId,
    selectedMarker,
    pendingTransportSelection,
  }), [
    pendingTransportSelection,
    playhead,
    selectedMarker,
    selectedSnapshotId,
    sequenceCueGroups,
    snapshots,
    sortedBars,
  ]);

  const snapshotIndexById = useMemo(() => {
    const entries = renderedSnapshots.map((snapshot, index) => [snapshot.id, index + 1]);
    return new Map(entries);
  }, [renderedSnapshots]);

  const findSnapshotById = useCallback((snapshotId) => (
    snapshots.find((snapshot) => snapshot.id === snapshotId) ?? null
  ), [snapshots]);

  const findNoteInSnapshot = useCallback((snapshot, noteRef) => {
    if (!snapshot) return null;
    const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
    const note = (snapshot.notes ?? []).find((entry) => noteMatchesReference(entry, noteRef, length)) ?? null;
    return note ? { note, length } : null;
  }, []);

  const nextDuplicateNoteId = useCallback((baseId = "note") => {
    duplicateNoteIdRef.current += 1;
    return `${String(baseId)}:copy:${duplicateNoteIdRef.current}`;
  }, []);

  const snapshotEventsById = useMemo(() => buildSnapshotEventsById(sequenceEvents), [sequenceEvents]);

  const firstSnapshotCueEventIds = useMemo(
    () => buildFirstSnapshotCueEventIds(snapshotEventsById),
    [snapshotEventsById],
  );

  const barNumberById = useMemo(() => buildBarNumberById(sortedBars), [sortedBars]);

  const structuralMarkersByDisplayBucket = useMemo(
    () => buildStructuralMarkersByDisplayBucket(sortedBars, sortedTempi, repeats),
    [repeats, sortedBars, sortedTempi],
  );
  const firstStructuralScrollKey = useMemo(() => {
    const orderedBuckets = [...structuralMarkersByDisplayBucket.keys()].sort((left, right) => left - right);
    for (const bucket of orderedBuckets) {
      const firstMarker = structuralMarkersByDisplayBucket.get(bucket)?.[0] ?? null;
      const markerKey = structuralEventRenderKey(firstMarker);
      if (markerKey) return markerKey;
    }
    return null;
  }, [structuralMarkersByDisplayBucket]);
  const firstRepeatStartMarker = useMemo(() => (
    [...(Array.isArray(repeats) ? repeats : [])]
      .filter((repeat) => repeat?.kind === "start")
      .sort((left, right) => Number(left?.position) - Number(right?.position))[0] ?? null
  ), [repeats]);
  const repeatStartBySnapshotId = useMemo(() => {
    const mapping = new Map();
    sequenceRepeatSections.forEach((section) => {
      const cueGroup = sequenceCueGroups[section.startCueIndex] ?? null;
      const snapshotId = cueGroup?.snapshotIndex != null
        ? (snapshots[cueGroup.snapshotIndex]?.id ?? null)
        : null;
      if (snapshotId == null || section.startRepeatId == null || mapping.has(snapshotId)) return;
      mapping.set(snapshotId, structuralEventRenderKey({
        type: "repeat-start",
        repeatId: section.startRepeatId,
      }));
    });
    return mapping;
  }, [sequenceCueGroups, sequenceRepeatSections, snapshots]);
  const repeatStartKeyAtPosition = useCallback((position) => {
    const time = Number(position);
    if (!Number.isFinite(time)) return null;
    const repeat = (Array.isArray(repeats) ? repeats : []).find((entry) => (
      entry?.kind === "start" &&
      Math.abs(Number(entry?.position) - time) < 1e-9
    ));
    return repeat == null
      ? null
      : structuralEventRenderKey({
        type: "repeat-start",
        repeatId: repeat.id,
      });
  }, [repeats]);
  const structuralScrollKeyAtPosition = useCallback((position) => {
    const time = Number(position);
    if (!Number.isFinite(time)) return null;
    for (const markers of structuralMarkersByDisplayBucket.values()) {
      const marker = markers.find((entry) => Math.abs(Number(entry?.position) - time) < 1e-9) ?? null;
      const markerKey = structuralEventRenderKey(marker);
      if (markerKey) return markerKey;
    }
    return null;
  }, [structuralMarkersByDisplayBucket]);

  const firstEventIdByCueIndex = useMemo(
    () => buildFirstEventIdByCueIndex(sequenceEvents),
    [sequenceEvents],
  );
  const firstCueTimeBySnapshotIndex = useMemo(
    () => buildFirstCueTimeBySnapshotIndex(sequenceCueGroups),
    [sequenceCueGroups],
  );

  useEffect(() => {
    if (snapshots.length === 0) {
      setCopyRangeStart("1");
      setCopyRangeEnd("1");
      setCopyInsertPosition("1");
      setCopyInsertBarNumber("1");
      setCopiedSnapshotBlock(null);
      setCopyInsertStatus("");
      return;
    }
    setCopyRangeStart((prev) => {
      const parsed = Math.round(Number(prev) || 0);
      if (parsed >= 1 && parsed <= snapshots.length) return prev;
      return String(selectedSnapshotPosition ?? 1);
    });
    setCopyRangeEnd((prev) => {
      const parsed = Math.round(Number(prev) || 0);
      if (parsed >= 1 && parsed <= snapshots.length) return prev;
      return String(selectedSnapshotPosition ?? snapshots.length);
    });
    setCopyInsertPosition((prev) => {
      const parsed = Math.round(Number(prev) || 0);
      if (parsed >= 1 && parsed <= snapshots.length + 1) return prev;
      return String(snapshots.length + 1);
    });
  }, [selectedSnapshotPosition, snapshots.length]);

  const handleCopyRangeStartInput = useCallback((rawValue) => {
    const nextValue = rawValue;
    setCopyRangeStart(nextValue);
    const nextStart = Math.max(1, Math.round(Number(nextValue) || 1));
    const currentEnd = Math.max(1, Math.round(Number(copyRangeEnd) || 1));
    if (currentEnd < nextStart) {
      setCopyRangeEnd(String(nextStart));
    }
  }, [copyRangeEnd]);

  const handleCopyRangeEndInput = useCallback((rawValue) => {
    const nextEnd = Math.max(1, Math.round(Number(rawValue) || 1));
    const currentStart = Math.max(1, Math.round(Number(copyRangeStart) || 1));
    setCopyRangeEnd(String(nextEnd));
    if (nextEnd < currentStart) {
      setCopyRangeStart(String(nextEnd));
    }
  }, [copyRangeStart]);

  const derivedInsertBarBeat = useMemo(() => {
    const position = Math.round(Number(copyInsertPosition) || 1);
    return absolutePositionToBarBeat(position, sortedBars, 1, 9, terminalBarlinePosition);
  }, [copyInsertPosition, sortedBars, terminalBarlinePosition]);

  const derivedInsertBarNumber = derivedInsertBarBeat?.barNumber ?? 1;
  const insertIsInsideBar = useMemo(() => {
    const position = Math.round(Number(copyInsertPosition) || 1);
    return !sortedBars.some((bar) => Math.abs((Number(bar?.position) || 0) - position) < 1e-9)
      && position > 1
      && position <= snapshots.length;
  }, [copyInsertPosition, snapshots.length, sortedBars]);

  useEffect(() => {
    setCopyInsertBarNumber(insertIsInsideBar ? `[${derivedInsertBarNumber}]` : String(derivedInsertBarNumber));
  }, [derivedInsertBarNumber, insertIsInsideBar]);

  const resolvedCopyRange = useMemo(() => resolveSnapshotCopyRange({
    snapshots,
    bars,
    startPosition: copyRangeStart,
    endPosition: copyRangeEnd,
    includeBars: copyIncludeBars,
  }), [bars, copyIncludeBars, copyRangeEnd, copyRangeStart, snapshots]);

  const copyInsertAtBarBoundary = useMemo(() => {
    const position = Math.round(Number(copyInsertPosition) || 0);
    if (position === 1 || position === snapshots.length + 1) return true;
    return bars.some((bar) => Math.abs((Number(bar?.position) || 0) - position) < 1e-9);
  }, [bars, copyInsertPosition, snapshots.length]);

  const copySummaryText = useMemo(() => {
    if (!resolvedCopyRange?.valid) {
      return "";
    }
    return (
      (resolvedCopyRange.startPosition === resolvedCopyRange.endPosition
        ? `Snapshot ${resolvedCopyRange.startPosition} selected`
        : `Snapshots ${resolvedCopyRange.startPosition}-${resolvedCopyRange.endPosition} selected`)
      + (
        copyIncludeBars
        && (
          resolvedCopyRange.requestedStartPosition !== resolvedCopyRange.startPosition
          || resolvedCopyRange.requestedEndPosition !== resolvedCopyRange.endPosition
        )
          ? " (expanded to full bars)."
          : "."
      )
      + (copiedSnapshotBlock?.includeBars && !copyInsertAtBarBoundary
        ? " Insert position must be at a bar marker, the beginning, or the end."
        : "")
    );
  }, [
    copyIncludeBars,
    copyInsertAtBarBoundary,
    copiedSnapshotBlock?.includeBars,
    resolvedCopyRange,
  ]);

  const resolveBarPositionFromBarNumber = useCallback((rawValue) => {
    const numeric = Math.round(Number(String(rawValue ?? "").replace(/[^\d-]/g, "")) || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    const exact = explicitBarPositions.find((entry) => entry.barNumber === numeric);
    return exact?.position ?? null;
  }, [explicitBarPositions]);

  const snapInsertPositionToBar = useCallback((rawValue) => {
    const numeric = Math.round(Number(rawValue) || 0);
    if (!Number.isFinite(numeric)) return;
    if (numeric <= 1) {
      setCopyInsertPosition("1");
      return;
    }
    if (numeric >= snapshots.length + 1) {
      setCopyInsertPosition(String(snapshots.length + 1));
      return;
    }
    const currentBar = absolutePositionToBarBeat(numeric, sortedBars, 1, 9, terminalBarlinePosition)?.barNumber ?? 1;
    const snapped = resolveBarPositionFromBarNumber(currentBar) ?? 1;
    setCopyInsertPosition(String(snapped));
  }, [resolveBarPositionFromBarNumber, snapshots.length, sortedBars, terminalBarlinePosition]);

  const handleCopySnapshotBlock = useCallback(() => {
    const block = buildSnapshotCopyBlock({
      snapshots,
      bars,
      tempi,
      repeats,
      startPosition: copyRangeStart,
      endPosition: copyRangeEnd,
      includeBars: copyIncludeBars,
      includeTempi: copyIncludeTempi,
      includeRepeats: copyIncludeRepeats,
      resetNoteOffsets: copyResetNoteOffsets,
    });
    if (!block) {
      setCopiedSnapshotBlock(null);
      setCopyInsertStatus("No snapshots available to copy.");
      return;
    }
    setCopiedSnapshotBlock(block);
    setCopyInsertStatus(
      `Copied ${block.length} snapshot${block.length === 1 ? "" : "s"}`
      + `${block.includeBars ? " with bars" : ""}`
      + `${block.includeTempi ? ", tempi" : ""}`
      + `${block.includeRepeats ? ", repeats" : ""}.`,
    );
  }, [
    bars,
    copyIncludeBars,
    copyIncludeRepeats,
    copyIncludeTempi,
    copyRangeEnd,
    copyRangeStart,
    copyResetNoteOffsets,
    repeats,
    snapshots,
    tempi,
  ]);

  const handleInsertSnapshotBlock = useCallback(() => {
    if (!copiedSnapshotBlock) {
      setCopyInsertStatus("Copy a snapshot block first.");
      return;
    }
    const position = Math.round(Number(copyInsertPosition) || 0);
    if (!Number.isFinite(position) || position < 1 || position > snapshots.length + 1) {
      setCopyInsertStatus("Choose a valid insert slot.");
      return;
    }
    const result = onInsertSnapshotCopyBlock?.(copiedSnapshotBlock, position);
    if (result === "bar-boundary-required") {
      setCopyInsertStatus("Bar-inclusive insertion must start at a bar marker, the beginning, or the end.");
      return;
    }
    if (typeof result === "string" && result) {
      setCopyInsertStatus("Unable to insert the copied snapshot block.");
      return;
    }
    setCopyInsertStatus(
      `Inserted ${copiedSnapshotBlock.length} snapshot${copiedSnapshotBlock.length === 1 ? "" : "s"} at slot ${position}.`,
    );
  }, [copiedSnapshotBlock, copyInsertPosition, onInsertSnapshotCopyBlock, snapshots.length]);

  const {
    editCommitTick,
    notifyEditCommitted,
    runTransportAction,
  } = useEditCommitTransportController({
    snapshots,
  });

  const sequencePlaybackActive = !!playingSnapshotId && playhead?.stopped !== true;
  const soundingAttackEventIds = useMemo(() => {
    return deriveSoundingAttackEventIds({
      sequencePlaybackActive,
      playheadMarkerIndex,
      renderedSnapshots,
      sortedBars,
      sortedTempi,
      activeSnapshotId,
      playingSnapshotId,
    });
  }, [activeSnapshotId, playingSnapshotId, playheadMarkerIndex, renderedSnapshots, sequencePlaybackActive, sortedBars, sortedTempi]);
  const cueExpandedSnapshotIdsAt = useCallback((cueIndexZeroBased) => {
    return buildCueExpandedSnapshotIdsAt(
      cueIndexZeroBased,
      renderedSnapshots,
      sortedBars,
      sortedTempi,
      sequenceEvents,
    );
  }, [renderedSnapshots, sequenceEvents, sortedBars, sortedTempi]);
  const cueExpandedSnapshotIds = useMemo(() => {
    return deriveCueExpandedSnapshotIds({
      activeCueIndex,
      cueExpandedSnapshotIdsAt,
      sequenceEvents,
      soundingAttackEventIds,
    });
  }, [activeCueIndex, cueExpandedSnapshotIdsAt, sequenceEvents, soundingAttackEventIds]);

  const presentTimedCue = useCallback((cueIndex, trigger, burst) => {
    timedVisualCueHandlerRef.current?.(cueIndex, trigger, burst);
  }, []);

  const {
    timedTransportUiState,
    getTimedTransportDisplay,
    handleTimedTransportPlayPause,
    handleTimedTransportStop,
    previewTimedTransportSpeed,
    recordTimedTransportDiagnostic,
  } = useTimedTransportController({
    timedPlaybackBursts,
    timedCueTriggers,
    timedCueTriggerBySourceIndex,
    playbackRuntimeToken,
    timedTriggerToken,
    sequencePlaybackSpeed,
    sequencePlayRepeats,
    pendingTransportSelection,
    playheadMarkerIndex,
    playheadStepIndex,
    playheadIsEnd,
    selectedBarIndex,
    sortedBars,
    formatTransportClock,
    formatTransportBarBeat,
    describeTransportTempo,
    onCueSequenceCue,
    onCueSequenceSnapshot,
    onSelectSequenceBar,
    onPlayCue,
    onPlayTimedCue,
    onPresentTimedCue: presentTimedCue,
    onStopSnapshot,
    getTimedTransportClockSeconds,
  });
  // UI controllers: scroll tracking, timed transport, and row draft editing
  // are split out so this component can remain a composition layer.
  const {
    playbackRowRef,
    scrollPanelRef,
    snapshotRowRefs,
    barRowRefs,
    eventRowRefs,
    transportScrollTargetRef,
    armPendingSnapshot,
    armPendingCue,
    ensureExpanded,
    resetSequencePlayheadAndScrollTop,
    jumpSequencePlayheadToEndAndScrollBottom,
    scrollNodeIntoPanel,
  } = useSequencerAutoscroll({
    autoScrollEnabled,
    activeCueIndex,
    activeSnapshotId,
    playheadStepIndex,
    playheadIsOff,
    selectedBarIndex,
    sortedBars,
    snapshots,
    sequenceEvents,
    sequenceCueGroups,
    sequenceRepeatSections,
    cueExpandedSnapshotIds,
    cueExpandedSnapshotIdsAt,
    firstCueTimeBySnapshotIndex,
    firstEventIdByCueIndex,
    firstRepeatStartMarker,
    firstStructuralScrollKey,
    repeatStartBySnapshotId,
    repeatStartKeyAtPosition,
    structuralScrollKeyAtPosition,
    showAllEvents,
    setExpandedIds,
    onCueSequenceSnapshot,
    onCueSequenceCue,
    onSelectSequenceBar,
    onResetSequencePlayhead,
    onJumpSequenceEnd,
    recordTimedTransportDiagnostic,
  });

  const virtualSequenceItems = useMemo(() => renderedSnapshots.map((snapshot, index) => {
    const snapshotEvents = snapshotEventsById.get(snapshot.id) ?? [];
    const expanded = showAllEvents || expandedIds.has(snapshot.id);
    const embeddedStructuralKeys = expanded
      ? new Set(snapshotEvents
        .filter((event) => event.type === "bar" || event.type === "tempo" || event.type === "repeat-start" || event.type === "repeat-end")
        .map((event) => structuralEventRenderKey(event)))
      : new Set();
    const structuralCount = (structuralMarkersByDisplayBucket.get(index) ?? [])
      .filter((marker) => !embeddedStructuralKeys.has(structuralEventRenderKey(marker)))
      .length;
    return {
      key: snapshot.id,
      snapshot,
      estimatedSize: estimateSequenceGroupHeight({
        expanded,
        eventCount: snapshotEvents.length,
        structuralCount,
      }),
    };
  }), [expandedIds, renderedSnapshots, showAllEvents, snapshotEventsById, structuralMarkersByDisplayBucket]);
  const virtualPinnedIndexes = useMemo(() => {
    const pinnedIds = new Set([
      selectedSnapshotId,
      activeSnapshotId,
      playingSnapshotId,
      draggedId,
    ].filter((id) => id != null));
    const indexes = [];
    renderedSnapshots.forEach((snapshot, index) => {
      if (pinnedIds.has(snapshot.id)) indexes.push(index);
    });
    const selectedBarBucket = barDisplayBucket(sortedBars[selectedBarIndex]?.position);
    if (selectedBarBucket >= 0 && selectedBarBucket < renderedSnapshots.length) {
      indexes.push(selectedBarBucket);
    }
    return indexes;
  }, [activeSnapshotId, draggedId, playingSnapshotId, renderedSnapshots, selectedBarIndex, selectedSnapshotId, sortedBars]);
  const sequenceVirtualization = useSequenceVirtualization({
    scrollPanelRef,
    items: virtualSequenceItems,
    pinnedIndexes: virtualPinnedIndexes,
  });
  const {
    layout: virtualSequenceLayout,
    measureItem: measureVirtualSequenceItem,
    ensureIndexVisible: ensureVirtualSequenceIndexVisible,
  } = sequenceVirtualization;
  const renderedSnapshotIndexById = useMemo(() => new Map(
    renderedSnapshots.map((snapshot, index) => [snapshot.id, index]),
  ), [renderedSnapshots]);
  const prepareVirtualSnapshotRow = useCallback((snapshotId) => {
    const index = renderedSnapshotIndexById.get(snapshotId);
    return index == null ? false : ensureVirtualSequenceIndexVisible(index);
  }, [ensureVirtualSequenceIndexVisible, renderedSnapshotIndexById]);

  useEffect(() => {
    const setTransportField = (field, value) => {
      const select = playbackRowRef.current?.querySelector?.(
        `[data-timed-transport-field="${field}"]`,
      ) ?? null;
      if (select && value != null) select.value = String(value);
    };
    const presenter = createTimedPlaybackVisualPresenter({
      resolveSnapshotRow: (snapshotId) => snapshotRowRefs.current.get(snapshotId) ?? null,
      resolveEventRow: (eventId) => eventRowRefs.current.get(eventId) ?? null,
      prepareSnapshotRow: prepareVirtualSnapshotRow,
      scrollSnapshotRow: scrollNodeIntoPanel,
      presentTransportPosition: (position) => {
        setTransportField("bar", position?.barIndex);
        setTransportField("snapshot", position?.snapshotIndex);
        setTransportField("cue", position?.cueIndex);
      },
      clearTransportPosition: () => {
        setTransportField("bar", playhead?.barIndex ?? 0);
        setTransportField("snapshot", snapshotSelectValue);
        setTransportField("cue", cueSelectValue);
      },
    });
    timedVisualPresenterRef.current = presenter;
    timedVisualCueHandlerRef.current = (cueIndex, trigger, burst) => {
      const cueGroup = sequenceCueGroups[cueIndex] ?? null;
      const snapshotIndex = cueGroup?.snapshotIndex ?? null;
      const snapshotId = cueGroup == null
        ? null
        : (snapshots[snapshotIndex]?.id ?? null);
      const soundingNotesForScroll = [
        ...(Array.isArray(burst?.soundingBefore) ? burst.soundingBefore : []),
        ...(Array.isArray(burst?.soundingAfter) ? burst.soundingAfter : []),
      ];
      const earliestSoundingSnapshotIndex = soundingNotesForScroll.length > 0
        ? soundingNotesForScroll.reduce((earliest, note) => {
          if (!Number.isFinite(note?.snapshotIndex)) return earliest;
          const noteSnapshotIndex = Number(note.snapshotIndex);
          return earliest == null ? noteSnapshotIndex : Math.min(earliest, noteSnapshotIndex);
        }, null)
        : null;
      const scrollSnapshotIndex = Number.isFinite(earliestSoundingSnapshotIndex)
        ? Math.min(snapshotIndex ?? earliestSoundingSnapshotIndex, earliestSoundingSnapshotIndex)
        : snapshotIndex;
      const sequenceTime = Number(burst?.sequenceTime ?? trigger?.sequenceTime);
      const barBeat = Number.isFinite(sequenceTime)
        ? absolutePositionToBarBeat(sequenceTime, sortedBars, 1, 9, terminalBarlinePosition)
        : null;
      presenter.enqueue({
        snapshotId,
        scrollSnapshotId: snapshots[scrollSnapshotIndex]?.id ?? snapshotId,
        scrollSnapshotIndex,
        soundingEventIds: Array.isArray(burst?.soundingAfter)
          ? burst.soundingAfter.map((note) => note?.eventId).filter((eventId) => eventId != null)
          : [],
        transport: {
          barIndex: Number.isFinite(barBeat?.barNumber) ? barBeat.barNumber - 1 : null,
          snapshotIndex,
          cueIndex,
        },
      });
    };

    return () => {
      timedVisualCueHandlerRef.current = null;
      timedVisualPresenterRef.current = null;
      presenter.dispose({ restoreTransport: false });
    };
  }, [
    cueSelectValue,
    eventRowRefs,
    playbackRowRef,
    playhead?.barIndex,
    prepareVirtualSnapshotRow,
    scrollNodeIntoPanel,
    sequenceCueGroups,
    snapshotRowRefs,
    snapshotSelectValue,
    snapshots,
    sortedBars,
    terminalBarlinePosition,
  ]);

  useEffect(() => {
    if (timedTransportUiState.running) return;
    timedVisualPresenterRef.current?.clear();
  }, [timedTransportUiState.running]);

  useEffect(() => {
    const nextExpandedIds = deriveExpandedSnapshotIds({
      showAllEvents,
      cueExpandedSnapshotIdsAt,
      playheadIsOff,
      playheadIsEnd,
      selectedSnapshotId,
      activeCueIndex,
      cueExpandedSnapshotIds,
      suppressSelectedSnapshotPreview: (
        !showAllEvents &&
        activeCueIndex == null &&
        selectedSnapshotId != null &&
        compactSelectionPreviewSuppressedId === selectedSnapshotId
      ),
    });
    if (nextExpandedIds == null) return;
    setExpandedIds((prev) => (sameSnapshotSet(prev, nextExpandedIds) ? prev : nextExpandedIds));
  }, [
    activeCueIndex,
    compactSelectionPreviewSuppressedId,
    cueExpandedSnapshotIds,
    cueExpandedSnapshotIdsAt,
    playheadIsEnd,
    playheadIsOff,
    selectedSnapshotId,
    showAllEvents,
  ]);

  useEffect(() => {
    if (showAllEvents || activeCueIndex != null || playheadIsOff || playheadIsEnd) {
      if (compactSelectionPreviewSuppressedId != null) setCompactSelectionPreviewSuppressedId(null);
      return;
    }
    if (selectedSnapshotId == null) {
      if (compactSelectionPreviewSuppressedId != null) setCompactSelectionPreviewSuppressedId(null);
      return;
    }
    if (
      compactSelectionPreviewSuppressedId != null &&
      compactSelectionPreviewSuppressedId !== selectedSnapshotId
    ) {
      setCompactSelectionPreviewSuppressedId(null);
    }
  }, [
    activeCueIndex,
    compactSelectionPreviewSuppressedId,
    playheadIsEnd,
    playheadIsOff,
    selectedSnapshotId,
    showAllEvents,
  ]);

  useSequencerPostCommitDiagnostics({
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
  });

  useTimedUiDiagnostics({
    running: timedTransportUiState.running,
    renderStartedAtMs,
    runtimeInstanceId: sequenceRuntime.runtimeInstanceId,
    scrollPanelRef,
    snapshotRowRefs,
    eventRowRefs,
    barRowRefs,
    snapshotCount: snapshots.length,
    eventCount: sequenceEvents.length,
    cueCount: sequenceCueGroups.length,
    recordDiagnostic: recordTimedTransportDiagnostic,
  });

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => (prev.has(id) ? new Set() : new Set([id])));
  };

  const handleSnapshotRowClick = useCallback((snapshotId, isSelected) => {
    onSelectSnapshot?.(snapshotId);
    if (showAllEvents) {
      setCompactSelectionPreviewSuppressedId(null);
      return;
    }
    if (isSelected) {
      setCompactSelectionPreviewSuppressedId(null);
      toggleExpanded(snapshotId);
      return;
    }
    setCompactSelectionPreviewSuppressedId(snapshotId);
  }, [onSelectSnapshot, showAllEvents]);

  const resolveDropSide = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  };
  const {
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
  } = useDraftEditingController({
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
  });

  useEffect(() => {
    if (snapshots.length > 0 || sortedBars.length > 0 || sortedTempi.length > 0) return;
    setExpandedIds((prev) => (prev.size === 0 ? prev : new Set()));
    resetDraftEditingState();
  }, [resetDraftEditingState, snapshots.length, sortedBars.length, sortedTempi.length]);

  const handleResetSnapshotRangeNoteOffsetsInPlace = useCallback(() => {
    if (!resolvedCopyRange?.valid) {
      setCopyInsertStatus("Choose a valid snapshot range first.");
      return;
    }
    resetDraftEditingState();
    const result = onResetSnapshotRangeNoteOffsetsInPlace?.({
      startPosition: copyRangeStart,
      endPosition: copyRangeEnd,
      includeBars: copyIncludeBars,
    });
    if (typeof result === "string" && result) {
      setCopyInsertStatus("Unable to reset note offsets for the selected range.");
      return;
    }
    setCopyInsertStatus(
      `Reset note offsets in ${resolvedCopyRange.length} snapshot${resolvedCopyRange.length === 1 ? "" : "s"}.`,
    );
  }, [
    copyIncludeBars,
    copyRangeEnd,
    copyRangeStart,
    onResetSnapshotRangeNoteOffsetsInPlace,
    resetDraftEditingState,
    resolvedCopyRange,
  ]);

  const handleDeleteSnapshotRange = useCallback(() => {
    if (!resolvedCopyRange?.valid) {
      setCopyInsertStatus("Choose a valid snapshot range first.");
      return;
    }
    resetDraftEditingState();
    const result = onDeleteSnapshotRange?.({
      startPosition: copyRangeStart,
      endPosition: copyRangeEnd,
      includeBars: copyIncludeBars,
      includeTempi: copyIncludeTempi,
      includeRepeats: copyIncludeRepeats,
    });
    if (typeof result === "string" && result) {
      setCopyInsertStatus("Unable to delete the selected range.");
      return;
    }
    setCopiedSnapshotBlock(null);
    setCopyInsertStatus(
      `Deleted ${resolvedCopyRange.length} snapshot${resolvedCopyRange.length === 1 ? "" : "s"}`
      + `${copyIncludeBars ? " with bars" : ""}`
      + `${copyIncludeTempi ? ", tempi" : ""}`
      + `${copyIncludeRepeats ? ", repeats" : ""}.`,
    );
  }, [
    copyIncludeBars,
    copyIncludeRepeats,
    copyIncludeTempi,
    copyRangeEnd,
    copyRangeStart,
    onDeleteSnapshotRange,
    resetDraftEditingState,
    resolvedCopyRange,
  ]);

  // Local mutation adapters passed down into row components.
  const updateEventField = useCallback((snapshot, noteRef, field, rawValue) => {
    const notes = updateEventFieldInSnapshot(snapshot, noteRef, field, rawValue);
    if (!notes) return;
    onUpdateSnapshot(snapshot.id, { notes });
  }, [onUpdateSnapshot]);

  const restoreEventPitchLabel = useCallback((snapshot, noteRef) => {
    const notes = restoreEventPitchLabelInSnapshot(snapshot, noteRef);
    onUpdateSnapshot(snapshot.id, { notes });
  }, [onUpdateSnapshot]);

  const commitEventPitchLabel = useCallback((snapshot, noteRef) => {
    const notes = commitEventPitchLabelInSnapshot(snapshot, noteRef);
    onUpdateSnapshot(snapshot.id, { notes });
  }, [onUpdateSnapshot]);

  const updateBarPosition = useCallback((barId, rawValue) => {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) return;
    onUpdateBar?.(barId, { position: Math.max(1, Math.round(numeric)) });
  }, [onUpdateBar]);

  const updateTempoPosition = useCallback((tempoId, rawValue) => {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) return;
    onUpdateTempo?.(tempoId, { position: Math.round(numeric * 1000000) / 1000000 });
  }, [onUpdateTempo]);

  const updateRepeatPosition = useCallback((repeatId, rawValue) => {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) return;
    onUpdateRepeat?.(repeatId, { position: Math.round(numeric * 1000000) / 1000000 });
  }, [onUpdateRepeat]);

  const updateRepeatCount = useCallback((repeatId, rawValue) => {
    const numeric = Math.max(2, Math.round(Number(rawValue) || 2));
    if (!Number.isFinite(numeric)) return;
    onUpdateRepeat?.(repeatId, { repeatCount: numeric });
  }, [onUpdateRepeat]);

  const updateTempoBpm = useCallback((tempoId, rawValue) => {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    onUpdateTempo?.(tempoId, { bpm: numeric });
  }, [onUpdateTempo]);

  const updateTempoBeatFraction = useCallback((tempoId, numerator, denominator) => {
    onUpdateTempo?.(tempoId, normalizeTempoBeatFraction(numerator, denominator));
  }, [onUpdateTempo]);

  const updateBarTimeSignatureField = useCallback((barId, field, rawValue) => {
    const parsed = Math.round(Number(rawValue) || 0);
    const numeric = field === "numerator"
      ? Math.max(1, parsed)
      : Math.max(1, parsed);
    if (!Number.isFinite(numeric)) return;
    if (field !== "numerator" && numeric <= 0) return;
    onUpdateBar?.(barId, { [field]: numeric });
  }, [onUpdateBar]);

  const addBarAtRequestedPosition = () => {
    const numeric = Number(newBarPosition);
    const numerator = Math.max(1, Math.round(Number(newBarNumerator) || 1));
    const denominator = Math.max(1, Math.round(Number(newBarDenominator) || 1));
    if (!Number.isFinite(numeric)) return;
    onAddBar?.(Math.max(1, Math.round(numeric)), numerator, denominator);
    setNewBarPosition(suggestedBarPosition);
    setNewBarNumerator(suggestedBarMeter.numerator);
    setNewBarDenominator(suggestedBarMeter.denominator);
    setNewBarPositionIsSuggested(true);
    setNewBarMeterIsSuggested(true);
  };

  const addTempoAtRequestedPosition = () => {
    const position = Number(newTempoPosition);
    const bpm = Number(newTempoBpm);
    if (!Number.isFinite(position) || !Number.isFinite(bpm) || bpm <= 0) return;
    onAddTempo?.(Math.round(position * 1000000) / 1000000, bpm, "immediate");
    setNewTempoPosition("1.000000");
    setNewTempoBpm("60");
  };

  const addTempoTransitionAtRequestedPosition = () => {
    const position = Number(newTempoPosition);
    const bpm = Number(newTempoBpm);
    if (!Number.isFinite(position) || !Number.isFinite(bpm) || bpm <= 0) return;
    onAddTempo?.(Math.round(position * 1000000) / 1000000, bpm, "transition");
    setNewTempoPosition("1.000000");
    setNewTempoBpm("60");
  };

  const addRepeatAtRequestedPosition = (kind) => {
    const position = Number(newRepeatPosition);
    if (!Number.isFinite(position)) return;
    onAddRepeat?.(Math.round(position * 1000000) / 1000000, kind);
    setNewRepeatPosition("1.000000");
  };

  const updateNewBarPosition = (rawValue, isSuggested = false) => {
    setNewBarPosition(rawValue);
    setNewBarPositionIsSuggested(Boolean(isSuggested));
  };

  const updateNewBarMeterField = (field, rawValue) => {
    setNewBarMeterIsSuggested(false);
    const digitsOnly = String(rawValue ?? "").replace(/[^\d]/g, "");
    if (digitsOnly === "") {
      if (field === "numerator") setNewBarNumerator("");
      else setNewBarDenominator("");
      return;
    }
    const parsed = Math.round(Number(digitsOnly) || 0);
    if (field === "numerator") {
      setNewBarNumerator(String(Math.max(1, parsed)));
      return;
    }
    setNewBarDenominator(String(Math.max(1, parsed)));
  };

  useEffect(() => {
    if (!newBarPositionIsSuggested) return;
    setNewBarPosition(suggestedBarPosition);
  }, [newBarPositionIsSuggested, suggestedBarPosition]);

  useEffect(() => {
    if (!newBarMeterIsSuggested) return;
    setNewBarNumerator(suggestedBarMeter.numerator);
    setNewBarDenominator(suggestedBarMeter.denominator);
  }, [newBarMeterIsSuggested, suggestedBarMeter]);

  const handleEnterCommit = useCallback((e, commit) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    commitTextInput(e.currentTarget, commit);
    notifyEditCommitted();
    e.currentTarget.blur();
  }, [notifyEditCommitted]);

  const handleBlurCommit = useCallback((e, commit, afterCommit = null) => {
    commitTextInput(e.currentTarget, commit);
    if (typeof afterCommit === "function") afterCommit();
    notifyEditCommitted();
  }, [notifyEditCommitted]);

  const currentEventPane = eventPane === "expression" ? "expression" : "timing";

  // Row-facing derived maps and prop bundles used during render.
  const barBeatByEventId = useMemo(() => {
    const next = new Map();
    for (const event of sequenceEvents) {
      if (!event?.eventId) continue;
      if (event.type !== "note" && event.type !== "tempo" && event.type !== "repeat-start" && event.type !== "repeat-end") {
        continue;
      }
      const barBeat = absolutePositionToBarBeat(
        event.absoluteTime,
        sortedBars,
        event.type === "note" ? event.fractionDenominator : null,
        9,
        terminalBarlinePosition,
        event.type === "note" && event.kind === "release",
        event.type === "note",
      );
      if (barBeat) next.set(event.eventId, barBeat);
    }
    return next;
  }, [sequenceEvents, sortedBars, terminalBarlinePosition]);

  const barRowDnd = useMemo(() => ({
    draggedBarId,
    barDragIdRef,
    setDraggedBarId,
    onMoveBar,
  }), [draggedBarId, onMoveBar]);

  const barRowEditing = useMemo(() => ({
    onDeleteBar,
    handleEnterCommit,
    handleBlurCommit,
    updateBarPosition,
    updateBarTimeSignatureField,
  }), [
    handleBlurCommit,
    handleEnterCommit,
    onDeleteBar,
    updateBarPosition,
    updateBarTimeSignatureField,
  ]);

  const tempoRowTiming = useMemo(() => ({
    sortedBars,
    sortedTempi,
    terminalBarlinePosition,
    barBeatByEventId,
    tempoBarRelativeDraftKey,
    tempoBarRelativeDrafts,
    tempoTransitionCueMap,
  }), [
    barBeatByEventId,
    sortedBars,
    sortedTempi,
    tempoBarRelativeDrafts,
    tempoTransitionCueMap,
    terminalBarlinePosition,
  ]);

  const repeatRowTiming = useMemo(() => ({
    sortedBars,
    terminalBarlinePosition,
    barBeatByEventId,
    repeatBarRelativeDraftKey,
    repeatBarRelativeDrafts,
  }), [
    barBeatByEventId,
    repeatBarRelativeDrafts,
    sortedBars,
    terminalBarlinePosition,
  ]);

  const tempoRowEditing = useMemo(() => ({
    handleEnterCommit,
    handleBlurCommit,
    updateTempoBeatFraction,
    updateTempoBpm,
    updateTempoPosition,
    updateTempoBarRelativeDraftField,
    commitTempoBarRelativeDraft,
    cancelTempoBarRelativeDraft,
    onDeleteTempo,
  }), [
    cancelTempoBarRelativeDraft,
    commitTempoBarRelativeDraft,
    handleBlurCommit,
    handleEnterCommit,
    onDeleteTempo,
    updateTempoBarRelativeDraftField,
    updateTempoBeatFraction,
    updateTempoBpm,
    updateTempoPosition,
  ]);

  const repeatRowEditing = useMemo(() => ({
    handleEnterCommit,
    handleBlurCommit,
    updateRepeatPosition,
    updateRepeatCount,
    updateRepeatBarRelativeDraftField,
    commitRepeatBarRelativeDraft,
    cancelRepeatBarRelativeDraft,
    onDeleteRepeat,
  }), [
    cancelRepeatBarRelativeDraft,
    commitRepeatBarRelativeDraft,
    handleBlurCommit,
    handleEnterCommit,
    onDeleteRepeat,
    updateRepeatBarRelativeDraftField,
    updateRepeatCount,
    updateRepeatPosition,
  ]);

  const eventRowView = useMemo(() => ({
    findSnapshotById,
    selectedMarker,
    activeNavigationMode,
    activeCueIndex,
    activeSnapshotId,
    sequencePlaybackActive,
    soundingAttackEventIds,
    snapshotIndexById,
    firstSnapshotCueEventIds,
    currentEventPane,
  }), [
    activeCueIndex,
    activeNavigationMode,
    activeSnapshotId,
    currentEventPane,
    findSnapshotById,
    firstSnapshotCueEventIds,
    selectedMarker,
    sequencePlaybackActive,
    snapshotIndexById,
    soundingAttackEventIds,
  ]);

  const eventRowDrafts = useMemo(() => ({
    sortedBars,
    terminalBarlinePosition,
    barBeatByEventId,
    eventBarRelativeDraftKey,
    barRelativeDrafts,
    eventSequenceDraftKey,
    eventSequenceDrafts,
  }), [
    barBeatByEventId,
    barRelativeDrafts,
    eventSequenceDrafts,
    sortedBars,
    terminalBarlinePosition,
  ]);

  const eventRowDrag = useMemo(() => ({
    eventRowRefs,
    barDragIdRef,
    onMoveBar,
    setDraggedBarId,
    eventDragRef,
    setDraggedEventId,
    setDragOverId,
    draggedEventId,
  }), [draggedEventId, eventRowRefs, onMoveBar]);

  const eventRowEditing = useMemo(() => ({
    onSelectMarker,
    deleteEventNote,
    updateEventSequenceDraftField,
    applyEventSequenceDraft,
    cancelEventSequenceDraft,
    updateEventField,
    handleEnterCommit,
    handleBlurCommit,
    snapSequenceToCurrentTuning,
    restoreEventPitchLabel,
    commitEventPitchLabel,
    updateEventBarRelativeDraftField,
    commitEventBarRelativeDraft,
    cancelEventBarRelativeDraft,
  }), [
    cancelEventBarRelativeDraft,
    cancelEventSequenceDraft,
    commitEventBarRelativeDraft,
    commitEventPitchLabel,
    deleteEventNote,
    handleBlurCommit,
    handleEnterCommit,
    onSelectMarker,
    restoreEventPitchLabel,
    snapSequenceToCurrentTuning,
    updateEventBarRelativeDraftField,
    updateEventField,
    updateEventSequenceDraftField,
    applyEventSequenceDraft,
  ]);

  const eventRowTransport = useMemo(() => ({
    playingSnapshotId,
    runTransportAction,
    onPlayCue,
    onStopSnapshot,
  }), [onPlayCue, onStopSnapshot, playingSnapshotId, runTransportAction]);

  const sharedDragState = useMemo(() => ({
    dragOverId,
    dragOverSide,
    draggedId,
    dragIdRef,
    snapshotRowRefs,
    eventDragRef,
    barDragIdRef,
    setDragOverId,
    setDragOverSide,
    setDraggedId,
    setDraggedEventId,
    setDraggedBarId,
    onMoveBar,
  }), [dragOverId, dragOverSide, draggedId, onMoveBar, snapshotRowRefs]);

  const sharedStructure = useMemo(() => ({
    snapshotEventsById,
    structuralMarkersByDisplayBucket,
    barRowRefs,
    barNumberById,
  }), [barNumberById, barRowRefs, snapshotEventsById, structuralMarkersByDisplayBucket]);

  const sharedRows = useMemo(() => ({
    eventPane,
    setEventPane,
    barRowDnd,
    barRowEditing,
    tempoRowTiming,
    tempoRowEditing,
    repeatRowTiming,
    repeatRowEditing,
    eventRowView,
    eventRowDrafts,
    eventRowDrag,
    eventRowEditing,
    eventRowTransport,
  }), [
    barRowDnd,
    barRowEditing,
    eventPane,
    eventRowDrafts,
    eventRowDrag,
    eventRowEditing,
    eventRowTransport,
    eventRowView,
    repeatRowEditing,
    repeatRowTiming,
    tempoRowEditing,
    tempoRowTiming,
  ]);

  const sharedActions = useMemo(() => ({
    resolveDropSide,
    duplicateEventNoteToSnapshot,
    moveEventNoteToSnapshot,
    onDuplicateSnapshot,
    onMoveSnapshot,
    onSnapshotRowClick: handleSnapshotRowClick,
    onSelectSnapshot,
    toggleExpanded,
    onDeleteSnapshot,
    ensureExpanded,
    onUpdateSnapshot,
    onResetSnapshotDescription,
    onPlaySnapshot,
    onStopSnapshot,
  }), [
    duplicateEventNoteToSnapshot,
    ensureExpanded,
    handleSnapshotRowClick,
    moveEventNoteToSnapshot,
    onDeleteSnapshot,
    onDuplicateSnapshot,
    onMoveSnapshot,
    onPlaySnapshot,
    onResetSnapshotDescription,
    onSelectSnapshot,
    onStopSnapshot,
    onUpdateSnapshot,
  ]);

  // Render the Sequencer as a thin view/composition layer over the derived
  // runtime state and controller hooks assembled above.
  return (
    <div role="group" aria-label="Sequencer workspace">
      <SequenceLibrary
        snapshots={snapshots}
        bars={bars}
        repeats={repeats}
        tempi={tempi}
        snapshotLabelMode={snapshotLabelMode}
        autoCreateBars={sequenceAutoCreateBars}
        activeSequenceSource={activeSequenceSource ?? ""}
        activeSequenceBuiltInName={activeSequenceBuiltInName ?? ""}
        activeSequenceName={activeSequenceName ?? ""}
        activeSequenceSavedName={activeSequenceSavedName ?? ""}
        activeSequenceDescription={activeSequenceDescription ?? ""}
        onLoadSequence={onLoadSequence}
        onClearSequence={onClearSequence}
        onSequenceSaved={onSequenceSaved}
        onSaveActionStateChange={setSequenceSaveActionState}
        onPrimarySaveVisibilityChange={setTopSequenceSaveVisible}
      />

      <SequenceInfo
        name={activeSequenceName ?? ""}
        description={activeSequenceDescription ?? ""}
        onNameChange={onSequenceNameChange}
        onDescriptionChange={onSequenceDescriptionChange}
      />

      <fieldset class="sequencer-capture-fieldset">
        <legend>
          <b>Snapshots</b>
        </legend>
        <p>
          <em>
            ENTER stores currently sounding notes, including attack / release velocity, pressure, and timbre data if available. The Sequence panel, below, allows snapshots to be played, re-ordered, and edited. Changing the global or bar-relative position of events automatically creates cues that may be triggered one-by-one. By adding bars with time signatures, tempo markers, repeats, and empty snapshots where needed, users can generate a musical score and automate timed playback.           
          </em>
        </p>
        <div class="preset-actions preset-actions--library">
          <button type="button" class="preset-action-btn" onClick={onTakeSnapshot}>
            Capture
          </button>
          <button type="button" class="preset-action-btn" onClick={onAddEmptySnapshot}>
            Append Empty Snapshot
          </button>
          {snapshots.length > 0 &&
            (
              <span class="preset-actions__clear-slot">
                {confirmClearSnapshots ? (
                  <span class="preset-actions__confirm">
                    <em class="preset-actions__confirm-text">Clear all snapshots?</em>
                    <button
                      type="button"
                      class="delete-btn preset-utility-btn settings-form__inline-button--nowrap"
                      onClick={() => {
                        onDeleteAllSnapshots?.();
                        setConfirmClearSnapshots(false);
                      }}
                    >
                      Yes, clear
                    </button>
                    <button
                      type="button"
                      class="preset-utility-btn settings-form__inline-button--nowrap"
                      onClick={() => setConfirmClearSnapshots(false)}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    class="delete-btn preset-utility-btn preset-actions__clear-trigger"
                    onClick={() => setConfirmClearSnapshots(true)}
                  >
                    Clear All
                  </button>
                )}
              </span>
            )}
        </div>
      </fieldset>

      <fieldset>
        <legend>
          <b>Copy & Insert</b>
        </legend>
        <div class="settings-form__action-row settings-form__action-row--top sequencer-copy-block__range-row">
          <span class="sequencer-copy-block__range-label">Select Snapshot Range</span>
          <span class="sequencer-copy-block__range-controls">
            <label class="sequencer-copy-block__range-item sequencer-copy-block__range-item--start">
              <span class="sequencer-copy-block__range-item-label">Start</span>
              <input
                type="number"
                min="1"
                step="1"
                aria-label="copy snapshot range start"
                value={copyRangeStart}
                onInput={(e) => handleCopyRangeStartInput(e.currentTarget.value)}
              />
            </label>
            <label class="sequencer-copy-block__range-item sequencer-copy-block__range-item--end">
              <span class="sequencer-copy-block__range-item-label">End</span>
              <input
                type="number"
                min="1"
                step="1"
                aria-label="copy snapshot range end"
                value={copyRangeEnd}
                onInput={(e) => handleCopyRangeEndInput(e.currentTarget.value)}
              />
            </label>
          </span>
        </div>
        <div class="sequencer-copy-block__include-row">
          <span class="sequencer-copy-block__options-label">Include</span>
          <div class="sequencer-copy-block__options-right">
            <label class="settings-form__checkbox-row settings-form__reload-checkbox sequencer-copy-block__include-option">
              <input
                type="checkbox"
                checked={copyIncludeBars}
                onInput={(e) => setCopyIncludeBars(e.currentTarget.checked)}
              />
              <span>Bars</span>
            </label>
            <label class="settings-form__checkbox-row settings-form__reload-checkbox sequencer-copy-block__include-option sequencer-copy-block__include-option--repeats">
              <input
                type="checkbox"
                checked={copyIncludeRepeats}
                onInput={(e) => setCopyIncludeRepeats(e.currentTarget.checked)}
              />
              <span>Repeats</span>
            </label>
            <label class="settings-form__checkbox-row settings-form__reload-checkbox sequencer-copy-block__include-option">
              <input
                type="checkbox"
                checked={copyIncludeTempi}
                onInput={(e) => setCopyIncludeTempi(e.currentTarget.checked)}
              />
              <span>Tempi</span>
            </label>
          </div>
        </div>
        <div class="sequencer-copy-block__copy-row">
          <label class="settings-form__checkbox-row settings-form__reload-checkbox">
            <input
              type="checkbox"
              checked={copyResetNoteOffsets}
              onInput={(e) => setCopyResetNoteOffsets(e.currentTarget.checked)}
            />
            <span class="sequencer-copy-block__option-text">Reset Note Offsets</span>
          </label>
          <span class="sequencer-copy-block__copy-actions">
            {copySummaryText && (
              <span class="controller-inline-row controller-status-row sequencer-copy-block__summary">
                <span class="sequencer-copy-block__summary-text">{copySummaryText}</span>
              </span>
            )}
            <button type="button" class="preset-action-btn sequencer-copy-block__copy-button" onClick={handleCopySnapshotBlock}>
              Copy Selection
            </button>
          </span>
        </div>
        <div class="sequencer-copy-block__range-actions">
          <button
            type="button"
            class="preset-action-btn"
            onClick={handleResetSnapshotRangeNoteOffsetsInPlace}
            disabled={!resolvedCopyRange?.valid}
          >
            Reset Note Offsets in Place
          </button>
          <button
            type="button"
            class="preset-utility-btn sequencer-copy-block__delete-range-btn"
            onClick={handleDeleteSnapshotRange}
            disabled={!resolvedCopyRange?.valid}
          >
            Delete Selected Range
          </button>
        </div>
        {copyInsertStatus && (
          <p class="sequencer-copy-block__status">
            <span class="sequencer-copy-block__summary-text">
              <em>{copyInsertStatus}</em>
            </span>
          </p>
        )}
        <div class="settings-form__action-row settings-form__action-row--top sequencer-copy-block__insert-row">
          <span class="sequencer-copy-block__insert-label">Insert at</span>
          <span class="sequencer-copy-block__insert-controls">
            <label class="sequencer-copy-block__range-item">
              <span class="sequencer-copy-block__range-item-label">Position</span>
              <input
                type="number"
                min="1"
                step="1"
                aria-label="copy snapshot insert global position"
                value={copyInsertPosition}
                onInput={(e) => setCopyInsertPosition(e.currentTarget.value)}
                onBlur={(e) => {
                  if (copyIncludeBars) snapInsertPositionToBar(e.currentTarget.value);
                }}
              />
            </label>
            <label class="sequencer-copy-block__range-item">
              <span class="sequencer-copy-block__range-item-label">Bar</span>
              <input
                type={insertIsInsideBar ? "text" : "number"}
                inputMode="numeric"
                min={insertIsInsideBar ? undefined : "1"}
                step={insertIsInsideBar ? undefined : "1"}
                aria-label="copy snapshot insert bar number"
                value={copyInsertBarNumber}
                onInput={(e) => {
                  const nextValue = e.currentTarget.value;
                  setCopyInsertBarNumber(nextValue);
                  const nextPosition = resolveBarPositionFromBarNumber(nextValue);
                  if (nextPosition != null) setCopyInsertPosition(String(nextPosition));
                }}
                onBlur={() => {
                  setCopyInsertBarNumber(insertIsInsideBar ? `[${derivedInsertBarNumber}]` : String(derivedInsertBarNumber));
                }}
              />
            </label>
          </span>
        </div>
        <div class="preset-actions preset-actions--library sequencer-copy-block__insert-actions">
          <button
            type="button"
            class="preset-action-btn"
            onClick={handleInsertSnapshotBlock}
            disabled={!copiedSnapshotBlock || (copiedSnapshotBlock.includeBars && !copyInsertAtBarBoundary)}
          >
            Insert Copied Block
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend>
          <b>Edit & Play</b>
          <button
            type="button"
            class="section-collapse-toggle"
            title={showAllEvents ? "Collapse to snapshot view" : "Expand to sequence view"}
            onClick={(e) => {
              e.stopPropagation();
              setShowAllEvents((value) => !value);
            }}
          >
            <span
              class={`disclosure-toggle-glyph disclosure-toggle-glyph--${showAllEvents ? "expanded" : "collapsed"}`}
              aria-hidden="true"
            />
          </button>
        </legend>

        <SequenceControls
          showAllEvents={showAllEvents}
          newTempoPosition={newTempoPosition}
          setNewTempoPosition={setNewTempoPosition}
          newTempoBpm={newTempoBpm}
          setNewTempoBpm={setNewTempoBpm}
          addTempoAtRequestedPosition={addTempoAtRequestedPosition}
          addTempoTransitionAtRequestedPosition={addTempoTransitionAtRequestedPosition}
          newBarPosition={newBarPosition}
          newBarPositionIsSuggested={newBarPositionIsSuggested}
          setNewBarPosition={updateNewBarPosition}
          addBarAtRequestedPosition={addBarAtRequestedPosition}
          newBarNumerator={newBarNumerator}
          newBarDenominator={newBarDenominator}
          newBarMeterIsSuggested={newBarMeterIsSuggested}
          updateNewBarMeterField={updateNewBarMeterField}
          sequenceAutoCreateBars={sequenceAutoCreateBars}
          onSequenceAutoCreateBarsChange={onSequenceAutoCreateBarsChange}
          onAddBarsBeforeSnapshots={onAddBarsBeforeSnapshots}
          newRepeatPosition={newRepeatPosition}
          setNewRepeatPosition={setNewRepeatPosition}
          onAddRepeatMarker={addRepeatAtRequestedPosition}
          snapshotLabelMode={snapshotLabelMode}
          onSetSnapshotLabelMode={onSetSnapshotLabelMode}
          sequenceLegato={sequenceLegato}
          onSequenceLegatoChange={onSequenceLegatoChange}
          sequencePlaybackSpeed={sequencePlaybackSpeed}
          sequencePlaybackPitchOffset={sequencePlaybackPitchOffset}
          onSequencePlaybackSpeedChange={onSequencePlaybackSpeedChange}
          onSequencePlaybackSpeedPreview={previewTimedTransportSpeed}
          onSequencePlaybackPitchOffsetChange={onSequencePlaybackPitchOffsetChange}
          onSequencePlaybackPitchOffsetPreview={onSequencePlaybackPitchOffsetPreview}
          sequencePlayRepeats={sequencePlayRepeats}
          onSequencePlayRepeatsChange={onSequencePlayRepeatsChange}
          autoScrollEnabled={autoScrollEnabled}
          onAutoScrollEnabledChange={setAutoScrollEnabled}
          snapSequenceToCurrentTuning={snapSequenceToCurrentTuning}
          onSnapSequenceToCurrentTuningChange={onSnapSequenceToCurrentTuningChange}
          playbackRowRef={playbackRowRef}
          playhead={playhead}
          sortedBars={sortedBars}
          transportScrollTargetRef={transportScrollTargetRef}
          onSelectSequenceBar={onSelectSequenceBar}
          snapshotSelectValue={snapshotSelectValue}
          renderedSnapshots={renderedSnapshots}
          impliedPendingSnapshotIndex={impliedPendingSnapshotIndex}
          armPendingSnapshot={armPendingSnapshot}
          snapshots={snapshots}
          playheadIsOff={playheadIsOff}
          nextSnapshotIndexFromBar={nextSnapshotIndexFromBar}
          playheadIsEnd={playheadIsEnd}
          runTransportAction={runTransportAction}
          onJumpSequenceSnapshot={onJumpSequenceSnapshot}
          onStepSequence={onStepSequence}
          cueSelectValue={cueSelectValue}
          sequenceCueGroups={sequenceCueGroups}
          impliedPendingCueIndex={impliedPendingCueIndex}
          armPendingCue={armPendingCue}
          nextCueIndexFromBar={nextCueIndexFromBar}
          onJumpSequenceCue={onJumpSequenceCue}
          onStepSequenceMarker={onStepSequenceMarker}
          onResetSequencePlayhead={resetSequencePlayheadAndScrollTop}
          onJumpSequenceEnd={jumpSequencePlayheadToEndAndScrollBottom}
          onPlaySequence={onPlaySequence}
          playingSnapshotId={playingSnapshotId}
          onStopSnapshot={onStopSnapshot}
          timedTransportUiState={timedTransportUiState}
          getTimedTransportDisplay={getTimedTransportDisplay}
          onTimedTransportPlayPause={handleTimedTransportPlayPause}
          onTimedTransportStop={handleTimedTransportStop}
          terminalSequenceTarget={terminalSequenceTarget}
        />

        <div ref={scrollPanelRef} class="sequencer-scroll-panel">
          {snapshots.length === 0 ? (
            <p>
              <em>No snapshots captured yet.</em>
            </p>
          ) : (
            <div class="sequencer-list">
              {(structuralMarkersByDisplayBucket.get(-1) ?? []).map((marker) => (
                <div
                  key={structuralEventInstanceKey(marker)}
                  ref={(node) => {
                    const structuralKey = structuralEventRenderKey(marker);
                    if (marker.structuralType === "bar") {
                      if (node) barRowRefs.current.set(marker.id, node);
                      else barRowRefs.current.delete(marker.id);
                    }
                    if (structuralKey != null) {
                      if (node) barRowRefs.current.set(structuralKey, node);
                      else barRowRefs.current.delete(structuralKey);
                    }
                  }}
                  class="sequencer-item sequencer-item--bar"
                >
                  {marker.structuralType === "bar" ? (
                    <BarRow bar={marker} barNumberById={barNumberById} dnd={barRowDnd} editing={barRowEditing} />
                  ) : marker.structuralType === "repeat-start" || marker.structuralType === "repeat-end" ? (
                    <RepeatRow repeat={marker} timing={repeatRowTiming} editing={repeatRowEditing} />
                  ) : (
                    <TempoRow
                      tempo={marker}
                      timing={tempoRowTiming}
                      editing={tempoRowEditing}
                    />
                  )}
                </div>
              ))}
              {virtualSequenceLayout.rows.map((row) => (
                row.type === "spacer" ? (
                  <div
                    key={row.key}
                    class="sequencer-virtual-spacer"
                    style={{ height: `${row.size}px` }}
                    aria-hidden="true"
                  />
                ) : (
                  <SnapshotSequenceItem
                    key={row.item.snapshot.id}
                    snapshot={row.item.snapshot}
                    index={row.index}
                    selectedSnapshotId={selectedSnapshotId}
                    playingSnapshotId={playingSnapshotId}
                    showAllEvents={showAllEvents}
                    expandedIds={expandedIds}
                    dragState={sharedDragState}
                    structure={sharedStructure}
                    rows={sharedRows}
                    actions={sharedActions}
                    virtualMeasure={measureVirtualSequenceItem}
                  />
                )
              ))}
            </div>
          )}

        </div>

        {!topSequenceSaveVisible &&
          sequenceSaveActionState.visible &&
          typeof sequenceSaveActionState.action === "function" && (
          <div class="settings-form__action-row sequencer-fieldset__save-row">
            <span class="settings-form__action-group settings-form__action-group--wrap">
              <button
                type="button"
                class="preset-action-btn"
                onClick={sequenceSaveActionState.action}
              >
                {sequenceSaveActionState.label}
              </button>
            </span>
          </div>
        )}
      </fieldset>
    </div>
  );
};

export default Sequencer;
