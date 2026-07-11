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
  barContextForPosition,
  deriveTerminalBarlinePosition,
  normalizeBarMarkers,
  normalizeTempoMarkers,
  timingBarAtNumber,
} from "./transport.js";
import {
  buildBarNumberById,
  buildStructuralMarkersByDisplayBucket,
  isStoppedBarNumber,
  normalizeTempoBeatFraction,
} from "./transport-runtime.js";
import {
  deriveSequenceCueGroups,
  deriveSequenceEvents,
} from "./trigger-groups.js";
import {
  buildCueExpandedSnapshotIds,
  buildFirstCueIndexBySnapshotIndex,
  buildFirstCueTimeBySnapshotIndex,
  buildFirstEventIdByCueIndex,
  buildFirstSnapshotCueEventIds,
  buildSnapshotEventsById,
} from "./timeline-runtime.js";
import { derivePlayheadNavigationState } from "./playhead-runtime.js";
import { buildPlaybackTimeline } from "./playback-timeline.js";
import { deriveTimedCueTriggers } from "./timed-cue-triggers.js";
import { collectTimedCueBurstsWithinLookahead } from "./timed-cue-scheduler.js";
import {
  advanceTimedTransport,
  createTimedTransportState,
  currentTimedTransportElapsedSeconds,
  findPlaybackStartIndex,
  pauseTimedTransport,
  resumeTimedTransport,
  startTimedTransport,
  stopTimedTransport,
} from "./timed-transport-runtime.js";
import {
  buildCueExpandedSnapshotIdsAt,
  deriveCueScrollAnchorTarget,
  deriveExpandedSnapshotIds,
  deriveSoundingAttackEventIds,
  firstSnapshotIdInSet,
  sameSnapshotSet,
} from "./view-runtime.js";
import { deriveRepeatSections } from "./repeat-playback-runtime.js";
import {
  commitTextInput,
  normalizeSequenceNumber,
  noteIdentity,
  structuralEventInstanceKey,
  structuralEventRenderKey,
} from "./value-runtime.js";
import {
  eventBarRelativeDraftKey,
  eventSequenceDraftKey,
  commitForeignDrafts,
  removeDraftEntry,
  resolveBarRelativeDraftPosition,
  resolveDraftScopeTarget,
  resolveEventSequenceDraftTarget,
  repeatBarRelativeDraftKey,
  tempoBarRelativeDraftKey,
  updateBarRelativeDrafts,
  updateEventSequenceDrafts,
} from "./sequence-drafts.js";
import {
  applyEventBarRelativeDraftToSnapshot,
  deleteEventNoteFromSnapshot,
  restoreEventPitchLabelInSnapshot,
  updateEventFieldInSnapshot,
} from "./sequence-mutations.js";
import {
  applyTransferredNote,
  buildTransferredNote,
} from "./sequence-operations.js";

/**
 * Sequencer — early sidebar workspace for building sequencer material from
 * captured snapshots while keeping the existing Hexatone canvas active.
 */
