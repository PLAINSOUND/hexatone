import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import SequenceInfo from "./sequence-info.jsx";
import SequenceLibrary from "./sequence-library.jsx";
import SequenceControls from "./sequence-controls.jsx";
import SnapshotSequenceItem from "./snapshot-sequence-item.jsx";
import BarRow from "./bar-row.jsx";
import TempoRow from "./tempo-row.jsx";
import RepeatRow from "./repeat-row.jsx";
import {
  absolutePositionToBarBeat,
} from "./transport.js";
import {
  buildBarNumberById,
  buildStructuralMarkersByDisplayBucket,
  normalizeTempoBeatFraction,
} from "./transport-runtime.js";
import {
  buildCueExpandedSnapshotIds,
  buildFirstCueTimeBySnapshotIndex,
  buildFirstEventIdByCueIndex,
  buildFirstSnapshotCueEventIds,
  buildSnapshotEventsById,
} from "./timeline-runtime.js";
import { derivePlayheadNavigationState } from "./playhead-runtime.js";
import { deriveTempoAtSequencePosition } from "./playback-timeline.js";
import { buildSequenceRuntimeModel } from "./runtime-model.js";
import useTimedTransportController from "./timed-transport-controller.js";
import useSequencerAutoscroll from "./autoscroll-controller.js";
import useDraftEditingController from "./draft-editing-controller.js";
import {
  buildCueExpandedSnapshotIdsAt,
  deriveExpandedSnapshotIds,
  deriveSoundingAttackEventIds,
  sameSnapshotSet,
} from "./view-runtime.js";
import {
  commitTextInput,
  noteIdentity,
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
  snapSequenceToCurrentTuning,
  sequenceAutoCreateBars,
  selectedSnapshotId,
  selectedMarker,
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
  onUpdateSnapshot,
  onResetSnapshotDescription,
}) => {
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
  const [editCommitTick, setEditCommitTick] = useState(0);
  const [eventPane, setEventPane] = useState("timing");
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [compactSelectionPreviewSuppressedId, setCompactSelectionPreviewSuppressedId] = useState(null);
  const dragIdRef = useRef(null);
  const barDragIdRef = useRef(null);
  const eventDragRef = useRef(null);
  const duplicateNoteIdRef = useRef(0);
  const pendingTransportActionRef = useRef(null);
  const editCommitPendingRef = useRef(false);

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
    prevCueIndexFromBar,
    nextSnapshotIndexFromBar,
    prevSnapshotIndexFromBar,
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
  }), [
    playhead,
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

  const findNoteInSnapshot = useCallback((snapshot, noteKey) => {
    if (!snapshot) return null;
    const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
    const note = (snapshot.notes ?? []).find((entry) => noteIdentity(entry, length) === noteKey) ?? null;
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

  const firstEventIdByCueIndex = useMemo(
    () => buildFirstEventIdByCueIndex(sequenceEvents),
    [sequenceEvents],
  );
  const firstCueTimeBySnapshotIndex = useMemo(
    () => buildFirstCueTimeBySnapshotIndex(sequenceCueGroups),
    [sequenceCueGroups],
  );

  const activeNavigationMode = playheadMarkerIndex != null ? "cue" : "snapshot";
  const activeCueIndex = playheadMarkerIndex != null ? playheadMarkerIndex + 1 : null;
  const activeSnapshotId =
    playheadStepIndex >= 0 && !playheadIsEnd ? (snapshots[playheadStepIndex]?.id ?? null) : null;
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
  const cueExpandedSnapshotIds = useMemo(
    () => buildCueExpandedSnapshotIds(activeCueIndex, sequenceEvents, soundingAttackEventIds),
    [activeCueIndex, sequenceEvents, soundingAttackEventIds],
  );
  const cueExpandedSnapshotIdsAt = useCallback((cueIndexZeroBased) => {
    return buildCueExpandedSnapshotIdsAt(
      cueIndexZeroBased,
      renderedSnapshots,
      sortedBars,
      sortedTempi,
      sequenceEvents,
    );
  }, [renderedSnapshots, sequenceEvents, sortedBars, sortedTempi]);

  const {
    timedTransportUiState,
    getTimedTransportDisplay,
    handleTimedTransportPlayPause,
    handleTimedTransportStop,
    recordTimedTransportDiagnostic,
  } = useTimedTransportController({
    timedPlaybackBursts,
    timedCueTriggers,
    timedCueTriggerBySourceIndex,
    sequencePlaybackSpeed,
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
  } = useSequencerAutoscroll({
    autoScrollEnabled,
    activeCueIndex,
    activeSnapshotId,
    playheadStepIndex,
    playheadIsOff,
    selectedBarIndex,
    sortedBars,
    snapshots,
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
    showAllEvents,
    setExpandedIds,
    onCueSequenceSnapshot,
    onCueSequenceCue,
    onSelectSequenceBar,
    onResetSequencePlayhead,
    onJumpSequenceEnd,
    recordTimedTransportDiagnostic,
  });

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

  useEffect(() => {
    if (!editCommitPendingRef.current && !pendingTransportActionRef.current) return;
    const action = pendingTransportActionRef.current;
    pendingTransportActionRef.current = null;
    editCommitPendingRef.current = false;
    action?.();
  }, [editCommitTick, snapshots]);

  const notifyEditCommitted = () => {
    setEditCommitTick((value) => value + 1);
  };

  const runTransportAction = (action) => {
    if (typeof document === "undefined") {
      action?.();
      return;
    }
    if (editCommitPendingRef.current) {
      pendingTransportActionRef.current = action;
      return;
    }
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active.matches?.(".sequencer-event__input")
    ) {
      editCommitPendingRef.current = true;
      pendingTransportActionRef.current = action;
      active.blur();
      return;
    }
    action?.();
  };

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

  // Local mutation adapters passed down into row components.
  const updateEventField = (snapshot, noteKey, field, rawValue) => {
    const notes = updateEventFieldInSnapshot(snapshot, noteKey, field, rawValue);
    if (!notes) return;
    onUpdateSnapshot(snapshot.id, { notes });
  };

  const restoreEventPitchLabel = (snapshot, noteKey) => {
    const notes = restoreEventPitchLabelInSnapshot(snapshot, noteKey);
    onUpdateSnapshot(snapshot.id, { notes });
  };

  const commitEventPitchLabel = (snapshot, noteKey) => {
    const notes = commitEventPitchLabelInSnapshot(snapshot, noteKey);
    onUpdateSnapshot(snapshot.id, { notes });
  };

  const updateBarPosition = (barId, rawValue) => {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) return;
    onUpdateBar?.(barId, { position: Math.max(1, Math.round(numeric)) });
  };

  const updateTempoPosition = (tempoId, rawValue) => {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) return;
    onUpdateTempo?.(tempoId, { position: Math.round(numeric * 1000000) / 1000000 });
  };

  const updateRepeatPosition = (repeatId, rawValue) => {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) return;
    onUpdateRepeat?.(repeatId, { position: Math.round(numeric * 1000000) / 1000000 });
  };

  const updateRepeatCount = (repeatId, rawValue) => {
    const numeric = Math.max(2, Math.round(Number(rawValue) || 2));
    if (!Number.isFinite(numeric)) return;
    onUpdateRepeat?.(repeatId, { repeatCount: numeric });
  };

  const updateTempoBpm = (tempoId, rawValue) => {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    onUpdateTempo?.(tempoId, { bpm: numeric });
  };

  const updateTempoBeatFraction = (tempoId, numerator, denominator) => {
    onUpdateTempo?.(tempoId, normalizeTempoBeatFraction(numerator, denominator));
  };

  const updateBarTimeSignatureField = (barId, field, rawValue) => {
    const parsed = Math.round(Number(rawValue) || 0);
    const numeric = field === "numerator"
      ? Math.max(1, parsed)
      : Math.max(1, parsed);
    if (!Number.isFinite(numeric)) return;
    if (field !== "numerator" && numeric <= 0) return;
    onUpdateBar?.(barId, { [field]: numeric });
  };

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

  const handleEnterCommit = (e, commit) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    commitTextInput(e.currentTarget, commit);
    notifyEditCommitted();
    e.currentTarget.blur();
  };

  const handleBlurCommit = (e, commit, afterCommit = null) => {
    commitTextInput(e.currentTarget, commit);
    if (typeof afterCommit === "function") afterCommit();
    notifyEditCommitted();
  };

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
      );
      if (barBeat) next.set(event.eventId, barBeat);
    }
    return next;
  }, [sequenceEvents, sortedBars, terminalBarlinePosition]);

  const barRowDnd = {
    draggedBarId,
    barDragIdRef,
    setDraggedBarId,
    onMoveBar,
  };

  const barRowEditing = {
    onDeleteBar,
    handleEnterCommit,
    handleBlurCommit,
    updateBarPosition,
    updateBarTimeSignatureField,
  };

  const tempoRowTiming = {
    sortedBars,
    sortedTempi,
    terminalBarlinePosition,
    barBeatByEventId,
    tempoBarRelativeDraftKey,
    tempoBarRelativeDrafts,
    tempoTransitionCueMap,
  };

  const repeatRowTiming = {
    sortedBars,
    terminalBarlinePosition,
    barBeatByEventId,
    repeatBarRelativeDraftKey,
    repeatBarRelativeDrafts,
  };

  const tempoRowEditing = {
    handleEnterCommit,
    handleBlurCommit,
    updateTempoBeatFraction,
    updateTempoBpm,
    updateTempoPosition,
    updateTempoBarRelativeDraftField,
    commitTempoBarRelativeDraft,
    cancelTempoBarRelativeDraft,
    onDeleteTempo,
  };

  const repeatRowEditing = {
    handleEnterCommit,
    handleBlurCommit,
    updateRepeatPosition,
    updateRepeatCount,
    updateRepeatBarRelativeDraftField,
    commitRepeatBarRelativeDraft,
    cancelRepeatBarRelativeDraft,
    onDeleteRepeat,
  };

  const eventRowView = {
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
  };

  const eventRowDrafts = {
    sortedBars,
    terminalBarlinePosition,
    barBeatByEventId,
    eventBarRelativeDraftKey,
    barRelativeDrafts,
    eventSequenceDraftKey,
    eventSequenceDrafts,
  };

  const eventRowDrag = {
    eventRowRefs,
    barDragIdRef,
    onMoveBar,
    setDraggedBarId,
    eventDragRef,
    setDraggedEventId,
    setDragOverId,
    draggedEventId,
  };

  const eventRowEditing = {
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
  };

  const eventRowTransport = {
    playingSnapshotId,
    runTransportAction,
    onPlayCue,
    onStopSnapshot,
  };

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
            Empty
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
          onSequencePlaybackPitchOffsetChange={onSequencePlaybackPitchOffsetChange}
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
          prevSnapshotIndexFromBar={prevSnapshotIndexFromBar}
          nextSnapshotIndexFromBar={nextSnapshotIndexFromBar}
          playheadIsEnd={playheadIsEnd}
          runTransportAction={runTransportAction}
          onJumpSequenceSnapshot={onJumpSequenceSnapshot}
          onStepSequence={onStepSequence}
          cueSelectValue={cueSelectValue}
          sequenceCueGroups={sequenceCueGroups}
          impliedPendingCueIndex={impliedPendingCueIndex}
          armPendingCue={armPendingCue}
          prevCueIndexFromBar={prevCueIndexFromBar}
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
              {renderedSnapshots.map((snapshot, index) => {
              return (
                <SnapshotSequenceItem
                  key={snapshot.id}
                  snapshot={snapshot}
                  index={index}
                  selectedSnapshotId={selectedSnapshotId}
                  playingSnapshotId={playingSnapshotId}
                  showAllEvents={showAllEvents}
                  expandedIds={expandedIds}
                  dragState={{
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
                  }}
                  structure={{
                    snapshotEventsById,
                    structuralMarkersByDisplayBucket,
                    barRowRefs,
                    barNumberById,
                  }}
                  rows={{
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
                  }}
                  actions={{
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
                  }}
                />
              );
              })}
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
