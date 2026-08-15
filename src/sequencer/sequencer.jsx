/**
 * Sequencer workspace coordinator.
 *
 * Stored sequence data remains owned by App. This component derives the event
 * view, coordinates transport/edit/viewport controllers, and composes row
 * components. Domain mutations and timing calculations belong in the imported
 * runtime modules so virtualization never becomes a second source of truth.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import SequenceInfo from "./sequence-info.jsx";
import SequenceLibrary from "./sequence-library.jsx";
import SequenceControls from "./sequence-controls.jsx";
import SnapshotSequenceItem from "./snapshot-sequence-item.jsx";
import BarRow from "./bar-row.jsx";
import TempoRow from "./tempo-row.jsx";
import RepeatRow from "./repeat-row.jsx";
import { buildSnapshotCopyBlock, resolveSnapshotCopyRange } from "./snapshot-workspace-runtime.js";
import { absolutePositionToBarBeat } from "./transport.js";
import {
  barDisplayBucket,
  buildBarNumberById,
  buildStructuralMarkersByDisplayBucket,
  normalizeTempoBeatFraction,
} from "./transport-runtime.js";
import {
  buildFirstEventIdByCueIndex,
  buildFirstSnapshotCueEventIds,
  buildSnapshotEventsById,
} from "./timeline-runtime.js";
import { derivePlayheadNavigationState } from "./playhead-runtime.js";
import { deriveTempoAtSequencePosition } from "./playback-timeline.js";
import { buildDependencyToken } from "./dependency-token.js";
import { buildSequenceRuntimeModel } from "./runtime-model.js";
import useTimedTransportController from "./timed-transport-controller.js";
import {
  createTimedPlaybackAutoscrollPresenter,
  createTimedPlaybackHighlightPresenter,
  createTimedTransportReadoutPresenter,
  deriveTimedPageFollowPosition,
  resolveSequencerViewportOwner,
  SEQUENCER_VIEWPORT_OWNER_TIMED_PLAYBACK,
} from "./timed-playback-visual-presenter.js";
import useSequencerAutoscroll from "./autoscroll-controller.js";
import { bottomOcclusionHeight, visibleElementBounds } from "./viewport-geometry.js";
import { deriveDragAutoscrollVelocity } from "./drag-autoscroll.js";
import {
  loadSequencerAutoScrollPreference,
  saveSequencerAutoScrollPreference,
} from "./autoscroll-preference.js";
import useDraftEditingController from "./draft-editing-controller.js";
import useEditCommitTransportController from "./edit-commit-transport-controller.js";
import useSequencerPostCommitDiagnostics from "./post-commit-diagnostics.js";
import useTimedUiDiagnostics from "./timed-ui-diagnostics.js";
import {
  estimateSequenceGroupHeight,
  SEQUENCE_VIRTUALIZATION_OVERSCAN_PX,
  sequenceVirtualizationMode,
  useSequenceVirtualization,
} from "./sequence-virtualization.js";
import {
  buildCueExpandedSnapshotIdsAt,
  deriveCueExpandedSnapshotIds,
  deriveExpandedSnapshotIds,
  deriveSoundingAttackEventIds,
  deriveCueViewportPlan,
  resolveCueAnchorSnapshotId,
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
import { normalizeManualArpeggiation } from "./manual-snapshot-arpeggiation.js";
import { normalizeSequenceLegatoMode } from "./legato.js";
import {
  appendPersistedSequencerCrashDiagnostic,
  createSequencerDiagnosticTransactionId,
  readSequencerDiagnosticMemory,
} from "../debug/sequencer-crash-diagnostics.js";
import { buildAutoSelectInputProps } from "../ui/input-selection.js";

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
  sequenceTimbreModWheelEnabled = false,
  sequencePlayRepeats = true,
  snapSequenceToCurrentTuning,
  sequenceAutoCreateBars,
  manualArpeggiation,
  selectedSnapshotId,
  selectedMarker,
  pendingTransportSelection = null,
  playingSnapshotId,
  playingSnapshotIds = [],
  scrollPositionRef = null,
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
  onSequenceTimbreModWheelEnabledChange,
  onSequencePlayRepeatsChange,
  onSnapSequenceToCurrentTuningChange,
  onSequenceAutoCreateBarsChange,
  onManualArpeggiationChange,
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
  onMoveSnapshotRange,
  onResetSnapshotRangeNoteOffsetsInPlace,
  onSetSnapshotRangeArticulation,
  onRestoreSnapshotRangeChanges,
  onDeleteSnapshotRange,
  onUpdateSnapshot,
  onResetSnapshotDescription,
}) => {
  const normalizedManualArpeggiation = useMemo(
    () => normalizeManualArpeggiation(manualArpeggiation),
    [manualArpeggiation],
  );
  const renderStartedAtMs = performance.now();
  const formatTransportClock = useCallback((seconds) => {
    const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const secs = String(totalSeconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${secs}`;
  }, []);

  // Local state is presentation or draft state only. Committed snapshots and
  // structural markers flow back through the App-owned mutation callbacks.
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [showAllEvents, setShowAllEvents] = useState(true);
  const [sequenceSaveActionState, setSequenceSaveActionState] = useState({
    visible: false,
    label: "",
    action: null,
    status: "",
  });
  const [topSequenceSaveVisible, setTopSequenceSaveVisible] = useState(false);
  const [sequenceSaveFooterClearance, setSequenceSaveFooterClearance] = useState(0);
  const sequenceSaveRowRef = useRef(null);
  const [newBarPosition, setNewBarPosition] = useState("1");
  const [newTempoPosition, setNewTempoPosition] = useState("1.000000");
  const [newRepeatPosition, setNewRepeatPosition] = useState("1.000000");
  const [newTempoBpm, setNewTempoBpm] = useState("60");
  const [newTempoBeatNumerator, setNewTempoBeatNumerator] = useState("1");
  const [newTempoBeatDenominator, setNewTempoBeatDenominator] = useState("4");
  const [newTempoBpmIsSuggested, setNewTempoBpmIsSuggested] = useState(true);
  const [newTempoBeatFractionIsSuggested, setNewTempoBeatFractionIsSuggested] = useState(true);
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
  const [dragRenderSettling, setDragRenderSettling] = useState(false);
  const [eventPane, setEventPane] = useState("timing");
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(loadSequencerAutoScrollPreference);
  const [cueViewportTransaction, setCueViewportTransaction] = useState(null);
  const [compactSelectionPreviewSuppressedId, setCompactSelectionPreviewSuppressedId] =
    useState(null);
  const [copyRangeStart, setCopyRangeStart] = useState("1");
  const [copyRangeEnd, setCopyRangeEnd] = useState("1");
  const [copyInsertPosition, setCopyInsertPosition] = useState("1");
  const [copyInsertBarNumber, setCopyInsertBarNumber] = useState("1");
  const [copyIncludeBars, setCopyIncludeBars] = useState(false);
  const [copyIncludeTempi, setCopyIncludeTempi] = useState(false);
  const [copyIncludeRepeats, setCopyIncludeRepeats] = useState(false);
  const [copiedSnapshotBlock, setCopiedSnapshotBlock] = useState(null);
  const [copiedSelectionSignature, setCopiedSelectionSignature] = useState(null);
  const [copyInsertStatus, setCopyInsertStatus] = useState("");
  const [rangeEditUndo, setRangeEditUndo] = useState(null);
  // Interaction refs intentionally avoid render-time updates during pointer
  // movement, scroll presentation, and timed playback animation frames.
  const dragIdRef = useRef(null);
  const dragAutoscrollFrameRef = useRef(null);
  const dragAutoscrollPointerYRef = useRef(null);
  const dragAutoscrollPreviousTimeRef = useRef(null);
  const dragAutoscrollDiagnosticActiveRef = useRef(false);
  const dragAutoscrollDiagnosticStartedAtRef = useRef(null);
  const dragAutoscrollDiagnosticStartTopRef = useRef(null);
  const dragRenderSettlementFrameRef = useRef(null);
  const barDragIdRef = useRef(null);
  const eventDragRef = useRef(null);
  const timedVisualCueHandlerRef = useRef(null);
  const timedHighlightPresenterRef = useRef(null);
  const timedAutoscrollPresenterRef = useRef(null);
  const timedReadoutPresenterRef = useRef(null);
  const pendingTimedVisualNotificationRef = useRef(null);
  const timedVisualNotificationFrameRef = useRef(null);
  const navigationAutoscrollIntentRef = useRef(null);
  const workspaceMutationViewportRef = useRef(null);
  const previousSnapshotIdsRef = useRef(new Set(snapshots.map((snapshot) => snapshot.id)));
  const copyRangeSelectionKeyRef = useRef(null);
  const cueStepViewportRequestedRef = useRef(false);
  const cueViewportGenerationRef = useRef(0);
  const editPlayLayoutReanchorRef = useRef(null);
  const editPlayLayoutReanchorGenerationRef = useRef(0);
  const editPlayLayoutReanchorCallbacksRef = useRef(null);
  const autoScrollEnabledRef = useRef(autoScrollEnabled);
  autoScrollEnabledRef.current = autoScrollEnabled;
  const timedTransportFieldValuesRef = useRef({
    bar: null,
    snapshot: null,
    cue: null,
  });
  const duplicateNoteIdRef = useRef(0);

  useEffect(() => {
    saveSequencerAutoScrollPreference(autoScrollEnabled);
  }, [autoScrollEnabled]);

  // Canonical derived sequence/timeline state. A supplied App runtime model is
  // reused; the fallback keeps isolated tests and embedders self-contained.
  const sequenceRuntime = useMemo(
    () =>
      runtimeModel ??
      buildSequenceRuntimeModel({
        snapshots,
        displaySnapshots,
        playbackSnapshots,
        bars,
        tempi,
        repeats,
        sequenceLegato,
        source: "sequencer",
      }),
    [
      bars,
      displaySnapshots,
      playbackSnapshots,
      repeats,
      runtimeModel,
      sequenceLegato,
      snapshots,
      tempi,
    ],
  );
  const renderedSnapshots = sequenceRuntime.renderedSnapshots;
  // The stored snapshots define timed-transport structure. `playbackSnapshots`
  // may be a live pitch-remapped view of the same events, so changing that
  // view must not invalidate a running transport.
  const playbackRuntimeToken = useMemo(
    () => buildDependencyToken([snapshots, bars, tempi, repeats]),
    [bars, repeats, snapshots, tempi],
  );
  const timedTriggerToken = useMemo(
    () => buildDependencyToken([playbackRuntimeToken, sequenceLegato]),
    [playbackRuntimeToken, sequenceLegato],
  );
  const sortedBars = sequenceRuntime.sortedBars;
  const suggestedBarPosition = useMemo(() => {
    const snapshotEndPosition = Math.max(1, snapshots.length + 1);
    const lastBarPosition =
      sortedBars.length > 0
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
  const suggestedNewBarMeter = useMemo(() => {
    const targetPosition = Math.max(1, Number(newBarPosition) || Number(suggestedBarPosition) || 1);
    const previousBar = [...sortedBars]
      .filter((bar) => Number(bar.position) < targetPosition)
      .at(-1);
    return {
      numerator: String(previousBar?.numerator ?? 4),
      denominator: String(previousBar?.denominator ?? 4),
    };
  }, [newBarPosition, sortedBars, suggestedBarPosition]);
  const sortedTempi = sequenceRuntime.sortedTempi;
  const sequenceEvents = sequenceRuntime.sequenceEvents;
  const sequenceCueGroups = sequenceRuntime.sequenceCueGroups;
  const terminalBarlinePosition = sequenceRuntime.terminalBarlinePosition;
  const tempoTransitionCueMap = sequenceRuntime.tempoTransitionCueMap;
  const explicitBarPositions = useMemo(
    () =>
      sortedBars.map((bar) => ({
        position: Math.round(Number(bar?.position) || 1),
        barNumber:
          absolutePositionToBarBeat(
            Number(bar?.position) || 1,
            sortedBars,
            1,
            9,
            terminalBarlinePosition,
          )?.barNumber ?? 1,
      })),
    [sortedBars, terminalBarlinePosition],
  );
  const formatTransportBarBeat = useCallback(
    (position) => {
      const resolved = absolutePositionToBarBeat(
        position,
        sortedBars,
        1,
        9,
        terminalBarlinePosition,
      );
      if (!resolved) return "1:1";
      const fraction =
        resolved.numerator > 0 ? ` ${resolved.numerator}/${resolved.denominator}` : "";
      return `${resolved.barNumber}:${resolved.beat}${fraction}`;
    },
    [sortedBars, terminalBarlinePosition],
  );
  const describeTransportTempo = useCallback(
    (position, speedMultiplier = 1) => {
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
    },
    [sortedBars, sortedTempi, terminalBarlinePosition],
  );
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
  } = useMemo(
    () =>
      derivePlayheadNavigationState({
        playhead,
        sortedBars,
        sequenceCueGroups,
        snapshots,
        selectedSnapshotId,
        selectedMarker,
        pendingTransportSelection,
      }),
    [
      pendingTransportSelection,
      playhead,
      selectedMarker,
      selectedSnapshotId,
      sequenceCueGroups,
      snapshots,
      sortedBars,
    ],
  );

  const snapshotIndexById = useMemo(() => {
    const entries = renderedSnapshots.map((snapshot, index) => [snapshot.id, index + 1]);
    return new Map(entries);
  }, [renderedSnapshots]);

  const findSnapshotById = useCallback(
    (snapshotId) => snapshots.find((snapshot) => snapshot.id === snapshotId) ?? null,
    [snapshots],
  );

  const findNoteInSnapshot = useCallback((snapshot, noteRef) => {
    if (!snapshot) return null;
    const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
    const note =
      (snapshot.notes ?? []).find((entry) => noteMatchesReference(entry, noteRef, length)) ?? null;
    return note ? { note, length } : null;
  }, []);

  const nextDuplicateNoteId = useCallback((baseId = "note") => {
    duplicateNoteIdRef.current += 1;
    return `${String(baseId)}:copy:${duplicateNoteIdRef.current}`;
  }, []);

  const snapshotEventsById = useMemo(
    () => buildSnapshotEventsById(sequenceEvents),
    [sequenceEvents],
  );

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
    const orderedBuckets = [...structuralMarkersByDisplayBucket.keys()].sort(
      (left, right) => left - right,
    );
    for (const bucket of orderedBuckets) {
      const firstMarker = structuralMarkersByDisplayBucket.get(bucket)?.[0] ?? null;
      const markerKey = structuralEventRenderKey(firstMarker);
      if (markerKey) return markerKey;
    }
    return null;
  }, [structuralMarkersByDisplayBucket]);
  const repeatStartKeyAtPosition = useCallback(
    (position) => {
      const time = Number(position);
      if (!Number.isFinite(time)) return null;
      const repeat = (Array.isArray(repeats) ? repeats : []).find(
        (entry) => entry?.kind === "start" && Math.abs(Number(entry?.position) - time) < 1e-9,
      );
      return repeat == null
        ? null
        : structuralEventRenderKey({
            type: "repeat-start",
            repeatId: repeat.id,
          });
    },
    [repeats],
  );
  const structuralScrollKeysAtPosition = useCallback(
    (position) => {
      const time = Number(position);
      if (!Number.isFinite(time)) return [];
      const keys = [];
      for (const markers of structuralMarkersByDisplayBucket.values()) {
        markers.forEach((marker) => {
          if (Math.abs(Number(marker?.position) - time) >= 1e-9) return;
          const markerKey = structuralEventRenderKey(marker);
          if (markerKey) keys.push(markerKey);
        });
      }
      return keys;
    },
    [structuralMarkersByDisplayBucket],
  );

  const firstEventIdByCueIndex = useMemo(
    () => buildFirstEventIdByCueIndex(sequenceEvents),
    [sequenceEvents],
  );
  useEffect(() => {
    if (snapshots.length === 0) {
      setCopyRangeStart("1");
      setCopyRangeEnd("1");
      setCopyInsertPosition("1");
      setCopyInsertBarNumber("1");
      setCopiedSnapshotBlock(null);
      setCopiedSelectionSignature(null);
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

  useEffect(() => {
    const selectedIndex = snapshots.findIndex((snapshot) => snapshot.id === selectedSnapshotId);
    const selectionKey =
      selectedIndex < 0 ? null : JSON.stringify([selectedSnapshotId, selectedIndex]);
    if (selectionKey === copyRangeSelectionKeyRef.current) return;
    copyRangeSelectionKeyRef.current = selectionKey;
    if (selectedIndex < 0) return;
    const position = String(selectedIndex + 1);
    setCopyRangeStart(position);
    setCopyRangeEnd(position);
  }, [selectedSnapshotId, snapshots]);

  const handleCopyRangeStartInput = useCallback(
    (rawValue) => {
      const nextValue = rawValue;
      setCopyRangeStart(nextValue);
      const nextStart = Math.max(1, Math.round(Number(nextValue) || 1));
      const currentEnd = Math.max(1, Math.round(Number(copyRangeEnd) || 1));
      if (currentEnd < nextStart) {
        setCopyRangeEnd(String(nextStart));
      }
    },
    [copyRangeEnd],
  );

  const handleCopyRangeEndInput = useCallback(
    (rawValue) => {
      const nextEnd = Math.max(1, Math.round(Number(rawValue) || 1));
      const currentStart = Math.max(1, Math.round(Number(copyRangeStart) || 1));
      setCopyRangeEnd(String(nextEnd));
      if (nextEnd < currentStart) {
        setCopyRangeStart(String(nextEnd));
      }
    },
    [copyRangeStart],
  );

  const derivedInsertBarBeat = useMemo(() => {
    const position = Math.round(Number(copyInsertPosition) || 1);
    return absolutePositionToBarBeat(position, sortedBars, 1, 9, terminalBarlinePosition);
  }, [copyInsertPosition, sortedBars, terminalBarlinePosition]);

  const derivedInsertBarNumber = derivedInsertBarBeat?.barNumber ?? 1;
  const insertIsInsideBar = useMemo(() => {
    const position = Math.round(Number(copyInsertPosition) || 1);
    return (
      !sortedBars.some((bar) => Math.abs((Number(bar?.position) || 0) - position) < 1e-9) &&
      position > 1 &&
      position <= snapshots.length
    );
  }, [copyInsertPosition, snapshots.length, sortedBars]);

  useEffect(() => {
    setCopyInsertBarNumber(
      insertIsInsideBar ? `[${derivedInsertBarNumber}]` : String(derivedInsertBarNumber),
    );
  }, [derivedInsertBarNumber, insertIsInsideBar]);

  const resolvedCopyRange = useMemo(
    () =>
      resolveSnapshotCopyRange({
        snapshots,
        bars,
        startPosition: copyRangeStart,
        endPosition: copyRangeEnd,
        includeBars: copyIncludeBars,
      }),
    [bars, copyIncludeBars, copyRangeEnd, copyRangeStart, snapshots],
  );

  const resolvedCopyRangeSnapshotIds = useMemo(
    () =>
      resolvedCopyRange?.valid
        ? snapshots
            .slice(resolvedCopyRange.startPosition - 1, resolvedCopyRange.endPosition)
            .map((snapshot) => snapshot.id)
        : [],
    [resolvedCopyRange, snapshots],
  );

  const currentCopySelectionSignature = useMemo(
    () =>
      JSON.stringify({
        snapshotIds: resolvedCopyRangeSnapshotIds,
        startPosition: resolvedCopyRange?.startPosition ?? null,
        endPosition: resolvedCopyRange?.endPosition ?? null,
        includeBars: copyIncludeBars,
        includeTempi: copyIncludeTempi,
        includeRepeats: copyIncludeRepeats,
      }),
    [
      copyIncludeBars,
      copyIncludeRepeats,
      copyIncludeTempi,
      resolvedCopyRange?.endPosition,
      resolvedCopyRange?.startPosition,
      resolvedCopyRangeSnapshotIds,
    ],
  );

  useEffect(() => {
    if (!rangeEditUndo) return;
    const sameRange =
      rangeEditUndo.snapshotIds.length === resolvedCopyRangeSnapshotIds.length &&
      rangeEditUndo.snapshotIds.every((id, index) => id === resolvedCopyRangeSnapshotIds[index]);
    if (!sameRange) setRangeEditUndo(null);
  }, [rangeEditUndo, resolvedCopyRangeSnapshotIds]);

  const copyInsertAtBarBoundary = useMemo(() => {
    const position = Math.round(Number(copyInsertPosition) || 0);
    if (position === 1 || position === snapshots.length + 1) return true;
    return bars.some((bar) => Math.abs((Number(bar?.position) || 0) - position) < 1e-9);
  }, [bars, copyInsertPosition, snapshots.length]);

  const copySummaryText = useMemo(() => {
    if (!resolvedCopyRange?.valid) {
      return "";
    }
    const action =
      copiedSelectionSignature === currentCopySelectionSignature ? "copied" : "selected";
    return (
      (resolvedCopyRange.startPosition === resolvedCopyRange.endPosition
        ? `Snapshot ${resolvedCopyRange.startPosition} ${action}`
        : `Snapshots ${resolvedCopyRange.startPosition}-${resolvedCopyRange.endPosition} ${action}`) +
      (copyIncludeBars &&
      (resolvedCopyRange.requestedStartPosition !== resolvedCopyRange.startPosition ||
        resolvedCopyRange.requestedEndPosition !== resolvedCopyRange.endPosition)
        ? " (expanded to full bars)."
        : ".") +
      (copiedSnapshotBlock?.includeBars && !copyInsertAtBarBoundary
        ? " Insert position must be at a bar marker, the beginning, or the end."
        : "")
    );
  }, [
    copyIncludeBars,
    copyInsertAtBarBoundary,
    copiedSnapshotBlock?.includeBars,
    copiedSelectionSignature,
    currentCopySelectionSignature,
    resolvedCopyRange,
  ]);

  const resolveBarPositionFromBarNumber = useCallback(
    (rawValue) => {
      const numeric = Math.round(Number(String(rawValue ?? "").replace(/[^\d-]/g, "")) || 0);
      if (!Number.isFinite(numeric) || numeric <= 0) return null;
      const exact = explicitBarPositions.find((entry) => entry.barNumber === numeric);
      return exact?.position ?? null;
    },
    [explicitBarPositions],
  );

  const snapInsertPositionToBar = useCallback(
    (rawValue) => {
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
      const currentBar =
        absolutePositionToBarBeat(numeric, sortedBars, 1, 9, terminalBarlinePosition)?.barNumber ??
        1;
      const snapped = resolveBarPositionFromBarNumber(currentBar) ?? 1;
      setCopyInsertPosition(String(snapped));
    },
    [resolveBarPositionFromBarNumber, snapshots.length, sortedBars, terminalBarlinePosition],
  );

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
    });
    if (!block) {
      setCopiedSnapshotBlock(null);
      setCopiedSelectionSignature(null);
      setCopyInsertStatus("No snapshots available to copy.");
      return;
    }
    setCopiedSnapshotBlock(block);
    setCopiedSelectionSignature(currentCopySelectionSignature);
    setCopyInsertStatus("");
  }, [
    bars,
    copyIncludeBars,
    copyIncludeRepeats,
    copyIncludeTempi,
    copyRangeEnd,
    copyRangeStart,
    currentCopySelectionSignature,
    repeats,
    snapshots,
    tempi,
  ]);

  const handleInsertSnapshotBlock = useCallback(() => {
    if (!copiedSnapshotBlock) {
      setCopyInsertStatus("Copy a snapshot range first.");
      return;
    }
    const position = Math.round(Number(copyInsertPosition) || 0);
    if (!Number.isFinite(position) || position < 1 || position > snapshots.length + 1) {
      setCopyInsertStatus("Choose a valid insert slot.");
      return;
    }
    const result = onInsertSnapshotCopyBlock?.(copiedSnapshotBlock, position);
    if (result === "bar-boundary-required") {
      setCopyInsertStatus(
        "Bar-inclusive insertion must start at a bar marker, the beginning, or the end.",
      );
      return;
    }
    if (typeof result === "string" && result) {
      setCopyInsertStatus("Unable to insert the copied snapshot range.");
      return;
    }
    workspaceMutationViewportRef.current = result?.focus ?? null;
    if (result?.focus?.kind === "snapshot") {
      copyRangeSelectionKeyRef.current = JSON.stringify([
        result.focus.snapshotId,
        result.focus.snapshotIndex,
      ]);
    }
    setCopyRangeStart(String(position));
    setCopyRangeEnd(String(position + copiedSnapshotBlock.length - 1));
    setRangeEditUndo(null);
    setCopyInsertStatus(
      `Inserted ${copiedSnapshotBlock.length} snapshot${copiedSnapshotBlock.length === 1 ? "" : "s"} at slot ${position}.`,
    );
  }, [copiedSnapshotBlock, copyInsertPosition, onInsertSnapshotCopyBlock, snapshots.length]);

  const handleMoveSnapshotBlock = useCallback(() => {
    if (!copiedSnapshotBlock || copiedSelectionSignature !== currentCopySelectionSignature) {
      setCopyInsertStatus("Copy the selected snapshot range first.");
      return;
    }
    const position = Math.round(Number(copyInsertPosition) || 0);
    if (!Number.isFinite(position) || position < 1 || position > snapshots.length + 1) {
      setCopyInsertStatus("Choose a valid insert slot.");
      return;
    }
    const result = onMoveSnapshotRange?.(
      {
        startPosition: copiedSnapshotBlock.range.startPosition,
        endPosition: copiedSnapshotBlock.range.endPosition,
        includeBars: copiedSnapshotBlock.includeBars,
        includeTempi: copiedSnapshotBlock.includeTempi,
        includeRepeats: copiedSnapshotBlock.includeRepeats,
      },
      position,
    );
    if (result === "bar-boundary-required") {
      setCopyInsertStatus(
        "Bar-inclusive movement must start at a bar marker, the beginning, or the end.",
      );
      return;
    }
    if (typeof result === "string" && result) {
      setCopyInsertStatus("Unable to move the copied snapshot range.");
      return;
    }
    const movedPosition = result?.insertionPosition ?? copiedSnapshotBlock.range.startPosition;
    workspaceMutationViewportRef.current = result?.focus ?? null;
    if (result?.focus?.kind === "snapshot") {
      copyRangeSelectionKeyRef.current = JSON.stringify([
        result.focus.snapshotId,
        result.focus.snapshotIndex,
      ]);
    }
    setCopyRangeStart(String(movedPosition));
    setCopyRangeEnd(String(movedPosition + copiedSnapshotBlock.length - 1));
    setCopyInsertPosition(String(movedPosition));
    setCopiedSnapshotBlock(null);
    setCopiedSelectionSignature(null);
    setRangeEditUndo(null);
    setCopyInsertStatus(
      result?.changed === false
        ? "The copied range is already at that position."
        : `Moved ${copiedSnapshotBlock.length} snapshot${copiedSnapshotBlock.length === 1 ? "" : "s"} to slot ${movedPosition}.`,
    );
  }, [
    copiedSelectionSignature,
    copiedSnapshotBlock,
    copyInsertPosition,
    currentCopySelectionSignature,
    onMoveSnapshotRange,
    snapshots.length,
  ]);

  const { editCommitTick, editCommitContext, notifyEditCommitted, runTransportAction } =
    useEditCommitTransportController({
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
      sequenceEvents,
    });
  }, [
    activeSnapshotId,
    playingSnapshotId,
    playheadMarkerIndex,
    renderedSnapshots,
    sequenceEvents,
    sequencePlaybackActive,
    sortedBars,
    sortedTempi,
  ]);
  const cueExpandedSnapshotIdsAt = useCallback(
    (cueIndexZeroBased) => {
      return buildCueExpandedSnapshotIdsAt(
        cueIndexZeroBased,
        renderedSnapshots,
        sortedBars,
        sortedTempi,
        sequenceEvents,
      );
    },
    [renderedSnapshots, sequenceEvents, sortedBars, sortedTempi],
  );
  const cueExpandedSnapshotIds = useMemo(() => {
    return deriveCueExpandedSnapshotIds({
      activeCueIndex,
      cueExpandedSnapshotIdsAt,
      sequenceEvents,
      soundingAttackEventIds,
    });
  }, [activeCueIndex, cueExpandedSnapshotIdsAt, sequenceEvents, soundingAttackEventIds]);

  const presentTimedCue = useCallback((cueIndex, trigger, burst) => {
    const notification = { cueIndex, trigger, burst };
    pendingTimedVisualNotificationRef.current = notification;
    if (timedVisualNotificationFrameRef.current != null) return;
    timedVisualNotificationFrameRef.current = window.requestAnimationFrame(() => {
      timedVisualNotificationFrameRef.current = null;
      const notification = pendingTimedVisualNotificationRef.current;
      pendingTimedVisualNotificationRef.current = null;
      if (!notification) return;
      timedVisualCueHandlerRef.current?.(
        notification.cueIndex,
        notification.trigger,
        notification.burst,
      );
    });
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
  const viewportOwner = resolveSequencerViewportOwner({
    timedPlaybackRunning: timedTransportUiState.running,
  });
  const timedPlaybackOwnsViewport = viewportOwner === SEQUENCER_VIEWPORT_OWNER_TIMED_PLAYBACK;
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
    scrollNodeIntoPanel,
    scrollNodesIntoPanel,
    cancelNavigationAutoscroll,
    refreshPendingSnapshotAlignment,
  } = useSequencerAutoscroll({
    autoScrollEnabled,
    activeCueIndex,
    manageActiveCueViewport: true,
    activeSnapshotId,
    manageActiveSnapshotViewport: true,
    playheadIsOff,
    snapshots,
    sequenceEvents,
    sequenceCueGroups,
    sequenceRepeatSections,
    cueExpandedSnapshotIds,
    cueExpandedSnapshotIdsAt,
    firstEventIdByCueIndex,
    firstStructuralScrollKey,
    repeatStartKeyAtPosition,
    showAllEvents,
    setExpandedIds,
    onCueSequenceSnapshot,
    onCueSequenceCue,
    onSelectSequenceBar,
    onResetSequencePlayhead,
    bottomOverlayRef: sequenceSaveRowRef,
    recordTimedTransportDiagnostic,
  });

  const bindScrollPanel = useCallback(
    (node) => {
      const previousPanel = scrollPanelRef.current;
      if (!(node instanceof HTMLElement) && previousPanel instanceof HTMLElement) {
        if (scrollPositionRef) scrollPositionRef.current = previousPanel.scrollTop;
      }
      scrollPanelRef.current = node;
      if (node instanceof HTMLElement && scrollPositionRef) {
        const restoredTop = Number(scrollPositionRef.current);
        node.scrollTop = Number.isFinite(restoredTop) ? Math.max(0, restoredTop) : 0;
      }
    },
    [scrollPanelRef, scrollPositionRef],
  );
  const rememberScrollPosition = useCallback(
    (event) => {
      if (!scrollPositionRef) return;
      scrollPositionRef.current = Math.max(0, Number(event.currentTarget?.scrollTop) || 0);
    },
    [scrollPositionRef],
  );
  useLayoutEffect(() => {
    const panel = scrollPanelRef.current;
    if (!(panel instanceof HTMLElement) || !scrollPositionRef) return undefined;
    const restoredTop = Number(scrollPositionRef.current);
    panel.scrollTop = Number.isFinite(restoredTop) ? Math.max(0, restoredTop) : 0;
    return () => {
      scrollPositionRef.current = panel.scrollTop;
    };
  }, [scrollPanelRef, scrollPositionRef]);

  const measureSequenceBottomOcclusion = useCallback(() => {
    const visiblePanel = visibleElementBounds(scrollPanelRef.current);
    return bottomOcclusionHeight(
      visiblePanel,
      sequenceSaveRowRef.current,
      sequenceSaveFooterClearance,
    );
  }, [scrollPanelRef, sequenceSaveFooterClearance]);
  useLayoutEffect(() => {
    const saveRow = sequenceSaveRowRef.current;
    if (!(saveRow instanceof HTMLElement)) {
      setSequenceSaveFooterClearance(0);
      return undefined;
    }
    const updateClearance = () => {
      const rect = saveRow.getBoundingClientRect();
      const style = window.getComputedStyle(saveRow);
      const rowHeight = Math.max(
        0,
        Number(rect.height) || Number(saveRow.offsetHeight) || Number(saveRow.clientHeight) || 0,
      );
      const bottomInset = Math.max(0, Number.parseFloat(style.bottom) || 0);
      // Include the footer's ::after fade, whose CSS height is 0.6rem, and the
      // same small visual gap used by row alignment. This is scrollable space,
      // not a guessed occlusion offset; live geometry still chooses the target.
      const fadeAndGap = 0.6 * (Number.parseFloat(style.fontSize) || 16) + 6;
      const nextClearance = Math.ceil(rowHeight + bottomInset + fadeAndGap);
      setSequenceSaveFooterClearance((current) =>
        current === nextClearance ? current : nextClearance,
      );
    };
    updateClearance();
    const resizeObserver =
      typeof ResizeObserver === "function" ? new ResizeObserver(updateClearance) : null;
    resizeObserver?.observe(saveRow);
    window.addEventListener("resize", updateClearance);
    window.visualViewport?.addEventListener?.("resize", updateClearance);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateClearance);
      window.visualViewport?.removeEventListener?.("resize", updateClearance);
    };
  }, [sequenceSaveActionState.label, sequenceSaveActionState.visible, topSequenceSaveVisible]);
  const stopSnapshotDragAutoscroll = useCallback(() => {
    if (dragAutoscrollFrameRef.current != null) {
      window.cancelAnimationFrame(dragAutoscrollFrameRef.current);
    }
    dragAutoscrollFrameRef.current = null;
    dragAutoscrollPointerYRef.current = null;
    dragAutoscrollPreviousTimeRef.current = null;
    if (dragAutoscrollDiagnosticActiveRef.current) {
      const panel = scrollPanelRef.current;
      const currentTop = panel instanceof HTMLElement ? panel.scrollTop : null;
      appendPersistedSequencerCrashDiagnostic(
        {
          type: "snapshot-drag-edge-scroll-stopped",
          detail: "Stopped snapshot drag edge scrolling",
          context: {
            source: "sequencer",
            snapshotId: dragIdRef.current,
            dragStage: "edge-scroll-stopped",
            scrollTop: currentTop,
            scrollDelta:
              currentTop == null || dragAutoscrollDiagnosticStartTopRef.current == null
                ? null
                : currentTop - dragAutoscrollDiagnosticStartTopRef.current,
            dragDurationMs:
              dragAutoscrollDiagnosticStartedAtRef.current == null
                ? null
                : performance.now() - dragAutoscrollDiagnosticStartedAtRef.current,
            snapshotCountBefore: snapshots.length,
            ...readSequencerDiagnosticMemory(),
          },
        },
        globalThis.sessionStorage,
        { immediate: true },
      );
    }
    dragAutoscrollDiagnosticActiveRef.current = false;
    dragAutoscrollDiagnosticStartedAtRef.current = null;
    dragAutoscrollDiagnosticStartTopRef.current = null;
  }, [scrollPanelRef, snapshots.length]);
  const updateSnapshotDragAutoscroll = useCallback(
    (pointerY) => {
      if (dragIdRef.current == null || !Number.isFinite(Number(pointerY))) return;
      dragAutoscrollPointerYRef.current = Number(pointerY);
      if (dragAutoscrollFrameRef.current != null) return;
      const step = (timestamp) => {
        dragAutoscrollFrameRef.current = null;
        if (dragIdRef.current == null) {
          stopSnapshotDragAutoscroll();
          return;
        }
        const panel = scrollPanelRef.current;
        const visiblePanel = visibleElementBounds(panel);
        if (!(panel instanceof HTMLElement) || visiblePanel == null || visiblePanel.height <= 0) {
          stopSnapshotDragAutoscroll();
          return;
        }
        const bottomOcclusion = measureSequenceBottomOcclusion();
        const velocity = deriveDragAutoscrollVelocity({
          pointerY: dragAutoscrollPointerYRef.current,
          visibleTop: visiblePanel.top,
          visibleBottom: Math.max(visiblePanel.top, visiblePanel.bottom - bottomOcclusion),
        });
        if (velocity === 0) {
          dragAutoscrollPreviousTimeRef.current = null;
          return;
        }
        const previousTime = dragAutoscrollPreviousTimeRef.current;
        const elapsedMs =
          previousTime == null ? 16 : Math.min(40, Math.max(8, timestamp - previousTime));
        dragAutoscrollPreviousTimeRef.current = timestamp;
        const previousTop = panel.scrollTop;
        if (!dragAutoscrollDiagnosticActiveRef.current) {
          dragAutoscrollDiagnosticActiveRef.current = true;
          dragAutoscrollDiagnosticStartedAtRef.current = performance.now();
          dragAutoscrollDiagnosticStartTopRef.current = previousTop;
          appendPersistedSequencerCrashDiagnostic(
            {
              type: "snapshot-drag-edge-scroll-started",
              detail: "Started snapshot drag edge scrolling",
              context: {
                source: "sequencer",
                snapshotId: dragIdRef.current,
                dragStage: "edge-scroll-started",
                pointerY: dragAutoscrollPointerYRef.current,
                scrollTop: previousTop,
                scrollVelocity: velocity,
                snapshotCountBefore: snapshots.length,
                ...readSequencerDiagnosticMemory(),
              },
            },
            globalThis.sessionStorage,
            { immediate: true },
          );
        }
        const maximumTop = Math.max(0, panel.scrollHeight - panel.clientHeight);
        const nextTop = Math.max(
          0,
          Math.min(maximumTop, previousTop + (velocity * elapsedMs) / 1000),
        );
        if (Math.abs(nextTop - previousTop) < 0.25) return;
        panel.scrollTop = nextTop;
        dragAutoscrollFrameRef.current = window.requestAnimationFrame(step);
      };
      dragAutoscrollFrameRef.current = window.requestAnimationFrame(step);
    },
    [measureSequenceBottomOcclusion, scrollPanelRef, snapshots.length, stopSnapshotDragAutoscroll],
  );

  useEffect(() => stopSnapshotDragAutoscroll, [stopSnapshotDragAutoscroll]);

  const settleDragRendering = useCallback(() => {
    setDragRenderSettling(true);
    if (dragRenderSettlementFrameRef.current != null) {
      window.cancelAnimationFrame(dragRenderSettlementFrameRef.current);
    }
    dragRenderSettlementFrameRef.current = window.requestAnimationFrame(() => {
      dragRenderSettlementFrameRef.current = window.requestAnimationFrame(() => {
        dragRenderSettlementFrameRef.current = null;
        setDragRenderSettling(false);
      });
    });
  }, []);

  useEffect(
    () => () => {
      if (dragRenderSettlementFrameRef.current != null) {
        window.cancelAnimationFrame(dragRenderSettlementFrameRef.current);
      }
    },
    [],
  );

  const virtualSequenceItems = useMemo(
    () =>
      renderedSnapshots.map((snapshot, index) => {
        const snapshotEvents = snapshotEventsById.get(snapshot.id) ?? [];
        const expanded = showAllEvents || expandedIds.has(snapshot.id);
        const embeddedStructuralKeys = expanded
          ? new Set(
              snapshotEvents
                .filter(
                  (event) =>
                    event.type === "bar" ||
                    event.type === "tempo" ||
                    event.type === "repeat-start" ||
                    event.type === "repeat-end",
                )
                .map((event) => structuralEventRenderKey(event)),
            )
          : new Set();
        const outsideStructuralMarkers = (structuralMarkersByDisplayBucket.get(index) ?? []).filter(
          (marker) => !embeddedStructuralKeys.has(structuralEventRenderKey(marker)),
        );
        const structuralCount = outsideStructuralMarkers.length;
        const visibleTempoMarkers = [
          ...(expanded ? snapshotEvents.filter((event) => event.type === "tempo") : []),
          ...outsideStructuralMarkers.filter((marker) => marker.structuralType === "tempo"),
        ];
        const transitionCueCount = visibleTempoMarkers.filter((tempo) =>
          tempoTransitionCueMap.has(tempo.tempoId ?? tempo.id),
        ).length;
        const measurementToken = [
          expanded ? 1 : 0,
          snapshotEvents.length,
          structuralCount,
          transitionCueCount,
        ].join(":");
        return {
          key: snapshot.id,
          snapshot,
          measurementToken,
          estimatedSize: estimateSequenceGroupHeight({
            expanded,
            eventCount: snapshotEvents.length,
            structuralCount,
            transitionCueCount,
          }),
          expandedEstimatedSize: estimateSequenceGroupHeight({
            expanded: true,
            eventCount: snapshotEvents.length,
            structuralCount,
            transitionCueCount,
          }),
        };
      }),
    [
      expandedIds,
      renderedSnapshots,
      showAllEvents,
      snapshotEventsById,
      structuralMarkersByDisplayBucket,
      tempoTransitionCueMap,
    ],
  );
  const virtualSequenceListRef = useRef(null);
  const virtualPinnedIndexes = useMemo(() => {
    const pinnedIds = new Set(
      [selectedSnapshotId, activeSnapshotId, playingSnapshotId, draggedId].filter(
        (id) => id != null,
      ),
    );
    const indexes = [];
    renderedSnapshots.forEach((snapshot, index) => {
      if (pinnedIds.has(snapshot.id)) indexes.push(index);
    });
    const selectedBarBucket = barDisplayBucket(sortedBars[selectedBarIndex]?.position);
    if (selectedBarBucket >= 0 && selectedBarBucket < renderedSnapshots.length) {
      indexes.push(selectedBarBucket);
    }
    return indexes;
  }, [
    activeSnapshotId,
    draggedId,
    playingSnapshotId,
    renderedSnapshots,
    selectedBarIndex,
    selectedSnapshotId,
    sortedBars,
  ]);
  const virtualSequenceMode = sequenceVirtualizationMode(
    timedPlaybackOwnsViewport,
    draggedId != null || draggedEventId != null || draggedBarId != null || dragRenderSettling,
  );
  const sequenceVirtualization = useSequenceVirtualization({
    scrollPanelRef,
    contentRef: virtualSequenceListRef,
    items: virtualSequenceItems,
    pinnedIndexes: virtualPinnedIndexes,
    revision: sequenceRuntime.runtimeInstanceId,
    // Manual editing gets a wider, measured window so structural changes such
    // as snapshot deletion promptly rebuild accurate spacer geometry. Timed
    // playback keeps the smaller estimate-only path to avoid measurement and
    // mount churn on the main thread while cues advance.
    measureRows: virtualSequenceMode.measureRows,
    overscan: virtualSequenceMode.overscan,
  });
  const {
    layout: virtualSequenceLayout,
    measureItem: measureVirtualSequenceItem,
    scrollIndexIntoView: scrollVirtualSequenceIndexIntoView,
    cancelPendingStartAnchor: cancelVirtualSequenceAnchor,
    releaseStartAnchorLayout: releaseVirtualSequenceAnchor,
  } = sequenceVirtualization;
  const renderedSnapshotIndexById = useMemo(
    () => new Map(renderedSnapshots.map((snapshot, index) => [snapshot.id, index])),
    [renderedSnapshots],
  );
  const redirectPlaybackSelectWheel = useCallback(
    (event) => {
      const deltaY = Number(event.deltaY) || 0;
      if (Math.abs(deltaY) < Math.abs(Number(event.deltaX) || 0)) return;
      if (event.cancelable) event.preventDefault();
      event.currentTarget.blur();
      cancelVirtualSequenceAnchor();
      const panel = scrollPanelRef.current;
      if (!(panel instanceof HTMLElement) || deltaY === 0) return;
      const multiplier =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? panel.clientHeight : 1;
      panel.scrollTop += deltaY * multiplier;
    },
    [cancelVirtualSequenceAnchor, scrollPanelRef],
  );
  const materializeVirtualViewport = useCallback(
    (firstIndex, lastIndex = firstIndex) => {
      if (virtualSequenceItems.length === 0) return [];
      let first = Math.max(0, Math.min(virtualSequenceItems.length - 1, Number(firstIndex)));
      let last = Math.max(first, Math.min(virtualSequenceItems.length - 1, Number(lastIndex)));
      const panelHeight =
        scrollPanelRef.current instanceof HTMLElement
          ? scrollPanelRef.current.clientHeight || 640
          : 640;
      const paddingBudget = panelHeight + SEQUENCE_VIRTUALIZATION_OVERSCAN_PX;
      let beforeHeight = 0;
      while (first > 0 && beforeHeight < paddingBudget) {
        first -= 1;
        beforeHeight += Math.max(1, Number(virtualSequenceItems[first]?.estimatedSize) || 1);
      }
      let afterHeight = 0;
      while (last < virtualSequenceItems.length - 1 && afterHeight < paddingBudget) {
        last += 1;
        afterHeight += Math.max(1, Number(virtualSequenceItems[last]?.estimatedSize) || 1);
      }
      return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
    },
    [scrollPanelRef, virtualSequenceItems],
  );
  const scrollVirtualSnapshotRowIntoView = useCallback(
    (snapshotId) => {
      const index = renderedSnapshotIndexById.get(snapshotId);
      return index == null ? false : scrollVirtualSequenceIndexIntoView(index);
    },
    [renderedSnapshotIndexById, scrollVirtualSequenceIndexIntoView],
  );

  useLayoutEffect(() => {
    cancelNavigationAutoscroll();
    timedAutoscrollPresenterRef.current?.cancel();
  }, [cancelNavigationAutoscroll, sequenceRuntime.runtimeInstanceId]);
  const prepareSnapshotViewport = useCallback(
    (snapshotIndex) => {
      const numericIndex = Number(snapshotIndex);
      if (
        timedPlaybackOwnsViewport ||
        !autoScrollEnabledRef.current ||
        !Number.isInteger(numericIndex)
      )
        return false;
      const scrollPanel = scrollPanelRef.current;
      const playbackRect =
        playbackRowRef.current instanceof HTMLElement
          ? playbackRowRef.current.getBoundingClientRect()
          : null;
      const panelRect =
        scrollPanel instanceof HTMLElement ? scrollPanel.getBoundingClientRect() : null;
      const stickyTransportOverlap =
        playbackRect == null || panelRect == null
          ? 0
          : Math.max(0, Math.min(playbackRect.bottom, panelRect.bottom) - panelRect.top);
      const materializedIndexes = materializeVirtualViewport(numericIndex);
      releaseVirtualSequenceAnchor();
      return scrollVirtualSequenceIndexIntoView(numericIndex, {
        align: "start",
        topOffset: stickyTransportOverlap + 6,
        bottomOffset: measureSequenceBottomOcclusion(),
        targetIndexes: [numericIndex],
        materializedIndexes,
        retainedIndexes: materializedIndexes,
        requireMeasuredLayout: true,
        applyOnce: true,
      });
    },
    [
      playbackRowRef,
      materializeVirtualViewport,
      releaseVirtualSequenceAnchor,
      scrollPanelRef,
      scrollVirtualSequenceIndexIntoView,
      measureSequenceBottomOcclusion,
      timedPlaybackOwnsViewport,
    ],
  );
  const prepareSequenceEndViewport = useCallback(() => {
    const lastIndex = renderedSnapshots.length - 1;
    if (lastIndex < 0) return false;
    const materializedIndexes = materializeVirtualViewport(lastIndex);
    releaseVirtualSequenceAnchor();
    return scrollVirtualSequenceIndexIntoView(lastIndex, {
      align: "end",
      bottomOffset: measureSequenceBottomOcclusion(),
      targetIndexes: [lastIndex],
      materializedIndexes,
      retainedIndexes: materializedIndexes,
      requireMeasuredLayout: true,
      applyOnce: true,
    });
  }, [
    materializeVirtualViewport,
    measureSequenceBottomOcclusion,
    releaseVirtualSequenceAnchor,
    renderedSnapshots.length,
    scrollVirtualSequenceIndexIntoView,
  ]);
  const jumpSequencePlayheadToEndAndScrollBottom = useCallback(() => {
    transportScrollTargetRef.current = "bar";
    cancelNavigationAutoscroll();
    // Move into the estimated final window immediately, then let the measured
    // end-anchor above correct the viewport to the actual last rendered row.
    const scrollPanel = scrollPanelRef.current;
    if (scrollPanel instanceof HTMLElement) {
      scrollPanel.scrollTop = Math.max(0, scrollPanel.scrollHeight - scrollPanel.clientHeight);
    }
    prepareSequenceEndViewport();
    onJumpSequenceEnd?.();
  }, [
    cancelNavigationAutoscroll,
    onJumpSequenceEnd,
    prepareSequenceEndViewport,
    scrollPanelRef,
    transportScrollTargetRef,
  ]);
  const prepareBarViewport = useCallback(
    (barIndex) => {
      const numericBarIndex = Number(barIndex);
      if (
        timedPlaybackOwnsViewport ||
        !autoScrollEnabledRef.current ||
        !Number.isInteger(numericBarIndex)
      )
        return false;
      const bar = sortedBars[numericBarIndex] ?? null;
      const virtualIndex = barDisplayBucket(bar?.position);
      if (virtualIndex < 0 || virtualIndex >= renderedSnapshots.length) return false;
      const alignAtSequenceEnd =
        virtualIndex === renderedSnapshots.length - 1 &&
        Number(bar?.position) >= snapshots.length + 1;
      const structuralKeys = structuralScrollKeysAtPosition(bar.position);
      const materializedIndexes = materializeVirtualViewport(virtualIndex);
      releaseVirtualSequenceAnchor();
      return scrollVirtualSequenceIndexIntoView(virtualIndex, {
        align: alignAtSequenceEnd ? "end" : "start",
        topOffset: 6,
        bottomOffset: measureSequenceBottomOcclusion(),
        targetIndexes: [virtualIndex],
        materializedIndexes,
        retainedIndexes: materializedIndexes,
        preferredStructuralKey: structuralKeys[0] ?? null,
        targetStructuralKeys: structuralKeys,
        requireMeasuredLayout: true,
        applyOnce: true,
      });
    },
    [
      releaseVirtualSequenceAnchor,
      materializeVirtualViewport,
      measureSequenceBottomOcclusion,
      renderedSnapshots.length,
      scrollVirtualSequenceIndexIntoView,
      snapshots.length,
      sortedBars,
      structuralScrollKeysAtPosition,
      timedPlaybackOwnsViewport,
    ],
  );
  const pendingStructuralViewportRef = useRef(null);
  const queueStructuralViewport = useCallback(
    (position) => {
      const numericPosition = Number(position);
      if (!Number.isFinite(numericPosition)) return;
      pendingStructuralViewportRef.current = {
        position: numericPosition,
        markerCount: structuralScrollKeysAtPosition(numericPosition).length,
      };
    },
    [structuralScrollKeysAtPosition],
  );
  const prepareStructuralPositionViewport = useCallback(
    (position) => {
      const time = Number(position);
      if (timedPlaybackOwnsViewport || !autoScrollEnabledRef.current || !Number.isFinite(time)) {
        return false;
      }
      const snapshotIndex = Math.max(
        0,
        Math.min(renderedSnapshots.length - 1, Math.floor(time) - 1),
      );
      if (renderedSnapshots.length === 0) return false;
      const alignAtSequenceEnd =
        snapshotIndex === renderedSnapshots.length - 1 && time >= snapshots.length + 1;
      const structuralKeys = structuralScrollKeysAtPosition(time);
      if (structuralKeys.length === 0) return false;
      const materializedIndexes = materializeVirtualViewport(snapshotIndex);
      releaseVirtualSequenceAnchor();
      return scrollVirtualSequenceIndexIntoView(snapshotIndex, {
        align: alignAtSequenceEnd ? "end" : "start",
        topOffset: 6,
        bottomOffset: measureSequenceBottomOcclusion(),
        targetIndexes: [snapshotIndex],
        materializedIndexes,
        retainedIndexes: materializedIndexes,
        preferredStructuralKey: structuralKeys[0],
        targetStructuralKeys: structuralKeys,
        requireMeasuredLayout: true,
        applyOnce: true,
      });
    },
    [
      materializeVirtualViewport,
      measureSequenceBottomOcclusion,
      releaseVirtualSequenceAnchor,
      renderedSnapshots.length,
      scrollVirtualSequenceIndexIntoView,
      snapshots.length,
      structuralScrollKeysAtPosition,
      timedPlaybackOwnsViewport,
    ],
  );
  useLayoutEffect(() => {
    const pendingStructuralViewport = pendingStructuralViewportRef.current;
    if (pendingStructuralViewport == null) return;
    const structuralKeys = structuralScrollKeysAtPosition(pendingStructuralViewport.position);
    if (structuralKeys.length <= pendingStructuralViewport.markerCount) return;
    pendingStructuralViewportRef.current = null;
    prepareStructuralPositionViewport(pendingStructuralViewport.position);
  }, [prepareStructuralPositionViewport, structuralScrollKeysAtPosition]);
  const selectSequenceBarWithViewport = useCallback(
    (barIndex) => {
      prepareBarViewport(barIndex);
      onSelectSequenceBar?.(barIndex);
    },
    [onSelectSequenceBar, prepareBarViewport],
  );
  const pendingAddedBarPositionRef = useRef(null);
  useLayoutEffect(() => {
    const pendingPosition = pendingAddedBarPositionRef.current;
    if (!Number.isFinite(pendingPosition)) return;
    const addedBarIndex = sortedBars.findIndex(
      (bar) => Math.abs(Number(bar?.position) - pendingPosition) < 1e-9,
    );
    if (addedBarIndex < 0) return;
    pendingAddedBarPositionRef.current = null;
    transportScrollTargetRef.current = "bar";
    selectSequenceBarWithViewport(addedBarIndex);
  }, [selectSequenceBarWithViewport, sortedBars, transportScrollTargetRef]);
  const armVirtualizedPendingSnapshot = useCallback(
    (snapshotIndex) => {
      prepareSnapshotViewport(snapshotIndex);
      armPendingSnapshot(snapshotIndex, { viewportPrepared: true });
    },
    [armPendingSnapshot, prepareSnapshotViewport],
  );
  useLayoutEffect(() => {
    const previousSnapshotIds = previousSnapshotIdsRef.current;
    const nextSnapshotIds = new Set(snapshots.map((snapshot) => snapshot.id));
    previousSnapshotIdsRef.current = nextSnapshotIds;
    if (nextSnapshotIds.size <= previousSnapshotIds.size) return;
    if (workspaceMutationViewportRef.current != null) return;
    const selectedIndex = snapshots.findIndex(
      (snapshot) => snapshot.id === selectedSnapshotId && !previousSnapshotIds.has(snapshot.id),
    );
    if (selectedIndex < 0) return;
    armVirtualizedPendingSnapshot(selectedIndex);
  }, [armVirtualizedPendingSnapshot, selectedSnapshotId, snapshots]);
  const prepareCueViewport = useCallback(
    (cueIndex, { onApplied = null } = {}) => {
      const numericCueIndex = Number(cueIndex);
      if (
        timedPlaybackOwnsViewport ||
        !autoScrollEnabledRef.current ||
        !Number.isInteger(numericCueIndex)
      )
        return false;
      const cueViewport = deriveCueViewportPlan({
        cueIndexZeroBased: numericCueIndex,
        sequenceEvents,
      });
      const cueSnapshotIds = cueViewport.snapshotIds;
      const overflowEvent =
        cueViewport.overflowEventId == null
          ? null
          : (sequenceEvents.find((event) => event.eventId === cueViewport.overflowEventId) ?? null);
      const cueEventIds = new Set(cueViewport.eventIds);
      // sequenceEvents.snapshotIndex addresses renderedSnapshots. Source
      // snapshot indexes diverge after the runtime inserts display snapshots, so
      // converting these IDs through `snapshots` can anchor a later visible row.
      const cueSnapshotIndexes = [
        ...new Set(
          sequenceEvents
            .filter((event) => cueEventIds.has(event.eventId))
            .map((event) => renderedSnapshotIndexById.get(event.snapshotId))
            .filter(
              (index) => Number.isInteger(index) && index >= 0 && index < renderedSnapshots.length,
            ),
        ),
      ];
      const recentSnapshotId =
        overflowEvent?.snapshotId ??
        resolveCueAnchorSnapshotId({
          activeCueIndex: numericCueIndex + 1,
          sequenceCueGroups,
          sequenceEvents,
          snapshots,
          cueExpandedSnapshotIds: cueSnapshotIds,
        });
      const overflowSnapshotIndex = renderedSnapshotIndexById.get(overflowEvent?.snapshotId);
      const recentSnapshotIndex = Number.isInteger(overflowSnapshotIndex)
        ? overflowSnapshotIndex
        : recentSnapshotId == null
          ? (sequenceCueGroups[numericCueIndex]?.snapshotIndex ?? null)
          : (renderedSnapshotIndexById.get(recentSnapshotId) ?? null);
      if (!Number.isInteger(recentSnapshotIndex) || recentSnapshotIndex < 0) return false;
      const firstRelevantIndex =
        cueSnapshotIndexes.length > 0 ? Math.min(...cueSnapshotIndexes) : recentSnapshotIndex;
      const lastRelevantIndex =
        cueSnapshotIndexes.length > 0 ? Math.max(...cueSnapshotIndexes) : recentSnapshotIndex;
      const relevantIndexes = Array.from(
        { length: lastRelevantIndex - firstRelevantIndex + 1 },
        (_, offset) => firstRelevantIndex + offset,
      );
      const materializedIndexes = materializeVirtualViewport(
        relevantIndexes[0],
        relevantIndexes.at(-1),
      );
      const scrollPanel = scrollPanelRef.current;
      const playbackRect =
        playbackRowRef.current instanceof HTMLElement
          ? playbackRowRef.current.getBoundingClientRect()
          : null;
      const panelRect =
        scrollPanel instanceof HTMLElement ? scrollPanel.getBoundingClientRect() : null;
      const stickyTransportOverlap =
        playbackRect == null || panelRect == null
          ? 0
          : Math.max(0, Math.min(playbackRect.bottom, panelRect.bottom) - panelRect.top);
      return scrollVirtualSequenceIndexIntoView(recentSnapshotIndex, {
        align: "start",
        topOffset: stickyTransportOverlap + 6,
        bottomOffset: measureSequenceBottomOcclusion(),
        // Mount the complete physical interval. No estimated spacer is then
        // allowed between the first and last relevant event row.
        targetIndexes: relevantIndexes,
        materializedIndexes,
        // Keep the exact interval used to calculate this one scroll. Dropping
        // the intervening snapshots immediately after applying the anchor
        // changes the virtual offsets and invalidates the chosen row position.
        // The next cue transaction replaces this interval.
        retainedIndexes: materializedIndexes,
        overflowAlignment: "end",
        preferredEventId: cueViewport.overflowEventId,
        targetEventIds: cueViewport.eventIds,
        requireMountedEventTargets: true,
        requireMeasuredLayout: true,
        applyOnce: true,
        onApplied,
      });
    },
    [
      playbackRowRef,
      materializeVirtualViewport,
      measureSequenceBottomOcclusion,
      renderedSnapshotIndexById,
      renderedSnapshots.length,
      scrollPanelRef,
      scrollVirtualSequenceIndexIntoView,
      sequenceCueGroups,
      sequenceEvents,
      snapshots,
      timedPlaybackOwnsViewport,
    ],
  );
  const startCueViewportTransaction = useCallback(
    (cueIndex) => {
      const numericCueIndex = Number(cueIndex);
      if (!Number.isInteger(numericCueIndex)) return;
      cueViewportGenerationRef.current += 1;
      releaseVirtualSequenceAnchor();
      setCueViewportTransaction({
        generation: cueViewportGenerationRef.current,
        cueIndex: numericCueIndex,
        phase: "expand",
      });
    },
    [releaseVirtualSequenceAnchor],
  );
  const armVirtualizedPendingCue = useCallback(
    (cueIndex) => {
      armPendingCue(cueIndex, { viewportPrepared: true });
      startCueViewportTransaction(cueIndex);
    },
    [armPendingCue, startCueViewportTransaction],
  );

  const armNavigationAutoscrollIntent = useCallback((mode, fromTarget) => {
    navigationAutoscrollIntentRef.current = {
      mode,
      fromTarget,
    };
  }, []);
  const consumeNavigationAutoscrollIntent = useCallback((mode, currentTarget) => {
    const intent = navigationAutoscrollIntentRef.current;
    if (intent == null) return false;
    if (intent.mode !== mode) return false;
    navigationAutoscrollIntentRef.current = null;
    if (Object.is(intent.fromTarget, currentTarget)) return false;
    return true;
  }, []);
  const stepSequenceWithAutoscroll = useCallback(
    (direction) => {
      transportScrollTargetRef.current = "snapshot";
      armNavigationAutoscrollIntent("snapshot", activeSnapshotId);
      onStepSequence?.(direction);
    },
    [activeSnapshotId, armNavigationAutoscrollIntent, onStepSequence, transportScrollTargetRef],
  );
  const jumpSequenceSnapshotWithAutoscroll = useCallback(
    (snapshotIndex) => {
      transportScrollTargetRef.current = "snapshot";
      armNavigationAutoscrollIntent("snapshot", activeSnapshotId);
      onJumpSequenceSnapshot?.(snapshotIndex);
    },
    [
      activeSnapshotId,
      armNavigationAutoscrollIntent,
      onJumpSequenceSnapshot,
      transportScrollTargetRef,
    ],
  );
  // CUE selection has already prepared its viewport. Triggering that queued
  // cue leaves activeCueIndex unchanged, so the intent below deliberately
  // produces no scroll. Later arrow presses change the cue index and prepare
  // the newly reached cue through the layout effect.
  const stepSequenceMarkerWithAutoscroll = useCallback(
    (direction) => {
      transportScrollTargetRef.current = "cue";
      const triggersPreparedCue =
        direction > 0 &&
        playhead?.stopped === true &&
        Number.isFinite(pendingTransportSelection?.cueIndex);
      if (triggersPreparedCue) {
        cueStepViewportRequestedRef.current = false;
        cueViewportGenerationRef.current += 1;
        setCueViewportTransaction(null);
        cancelNavigationAutoscroll();
        cancelVirtualSequenceAnchor();
        onStepSequenceMarker?.(direction);
        return;
      }
      cueStepViewportRequestedRef.current = true;
      onStepSequenceMarker?.(direction);
    },
    [
      cancelNavigationAutoscroll,
      cancelVirtualSequenceAnchor,
      onStepSequenceMarker,
      pendingTransportSelection?.cueIndex,
      playhead?.stopped,
      transportScrollTargetRef,
    ],
  );
  const jumpSequenceCueWithAutoscroll = useCallback(
    (cueIndex) => {
      transportScrollTargetRef.current = "cue";
      cueStepViewportRequestedRef.current = true;
      onJumpSequenceCue?.(cueIndex);
    },
    [onJumpSequenceCue, transportScrollTargetRef],
  );

  useLayoutEffect(() => {
    if (timedPlaybackOwnsViewport) return;
    if (!Number.isFinite(activeCueIndex)) return;
    if (!cueStepViewportRequestedRef.current) return;
    cueStepViewportRequestedRef.current = false;
    startCueViewportTransaction(activeCueIndex - 1);
  }, [activeCueIndex, startCueViewportTransaction, timedPlaybackOwnsViewport]);

  useLayoutEffect(() => {
    if (cueViewportTransaction == null) return;
    const { cueIndex, generation, phase } = cueViewportTransaction;
    if (phase === "expand") {
      const requiredExpandedIds = cueExpandedSnapshotIdsAt(cueIndex);
      if (!showAllEvents && !sameSnapshotSet(expandedIds, requiredExpandedIds)) {
        setExpandedIds(requiredExpandedIds);
      }
      setCueViewportTransaction((current) =>
        current?.generation === generation ? { ...current, phase: "materialize" } : current,
      );
      return;
    }
    if (phase !== "materialize") return;
    if (timedPlaybackOwnsViewport || !autoScrollEnabledRef.current) {
      setCueViewportTransaction((current) => (current?.generation === generation ? null : current));
      return;
    }
    const onApplied = () => {
      setCueViewportTransaction((current) =>
        current?.generation === generation ? { ...current, phase: "prepared" } : current,
      );
    };
    setCueViewportTransaction((current) =>
      current?.generation === generation ? { ...current, phase: "measuring" } : current,
    );
    prepareCueViewport(cueIndex, { onApplied });
  }, [
    cueExpandedSnapshotIdsAt,
    cueViewportTransaction,
    expandedIds,
    prepareCueViewport,
    showAllEvents,
    timedPlaybackOwnsViewport,
  ]);

  editPlayLayoutReanchorCallbacksRef.current = {
    prepareBarViewport,
    prepareSnapshotViewport,
    startCueViewportTransaction,
  };

  useLayoutEffect(() => {
    const request = editPlayLayoutReanchorRef.current;
    if (request == null) return undefined;
    let settleFrame = null;
    const layoutFrame = window.requestAnimationFrame(() => {
      settleFrame = window.requestAnimationFrame(() => {
        if (editPlayLayoutReanchorRef.current?.generation !== request.generation) return;
        editPlayLayoutReanchorRef.current = null;
        if (timedPlaybackOwnsViewport || !autoScrollEnabledRef.current) return;
        const callbacks = editPlayLayoutReanchorCallbacksRef.current;
        if (request.target === "cue") {
          callbacks?.startCueViewportTransaction(request.index);
        } else if (request.target === "bar") {
          callbacks?.prepareBarViewport(request.index);
        } else {
          callbacks?.prepareSnapshotViewport(request.index);
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(layoutFrame);
      if (settleFrame != null) window.cancelAnimationFrame(settleFrame);
    };
  }, [showAllEvents, timedPlaybackOwnsViewport, virtualSequenceLayout]);

  useLayoutEffect(() => {
    if (timedPlaybackOwnsViewport) return;
    if (Number.isFinite(activeCueIndex) || activeSnapshotId == null) return;
    if (!consumeNavigationAutoscrollIntent("snapshot", activeSnapshotId)) return;
    const activeSnapshotIndex = snapshots.findIndex((snapshot) => snapshot.id === activeSnapshotId);
    if (activeSnapshotIndex < 0) return;
    prepareSnapshotViewport(activeSnapshotIndex);
  }, [
    activeCueIndex,
    activeSnapshotId,
    consumeNavigationAutoscrollIntent,
    prepareSnapshotViewport,
    snapshots,
    timedPlaybackOwnsViewport,
  ]);

  useLayoutEffect(() => {
    const focus = workspaceMutationViewportRef.current;
    if (focus == null || focus.snapshotCount !== snapshots.length) return;
    if (timedPlaybackOwnsViewport || !autoScrollEnabledRef.current) {
      workspaceMutationViewportRef.current = null;
      return;
    }
    if (focus.kind === "end") {
      workspaceMutationViewportRef.current = null;
      const scrollPanel = scrollPanelRef.current;
      if (scrollPanel instanceof HTMLElement) {
        scrollPanel.scrollTop = Math.max(0, scrollPanel.scrollHeight - scrollPanel.clientHeight);
      }
      return;
    }
    const renderedIndex = renderedSnapshotIndexById.get(focus.snapshotId);
    if (renderedIndex == null) return;
    workspaceMutationViewportRef.current = null;
    prepareSnapshotViewport(renderedIndex);
  }, [
    prepareSnapshotViewport,
    renderedSnapshotIndexById,
    scrollPanelRef,
    snapshots.length,
    timedPlaybackOwnsViewport,
    virtualSequenceLayout,
  ]);

  useLayoutEffect(() => {
    if (!timedPlaybackOwnsViewport) return;
    cueViewportGenerationRef.current += 1;
    setCueViewportTransaction(null);
    releaseVirtualSequenceAnchor();
    cancelNavigationAutoscroll();
  }, [cancelNavigationAutoscroll, releaseVirtualSequenceAnchor, timedPlaybackOwnsViewport]);

  useEffect(() => {
    refreshPendingSnapshotAlignment();
  }, [refreshPendingSnapshotAlignment, virtualSequenceLayout]);

  useEffect(() => {
    const setTransportField = (field, value) => {
      if (value != null) timedTransportFieldValuesRef.current[field] = String(value);
      const select =
        playbackRowRef.current?.querySelector?.(`[data-timed-transport-field="${field}"]`) ?? null;
      if (select && value != null) select.value = String(value);
    };
    const highlightPresenter = createTimedPlaybackHighlightPresenter({
      resolveSnapshotRow: (snapshotId) => snapshotRowRefs.current.get(snapshotId) ?? null,
      resolveEventRow: (eventId) => eventRowRefs.current.get(eventId) ?? null,
    });
    const autoscrollPresenter = createTimedPlaybackAutoscrollPresenter({
      isEnabled: () => autoScrollEnabledRef.current,
      resolveSnapshotRow: (snapshotId) => snapshotRowRefs.current.get(snapshotId) ?? null,
      resolveEventRow: (eventId) => eventRowRefs.current.get(eventId) ?? null,
      prepareSnapshotRow: scrollVirtualSnapshotRowIntoView,
      scrollSnapshotRow: scrollNodeIntoPanel,
      scrollSnapshotRows: scrollNodesIntoPanel,
    });
    const readoutPresenter = createTimedTransportReadoutPresenter({
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
    timedHighlightPresenterRef.current = highlightPresenter;
    timedAutoscrollPresenterRef.current = autoscrollPresenter;
    timedReadoutPresenterRef.current = readoutPresenter;
    timedVisualCueHandlerRef.current = (cueIndex, trigger, burst) => {
      const cueGroup = sequenceCueGroups[cueIndex] ?? null;
      const snapshotIndex = cueGroup?.snapshotIndex ?? null;
      const snapshotId = cueGroup == null ? null : (snapshots[snapshotIndex]?.id ?? null);
      const soundingAfter = Array.isArray(burst?.soundingAfter) ? burst.soundingAfter : [];
      const soundingEventIds = new Set(
        soundingAfter.map((note) => note?.eventId).filter((eventId) => eventId != null),
      );
      const sequenceTime = Number(burst?.sequenceTime ?? trigger?.sequenceTime);
      const barBeat = Number.isFinite(sequenceTime)
        ? absolutePositionToBarBeat(sequenceTime, sortedBars, 1, 9, terminalBarlinePosition)
        : null;
      const transport = {
        barIndex: Number.isFinite(barBeat?.barNumber) ? barBeat.barNumber - 1 : null,
        snapshotIndex,
        cueIndex,
      };
      highlightPresenter.present({
        snapshotId,
        soundingEventIds: [...soundingEventIds],
      });
      readoutPresenter.present(transport);

      if (!showAllEvents) {
        const timedExpandedSnapshotIds = new Set(
          soundingAfter.map((note) => note?.snapshotId).filter((id) => id != null),
        );
        if (timedExpandedSnapshotIds.size === 0 && snapshotId != null) {
          timedExpandedSnapshotIds.add(snapshotId);
        }
        setExpandedIds((previous) =>
          sameSnapshotSet(previous, timedExpandedSnapshotIds) ? previous : timedExpandedSnapshotIds,
        );
      }

      if (!autoScrollEnabledRef.current) {
        autoscrollPresenter.cancel();
        return;
      }

      const pageFollowPosition = deriveTimedPageFollowPosition({
        burst,
        sequenceEvents,
        snapshots,
        fallbackSnapshotIndex: snapshotIndex,
        fallbackSnapshotId: snapshotId,
      });
      // Newly attacked rows are preferred. When this playback position has no
      // note-ON, its current snapshot row still drives the page turn. Sustained
      // old notes never become scroll targets.
      if (pageFollowPosition != null) autoscrollPresenter.enqueue(pageFollowPosition);
    };

    return () => {
      timedVisualCueHandlerRef.current = null;
      timedHighlightPresenterRef.current = null;
      timedAutoscrollPresenterRef.current = null;
      timedReadoutPresenterRef.current = null;
      highlightPresenter.dispose();
      autoscrollPresenter.dispose();
      readoutPresenter.dispose();
    };
  }, [
    cueSelectValue,
    eventRowRefs,
    playbackRowRef,
    playhead?.barIndex,
    scrollVirtualSnapshotRowIntoView,
    scrollNodeIntoPanel,
    scrollNodesIntoPanel,
    scrollPanelRef,
    sequenceCueGroups,
    setExpandedIds,
    showAllEvents,
    snapshotRowRefs,
    snapshotSelectValue,
    snapshots,
    sortedBars,
    terminalBarlinePosition,
    sequenceEvents,
  ]);

  useEffect(() => {
    if (timedTransportUiState.running) return;
    pendingTimedVisualNotificationRef.current = null;
    if (timedVisualNotificationFrameRef.current != null) {
      window.cancelAnimationFrame(timedVisualNotificationFrameRef.current);
      timedVisualNotificationFrameRef.current = null;
    }
    timedHighlightPresenterRef.current?.clear();
    timedAutoscrollPresenterRef.current?.cancel();
    timedReadoutPresenterRef.current?.clear();
  }, [timedTransportUiState.running]);

  useEffect(() => {
    if (!timedTransportUiState.running) return undefined;
    const refreshFrame = window.requestAnimationFrame(() => {
      timedHighlightPresenterRef.current?.refresh();
    });
    return () => window.cancelAnimationFrame(refreshFrame);
  }, [timedTransportUiState.running, virtualSequenceLayout]);

  useEffect(
    () => () => {
      pendingTimedVisualNotificationRef.current = null;
      if (timedVisualNotificationFrameRef.current != null) {
        window.cancelAnimationFrame(timedVisualNotificationFrameRef.current);
        timedVisualNotificationFrameRef.current = null;
      }
    },
    [],
  );

  if (!timedTransportUiState.running) {
    timedTransportFieldValuesRef.current = {
      bar: String(playhead?.barIndex ?? 0),
      snapshot: String(snapshotSelectValue),
      cue: String(cueSelectValue),
    };
  }
  const timedTransportFieldValues = timedTransportFieldValuesRef.current;
  const displayedSnapshotSelectValue = timedTransportUiState.running
    ? timedTransportFieldValues.snapshot
    : snapshotSelectValue;
  const displayedCueSelectValue = timedTransportUiState.running
    ? timedTransportFieldValues.cue
    : cueSelectValue;

  useEffect(() => {
    if (timedPlaybackOwnsViewport) return;
    const pendingCueIndex =
      transportScrollTargetRef.current === "cue" &&
      Number.isFinite(pendingTransportSelection?.cueIndex)
        ? pendingTransportSelection.cueIndex
        : null;
    const nextExpandedIds = deriveExpandedSnapshotIds({
      showAllEvents,
      cueExpandedSnapshotIdsAt,
      playheadIsOff,
      playheadIsEnd,
      selectedSnapshotId,
      activeCueIndex,
      pendingCueIndex,
      cueExpandedSnapshotIds,
      suppressSelectedSnapshotPreview:
        !showAllEvents &&
        activeCueIndex == null &&
        selectedSnapshotId != null &&
        compactSelectionPreviewSuppressedId === selectedSnapshotId,
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
    pendingTransportSelection?.cueIndex,
    selectedSnapshotId,
    showAllEvents,
    timedPlaybackOwnsViewport,
    transportScrollTargetRef,
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

  const selectSnapshotForEditing = useCallback(
    (snapshotId) => {
      const snapshotIndex = snapshots.findIndex((snapshot) => snapshot.id === snapshotId);
      if (snapshotIndex >= 0) {
        const snapshotPosition = String(snapshotIndex + 1);
        setCopyRangeStart(snapshotPosition);
        setCopyRangeEnd(snapshotPosition);
      }
      onSelectSnapshot?.(snapshotId);
    },
    [onSelectSnapshot, snapshots],
  );

  const toggleEditPlayLayout = useCallback(() => {
    const target = transportScrollTargetRef.current;
    let index = null;
    if (target === "cue") {
      index = Number.isFinite(pendingTransportSelection?.cueIndex)
        ? Number(pendingTransportSelection.cueIndex)
        : Number.isFinite(activeCueIndex)
          ? Number(activeCueIndex) - 1
          : Number(cueSelectValue);
    } else if (target === "bar") {
      index = Number(selectedBarIndex);
    } else {
      const activeRenderedIndex = renderedSnapshotIndexById.get(activeSnapshotId);
      index = Number.isFinite(pendingTransportSelection?.snapshotIndex)
        ? Number(pendingTransportSelection.snapshotIndex)
        : Number.isInteger(activeRenderedIndex)
          ? activeRenderedIndex
          : Number(snapshotSelectValue);
    }
    if (Number.isInteger(index) && index >= 0) {
      editPlayLayoutReanchorGenerationRef.current += 1;
      editPlayLayoutReanchorRef.current = {
        generation: editPlayLayoutReanchorGenerationRef.current,
        target,
        index,
      };
    } else {
      editPlayLayoutReanchorRef.current = null;
    }
    setShowAllEvents((value) => !value);
  }, [
    activeCueIndex,
    activeSnapshotId,
    cueSelectValue,
    pendingTransportSelection?.cueIndex,
    pendingTransportSelection?.snapshotIndex,
    renderedSnapshotIndexById,
    selectedBarIndex,
    snapshotSelectValue,
    transportScrollTargetRef,
  ]);

  const handleSnapshotRowClick = useCallback(
    (snapshotId, isSelected) => {
      selectSnapshotForEditing(snapshotId);
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
    },
    [selectSnapshotForEditing, showAllEvents],
  );

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

  const requireValidCopyRange = useCallback(() => {
    if (resolvedCopyRange?.valid) return true;
    setCopyInsertStatus("Choose a valid snapshot range first.");
    return false;
  }, [resolvedCopyRange?.valid]);

  const buildRangeEditUndo = useCallback(
    (extra = {}) => {
      const rangeSnapshots = snapshots.slice(
        resolvedCopyRange.startPosition - 1,
        resolvedCopyRange.endPosition,
      );
      return {
        snapshots: rangeSnapshots,
        snapshotIds: rangeSnapshots.map((snapshot) => snapshot.id),
        ...extra,
      };
    },
    [resolvedCopyRange, snapshots],
  );

  const handleResetSnapshotRangeNoteOffsetsInPlace = useCallback(() => {
    if (!requireValidCopyRange()) return;
    const undo = buildRangeEditUndo();
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
    setRangeEditUndo(undo);
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
    buildRangeEditUndo,
    requireValidCopyRange,
  ]);

  const handleDeleteSnapshotRange = useCallback(() => {
    if (!requireValidCopyRange()) return;
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
    workspaceMutationViewportRef.current = result?.focus ?? null;
    setCopiedSnapshotBlock(null);
    setRangeEditUndo(null);
    setCopyInsertStatus(
      `Deleted ${resolvedCopyRange.length} snapshot${resolvedCopyRange.length === 1 ? "" : "s"}` +
        `${copyIncludeBars ? " with bars" : ""}` +
        `${copyIncludeTempi ? ", tempi" : ""}` +
        `${copyIncludeRepeats ? ", repeats" : ""}.`,
    );
  }, [
    copyIncludeBars,
    copyIncludeRepeats,
    copyIncludeTempi,
    copyRangeEnd,
    copyRangeStart,
    onDeleteSnapshotRange,
    requireValidCopyRange,
    resetDraftEditingState,
    resolvedCopyRange,
  ]);

  const handleDeleteSnapshot = useCallback(
    (snapshotId) => {
      const result = onDeleteSnapshot?.(snapshotId);
      workspaceMutationViewportRef.current = result?.focus ?? null;
    },
    [onDeleteSnapshot],
  );

  const handleSetSnapshotRangeArticulation = useCallback(
    (articulation) => {
      if (!requireValidCopyRange()) return;
      const undo = buildRangeEditUndo({
        manualArpeggiationMode: normalizedManualArpeggiation.mode,
      });
      const result = onSetSnapshotRangeArticulation?.(
        {
          startPosition: copyRangeStart,
          endPosition: copyRangeEnd,
          includeBars: copyIncludeBars,
        },
        articulation,
      );
      if (typeof result === "string" && result) {
        setCopyInsertStatus("Unable to set arpeggiation for the selected range.");
        return;
      }
      setRangeEditUndo(undo);
      if (normalizedManualArpeggiation.mode !== "per-snapshot") {
        onManualArpeggiationChange?.({ mode: "per-snapshot" });
      }
      setCopyInsertStatus(
        `Set ${resolvedCopyRange.length} snapshot${resolvedCopyRange.length === 1 ? "" : "s"}` +
          ` to ${articulation === "arpeggiate" ? "arp" : "chord"}.`,
      );
    },
    [
      buildRangeEditUndo,
      copyIncludeBars,
      copyRangeEnd,
      copyRangeStart,
      normalizedManualArpeggiation.mode,
      onManualArpeggiationChange,
      onSetSnapshotRangeArticulation,
      requireValidCopyRange,
      resolvedCopyRange,
    ],
  );

  const handleRevertSnapshotRangeChanges = useCallback(() => {
    if (!rangeEditUndo) return;
    const result = onRestoreSnapshotRangeChanges?.(rangeEditUndo.snapshots);
    if (typeof result === "string" && result) {
      setCopyInsertStatus("Unable to revert changes for the selected range.");
      return;
    }
    if (rangeEditUndo.manualArpeggiationMode) {
      onManualArpeggiationChange?.({ mode: rangeEditUndo.manualArpeggiationMode });
    }
    const restoredCount = rangeEditUndo.snapshots.length;
    setRangeEditUndo(null);
    setCopyInsertStatus(
      `Reverted changes in ${restoredCount} snapshot${restoredCount === 1 ? "" : "s"}.`,
    );
  }, [onManualArpeggiationChange, onRestoreSnapshotRangeChanges, rangeEditUndo]);

  // Local mutation adapters passed down into row components.
  const updateEventField = useCallback(
    (snapshot, noteRef, field, rawValue) => {
      const notes = updateEventFieldInSnapshot(snapshot, noteRef, field, rawValue);
      if (!notes) return;
      onUpdateSnapshot(snapshot.id, { notes });
    },
    [onUpdateSnapshot],
  );

  const toggleEventReattack = useCallback(
    (snapshot, noteRef) => {
      const notes = (snapshot?.notes ?? []).map((note) => {
        const matches =
          (noteRef?.noteId != null && note?.id === noteRef.noteId) ||
          (noteRef?.noteId == null && noteMatchesReference(note, noteRef));
        return matches ? { ...note, forceReattack: note.forceReattack !== true } : note;
      });
      onUpdateSnapshot(snapshot.id, { notes });
    },
    [onUpdateSnapshot],
  );

  const restoreEventPitchLabel = useCallback(
    (snapshot, noteRef) => {
      const notes = restoreEventPitchLabelInSnapshot(snapshot, noteRef);
      onUpdateSnapshot(snapshot.id, { notes });
    },
    [onUpdateSnapshot],
  );

  const commitEventPitchLabel = useCallback(
    (snapshot, noteRef) => {
      const notes = commitEventPitchLabelInSnapshot(snapshot, noteRef);
      onUpdateSnapshot(snapshot.id, { notes });
    },
    [onUpdateSnapshot],
  );

  const updateBarPosition = useCallback(
    (barId, rawValue) => {
      const numeric = Number(rawValue);
      if (!Number.isFinite(numeric)) return;
      onUpdateBar?.(barId, { position: Math.max(1, Math.round(numeric)) });
    },
    [onUpdateBar],
  );

  const updateTempoPosition = useCallback(
    (tempoId, rawValue) => {
      const numeric = Number(rawValue);
      if (!Number.isFinite(numeric)) return;
      const position = Math.round(numeric * 1000000) / 1000000;
      const commitKind = "tempo-position";
      const transactionId = createSequencerDiagnosticTransactionId(commitKind);
      appendPersistedSequencerCrashDiagnostic(
        {
          type: "tempo-position-commit",
          detail: "Committed sequencer tempo position",
          context: {
            source: "sequencer",
            transactionId,
            commitKind,
            tempoId,
            absoluteTime: position,
            ...readSequencerDiagnosticMemory(),
          },
        },
        globalThis.sessionStorage,
        { immediate: true },
      );
      onUpdateTempo?.(tempoId, { position });
      return { transactionId, commitKind };
    },
    [onUpdateTempo],
  );

  const updateRepeatPosition = useCallback(
    (repeatId, rawValue) => {
      const numeric = Number(rawValue);
      if (!Number.isFinite(numeric)) return;
      onUpdateRepeat?.(repeatId, { position: Math.round(numeric * 1000000) / 1000000 });
    },
    [onUpdateRepeat],
  );

  const updateRepeatCount = useCallback(
    (repeatId, rawValue) => {
      const numeric = Math.max(2, Math.round(Number(rawValue) || 2));
      if (!Number.isFinite(numeric)) return;
      onUpdateRepeat?.(repeatId, { repeatCount: numeric });
    },
    [onUpdateRepeat],
  );

  const updateTempoBpm = useCallback(
    (tempoId, rawValue) => {
      const numeric = Number(rawValue);
      if (!Number.isFinite(numeric) || numeric <= 0) return;
      onUpdateTempo?.(tempoId, { bpm: numeric });
    },
    [onUpdateTempo],
  );

  const updateTempoBeatFraction = useCallback(
    (tempoId, numerator, denominator) => {
      onUpdateTempo?.(tempoId, normalizeTempoBeatFraction(numerator, denominator));
    },
    [onUpdateTempo],
  );

  const updateTempoMode = useCallback(
    (tempoId, mode) => {
      onUpdateTempo?.(tempoId, {
        mode: mode === "gradual" ? "gradual" : "immediate",
      });
    },
    [onUpdateTempo],
  );

  const updateBarTimeSignatureField = useCallback(
    (barId, field, rawValue) => {
      if (field !== "numerator" && field !== "denominator") return;
      const parsed = Math.round(Number(rawValue) || 0);
      const numeric = Math.max(1, parsed);
      onUpdateBar?.(barId, { [field]: numeric });
    },
    [onUpdateBar],
  );

  const addBarAtRequestedPosition = () => {
    const numeric = Number(newBarPosition);
    const numerator = Math.max(1, Math.round(Number(newBarNumerator) || 1));
    const denominator = Math.max(1, Math.round(Number(newBarDenominator) || 1));
    if (!Number.isFinite(numeric)) return;
    const position = Math.max(1, Math.round(numeric));
    pendingAddedBarPositionRef.current = position;
    queueStructuralViewport(position);
    onAddBar?.(position, numerator, denominator);
    setNewBarPosition(suggestedBarPosition);
    setNewBarNumerator(suggestedBarMeter.numerator);
    setNewBarDenominator(suggestedBarMeter.denominator);
    setNewBarPositionIsSuggested(true);
    setNewBarMeterIsSuggested(true);
  };

  const loadSnapshotAtStructuralPosition = useCallback(
    (position) => {
      if (snapshots.length === 0) return;
      const numericPosition = Number(position);
      if (!Number.isFinite(numericPosition)) return;
      queueStructuralViewport(numericPosition);
      const snapshotNumber = Math.max(1, Math.floor(numericPosition));
      const snapshotIndex = Math.min(snapshots.length - 1, snapshotNumber - 1);
      armVirtualizedPendingSnapshot(snapshotIndex);
    },
    [armVirtualizedPendingSnapshot, queueStructuralViewport, snapshots.length],
  );

  const addTempoAtRequestedPosition = () => {
    const position = Number(newTempoPosition);
    const bpm = Math.round(Number(newTempoBpm));
    const beatNumerator = Math.max(1, Math.round(Number(newTempoBeatNumerator) || 1));
    const beatDenominator = Math.max(1, Math.round(Number(newTempoBeatDenominator) || 1));
    if (!Number.isFinite(position) || !Number.isFinite(bpm) || bpm <= 0) return;
    const normalizedPosition = Math.round(position * 1000000) / 1000000;
    onAddTempo?.(normalizedPosition, bpm, "immediate", beatNumerator, beatDenominator);
    loadSnapshotAtStructuralPosition(normalizedPosition);
  };

  const addTempoTransitionAtRequestedPosition = () => {
    const position = Number(newTempoPosition);
    const bpm = Math.round(Number(newTempoBpm));
    const beatNumerator = Math.max(1, Math.round(Number(newTempoBeatNumerator) || 1));
    const beatDenominator = Math.max(1, Math.round(Number(newTempoBeatDenominator) || 1));
    if (!Number.isFinite(position) || !Number.isFinite(bpm) || bpm <= 0) return;
    const normalizedPosition = Math.round(position * 1000000) / 1000000;
    onAddTempo?.(normalizedPosition, bpm, "gradual", beatNumerator, beatDenominator);
    loadSnapshotAtStructuralPosition(normalizedPosition);
  };

  const updateNewTempoBeatFractionField = (field, rawValue) => {
    if (String(rawValue).trim() === "") {
      const tempo = deriveTempoAtSequencePosition(
        Number(newTempoPosition),
        sortedTempi,
        sortedBars,
        terminalBarlinePosition,
      );
      setNewTempoBeatNumerator(String(tempo?.beatNumerator ?? 1));
      setNewTempoBeatDenominator(String(tempo?.beatDenominator ?? 4));
      setNewTempoBeatFractionIsSuggested(true);
      return String(
        field === "numerator" ? (tempo?.beatNumerator ?? 1) : (tempo?.beatDenominator ?? 4),
      );
    }
    setNewTempoBeatFractionIsSuggested(false);
    if (field === "numerator") {
      setNewTempoBeatNumerator(rawValue);
      return;
    }
    setNewTempoBeatDenominator(rawValue);
  };

  const updateNewTempoPosition = useCallback(
    (rawValue) => {
      const nextValue = String(rawValue).trim() === "" ? "1.000000" : rawValue;
      setNewTempoPosition(nextValue);
      const position = Number(nextValue);
      if (!Number.isFinite(position)) return;
      const tempo = deriveTempoAtSequencePosition(
        position,
        sortedTempi,
        sortedBars,
        terminalBarlinePosition,
      );
      if (!tempo) return;
      if (newTempoBpmIsSuggested) {
        const inheritedBpm = Number(tempo.bpm);
        if (Number.isFinite(inheritedBpm) && inheritedBpm > 0) {
          setNewTempoBpm(String(Math.round(inheritedBpm)));
        }
      }
      if (newTempoBeatFractionIsSuggested) {
        setNewTempoBeatNumerator(String(tempo.beatNumerator));
        setNewTempoBeatDenominator(String(tempo.beatDenominator));
      }
      return String(rawValue).trim() === "" ? "1.000000" : undefined;
    },
    [
      newTempoBeatFractionIsSuggested,
      newTempoBpmIsSuggested,
      sortedBars,
      sortedTempi,
      terminalBarlinePosition,
    ],
  );

  const updateNewTempoBpm = useCallback(
    (rawValue) => {
      if (String(rawValue).trim() === "") {
        const tempo = deriveTempoAtSequencePosition(
          Number(newTempoPosition),
          sortedTempi,
          sortedBars,
          terminalBarlinePosition,
        );
        setNewTempoBpm(String(Math.round(Number(tempo?.bpm) || 60)));
        setNewTempoBpmIsSuggested(true);
        return String(Math.round(Number(tempo?.bpm) || 60));
      }
      setNewTempoBpm(rawValue);
      setNewTempoBpmIsSuggested(false);
    },
    [newTempoPosition, sortedBars, sortedTempi, terminalBarlinePosition],
  );

  const addRepeatAtRequestedPosition = (kind) => {
    const position = Number(newRepeatPosition);
    if (!Number.isFinite(position)) return;
    const normalizedPosition = Math.round(position * 1000000) / 1000000;
    if (kind === "end" && normalizedPosition <= 1) return;
    onAddRepeat?.(normalizedPosition, kind);
    loadSnapshotAtStructuralPosition(normalizedPosition);
    setNewRepeatPosition("1.000000");
  };

  const updateNewBarPosition = (rawValue, isSuggested = false) => {
    if (String(rawValue).trim() === "") {
      setNewBarPosition(suggestedBarPosition);
      setNewBarPositionIsSuggested(true);
      return suggestedBarPosition;
    }
    setNewBarPosition(rawValue);
    setNewBarPositionIsSuggested(Boolean(isSuggested));
    if (!newBarMeterIsSuggested) return;
    const position = Number(rawValue);
    if (!Number.isFinite(position)) return;
    const previousBar = [...sortedBars].filter((bar) => Number(bar.position) < position).at(-1);
    setNewBarNumerator(String(previousBar?.numerator ?? 4));
    setNewBarDenominator(String(previousBar?.denominator ?? 4));
  };

  const updateNewBarMeterField = (field, rawValue) => {
    const digitsOnly = String(rawValue ?? "").replace(/[^\d]/g, "");
    if (digitsOnly === "") {
      setNewBarNumerator(suggestedNewBarMeter.numerator);
      setNewBarDenominator(suggestedNewBarMeter.denominator);
      setNewBarMeterIsSuggested(true);
      return field === "numerator"
        ? suggestedNewBarMeter.numerator
        : suggestedNewBarMeter.denominator;
    }
    setNewBarMeterIsSuggested(false);
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
    setNewBarNumerator(suggestedNewBarMeter.numerator);
    setNewBarDenominator(suggestedNewBarMeter.denominator);
  }, [newBarMeterIsSuggested, suggestedNewBarMeter]);

  const handleEnterCommit = useCallback(
    (e, commit) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const result = commitTextInput(e.currentTarget, commit);
      if (result.committed) notifyEditCommitted(result.metadata ?? {});
      e.currentTarget.blur();
    },
    [notifyEditCommitted],
  );

  const handleBlurCommit = useCallback(
    (e, commit, afterCommit = null) => {
      const result = commitTextInput(e.currentTarget, commit);
      if (typeof afterCommit === "function") afterCommit();
      if (result.committed) notifyEditCommitted(result.metadata ?? {});
    },
    [notifyEditCommitted],
  );

  const currentEventPane = eventPane === "expression" ? "expression" : "timing";

  // Row-facing derived maps and prop bundles used during render.
  const barBeatByEventId = useMemo(() => {
    const next = new Map();
    for (const event of sequenceEvents) {
      if (!event?.eventId) continue;
      if (
        event.type !== "note" &&
        event.type !== "tempo" &&
        event.type !== "repeat-start" &&
        event.type !== "repeat-end"
      ) {
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

  const barRowDnd = useMemo(
    () => ({
      draggedBarId,
      barDragIdRef,
      setDraggedBarId,
      onMoveBar,
    }),
    [draggedBarId, onMoveBar],
  );

  const barRowEditing = useMemo(
    () => ({
      onDeleteBar,
      handleEnterCommit,
      handleBlurCommit,
      updateBarPosition,
      updateBarTimeSignatureField,
    }),
    [
      handleBlurCommit,
      handleEnterCommit,
      onDeleteBar,
      updateBarPosition,
      updateBarTimeSignatureField,
    ],
  );

  const tempoRowTiming = useMemo(
    () => ({
      sortedBars,
      sortedTempi,
      terminalBarlinePosition,
      barBeatByEventId,
      tempoBarRelativeDraftKey,
      tempoBarRelativeDrafts,
      tempoTransitionCueMap,
    }),
    [
      barBeatByEventId,
      sortedBars,
      sortedTempi,
      tempoBarRelativeDrafts,
      tempoTransitionCueMap,
      terminalBarlinePosition,
    ],
  );

  const repeatRowTiming = useMemo(
    () => ({
      sortedBars,
      terminalBarlinePosition,
      barBeatByEventId,
      repeatBarRelativeDraftKey,
      repeatBarRelativeDrafts,
    }),
    [barBeatByEventId, repeatBarRelativeDrafts, sortedBars, terminalBarlinePosition],
  );

  const tempoRowEditing = useMemo(
    () => ({
      handleEnterCommit,
      handleBlurCommit,
      updateTempoBeatFraction,
      updateTempoBpm,
      updateTempoMode,
      updateTempoPosition,
      updateTempoBarRelativeDraftField,
      commitTempoBarRelativeDraft,
      cancelTempoBarRelativeDraft,
      onDeleteTempo,
    }),
    [
      cancelTempoBarRelativeDraft,
      commitTempoBarRelativeDraft,
      handleBlurCommit,
      handleEnterCommit,
      onDeleteTempo,
      updateTempoBarRelativeDraftField,
      updateTempoBeatFraction,
      updateTempoBpm,
      updateTempoMode,
      updateTempoPosition,
    ],
  );

  const repeatRowEditing = useMemo(
    () => ({
      handleEnterCommit,
      handleBlurCommit,
      updateRepeatPosition,
      updateRepeatCount,
      updateRepeatBarRelativeDraftField,
      commitRepeatBarRelativeDraft,
      cancelRepeatBarRelativeDraft,
      onDeleteRepeat,
    }),
    [
      cancelRepeatBarRelativeDraft,
      commitRepeatBarRelativeDraft,
      handleBlurCommit,
      handleEnterCommit,
      onDeleteRepeat,
      updateRepeatBarRelativeDraftField,
      updateRepeatCount,
      updateRepeatPosition,
    ],
  );

  const eventRowView = useMemo(
    () => ({
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
      sequenceLegatoMode: normalizeSequenceLegatoMode(sequenceLegato),
    }),
    [
      activeCueIndex,
      activeNavigationMode,
      activeSnapshotId,
      currentEventPane,
      findSnapshotById,
      firstSnapshotCueEventIds,
      selectedMarker,
      sequencePlaybackActive,
      sequenceLegato,
      snapshotIndexById,
      soundingAttackEventIds,
    ],
  );

  const eventRowDrafts = useMemo(
    () => ({
      sortedBars,
      terminalBarlinePosition,
      barBeatByEventId,
      eventBarRelativeDraftKey,
      barRelativeDrafts,
      eventSequenceDraftKey,
      eventSequenceDrafts,
    }),
    [barBeatByEventId, barRelativeDrafts, eventSequenceDrafts, sortedBars, terminalBarlinePosition],
  );

  const eventRowDrag = useMemo(
    () => ({
      eventRowRefs,
      barDragIdRef,
      onMoveBar,
      setDraggedBarId,
      eventDragRef,
      setDraggedEventId,
      setDragOverId,
      draggedEventId,
    }),
    [draggedEventId, eventRowRefs, onMoveBar],
  );

  const eventRowEditing = useMemo(
    () => ({
      onSelectMarker,
      deleteEventNote,
      updateEventSequenceDraftField,
      applyEventSequenceDraft,
      cancelEventSequenceDraft,
      updateEventField,
      toggleEventReattack,
      handleEnterCommit,
      handleBlurCommit,
      snapSequenceToCurrentTuning,
      restoreEventPitchLabel,
      commitEventPitchLabel,
      updateEventBarRelativeDraftField,
      commitEventBarRelativeDraft,
      cancelEventBarRelativeDraft,
    }),
    [
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
      toggleEventReattack,
      updateEventSequenceDraftField,
      applyEventSequenceDraft,
    ],
  );

  const eventRowTransport = useMemo(
    () => ({
      playingSnapshotId,
      runTransportAction,
      onPlayCue,
      onStopSnapshot,
    }),
    [onPlayCue, onStopSnapshot, playingSnapshotId, runTransportAction],
  );

  const sharedDragState = useMemo(
    () => ({
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
      settleDragRendering,
      stopSnapshotDragAutoscroll,
    }),
    [
      dragOverId,
      dragOverSide,
      draggedId,
      onMoveBar,
      settleDragRendering,
      snapshotRowRefs,
      stopSnapshotDragAutoscroll,
    ],
  );

  const sharedStructure = useMemo(
    () => ({
      snapshotEventsById,
      structuralMarkersByDisplayBucket,
      barRowRefs,
      barNumberById,
    }),
    [barNumberById, barRowRefs, snapshotEventsById, structuralMarkersByDisplayBucket],
  );

  const sharedRows = useMemo(
    () => ({
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
    }),
    [
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
    ],
  );

  const sharedActions = useMemo(
    () => ({
      resolveDropSide,
      duplicateEventNoteToSnapshot,
      moveEventNoteToSnapshot,
      onDuplicateSnapshot,
      onMoveSnapshot,
      onSnapshotRowClick: handleSnapshotRowClick,
      onSelectSnapshot: selectSnapshotForEditing,
      toggleExpanded,
      onDeleteSnapshot: handleDeleteSnapshot,
      ensureExpanded,
      onUpdateSnapshot,
      onResetSnapshotDescription,
      onPlaySnapshot,
      onStopSnapshot,
    }),
    [
      duplicateEventNoteToSnapshot,
      ensureExpanded,
      handleSnapshotRowClick,
      moveEventNoteToSnapshot,
      handleDeleteSnapshot,
      onDuplicateSnapshot,
      onMoveSnapshot,
      onPlaySnapshot,
      onResetSnapshotDescription,
      selectSnapshotForEditing,
      onStopSnapshot,
      onUpdateSnapshot,
    ],
  );

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
        manualArpeggiation={normalizedManualArpeggiation}
        sequenceLegato={sequenceLegato}
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
            SHIFT+ENTER stores currently sounding notes, including expression data if available. The
            panels below allow snapshots to be played, re-ordered, copied, and edited. Changing
            global or bar-relative event positions automatically creates cues that may be triggered
            one-by-one. Adding bars with time signatures, tempo markers, repeats, and empty
            snapshots where needed generates a musical score with automated timed playback.
          </em>
        </p>
        <div class="preset-actions preset-actions--library">
          <button type="button" class="preset-action-btn" onClick={onTakeSnapshot}>
            Capture
          </button>
          <button type="button" class="preset-action-btn" onClick={onAddEmptySnapshot}>
            Append Empty Snapshot
          </button>
          {snapshots.length > 0 && (
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
                {...buildAutoSelectInputProps()}
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
                {...buildAutoSelectInputProps()}
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
        <div class="sequencer-copy-block__copy-row sequencer-copy-block__copy-row--actions-only">
          <span class="sequencer-copy-block__copy-actions">
            {copySummaryText && (
              <span class="controller-inline-row controller-status-row sequencer-copy-block__summary">
                <span class="sequencer-copy-block__summary-text">{copySummaryText}</span>
              </span>
            )}
            <button
              type="button"
              class="preset-action-btn sequencer-copy-block__copy-button"
              onClick={handleCopySnapshotBlock}
            >
              Copy Selection
            </button>
          </span>
        </div>
        {copyInsertStatus && (
          <p class="sequencer-copy-block__status">
            <span class="sequencer-copy-block__summary-text">
              <em>{copyInsertStatus}</em>
            </span>
          </p>
        )}
        <fieldset class="sequencer-copy-block__range-operations">
          <legend>Edit Selected Range</legend>
          <div class="sequencer-copy-block__range-actions">
            <span class="sequencer-copy-block__range-label">Positions</span>
            <button
              type="button"
              class="preset-action-btn"
              onClick={handleResetSnapshotRangeNoteOffsetsInPlace}
              disabled={!resolvedCopyRange?.valid}
            >
              Reset Note Offsets
            </button>
          </div>
          <div class="sequencer-copy-block__articulation-row">
            <span class="sequencer-copy-block__articulation-label">Arpeggiation</span>
            <span class="sequencer-copy-block__articulation-actions">
              <button
                type="button"
                class="preset-action-btn"
                onClick={() => handleSetSnapshotRangeArticulation("chord")}
                disabled={!resolvedCopyRange?.valid}
              >
                Set to chord
              </button>
              <button
                type="button"
                class="preset-action-btn"
                onClick={() => handleSetSnapshotRangeArticulation("arpeggiate")}
                disabled={!resolvedCopyRange?.valid}
              >
                Set to arp
              </button>
            </span>
          </div>
          <div class="sequencer-copy-block__range-final-actions">
            <button
              type="button"
              class="preset-utility-btn"
              onClick={handleRevertSnapshotRangeChanges}
              disabled={!rangeEditUndo}
            >
              Revert changes
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
        </fieldset>
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
                {...buildAutoSelectInputProps()}
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
                {...buildAutoSelectInputProps()}
                onInput={(e) => {
                  const nextValue = e.currentTarget.value;
                  setCopyInsertBarNumber(nextValue);
                  const nextPosition = resolveBarPositionFromBarNumber(nextValue);
                  if (nextPosition != null) setCopyInsertPosition(String(nextPosition));
                }}
                onBlur={() => {
                  setCopyInsertBarNumber(
                    insertIsInsideBar
                      ? `[${derivedInsertBarNumber}]`
                      : String(derivedInsertBarNumber),
                  );
                }}
              />
            </label>
          </span>
        </div>
        <div class="preset-actions preset-actions--library sequencer-copy-block__insert-actions">
          <button
            type="button"
            class="preset-action-btn"
            onClick={handleMoveSnapshotBlock}
            disabled={
              !copiedSnapshotBlock ||
              copiedSelectionSignature !== currentCopySelectionSignature ||
              (copiedSnapshotBlock.includeBars && !copyInsertAtBarBoundary)
            }
          >
            Move Copied Range
          </button>
          <button
            type="button"
            class="preset-action-btn"
            onClick={handleInsertSnapshotBlock}
            disabled={
              !copiedSnapshotBlock || (copiedSnapshotBlock.includeBars && !copyInsertAtBarBoundary)
            }
          >
            Insert Copied Range
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
              toggleEditPlayLayout();
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
          setNewTempoPosition={updateNewTempoPosition}
          newTempoBpm={newTempoBpm}
          newTempoBpmIsSuggested={newTempoBpmIsSuggested}
          setNewTempoBpm={updateNewTempoBpm}
          newTempoBeatNumerator={newTempoBeatNumerator}
          newTempoBeatDenominator={newTempoBeatDenominator}
          newTempoBeatFractionIsSuggested={newTempoBeatFractionIsSuggested}
          updateNewTempoBeatFractionField={updateNewTempoBeatFractionField}
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
          manualArpeggiation={normalizedManualArpeggiation}
          onManualArpeggiationChange={onManualArpeggiationChange}
          sequenceLegato={sequenceLegato}
          onSequenceLegatoChange={onSequenceLegatoChange}
          sequencePlaybackSpeed={sequencePlaybackSpeed}
          sequencePlaybackPitchOffset={sequencePlaybackPitchOffset}
          sequenceTimbreModWheelEnabled={sequenceTimbreModWheelEnabled}
          onSequencePlaybackSpeedChange={onSequencePlaybackSpeedChange}
          onSequencePlaybackSpeedPreview={previewTimedTransportSpeed}
          onSequencePlaybackPitchOffsetChange={onSequencePlaybackPitchOffsetChange}
          onSequencePlaybackPitchOffsetPreview={onSequencePlaybackPitchOffsetPreview}
          onSequenceTimbreModWheelEnabledChange={onSequenceTimbreModWheelEnabledChange}
          sequencePlayRepeats={sequencePlayRepeats}
          onSequencePlayRepeatsChange={onSequencePlayRepeatsChange}
          autoScrollEnabled={autoScrollEnabled}
          onAutoScrollEnabledChange={setAutoScrollEnabled}
          snapSequenceToCurrentTuning={snapSequenceToCurrentTuning}
          onSnapSequenceToCurrentTuningChange={onSnapSequenceToCurrentTuningChange}
          playbackRowRef={playbackRowRef}
          playhead={playhead}
          selectedBarIndex={selectedBarIndex}
          timedBarSelectValue={timedTransportUiState.running ? timedTransportFieldValues.bar : null}
          sortedBars={sortedBars}
          transportScrollTargetRef={transportScrollTargetRef}
          onSelectSequenceBar={selectSequenceBarWithViewport}
          snapshotSelectValue={displayedSnapshotSelectValue}
          renderedSnapshots={renderedSnapshots}
          impliedPendingSnapshotIndex={impliedPendingSnapshotIndex}
          armPendingSnapshot={armVirtualizedPendingSnapshot}
          snapshots={snapshots}
          playheadIsOff={playheadIsOff}
          nextSnapshotIndexFromBar={nextSnapshotIndexFromBar}
          playheadIsEnd={playheadIsEnd}
          runTransportAction={runTransportAction}
          onJumpSequenceSnapshot={jumpSequenceSnapshotWithAutoscroll}
          onStepSequence={stepSequenceWithAutoscroll}
          cueSelectValue={displayedCueSelectValue}
          sequenceCueGroups={sequenceCueGroups}
          impliedPendingCueIndex={impliedPendingCueIndex}
          armPendingCue={armVirtualizedPendingCue}
          nextCueIndexFromBar={nextCueIndexFromBar}
          onJumpSequenceCue={jumpSequenceCueWithAutoscroll}
          onStepSequenceMarker={stepSequenceMarkerWithAutoscroll}
          onResetSequencePlayhead={resetSequencePlayheadAndScrollTop}
          onJumpSequenceEnd={jumpSequencePlayheadToEndAndScrollBottom}
          onPlaySequence={onPlaySequence}
          onPlayCue={onPlayCue}
          playingSnapshotId={playingSnapshotId}
          onStopSnapshot={onStopSnapshot}
          timedTransportUiState={timedTransportUiState}
          getTimedTransportDisplay={getTimedTransportDisplay}
          onTimedTransportPlayPause={handleTimedTransportPlayPause}
          onTimedTransportStop={handleTimedTransportStop}
          onPlaybackSelectWheel={redirectPlaybackSelectWheel}
          terminalSequenceTarget={terminalSequenceTarget}
        />

        <div
          ref={bindScrollPanel}
          class="sequencer-scroll-panel"
          onScroll={rememberScrollPosition}
          onDragOver={(event) => {
            if (dragIdRef.current != null) updateSnapshotDragAutoscroll(event.clientY);
          }}
        >
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
                  data-sequence-structural-key={structuralEventRenderKey(marker)}
                >
                  {marker.structuralType === "bar" ? (
                    <BarRow
                      bar={marker}
                      barNumberById={barNumberById}
                      dnd={barRowDnd}
                      editing={barRowEditing}
                    />
                  ) : marker.structuralType === "repeat-start" ||
                    marker.structuralType === "repeat-end" ? (
                    <RepeatRow
                      repeat={marker}
                      timing={repeatRowTiming}
                      editing={repeatRowEditing}
                    />
                  ) : (
                    <TempoRow tempo={marker} timing={tempoRowTiming} editing={tempoRowEditing} />
                  )}
                </div>
              ))}
              <div ref={virtualSequenceListRef} class="sequencer-virtual-list">
                {virtualSequenceLayout.rows.map((row) =>
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
                      playingSnapshotIds={playingSnapshotIds}
                      manualArpeggiationMode={normalizedManualArpeggiation.mode}
                      showAllEvents={showAllEvents}
                      expandedIds={expandedIds}
                      dragState={sharedDragState}
                      structure={sharedStructure}
                      rows={sharedRows}
                      actions={sharedActions}
                      virtualMeasure={measureVirtualSequenceItem}
                    />
                  ),
                )}
              </div>
              {sequenceSaveFooterClearance > 0 && (
                <div
                  class="sequencer-scroll-end-clearance"
                  style={{ height: `${sequenceSaveFooterClearance}px` }}
                  aria-hidden="true"
                />
              )}
            </div>
          )}
        </div>

        {!topSequenceSaveVisible &&
          sequenceSaveActionState.visible &&
          typeof sequenceSaveActionState.action === "function" && (
            <div
              ref={sequenceSaveRowRef}
              class="settings-form__action-row sequencer-fieldset__save-row"
            >
              <span class="settings-form__action-group settings-form__action-group--wrap">
                <button
                  type="button"
                  class="preset-action-btn"
                  onClick={sequenceSaveActionState.action}
                >
                  {sequenceSaveActionState.label}
                </button>
                {sequenceSaveActionState.status && (
                  <span class="sequencer-copy-block__summary sequencer-fieldset__save-status">
                    <span class="sequencer-copy-block__summary-text">
                      <em>{sequenceSaveActionState.status}</em>
                    </span>
                  </span>
                )}
              </span>
            </div>
          )}
      </fieldset>
    </div>
  );
};

export default Sequencer;