const Sequencer = ({
  snapshots,
  displaySnapshots,
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
  onSnapSequenceToCurrentTuningChange,
  onSequenceAutoCreateBarsChange,
  onSetSnapshotLabelMode,
  onSelectSnapshot,
  onSelectMarker,
  onPlaySnapshot,
  onStopSnapshot,
  onSelectSequenceBar,
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

  const renderedSnapshots = Array.isArray(displaySnapshots) ? displaySnapshots : snapshots;
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [showAllEvents, setShowAllEvents] = useState(true);
  const [sequenceSaveActionState, setSequenceSaveActionState] = useState({
    visible: false,
    label: "",
    action: null,
  });
  const [newBarPosition, setNewBarPosition] = useState("1");
  const [newTempoPosition, setNewTempoPosition] = useState("1.000000");
  const [newRepeatPosition, setNewRepeatPosition] = useState("1.000000");
  const [newTempoBpm, setNewTempoBpm] = useState("60");
  const [newBarNumerator, setNewBarNumerator] = useState("4");
  const [newBarDenominator, setNewBarDenominator] = useState("4");
  const [confirmClearSnapshots, setConfirmClearSnapshots] = useState(false);
  const [pendingSnapshotJumpIndex, setPendingSnapshotJumpIndex] = useState("");
  const [pendingCueJumpIndex, setPendingCueJumpIndex] = useState("");
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverSide, setDragOverSide] = useState("before");
  const [draggedId, setDraggedId] = useState(null);
  const [draggedBarId, setDraggedBarId] = useState(null);
  const [draggedEventId, setDraggedEventId] = useState(null);
  const [barRelativeDrafts, setBarRelativeDrafts] = useState({});
  const [eventSequenceDrafts, setEventSequenceDrafts] = useState({});
  const [tempoBarRelativeDrafts, setTempoBarRelativeDrafts] = useState({});
  const [repeatBarRelativeDrafts, setRepeatBarRelativeDrafts] = useState({});
  const [editCommitTick, setEditCommitTick] = useState(0);
  const [eventPane, setEventPane] = useState("timing");
  const dragIdRef = useRef(null);
  const barDragIdRef = useRef(null);
  const eventDragRef = useRef(null);
  const duplicateNoteIdRef = useRef(0);
  const pendingTransportActionRef = useRef(null);
  const playbackRowRef = useRef(null);
  const scrollPanelRef = useRef(null);
  const snapshotRowRefs = useRef(new Map());
  const barRowRefs = useRef(new Map());
  const eventRowRefs = useRef(new Map());
  const lastAutoScrolledSnapshotIdRef = useRef(null);
  const lastAutoScrolledBarIdRef = useRef(null);
  const lastAutoScrolledCueTargetRef = useRef(null);
  const pendingResetScrollTargetRef = useRef(null);
  const suppressNextBarAutoScrollRef = useRef(false);
  const transportScrollTargetRef = useRef("snapshot");
  const timedTransportStateRef = useRef(createTimedTransportState([]));
  const scheduledTimedPlaybackIndexRef = useRef(0);
  const timedTransportSchedulerTokenRef = useRef(0);
  const timedTransportTimeoutsRef = useRef(new Set());
  const onPlayCueRef = useRef(onPlayCue);
  const onPlayTimedCueRef = useRef(onPlayTimedCue);
  const onStopSnapshotRef = useRef(onStopSnapshot);
  const getTimedTransportClockSecondsRef = useRef(getTimedTransportClockSeconds);
  const timedPlaybackBurstsRef = useRef([]);
  const timedCueTriggerBySourceIndexRef = useRef(new Map());
  const [timedTransportState, setTimedTransportState] = useState(() => createTimedTransportState([]));
  const [timedTransportClockSeconds, setTimedTransportClockSeconds] = useState(0);

  const sortedBars = useMemo(() => normalizeBarMarkers(bars), [bars]);
  const sortedTempi = useMemo(
    () => (Array.isArray(tempi) ? normalizeTempoMarkers(tempi) : []),
    [tempi],
  );
  const sequenceEvents = useMemo(
    () => deriveSequenceEvents(renderedSnapshots, sortedBars, sortedTempi, repeats),
    [renderedSnapshots, repeats, sortedBars, sortedTempi],
  );
  const sequenceCueGroups = useMemo(
    () => deriveSequenceCueGroups(renderedSnapshots, sortedBars, sortedTempi, repeats),
    [renderedSnapshots, repeats, sortedBars, sortedTempi],
  );
  const terminalBarlinePosition = useMemo(
    () => deriveTerminalBarlinePosition(renderedSnapshots, sortedBars),
    [renderedSnapshots, sortedBars],
  );
  const formatTransportBarBeat = useCallback((position) => {
    const resolved = absolutePositionToBarBeat(position, sortedBars, 1, 9, terminalBarlinePosition);
    if (!resolved) return "1:1";
    const fraction = resolved.numerator > 0 ? ` ${resolved.numerator}/${resolved.denominator}` : "";
    return `${resolved.barNumber}:${resolved.beat}${fraction}`;
  }, [sortedBars, terminalBarlinePosition]);
  const sequenceRepeatSections = useMemo(
    () => deriveRepeatSections(sequenceCueGroups, repeats),
    [sequenceCueGroups, repeats],
  );
  const playbackTimeline = useMemo(
    () => buildPlaybackTimeline({
      snapshots: renderedSnapshots,
      bars: sortedBars,
      tempi: sortedTempi,
      repeats,
    }),
    [renderedSnapshots, repeats, sortedBars, sortedTempi],
  );
  const timedPlaybackBursts = playbackTimeline.playbackBursts;
  const timedCueTriggers = useMemo(
    () => deriveTimedCueTriggers(playbackTimeline, { legato: sequenceLegato }),
    [playbackTimeline, sequenceLegato],
  );
  const timedCueTriggerBySourceIndex = useMemo(() => {
    const mapping = new Map();
    timedCueTriggers.forEach((trigger) => {
      const sourceCueIndex = Number(trigger?.cueIndex);
      if (!Number.isFinite(sourceCueIndex)) return;
      mapping.set(sourceCueIndex, trigger);
    });
    return mapping;
  }, [timedCueTriggers]);

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
    pendingSnapshotJumpIndex,
    pendingCueJumpIndex,
  }), [
    pendingCueJumpIndex,
    pendingSnapshotJumpIndex,
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
  const firstCueIndexBySnapshotIndex = useMemo(
    () => buildFirstCueIndexBySnapshotIndex(sequenceCueGroups),
    [sequenceCueGroups],
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

  useEffect(() => {
    timedTransportStateRef.current = timedTransportState;
  }, [timedTransportState]);

  useEffect(() => {
    onPlayCueRef.current = onPlayCue;
  }, [onPlayCue]);

  useEffect(() => {
    onPlayTimedCueRef.current = onPlayTimedCue;
  }, [onPlayTimedCue]);

  useEffect(() => {
    onStopSnapshotRef.current = onStopSnapshot;
  }, [onStopSnapshot]);

  useEffect(() => {
    getTimedTransportClockSecondsRef.current = getTimedTransportClockSeconds;
  }, [getTimedTransportClockSeconds]);

  useEffect(() => {
    timedPlaybackBurstsRef.current = timedPlaybackBursts;
  }, [timedPlaybackBursts]);

  useEffect(() => {
    timedCueTriggerBySourceIndexRef.current = timedCueTriggerBySourceIndex;
  }, [timedCueTriggerBySourceIndex]);

  useEffect(() => {
    setTimedTransportState((previous) => {
      const freshState = createTimedTransportState(timedPlaybackBursts);
      if (
        previous?.status !== "running"
        && previous?.status !== "paused"
      ) {
        scheduledTimedPlaybackIndexRef.current = 0;
        timedTransportStateRef.current = freshState;
        return freshState;
      }

      const lastPlaybackIndex = Math.max(0, timedPlaybackBursts.length - 1);
      const nextPlaybackIndex = timedPlaybackBursts.length === 0
        ? -1
        : Math.max(0, Math.min(lastPlaybackIndex, Number(previous?.nextPlaybackIndex ?? 0)));
      const lastDispatchedPlaybackIndex = timedPlaybackBursts.length === 0
        ? -1
        : Math.max(-1, Math.min(lastPlaybackIndex, Number(previous?.lastDispatchedPlaybackIndex ?? -1)));
      const preservedState = {
        ...previous,
        status: timedPlaybackBursts.length === 0 ? "empty" : previous.status,
        nextPlaybackIndex,
        lastDispatchedPlaybackIndex,
      };
      scheduledTimedPlaybackIndexRef.current = Math.max(0, nextPlaybackIndex);
      timedTransportStateRef.current = preservedState;
      return preservedState;
    });
  }, [timedPlaybackBursts]);

  const clearScheduledTimedCueCallbacks = useCallback(() => {
    timedTransportSchedulerTokenRef.current += 1;
    timedTransportTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    timedTransportTimeoutsRef.current.clear();
  }, []);

  const resolveTimedTransportStartIndex = useCallback(() => {
    if (pendingCueJumpIndex !== "") {
      return findPlaybackStartIndex(timedPlaybackBursts, { cueIndex: Number(pendingCueJumpIndex) });
    }
    if (Number.isFinite(playheadMarkerIndex)) {
      return findPlaybackStartIndex(timedPlaybackBursts, { cueIndex: Number(playheadMarkerIndex) });
    }
    if (pendingSnapshotJumpIndex !== "") {
      return findPlaybackStartIndex(timedPlaybackBursts, { snapshotIndex: Number(pendingSnapshotJumpIndex) });
    }
    if (Number.isFinite(playheadStepIndex) && playheadStepIndex >= 0 && !playheadIsEnd) {
      return findPlaybackStartIndex(timedPlaybackBursts, { snapshotIndex: Number(playheadStepIndex) });
    }
    const selectedBarPosition = Number(sortedBars[selectedBarIndex]?.position ?? 1);
    return findPlaybackStartIndex(timedPlaybackBursts, { sequenceTime: selectedBarPosition });
  }, [
    pendingCueJumpIndex,
    pendingSnapshotJumpIndex,
    playheadIsEnd,
    playheadMarkerIndex,
    playheadStepIndex,
    selectedBarIndex,
    sortedBars,
    timedPlaybackBursts,
  ]);

  const scheduleTimedCueBursts = useCallback((cueBursts, nowSeconds) => {
    if (!Array.isArray(cueBursts) || cueBursts.length === 0) return;
    const schedulerToken = timedTransportSchedulerTokenRef.current;
    const currentElapsed = currentTimedTransportElapsedSeconds(timedTransportStateRef.current, nowSeconds);

    cueBursts.forEach((burst) => {
      const delayMs = Math.max(0, (Number(burst.elapsedSeconds) - currentElapsed) * 1000);
      const timeoutId = window.setTimeout(() => {
        timedTransportTimeoutsRef.current.delete(timeoutId);
        if (timedTransportSchedulerTokenRef.current !== schedulerToken) return;
        if (timedTransportStateRef.current.status !== "running") return;
        if (Number.isFinite(burst.sourceCueIndex)) {
          const cueIndex = Number(burst.sourceCueIndex) - 1;
          const trigger = timedCueTriggerBySourceIndexRef.current.get(Number(burst.sourceCueIndex)) ?? null;
          if (onPlayTimedCueRef.current) {
            onPlayTimedCueRef.current(cueIndex, trigger, {
              hardRestart: burst.repeatJump != null,
            });
          } else {
            onPlayCueRef.current?.(cueIndex);
          }
        }
      }, delayMs);
      timedTransportTimeoutsRef.current.add(timeoutId);
    });
  }, []);

  const runTimedCueLookahead = useCallback((nowSeconds) => {
    const currentElapsed = currentTimedTransportElapsedSeconds(timedTransportStateRef.current, nowSeconds);
    const { cueBursts, nextPlaybackIndex } = collectTimedCueBurstsWithinLookahead(
      timedPlaybackBurstsRef.current,
      scheduledTimedPlaybackIndexRef.current,
      currentElapsed,
      0.15,
    );
    scheduledTimedPlaybackIndexRef.current = nextPlaybackIndex;
    if (cueBursts.length > 0) scheduleTimedCueBursts(cueBursts, nowSeconds);
  }, [scheduleTimedCueBursts]);

  useEffect(() => {
    if (timedTransportState.status !== "running") return undefined;
    let cancelled = false;
    const schedulerIntervalMs = 25;
    const displayIntervalMs = 125;
    scheduledTimedPlaybackIndexRef.current = Math.max(0, timedTransportStateRef.current.nextPlaybackIndex);
    clearScheduledTimedCueCallbacks();

    const initialNowSeconds = getTimedTransportClockSecondsRef.current?.() ?? performance.now() / 1000;
    setTimedTransportClockSeconds(initialNowSeconds);
    runTimedCueLookahead(initialNowSeconds);

    const schedulerId = window.setInterval(() => {
      if (cancelled) return;
      const nowSeconds = getTimedTransportClockSecondsRef.current?.() ?? performance.now() / 1000;
      runTimedCueLookahead(nowSeconds);
    }, schedulerIntervalMs);

    const monitorId = window.setInterval(() => {
      if (cancelled) return;
      const nowSeconds = getTimedTransportClockSecondsRef.current?.() ?? performance.now() / 1000;
      const previous = timedTransportStateRef.current;
      const result = advanceTimedTransport(previous, timedPlaybackBurstsRef.current, nowSeconds);
      timedTransportStateRef.current = result.state;

      const stateChanged = (
        result.state.status !== previous.status ||
        result.state.nextPlaybackIndex !== previous.nextPlaybackIndex ||
        result.state.lastDispatchedPlaybackIndex !== previous.lastDispatchedPlaybackIndex
      );

      if (result.state.status === "finished") {
        clearScheduledTimedCueCallbacks();
        onStopSnapshotRef.current?.();
        setTimedTransportState(result.state);
        window.clearInterval(monitorId);
        return;
      }

      if (stateChanged) {
        setTimedTransportState(result.state);
      }
    }, schedulerIntervalMs);

    const displayId = window.setInterval(() => {
      if (cancelled) return;
      const nowSeconds = getTimedTransportClockSecondsRef.current?.() ?? performance.now() / 1000;
      setTimedTransportClockSeconds(nowSeconds);
    }, displayIntervalMs);

    return () => {
      cancelled = true;
      clearScheduledTimedCueCallbacks();
      window.clearInterval(schedulerId);
      window.clearInterval(monitorId);
      window.clearInterval(displayId);
    };
  }, [
    clearScheduledTimedCueCallbacks,
    runTimedCueLookahead,
    timedTransportState.status,
  ]);

  const handleTimedTransportPlayPause = useCallback(() => {
    if (!timedPlaybackBursts.length) return;
    const nowSeconds = getTimedTransportClockSeconds?.() ?? performance.now() / 1000;
    setTimedTransportClockSeconds(nowSeconds);
    setTimedTransportState((previous) => {
      if (previous.status === "running") return pauseTimedTransport(previous, nowSeconds);
      if (previous.status === "paused") return resumeTimedTransport(previous, nowSeconds);
      const startIndex = resolveTimedTransportStartIndex();
      return startTimedTransport(previous, timedPlaybackBursts, {
        playbackIndex: startIndex < 0 ? 0 : startIndex,
        clockSeconds: nowSeconds,
      });
    });
  }, [getTimedTransportClockSeconds, resolveTimedTransportStartIndex, timedPlaybackBursts]);

  const handleTimedTransportStop = useCallback(() => {
    clearScheduledTimedCueCallbacks();
    onStopSnapshot?.();
    scheduledTimedPlaybackIndexRef.current = 0;
    setTimedTransportState(stopTimedTransport(timedPlaybackBursts));
  }, [clearScheduledTimedCueCallbacks, onStopSnapshot, timedPlaybackBursts]);

  const timedTransportDisplay = useMemo(() => {
    const runningElapsed = currentTimedTransportElapsedSeconds(timedTransportState, timedTransportClockSeconds);
    const queuedPlaybackIndex = timedTransportState.status === "stopped" || timedTransportState.status === "empty"
      ? resolveTimedTransportStartIndex()
      : timedTransportState.nextPlaybackIndex >= 0
        ? Math.max(0, timedTransportState.nextPlaybackIndex)
        : Math.max(0, timedPlaybackBursts.length - 1);
    const queuedBurst = queuedPlaybackIndex >= 0 ? timedPlaybackBursts[queuedPlaybackIndex] ?? null : null;
    const lastDispatchedBurst = timedTransportState.lastDispatchedPlaybackIndex >= 0
      ? (timedPlaybackBursts[timedTransportState.lastDispatchedPlaybackIndex] ?? null)
      : null;
    const displaySequenceTime = (
      lastDispatchedBurst?.sequenceTime
      ?? queuedBurst?.sequenceTime
      ?? (Number(sortedBars[selectedBarIndex]?.position) || 1)
    );

    return {
      clock: formatTransportClock(runningElapsed),
      barBeat: formatTransportBarBeat(displaySequenceTime),
      running: timedTransportState.status === "running",
      paused: timedTransportState.status === "paused",
      canPlay: timedCueTriggers.length > 0,
      canStop: timedTransportState.status === "running" || timedTransportState.status === "paused",
    };
  }, [
    formatTransportBarBeat,
    formatTransportClock,
    resolveTimedTransportStartIndex,
    selectedBarIndex,
    sortedBars,
    timedPlaybackBursts,
    timedCueTriggers.length,
    timedTransportClockSeconds,
    timedTransportState,
  ]);

  const selectBarForPosition = (position) => {
    const barContext = barContextForPosition(position, sortedBars);
    if (barContext) onSelectSequenceBar?.(barContext.barIndex);
  };

  const scrollNodeIntoPanel = useCallback((targetNode) => {
    const scrollPanel = scrollPanelRef.current;
    if (!(scrollPanel instanceof HTMLElement) || !(targetNode instanceof HTMLElement)) return;

    window.requestAnimationFrame(() => {
      const panelRect = scrollPanel.getBoundingClientRect();
      const targetRect = targetNode.getBoundingClientRect();
      const gap = 6;
      const targetTop = scrollPanel.scrollTop + (targetRect.top - panelRect.top) - gap;
      const maxTop = Math.max(0, scrollPanel.scrollHeight - scrollPanel.clientHeight);
      const nextTop = Math.max(0, Math.min(maxTop, targetTop));
      if (Math.abs(nextTop - scrollPanel.scrollTop) < 2) return;
      scrollPanel.scrollTop = nextTop;
    });
  }, []);

  const armPendingSnapshot = (snapshotIndex) => {
    transportScrollTargetRef.current = "snapshot";
    const nextSnapshotIndex = Number(snapshotIndex);
    if (!Number.isFinite(nextSnapshotIndex)) {
      setPendingSnapshotJumpIndex("");
      setPendingCueJumpIndex("");
      return;
    }
    setPendingSnapshotJumpIndex(String(nextSnapshotIndex));
    const nextCueIndex = firstCueIndexBySnapshotIndex.get(nextSnapshotIndex);
    setPendingCueJumpIndex(nextCueIndex == null ? "" : String(nextCueIndex));
    const snapshotTime = firstCueTimeBySnapshotIndex.get(nextSnapshotIndex) ?? (nextSnapshotIndex + 1);
    const repeatStartKey = repeatStartKeyAtPosition(snapshotTime);
    if (repeatStartKey != null) {
      const repeatRow = barRowRefs.current.get(repeatStartKey) ?? null;
      scrollNodeIntoPanel(repeatRow);
    } else {
      const snapshotId = snapshots[nextSnapshotIndex]?.id ?? null;
      if (snapshotId != null) {
        const snapshotRow = snapshotRowRefs.current.get(snapshotId) ?? null;
        scrollNodeIntoPanel(snapshotRow);
      }
    }
    selectBarForPosition(snapshotTime);
  };

  const armPendingCue = (cueIndex) => {
    transportScrollTargetRef.current = "cue";
    const nextCueIndex = Number(cueIndex);
    if (!Number.isFinite(nextCueIndex)) {
      setPendingCueJumpIndex("");
      return;
    }
    const cueGroup = sequenceCueGroups[nextCueIndex];
    if (!cueGroup) {
      setPendingCueJumpIndex("");
      return;
    }
    setPendingCueJumpIndex(String(nextCueIndex));
    setPendingSnapshotJumpIndex(String(cueGroup.snapshotIndex));
    const repeatStartKey = repeatStartKeyAtPosition(cueGroup.time);
    if (repeatStartKey != null) {
      const repeatRow = barRowRefs.current.get(repeatStartKey) ?? null;
      scrollNodeIntoPanel(repeatRow);
      selectBarForPosition(cueGroup.time);
      return;
    }
    const previewExpandedIds = cueExpandedSnapshotIdsAt(nextCueIndex);
    if (showAllEvents) {
      const anchorSnapshotId = firstSnapshotIdInSet(previewExpandedIds, snapshots)
        ?? (snapshots[cueGroup.snapshotIndex]?.id ?? null);
      if (anchorSnapshotId != null) {
        const snapshotRow = snapshotRowRefs.current.get(anchorSnapshotId) ?? null;
        scrollNodeIntoPanel(snapshotRow);
      }
    } else {
      if (previewExpandedIds.size > 0) {
        setExpandedIds(previewExpandedIds);
        const anchorSnapshotId = firstSnapshotIdInSet(previewExpandedIds, snapshots);
        if (anchorSnapshotId != null) {
          const snapshotRow = snapshotRowRefs.current.get(anchorSnapshotId) ?? null;
          scrollNodeIntoPanel(snapshotRow);
        }
      } else {
        const eventId = firstEventIdByCueIndex.get(nextCueIndex + 1) ?? null;
        if (eventId != null) {
          const eventRow = eventRowRefs.current.get(eventId) ?? null;
          scrollNodeIntoPanel(eventRow);
        }
      }
    }
    selectBarForPosition(cueGroup.time);
  };

  const ensureExpanded = (id) => {
    setExpandedIds((prev) => {
      if (prev.size === 1 && prev.has(id)) return prev;
      return new Set([id]);
    });
  };

  useEffect(() => {
    const nextExpandedIds = deriveExpandedSnapshotIds({
      showAllEvents,
      pendingCueJumpIndex,
      cueExpandedSnapshotIdsAt,
      playheadIsOff,
      playheadIsEnd,
      selectedSnapshotId,
      activeCueIndex,
      cueExpandedSnapshotIds,
    });
    if (nextExpandedIds == null) return;
    setExpandedIds((prev) => (sameSnapshotSet(prev, nextExpandedIds) ? prev : nextExpandedIds));
  }, [activeCueIndex, cueExpandedSnapshotIds, cueExpandedSnapshotIdsAt, pendingCueJumpIndex, playheadIsEnd, playheadIsOff, selectedSnapshotId, showAllEvents]);

  useEffect(() => {
    if (snapshots.length > 0 || sortedBars.length > 0 || sortedTempi.length > 0) return;
    setExpandedIds((prev) => (prev.size === 0 ? prev : new Set()));
    setPendingSnapshotJumpIndex("");
    setPendingCueJumpIndex("");
    setEventSequenceDrafts({});
  }, [snapshots.length, sortedBars.length, sortedTempi.length]);

  useEffect(() => {
    if (!pendingTransportActionRef.current) return;
    const action = pendingTransportActionRef.current;
    pendingTransportActionRef.current = null;
    action();
  }, [editCommitTick, snapshots]);

 useEffect(() => {
    if (Number.isFinite(activeCueIndex)) {
      const anchorTarget = deriveCueScrollAnchorTarget({
        showAllEvents,
        activeCueIndex,
        sequenceCueGroups,
        snapshots,
        cueExpandedSnapshotIds,
        repeatSections: sequenceRepeatSections,
      });
      if (anchorTarget == null) return;
      const targetRefKey = `${anchorTarget.kind}:${anchorTarget.targetKey}`;
      if (lastAutoScrolledCueTargetRef.current === targetRefKey) return;
      const targetNode = anchorTarget.kind === "structural"
        ? (barRowRefs.current.get(anchorTarget.targetKey) ?? null)
        : (snapshotRowRefs.current.get(anchorTarget.targetKey) ?? null);
      if (!(targetNode instanceof HTMLElement)) return;

      lastAutoScrolledCueTargetRef.current = targetRefKey;
      scrollNodeIntoPanel(targetNode);
      return;
    }
    lastAutoScrolledCueTargetRef.current = null;
  }, [activeCueIndex, cueExpandedSnapshotIds, scrollNodeIntoPanel, sequenceCueGroups, sequenceRepeatSections, showAllEvents, snapshots]);

  useEffect(() => {
    if (Number.isFinite(activeCueIndex)) {
      lastAutoScrolledSnapshotIdRef.current = null;
      return;
    }
    const repeatStartKey = activeSnapshotId != null
      ? (repeatStartBySnapshotId.get(activeSnapshotId) ?? (
        playheadStepIndex === 0 && firstRepeatStartMarker != null
          ? structuralEventRenderKey({
            type: "repeat-start",
            repeatId: firstRepeatStartMarker.id,
          })
          : null
      ))
      : (
        playheadStepIndex === 0 && firstRepeatStartMarker != null
          ? structuralEventRenderKey({
            type: "repeat-start",
            repeatId: firstRepeatStartMarker.id,
          })
          : null
      );
    if (repeatStartKey != null) {
      if (lastAutoScrolledSnapshotIdRef.current === repeatStartKey) return;
      const repeatRow = barRowRefs.current.get(repeatStartKey) ?? null;
      if (!(repeatRow instanceof HTMLElement)) return;
      lastAutoScrolledSnapshotIdRef.current = repeatStartKey;
      scrollNodeIntoPanel(repeatRow);
      return;
    }
    const snapshotId = activeSnapshotId ?? null;
    if (snapshotId == null) {
      lastAutoScrolledSnapshotIdRef.current = null;
      return;
    }
    if (lastAutoScrolledSnapshotIdRef.current === snapshotId) return;
    const scrollPanel = scrollPanelRef.current;
    const snapshotRow = snapshotRowRefs.current.get(snapshotId) ?? null;
    if (!(scrollPanel instanceof HTMLElement) || !(snapshotRow instanceof HTMLElement)) return;

    lastAutoScrolledSnapshotIdRef.current = snapshotId;
    const frame = window.requestAnimationFrame(() => {
      const panelRect = scrollPanel.getBoundingClientRect();
      const snapshotRect = snapshotRow.getBoundingClientRect();
      const gap = 6;
      const targetTop = scrollPanel.scrollTop + (snapshotRect.top - panelRect.top) - gap;
      const maxTop = Math.max(0, scrollPanel.scrollHeight - scrollPanel.clientHeight);
      const nextTop = Math.max(0, Math.min(maxTop, targetTop));
      if (Math.abs(nextTop - scrollPanel.scrollTop) < 2) return;
      scrollPanel.scrollTop = nextTop;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeCueIndex, activeSnapshotId, firstRepeatStartMarker, playheadStepIndex, repeatStartBySnapshotId, scrollNodeIntoPanel]);

  useEffect(() => {
    const pendingTarget = pendingResetScrollTargetRef.current;
    if (!playheadIsOff || pendingTarget == null) return;
    pendingResetScrollTargetRef.current = null;
    if (pendingTarget === "__top__") {
      const scrollPanel = scrollPanelRef.current;
      if (scrollPanel instanceof HTMLElement) {
        scrollPanel.scrollTop = 0;
      }
      return;
    }
    const repeatRow = barRowRefs.current.get(pendingTarget) ?? null;
    if (!(repeatRow instanceof HTMLElement)) return;
    suppressNextBarAutoScrollRef.current = true;
    lastAutoScrolledSnapshotIdRef.current = pendingTarget;
    scrollNodeIntoPanel(repeatRow);
  }, [playheadIsOff, scrollNodeIntoPanel]);

  useEffect(() => {
    if (!playheadIsOff || transportScrollTargetRef.current !== "bar") {
      lastAutoScrolledBarIdRef.current = null;
      return;
    }
    if (pendingResetScrollTargetRef.current != null) return;
    if (suppressNextBarAutoScrollRef.current) {
      suppressNextBarAutoScrollRef.current = false;
      return;
    }
    const selectedBar = sortedBars[selectedBarIndex] ?? null;
    const selectedBarId = selectedBar?.id ?? null;
    if (selectedBarId == null) return;
    const repeatStartKey = repeatStartKeyAtPosition(selectedBar.position);
    const targetKey = repeatStartKey ?? selectedBarId;
    if (lastAutoScrolledBarIdRef.current === targetKey) return;
    const scrollPanel = scrollPanelRef.current;
    const barRow = barRowRefs.current.get(targetKey) ?? null;
    if (!(scrollPanel instanceof HTMLElement) || !(barRow instanceof HTMLElement)) return;

    lastAutoScrolledBarIdRef.current = targetKey;
    const frame = window.requestAnimationFrame(() => {
      const panelRect = scrollPanel.getBoundingClientRect();
      const barRect = barRow.getBoundingClientRect();
      const gap = 6;
      const targetTop = scrollPanel.scrollTop + (barRect.top - panelRect.top) - gap;
      const maxTop = Math.max(0, scrollPanel.scrollHeight - scrollPanel.clientHeight);
      const nextTop = Math.max(0, Math.min(maxTop, targetTop));
      if (Math.abs(nextTop - scrollPanel.scrollTop) < 2) return;
      scrollPanel.scrollTop = nextTop;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [playheadIsOff, repeatStartKeyAtPosition, selectedBarIndex, sortedBars]);

  const notifyEditCommitted = () => {
    setEditCommitTick((value) => value + 1);
  };

  const runTransportAction = (action) => {
    if (typeof document === "undefined") {
      action?.();
      return;
    }
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active.matches?.(".sequencer-event__input")
    ) {
      pendingTransportActionRef.current = action;
      active.blur();
      return;
    }
    action?.();
  };

  const resetSequencePlayheadAndScrollTop = useCallback(() => {
    transportScrollTargetRef.current = "bar";
    lastAutoScrolledBarIdRef.current = null;
    const repeatStartKey = firstRepeatStartMarker != null
      ? structuralEventRenderKey({
        type: "repeat-start",
        repeatId: firstRepeatStartMarker.id,
      })
      : null;
    if (repeatStartKey != null) {
      pendingResetScrollTargetRef.current = repeatStartKey;
    } else {
      pendingResetScrollTargetRef.current = null;
      const scrollPanel = scrollPanelRef.current;
      if (scrollPanel instanceof HTMLElement) {
        scrollPanel.scrollTop = 0;
      }
    }
    onResetSequencePlayhead?.();
  }, [firstRepeatStartMarker, onResetSequencePlayhead]);

  const jumpSequencePlayheadToEndAndScrollBottom = useCallback(() => {
    transportScrollTargetRef.current = "bar";
    lastAutoScrolledBarIdRef.current = null;
    pendingResetScrollTargetRef.current = null;
    const scrollPanel = scrollPanelRef.current;
    if (scrollPanel instanceof HTMLElement) {
      scrollPanel.scrollTop = Math.max(0, scrollPanel.scrollHeight - scrollPanel.clientHeight);
    }
    onJumpSequenceEnd?.();
  }, [onJumpSequenceEnd]);

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => (prev.has(id) ? new Set() : new Set([id])));
  };

  const resolveDropSide = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  };

  const updateEventSequenceDraftField = (draftKey, field, value, meta) => {
    setEventSequenceDrafts((prev) => updateEventSequenceDrafts(prev, {
      draftKey,
      field,
      value,
      meta,
      snapshotCount: snapshots.length,
    }));
  };

  const cancelEventSequenceDraft = (draftKey) => {
    setEventSequenceDrafts((prev) => removeDraftEntry(prev, draftKey));
  };

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
    notifyEditCommitted();
  }, [
    findNoteInSnapshot,
    findSnapshotById,
    nextDuplicateNoteId,
    onUpdateSnapshot,
    onSelectMarker,
    onSelectSnapshot,
    snapshotIndexById,
  ]);

  const deleteEventNote = useCallback((snapshotId, noteKey) => {
    const snapshot = findSnapshotById(snapshotId);
    if (!snapshot) return;
    const notes = deleteEventNoteFromSnapshot(snapshot, noteKey);
    onUpdateSnapshot(snapshot.id, { notes });
    notifyEditCommitted();
  }, [findSnapshotById, onUpdateSnapshot]);

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

  const stoppedBarStateForBarNumber = useCallback(
    (barNumber) => isStoppedBarNumber(barNumber, sortedBars),
    [sortedBars],
  );
  const beatsPerBarForBarNumber = useCallback(
    (barNumber) => Math.max(0, Math.round(Number(timingBarAtNumber(barNumber, sortedBars)?.numerator) || 0)),
    [sortedBars],
  );

  const applyTempoBarRelativeDraft = useCallback((draft) => {
    const position = resolveBarRelativeDraftPosition(draft, sortedBars, terminalBarlinePosition);
    if (position == null) return;
    onUpdateTempo?.(draft.tempoId, { position });
    setTempoBarRelativeDrafts((prev) => removeDraftEntry(prev, draft.draftKey));
    notifyEditCommitted();
  }, [onUpdateTempo, sortedBars, terminalBarlinePosition]);

  const applyRepeatBarRelativeDraft = useCallback((draft) => {
    const position = resolveBarRelativeDraftPosition(draft, sortedBars, terminalBarlinePosition);
    if (position == null) return;
    onUpdateRepeat?.(draft.repeatId, { position });
    setRepeatBarRelativeDrafts((prev) => removeDraftEntry(prev, draft.draftKey));
    notifyEditCommitted();
  }, [onUpdateRepeat, sortedBars, terminalBarlinePosition]);

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
    notifyEditCommitted();
  }, [onUpdateSnapshot, snapshots, sortedBars, snapshotIndexById, terminalBarlinePosition]);

  const updateEventBarRelativeDraftField = (draftKey, barBeat, field, value, meta) => {
    setBarRelativeDrafts((prev) => updateBarRelativeDrafts(prev, {
      draftKey,
      barBeat,
      field,
      value,
      meta,
      scopePrefix: "event",
      isStoppedBar: stoppedBarStateForBarNumber,
      beatsPerBarForBarNumber,
    }));
  };

  const cancelEventBarRelativeDraft = (draftKey) => {
    setBarRelativeDrafts((prev) => removeDraftEntry(prev, draftKey));
  };

  const updateTempoBarRelativeDraftField = (draftKey, barBeat, field, value, meta) => {
    setTempoBarRelativeDrafts((prev) => updateBarRelativeDrafts(prev, {
      draftKey,
      barBeat,
      field,
      value,
      meta,
      scopePrefix: "tempo",
      isStoppedBar: stoppedBarStateForBarNumber,
      beatsPerBarForBarNumber,
    }));
  };

  const cancelTempoBarRelativeDraft = (draftKey) => {
    setTempoBarRelativeDrafts((prev) => removeDraftEntry(prev, draftKey));
  };

  const updateRepeatBarRelativeDraftField = (draftKey, barBeat, field, value, meta) => {
    setRepeatBarRelativeDrafts((prev) => updateBarRelativeDrafts(prev, {
      draftKey,
      barBeat,
      field,
      value,
      meta,
      scopePrefix: "repeat",
      isStoppedBar: stoppedBarStateForBarNumber,
      beatsPerBarForBarNumber,
    }));
  };

  const cancelRepeatBarRelativeDraft = (draftKey) => {
    setRepeatBarRelativeDrafts((prev) => removeDraftEntry(prev, draftKey));
  };

  const commitTempoBarRelativeDraft = (tempoId, draftKey) => {
    const draft = tempoBarRelativeDrafts[draftKey];
    if (!draft) return;
    applyTempoBarRelativeDraft(draft);
  };

  const commitRepeatBarRelativeDraft = (repeatId, draftKey) => {
    const draft = repeatBarRelativeDrafts[draftKey];
    if (!draft) return;
    applyRepeatBarRelativeDraft(draft);
  };

  const commitEventBarRelativeDraft = (snapshot, noteKey, kind, draftKey) => {
    const draft = barRelativeDrafts[draftKey];
    if (!draft) return;
    applyEventBarRelativeDraft({
      ...draft,
      snapshotId: snapshot.id,
      noteKey,
      kind,
    });
  };

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

  const updateEventField = (snapshot, noteKey, field, rawValue) => {
    const notes = updateEventFieldInSnapshot(snapshot, noteKey, field, rawValue);
    if (!notes) return;
    onUpdateSnapshot(snapshot.id, { notes });
  };

  const restoreEventPitchLabel = (snapshot, noteKey) => {
    const notes = restoreEventPitchLabelInSnapshot(snapshot, noteKey);
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
      ? Math.max(0, parsed)
      : Math.max(1, parsed);
    if (!Number.isFinite(numeric)) return;
    if (field !== "numerator" && numeric <= 0) return;
    onUpdateBar?.(barId, { [field]: numeric });
  };

  const addBarAtRequestedPosition = () => {
    const numeric = Number(newBarPosition);
    const numerator = Math.max(0, Math.round(Number(newBarNumerator) || 0));
    const denominator = Math.max(1, Math.round(Number(newBarDenominator) || 1));
    if (!Number.isFinite(numeric)) return;
    onAddBar?.(Math.max(1, Math.round(numeric)), numerator, denominator);
    setNewBarPosition("1");
    setNewBarNumerator("4");
    setNewBarDenominator("4");
  };

  const addTempoAtRequestedPosition = () => {
    const position = Number(newTempoPosition);
    const bpm = Number(newTempoBpm);
    if (!Number.isFinite(position) || !Number.isFinite(bpm) || bpm <= 0) return;
    onAddTempo?.(Math.round(position * 1000000) / 1000000, bpm);
    setNewTempoPosition("1.000000");
    setNewTempoBpm("60");
  };

  const addRepeatAtRequestedPosition = (kind) => {
    const position = Number(newRepeatPosition);
    if (!Number.isFinite(position)) return;
    onAddRepeat?.(Math.round(position * 1000000) / 1000000, kind);
    setNewRepeatPosition("1.000000");
  };

  const updateNewBarMeterField = (field, rawValue) => {
    const digitsOnly = String(rawValue ?? "").replace(/[^\d]/g, "");
    if (digitsOnly === "") {
      if (field === "numerator") setNewBarNumerator("");
      else setNewBarDenominator("");
      return;
    }
    const parsed = Math.round(Number(digitsOnly) || 0);
    if (field === "numerator") {
      setNewBarNumerator(String(Math.max(0, parsed)));
      return;
    }
    setNewBarDenominator(String(Math.max(1, parsed)));
  };

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
    terminalBarlinePosition,
    tempoBarRelativeDraftKey,
    tempoBarRelativeDrafts,
    stoppedBarStateForBarNumber,
  };

  const repeatRowTiming = {
    sortedBars,
    terminalBarlinePosition,
    repeatBarRelativeDraftKey,
    repeatBarRelativeDrafts,
    stoppedBarStateForBarNumber,
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
    eventBarRelativeDraftKey,
    barRelativeDrafts,
    eventSequenceDraftKey,
    eventSequenceDrafts,
    stoppedBarStateForBarNumber,
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
          newBarPosition={newBarPosition}
          setNewBarPosition={setNewBarPosition}
          addBarAtRequestedPosition={addBarAtRequestedPosition}
          newBarNumerator={newBarNumerator}
          newBarDenominator={newBarDenominator}
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
          setPendingSnapshotJumpIndex={setPendingSnapshotJumpIndex}
          setPendingCueJumpIndex={setPendingCueJumpIndex}
          armPendingSnapshot={armPendingSnapshot}
          snapshots={snapshots}
          playheadIsOff={playheadIsOff}
          prevSnapshotIndexFromBar={prevSnapshotIndexFromBar}
          nextSnapshotIndexFromBar={nextSnapshotIndexFromBar}
          pendingSnapshotJumpIndex={pendingSnapshotJumpIndex}
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
          pendingCueJumpIndex={pendingCueJumpIndex}
          onJumpSequenceCue={onJumpSequenceCue}
          onStepSequenceMarker={onStepSequenceMarker}
          onResetSequencePlayhead={resetSequencePlayheadAndScrollTop}
          onJumpSequenceEnd={jumpSequencePlayheadToEndAndScrollBottom}
          onPlaySequence={onPlaySequence}
          playingSnapshotId={playingSnapshotId}
          onStopSnapshot={onStopSnapshot}
          timedTransportDisplay={timedTransportDisplay}
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

          {sequenceSaveActionState.visible && typeof sequenceSaveActionState.action === "function" && (
            <div class="settings-form__action-row sequencer-scroll-panel__save-row">
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
        </div>
      </fieldset>
    </div>
  );
};

export default Sequencer;
