import { Fragment } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SNAPSHOT_LABEL_MODES } from "./labels.js";
import SequenceInfo from "./sequence-info.jsx";
import SequenceLibrary from "./sequence-library.jsx";
import {
  absolutePositionToBarBeat,
  barContextForPosition,
  barBeatToAbsolutePosition,
  normalizeBarMarkers,
  normalizeTempoMarkers,
} from "./transport.js";
import {
  deriveSequenceCueGroups,
  deriveSequenceEvents,
  isWholeSequencePosition,
  sequenceNoteKeysAtCueIndex,
} from "./trigger-groups.js";

function formatSequenceTime(snapshotIndex, relativeTime) {
  const baseIndex = Number(snapshotIndex);
  const offset = Number(relativeTime);
  if (!Number.isFinite(baseIndex) || !Number.isFinite(offset)) return "--";
  return (baseIndex + offset).toFixed(6);
}

function formatSequenceOffset(relativeTime) {
  const offset = Number(relativeTime);
  if (!Number.isFinite(offset)) return "--";
  return offset.toFixed(6);
}

function formatDisplaySequenceOffset(relativeTime) {
  const offset = Number(relativeTime);
  if (!Number.isFinite(offset)) return "--";
  return offset.toFixed(3);
}

function formatFrequency(value) {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(1);
}

function formatEditableFrequency(value) {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(6);
}

function formatMidicents(value) {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(3);
}

function formatEditableMidicents(value) {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(6);
}

function displayValue(value) {
  return value == null ? "--" : String(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isOutOfSnapshotRange(snapshot, relativeTime) {
  const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
  const time = Number(relativeTime);
  if (!Number.isFinite(time)) return false;
  return time < 0 || time > length;
}

function frequencyToMidicents(value) {
  const frequency = Number(value);
  if (!Number.isFinite(frequency) || frequency <= 0) return null;
  return 69 + Math.log2(frequency / 440) * 12;
}

function normalizeSequenceNumber(value) {
  return Math.round(Number(value) * 1000000) / 1000000;
}

function barDisplayBucket(position) {
  const time = Number(position);
  if (!Number.isFinite(time) || time <= 1 + 1e-9) return -1;
  const rounded = Math.round(time);
  const isInteger = Math.abs(time - rounded) < 1e-9;
  return isInteger ? rounded - 2 : Math.floor(time - 1);
}

function noteIdentity(note, fallbackLength = 1) {
  const midicents = Number.isFinite(Number(note?.midicents)) ? Number(note.midicents) : "na";
  const start = Number.isFinite(Number(note?.start)) ? Number(note.start) : 0;
  const rawEnd = Number.isFinite(Number(note?.end)) ? Number(note.end) : fallbackLength;
  const end = Math.max(start, rawEnd);
  return note?.id ?? `${midicents}:${start}:${end}`;
}

function sortSnapshotNotes(notes = [], fallbackLength = 1) {
  return [...notes].sort((a, b) => {
    const aStart = Number.isFinite(Number(a?.start)) ? Number(a.start) : 0;
    const bStart = Number.isFinite(Number(b?.start)) ? Number(b.start) : 0;
    if (aStart !== bStart) return aStart - bStart;
    const aEnd = Math.max(aStart, Number.isFinite(Number(a?.end)) ? Number(a.end) : fallbackLength);
    const bEnd = Math.max(bStart, Number.isFinite(Number(b?.end)) ? Number(b.end) : fallbackLength);
    if (aEnd !== bEnd) return aEnd - bEnd;
    const aPitch = Number.isFinite(Number(a?.midicents)) ? Number(a.midicents) : -Infinity;
    const bPitch = Number.isFinite(Number(b?.midicents)) ? Number(b.midicents) : -Infinity;
    return bPitch - aPitch;
  });
}

function readNumericInput(container, selector, fallback = null) {
  const input = container?.querySelector?.(selector);
  if (!(input instanceof HTMLInputElement)) return fallback;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function normalizeTempoBeatFraction(numerator, denominator) {
  const beatNumerator = Math.max(1, Math.round(Number(numerator) || 1));
  const beatDenominator = Math.max(1, Math.round(Number(denominator) || 4));
  return {
    beatNumerator,
    beatDenominator,
    beatLength: (4 * beatNumerator) / beatDenominator,
  };
}

function soundingOnTextStyle(active) {
  if (!active) return undefined;
  return {
    fontWeight: 600,
    color: "#15530f",
  };
}

function structuralEventRenderKey(item) {
  if (!item) return "";
  if (item.type === "bar" || item.structuralType === "bar") return `bar:${item.barId ?? item.id}`;
  if (item.type === "tempo" || item.structuralType === "tempo") return `tempo:${item.tempoId ?? item.id}`;
  return "";
}

function structuralEventInstanceKey(item) {
  const base = structuralEventRenderKey(item);
  if (!base) return "";
  if (item.type === "bar" || item.structuralType === "bar") {
    return `${base}:${Number(item.position ?? item.absoluteTime ?? 0).toFixed(6)}:${item.numerator ?? 4}:${item.denominator ?? 4}`;
  }
  if (item.type === "tempo" || item.structuralType === "tempo") {
    return `${base}:${Number(item.position ?? item.absoluteTime ?? 0).toFixed(6)}:${item.bpm ?? 60}:${item.beatNumerator ?? 1}:${item.beatDenominator ?? 4}`;
  }
  return base;
}

function commitTextInput(target, commit) {
  if (!(target instanceof HTMLInputElement)) return;
  const value = target.value;
  if (target.dataset.lastCommittedValue === value) return;
  commit(value);
  target.dataset.lastCommittedValue = value;
}

/**
 * Sequencer — early sidebar workspace for building sequencer material from
 * captured snapshots while keeping the existing Hexatone canvas active.
 */
const Sequencer = ({
  snapshots,
  bars,
  tempi,
  snapshotLabelMode,
  activeSequenceName,
  activeSequenceSavedName,
  activeSequenceDescription,
  sequenceLegato,
  sequenceAutoCreateBars,
  selectedSnapshotId,
  selectedMarker,
  playingSnapshotId,
  playhead,
  onTakeSnapshot,
  onLoadSequence,
  onSequenceNameChange,
  onSequenceDescriptionChange,
  onSequenceSaved,
  onSequenceLegatoChange,
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
  onResetSequencePlayhead,
  onAddBar,
  onAddTempo,
  onAddBarsBeforeSnapshots,
  onDeleteBar,
  onDeleteTempo,
  onUpdateBar,
  onUpdateTempo,
  onMoveBar,
  onDeleteSnapshot,
  onDeleteAllSnapshots,
  onClearSequence,
  onMoveSnapshot,
  onDuplicateSnapshot,
  onUpdateSnapshot,
  onResetSnapshotDescription,
}) => {
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [showAllEvents, setShowAllEvents] = useState(true);
  const [newBarPosition, setNewBarPosition] = useState("1.000000");
  const [newTempoPosition, setNewTempoPosition] = useState("1.000000");
  const [newTempoBpm, setNewTempoBpm] = useState("60");
  const [confirmClearSnapshots, setConfirmClearSnapshots] = useState(false);
  const [confirmClearSequence, setConfirmClearSequence] = useState(false);
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
  const lastAutoScrolledCueIndexRef = useRef(null);
  const transportScrollTargetRef = useRef("snapshot");

  const sortedBars = useMemo(() => normalizeBarMarkers(bars), [bars]);
  const sortedTempi = useMemo(
    () => (Array.isArray(tempi) ? normalizeTempoMarkers(tempi) : []),
    [tempi],
  );
  const sequenceEvents = useMemo(() => deriveSequenceEvents(snapshots, sortedBars, sortedTempi), [snapshots, sortedBars, sortedTempi]);
  const sequenceCueGroups = useMemo(() => deriveSequenceCueGroups(snapshots, sortedBars, sortedTempi), [snapshots, sortedBars, sortedTempi]);

  const rawPlayheadStepIndex = Number.isFinite(playhead?.stepIndex) ? playhead.stepIndex : -1;
  const playheadIsOff = rawPlayheadStepIndex < 0 || snapshots.length === 0;
  const playheadIsEnd = !playheadIsOff && rawPlayheadStepIndex >= snapshots.length;
  const playheadStepIndex =
    playheadIsOff || playheadIsEnd
      ? -1
      : Math.max(0, Math.min(snapshots.length - 1, rawPlayheadStepIndex));
  const playheadMarkerIndex = Number.isFinite(playhead?.markerIndex) ? playhead.markerIndex : null;

  const snapshotIndexById = useMemo(() => {
    const entries = snapshots.map((snapshot, index) => [snapshot.id, index + 1]);
    return new Map(entries);
  }, [snapshots]);

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

  const snapshotEventsById = useMemo(() => {
    const groups = new Map();
    for (const event of sequenceEvents) {
      if (event.type !== "note" && event.type !== "bar" && event.type !== "tempo") continue;
      if (
        (event.type === "bar" || event.type === "tempo") &&
        isWholeSequencePosition(event.absoluteTime) &&
        Math.abs(Number(event.absoluteTime) - (Number(event.snapshotIndex) + 1)) < 1e-9
      ) {
        continue;
      }
      if (!groups.has(event.snapshotId)) groups.set(event.snapshotId, []);
      groups.get(event.snapshotId).push(event);
    }
    return groups;
  }, [sequenceEvents]);

  const firstSnapshotEventIds = useMemo(() => {
    const ids = new Map();
    for (const [snapshotId, events] of snapshotEventsById.entries()) {
      const firstNoteEvent = events.find((event) => event.type === "note");
      if (firstNoteEvent) ids.set(snapshotId, firstNoteEvent.eventId);
    }
    return ids;
  }, [snapshotEventsById]);

  const selectedBarIndex = sortedBars.length === 0
    ? 0
    : Math.max(0, Math.min(sortedBars.length - 1, Number(playhead?.barIndex) || 0));
  const selectedBarTime = sortedBars.length === 0
    ? 1
    : Number(sortedBars[selectedBarIndex]?.position) || 1;
  const nextCueIndexFromBar = useMemo(
    () => sequenceCueGroups.findIndex((group) => group.time >= selectedBarTime),
    [selectedBarTime, sequenceCueGroups],
  );
  const prevCueIndexFromBar = useMemo(
    () => sequenceCueGroups.findLastIndex((group) => group.time < selectedBarTime),
    [selectedBarTime, sequenceCueGroups],
  );
  const nextSnapshotIndexFromBar = useMemo(() => {
    if (nextCueIndexFromBar >= 0) return sequenceCueGroups[nextCueIndexFromBar]?.snapshotIndex ?? -1;
    const nextIndex = snapshots.findIndex((_, index) => index + 1 >= selectedBarTime);
    return nextIndex >= 0 ? nextIndex : snapshots.length;
  }, [nextCueIndexFromBar, selectedBarTime, sequenceCueGroups, snapshots]);
  const prevSnapshotIndexFromBar = useMemo(() => {
    if (prevCueIndexFromBar >= 0) return sequenceCueGroups[prevCueIndexFromBar]?.snapshotIndex ?? -1;
    return snapshots.findLastIndex((_, index) => index + 1 < selectedBarTime);
  }, [prevCueIndexFromBar, selectedBarTime, sequenceCueGroups, snapshots]);

  const snapshotSelectValue = pendingSnapshotJumpIndex !== ""
    ? pendingSnapshotJumpIndex
    : playheadIsEnd
      ? snapshots.length > 0 ? "0" : ""
      : playheadIsOff || playheadStepIndex < 0
        ? nextSnapshotIndexFromBar >= 0 && nextSnapshotIndexFromBar < snapshots.length
          ? String(nextSnapshotIndexFromBar)
          : snapshots.length > 0 ? String(snapshots.length - 1) : ""
        : String(playheadStepIndex);
  const cueSelectValue = pendingCueJumpIndex !== ""
    ? pendingCueJumpIndex
    : playheadIsEnd
      ? sequenceCueGroups.length > 0 ? "0" : ""
      : playheadIsOff || (playheadMarkerIndex == null && sequenceCueGroups.length === 0)
        ? nextCueIndexFromBar >= 0 && nextCueIndexFromBar < sequenceCueGroups.length
          ? String(nextCueIndexFromBar)
          : sequenceCueGroups.length > 0 ? String(sequenceCueGroups.length - 1) : ""
        : playheadMarkerIndex != null
          ? String(playheadMarkerIndex)
          : nextCueIndexFromBar >= 0 && nextCueIndexFromBar < sequenceCueGroups.length
            ? String(nextCueIndexFromBar)
            : sequenceCueGroups.length > 0 ? String(sequenceCueGroups.length - 1) : "";
  const impliedPendingSnapshotIndex = pendingSnapshotJumpIndex !== ""
    ? pendingSnapshotJumpIndex
    : playheadIsEnd
      ? snapshots.length > 0 ? "0" : ""
      : playheadIsOff || playheadStepIndex < 0
      ? nextSnapshotIndexFromBar >= 0 && nextSnapshotIndexFromBar < snapshots.length
        ? String(nextSnapshotIndexFromBar)
        : ""
      : "";
  const impliedPendingCueIndex = pendingCueJumpIndex !== ""
    ? pendingCueJumpIndex
    : playheadIsEnd
      ? sequenceCueGroups.length > 0 ? "0" : ""
      : playheadIsOff
      ? nextCueIndexFromBar >= 0 && nextCueIndexFromBar < sequenceCueGroups.length
        ? String(nextCueIndexFromBar)
        : ""
      : "";

  const barNumberById = useMemo(() => {
    const entries = sortedBars.map((bar, index) => [bar.id, index + 1]);
    return new Map(entries);
  }, [sortedBars]);

  const structuralMarkersByDisplayBucket = useMemo(() => {
    const groups = new Map();
    const collect = (marker, type, order) => {
      if (!isWholeSequencePosition(marker.position)) return;
      const bucket = barDisplayBucket(marker.position);
      if (!groups.has(bucket)) groups.set(bucket, []);
      groups.get(bucket).push({ ...marker, structuralType: type, structuralOrder: order });
    };
    sortedBars.forEach((bar, index) => collect(bar, "bar", index));
    sortedTempi.forEach((tempo, index) => collect(tempo, "tempo", index));
    for (const items of groups.values()) {
      items.sort((a, b) => (
        Number(a.position) - Number(b.position) ||
        (a.structuralType === "tempo" ? 0 : 1) - (b.structuralType === "tempo" ? 0 : 1) ||
        Number(a.structuralOrder) - Number(b.structuralOrder)
      ));
    }
    return groups;
  }, [sortedBars, sortedTempi]);

  const snapshotStartCueIndexes = useMemo(() => {
    const indexes = new Map();
    for (const [snapshotId, eventId] of firstSnapshotEventIds.entries()) {
      const firstEvent = sequenceEvents.find((event) => event.eventId === eventId);
      if (firstEvent) indexes.set(snapshotId, firstEvent.cueIndex);
    }
    return indexes;
  }, [firstSnapshotEventIds, sequenceEvents]);
  const firstEventIdByCueIndex = useMemo(() => {
    const ids = new Map();
    for (const event of sequenceEvents) {
      if (event.type !== "note") continue;
      if (!Number.isFinite(event.cueIndex)) continue;
      if (!ids.has(event.cueIndex)) ids.set(event.cueIndex, event.eventId);
    }
    return ids;
  }, [sequenceEvents]);
  const firstCueIndexBySnapshotIndex = useMemo(() => {
    const indexes = new Map();
    sequenceCueGroups.forEach((group, index) => {
      if (!indexes.has(group.snapshotIndex)) indexes.set(group.snapshotIndex, index);
    });
    return indexes;
  }, [sequenceCueGroups]);
  const firstCueTimeBySnapshotIndex = useMemo(() => {
    const times = new Map();
    sequenceCueGroups.forEach((group) => {
      if (!times.has(group.snapshotIndex)) times.set(group.snapshotIndex, group.time);
    });
    return times;
  }, [sequenceCueGroups]);

  const activeNavigationMode = playheadMarkerIndex != null ? "cue" : "snapshot";
  const activeCueIndex = playheadMarkerIndex != null ? playheadMarkerIndex + 1 : null;
  const activeSnapshotId =
    playheadStepIndex >= 0 && !playheadIsEnd ? (snapshots[playheadStepIndex]?.id ?? null) : null;
  const sequencePlaybackActive = !!playingSnapshotId && playhead?.stopped !== true;
  const soundingAttackNoteKeys = useMemo(() => {
    if (!sequencePlaybackActive) return new Set();
    if (playheadMarkerIndex != null) {
      return new Set(sequenceNoteKeysAtCueIndex(snapshots, sortedBars, sortedTempi, playheadMarkerIndex));
    }
    const activeSnapshot = activeSnapshotId != null
      ? snapshots.find((snapshot) => snapshot.id === activeSnapshotId)
      : snapshots.find((snapshot) => snapshot.id === playingSnapshotId);
    if (!activeSnapshot) return new Set();
    const snapshotLength = Number.isFinite(Number(activeSnapshot.length)) ? Number(activeSnapshot.length) : 1;
    return new Set(
      (activeSnapshot.notes ?? [])
        .filter((note) => Number.isFinite(Number(note?.midicents)))
        .map((note) => noteIdentity(note, snapshotLength)),
    );
  }, [activeSnapshotId, playingSnapshotId, playheadMarkerIndex, sequencePlaybackActive, snapshots, sortedBars, sortedTempi]);
  const cueExpandedSnapshotIds = useMemo(() => {
    if (activeCueIndex == null) return new Set();
    const ids = new Set();
    for (const event of sequenceEvents) {
      if (event.type !== "note") continue;
      if (
        event.cueIndex === activeCueIndex ||
        (event.kind === "attack" && soundingAttackNoteKeys.has(event.noteKey))
      ) {
        if (event.snapshotId != null) ids.add(event.snapshotId);
      }
    }
    return ids;
  }, [activeCueIndex, sequenceEvents, soundingAttackNoteKeys]);
  const selectedCueAbsoluteTime = useMemo(() => {
    if (selectedMarker?.snapshotId != null && Number.isFinite(Number(selectedMarker?.time))) {
      const snapshotStart = snapshotIndexById.get(selectedMarker.snapshotId);
      if (snapshotStart != null) return Number((snapshotStart + Number(selectedMarker.time)).toFixed(6));
    }
    if (playheadMarkerIndex != null) {
      const cueGroup = sequenceCueGroups[playheadMarkerIndex];
      if (cueGroup) return Number(cueGroup.time.toFixed(6));
    }
    return null;
  }, [playheadMarkerIndex, selectedMarker, sequenceCueGroups, snapshotIndexById]);

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
    const snapshotId = snapshots[nextSnapshotIndex]?.id ?? null;
    if (snapshotId != null) {
      const snapshotRow = snapshotRowRefs.current.get(snapshotId) ?? null;
      scrollNodeIntoPanel(snapshotRow);
    }
    const snapshotTime = firstCueTimeBySnapshotIndex.get(nextSnapshotIndex) ?? (nextSnapshotIndex + 1);
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
    const eventId = firstEventIdByCueIndex.get(nextCueIndex + 1) ?? null;
    if (eventId != null) {
      const eventRow = eventRowRefs.current.get(eventId) ?? null;
      scrollNodeIntoPanel(eventRow);
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
    if (showAllEvents) return;
    if (playheadIsOff || playheadIsEnd || selectedSnapshotId == null) {
      setExpandedIds((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    if (activeCueIndex != null) {
      setExpandedIds((prev) => {
        if (
          prev.size === cueExpandedSnapshotIds.size &&
          [...cueExpandedSnapshotIds].every((id) => prev.has(id))
        ) {
          return prev;
        }
        return cueExpandedSnapshotIds.size > 0 ? new Set(cueExpandedSnapshotIds) : new Set([selectedSnapshotId]);
      });
      return;
    }
    setExpandedIds((prev) => {
      if (prev.size === 1 && prev.has(selectedSnapshotId)) return prev;
      return new Set([selectedSnapshotId]);
    });
  }, [activeCueIndex, cueExpandedSnapshotIds, playheadIsEnd, playheadIsOff, selectedSnapshotId, showAllEvents]);

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
    if (selectedCueAbsoluteTime == null) return;
    setNewBarPosition(selectedCueAbsoluteTime.toFixed(6));
  }, [selectedCueAbsoluteTime]);

  useEffect(() => {
    if (Number.isFinite(activeCueIndex)) {
      const cueIndex = activeCueIndex;
      if (lastAutoScrolledCueIndexRef.current === cueIndex) return;
      const scrollPanel = scrollPanelRef.current;
      const eventId = firstEventIdByCueIndex.get(cueIndex) ?? null;
      const eventRow = eventId != null ? eventRowRefs.current.get(eventId) ?? null : null;
      if (!(scrollPanel instanceof HTMLElement) || !(eventRow instanceof HTMLElement)) return;

      lastAutoScrolledCueIndexRef.current = cueIndex;
      const frame = window.requestAnimationFrame(() => {
        const panelRect = scrollPanel.getBoundingClientRect();
        const eventRect = eventRow.getBoundingClientRect();
        const gap = 6;
        const targetTop = scrollPanel.scrollTop + (eventRect.top - panelRect.top) - gap;
        const maxTop = Math.max(0, scrollPanel.scrollHeight - scrollPanel.clientHeight);
        const nextTop = Math.max(0, Math.min(maxTop, targetTop));
        if (Math.abs(nextTop - scrollPanel.scrollTop) < 2) return;
        scrollPanel.scrollTop = nextTop;
      });
      return () => window.cancelAnimationFrame(frame);
    }
    lastAutoScrolledCueIndexRef.current = null;
  }, [activeCueIndex, firstEventIdByCueIndex]);

  useEffect(() => {
    if (Number.isFinite(activeCueIndex)) {
      lastAutoScrolledSnapshotIdRef.current = null;
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
  }, [activeCueIndex, activeSnapshotId]);

  useEffect(() => {
    if (!playheadIsOff || transportScrollTargetRef.current !== "bar") {
      lastAutoScrolledBarIdRef.current = null;
      return;
    }
    const selectedBar = sortedBars[selectedBarIndex] ?? null;
    const selectedBarId = selectedBar?.id ?? null;
    if (selectedBarId == null) return;
    if (lastAutoScrolledBarIdRef.current === selectedBarId) return;
    const scrollPanel = scrollPanelRef.current;
    const barRow = barRowRefs.current.get(selectedBarId) ?? null;
    if (!(scrollPanel instanceof HTMLElement) || !(barRow instanceof HTMLElement)) return;

    lastAutoScrolledBarIdRef.current = selectedBarId;
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
  }, [playheadIsOff, selectedBarIndex, sortedBars]);

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

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => (prev.has(id) ? new Set() : new Set([id])));
  };

  const resolveDropSide = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  };

  const eventSequenceDraftKey = (snapshotId, eventId, kind) => `${snapshotId}:${eventId}:${kind}`;

  const buildEventSequenceDraft = (snapshotNumber, relativeTime, meta = {}) => ({
    snapshotNumber: String(snapshotNumber),
    offset: formatSequenceOffset(relativeTime),
    ...meta,
  });

  const updateEventSequenceDraftField = (draftKey, field, value, meta) => {
    setEventSequenceDrafts((prev) => {
      const current = prev[draftKey] ?? buildEventSequenceDraft(meta.snapshotNumber, meta.relativeTime);
      if (field === "snapshotNumber") {
        const currentSnapshotNumber = Number(current.snapshotNumber);
        const currentOffset = Number(current.offset);
        const currentAbsoluteTime = Number.isFinite(currentSnapshotNumber) && Number.isFinite(currentOffset)
          ? normalizeSequenceNumber(currentSnapshotNumber + currentOffset)
          : normalizeSequenceNumber(Number(meta.snapshotNumber) + Number(meta.relativeTime));
        const nextSnapshotNumber = Math.max(1, Math.min(snapshots.length, Math.round(Number(value) || 1)));
        return {
          ...prev,
          [draftKey]: {
            ...current,
            ...meta,
            draftKey,
            scope: `event-sequence:${draftKey}`,
            snapshotNumber: String(nextSnapshotNumber),
            offset: formatSequenceOffset(currentAbsoluteTime - nextSnapshotNumber),
          },
        };
      }
      return {
        ...prev,
        [draftKey]: {
          ...current,
          ...meta,
          draftKey,
          scope: `event-sequence:${draftKey}`,
          [field]: value,
        },
      };
    });
  };

  const cancelEventSequenceDraft = (draftKey) => {
    setEventSequenceDrafts((prev) => {
      if (!(draftKey in prev)) return prev;
      const next = { ...prev };
      delete next[draftKey];
      return next;
    });
  };

  const applyNoteIntoSnapshot = useCallback((targetSnapshotId, buildNotes) => {
    const targetSnapshot = findSnapshotById(targetSnapshotId);
    if (!targetSnapshot) return;
    const length = Number.isFinite(Number(targetSnapshot?.length)) ? Number(targetSnapshot.length) : 1;
    const nextNotes = sortSnapshotNotes(buildNotes(targetSnapshot, length), length);
    onUpdateSnapshot(targetSnapshotId, { notes: nextNotes });
  }, [findSnapshotById, onUpdateSnapshot]);

  const commitNoteTransfer = useCallback((sourceSnapshotId, noteKey, targetSnapshotId, mutateNote, options = {}) => {
    const sourceSnapshot = findSnapshotById(sourceSnapshotId);
    const targetSnapshot = findSnapshotById(targetSnapshotId);
    if (!sourceSnapshot || !targetSnapshot) return;

    const sourceFound = findNoteInSnapshot(sourceSnapshot, noteKey);
    if (!sourceFound) return;
    const { note, length: sourceLength } = sourceFound;
    const sourceSnapshotNumber = snapshotIndexById.get(sourceSnapshot.id) ?? 1;
    const targetSnapshotNumber = snapshotIndexById.get(targetSnapshot.id) ?? 1;
    const start = Number.isFinite(Number(note?.start)) ? Number(note.start) : 0;
    const rawEnd = Number.isFinite(Number(note?.end)) ? Number(note.end) : sourceLength;
    const end = Math.max(start, rawEnd);
    const absoluteStart = normalizeSequenceNumber(sourceSnapshotNumber + start);
    const absoluteEnd = normalizeSequenceNumber(sourceSnapshotNumber + end);

    const targetLength = Number.isFinite(Number(targetSnapshot?.length)) ? Number(targetSnapshot.length) : 1;
    const baseMovedNote = {
      ...JSON.parse(JSON.stringify(note)),
      start: normalizeSequenceNumber(absoluteStart - targetSnapshotNumber),
      end: normalizeSequenceNumber(absoluteEnd - targetSnapshotNumber),
    };
    const movedNote = mutateNote(baseMovedNote, {
      sourceSnapshot,
      targetSnapshot,
      sourceSnapshotNumber,
      targetSnapshotNumber,
      absoluteStart,
      absoluteEnd,
      sourceLength,
      targetLength,
    });
    if (!movedNote) return;

    if (options.duplicate) {
      const duplicateBaseId = note.id ?? noteKey;
      movedNote.id = nextDuplicateNoteId(duplicateBaseId);
      applyNoteIntoSnapshot(targetSnapshot.id, (snapshot) => [...(snapshot.notes ?? []), movedNote]);
    } else if (sourceSnapshot.id === targetSnapshot.id) {
      applyNoteIntoSnapshot(sourceSnapshot.id, (snapshot, length) => (
        (snapshot.notes ?? []).map((entry) => (
          noteIdentity(entry, length) === noteKey ? movedNote : entry
        ))
      ));
    } else {
      applyNoteIntoSnapshot(sourceSnapshot.id, (snapshot, length) => (
        (snapshot.notes ?? []).filter((entry) => noteIdentity(entry, length) !== noteKey)
      ));
      applyNoteIntoSnapshot(targetSnapshot.id, (snapshot) => [...(snapshot.notes ?? []), movedNote]);
    }

    const nextSelectedSnapshot = targetSnapshot.id;
    const nextSelectedTime = options.selectKind === "release"
      ? movedNote.end
      : movedNote.start;
    onSelectSnapshot?.(nextSelectedSnapshot);
    onSelectMarker?.(nextSelectedSnapshot, nextSelectedTime);
    notifyEditCommitted();
  }, [
    applyNoteIntoSnapshot,
    findNoteInSnapshot,
    findSnapshotById,
    nextDuplicateNoteId,
    onSelectMarker,
    onSelectSnapshot,
    snapshotIndexById,
  ]);

  const deleteEventNote = useCallback((snapshotId, noteKey) => {
    const snapshot = findSnapshotById(snapshotId);
    if (!snapshot) return;
    const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
    const nextNotes = (snapshot.notes ?? []).filter((note) => noteIdentity(note, length) !== noteKey);
    onUpdateSnapshot(snapshot.id, { notes: sortSnapshotNotes(nextNotes, length) });
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
    if (!draft) return;
    const snapshotNumber = Math.max(1, Math.min(snapshots.length, Math.round(Number(draft.snapshotNumber) || 1)));
    const targetSnapshot = snapshots[snapshotNumber - 1];
    const nextOffset = Number(draft.offset);
    if (!targetSnapshot || !Number.isFinite(nextOffset)) return;
    const nextAbsoluteTime = normalizeSequenceNumber(snapshotNumber + nextOffset);

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

    setEventSequenceDrafts((prev) => {
      if (!(draft.draftKey in prev)) return prev;
      const next = { ...prev };
      delete next[draft.draftKey];
      return next;
    });
  }, [commitNoteTransfer, snapshots]);

  const eventBarRelativeDraftKey = (snapshotId, eventId, kind) => `${snapshotId}:${eventId}:${kind}`;

  const buildBarRelativeDraft = (barBeat, changedField = null, override = {}) => {
    const next = {
      barNumber: String(override.barNumber ?? barBeat?.barNumber ?? 1),
      beat: String(override.beat ?? barBeat?.beat ?? 1),
      numerator: String(override.numerator ?? barBeat?.numerator ?? 0),
      denominator: String(override.denominator ?? barBeat?.denominator ?? 1),
    };
    if (changedField === "bar") {
      next.beat = "1";
      next.numerator = "0";
    } else if (changedField === "beat") {
      next.numerator = "0";
    }
    return next;
  };

  const stoppedBarStateForBarNumber = useCallback((barNumber) => {
    const index = Math.max(0, Math.round(Number(barNumber) || 1) - 1);
    const bar = sortedBars[index] ?? null;
    const beatsPerBar = Math.max(0, Math.round(Number(bar?.numerator) || 0));
    return beatsPerBar === 0;
  }, [sortedBars]);

  const normalizeDraftForStoppedBar = useCallback((draft) => {
    if (!draft) return draft;
    if (!stoppedBarStateForBarNumber(draft.barNumber)) return draft;
    return {
      ...draft,
      beat: "0",
      numerator: "0",
      denominator: "1",
    };
  }, [stoppedBarStateForBarNumber]);

  const applyTempoBarRelativeDraft = useCallback((draft) => {
    if (!draft) return;
    const position = barBeatToAbsolutePosition({
      barNumber: Number(draft.barNumber),
      beat: Number(draft.beat),
      numerator: Number(draft.numerator),
      denominator: Number(draft.denominator),
    }, sortedBars);
    if (position == null) return;
    onUpdateTempo?.(draft.tempoId, { position });
    setTempoBarRelativeDrafts((prev) => {
      if (!(draft.draftKey in prev)) return prev;
      const next = { ...prev };
      delete next[draft.draftKey];
      return next;
    });
    notifyEditCommitted();
  }, [onUpdateTempo, sortedBars]);

  const applyEventBarRelativeDraft = useCallback((draft) => {
    if (!draft) return;
    const snapshot = snapshots.find((entry) => entry.id === draft.snapshotId);
    if (!snapshot) return;
    const absoluteTime = barBeatToAbsolutePosition({
      barNumber: Number(draft.barNumber),
      beat: Number(draft.beat),
      numerator: Number(draft.numerator),
      denominator: Number(draft.denominator),
    }, sortedBars);
    if (absoluteTime == null) return;
    const denominator = Math.max(1, Math.round(Number(draft.denominator) || 1));
    const notes = (snapshot.notes ?? []).map((note) => {
      const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
      if (noteIdentity(note, length) !== draft.noteKey) return note;
      const nextRelativeTime = Math.round((absoluteTime - (snapshotIndexById.get(snapshot.id) ?? 1)) * 1000000) / 1000000;
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
    onUpdateSnapshot(snapshot.id, { notes });
    setBarRelativeDrafts((prev) => {
      if (!(draft.draftKey in prev)) return prev;
      const next = { ...prev };
      delete next[draft.draftKey];
      return next;
    });
    notifyEditCommitted();
  }, [onUpdateSnapshot, snapshots, sortedBars, snapshotIndexById]);

  const updateEventBarRelativeDraftField = (draftKey, barBeat, field, value, meta) => {
    const draftField = field === "bar"
      ? "barNumber"
      : field === "num"
        ? "numerator"
        : field === "den"
          ? "denominator"
          : field;
    setBarRelativeDrafts((prev) => {
      const current = prev[draftKey] ?? buildBarRelativeDraft(barBeat);
      const nextDraft = {
        ...buildBarRelativeDraft(current, field, { [draftField]: value }),
        ...meta,
        draftKey,
        scope: `event:${draftKey}`,
      };
      return {
        ...prev,
        [draftKey]: normalizeDraftForStoppedBar(nextDraft),
      };
    });
  };

  const cancelEventBarRelativeDraft = (draftKey) => {
    setBarRelativeDrafts((prev) => {
      if (!(draftKey in prev)) return prev;
      const next = { ...prev };
      delete next[draftKey];
      return next;
    });
  };

  const tempoBarRelativeDraftKey = (tempoId) => String(tempoId);

  const updateTempoBarRelativeDraftField = (draftKey, barBeat, field, value, meta) => {
    const draftField = field === "bar"
      ? "barNumber"
      : field === "num"
        ? "numerator"
        : field === "den"
          ? "denominator"
          : field;
    setTempoBarRelativeDrafts((prev) => {
      const current = prev[draftKey] ?? buildBarRelativeDraft(barBeat);
      const nextDraft = {
        ...buildBarRelativeDraft(current, field, { [draftField]: value }),
        ...meta,
        draftKey,
        scope: `tempo:${draftKey}`,
      };
      return {
        ...prev,
        [draftKey]: normalizeDraftForStoppedBar(nextDraft),
      };
    });
  };

  const cancelTempoBarRelativeDraft = (draftKey) => {
    setTempoBarRelativeDrafts((prev) => {
      if (!(draftKey in prev)) return prev;
      const next = { ...prev };
      delete next[draftKey];
      return next;
    });
  };

  const commitTempoBarRelativeDraft = (tempoId, draftKey) => {
    const draft = tempoBarRelativeDrafts[draftKey];
    if (!draft) return;
    applyTempoBarRelativeDraft(draft);
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
      const targetScope = event.target instanceof Element
        ? event.target.closest("[data-event-sequence-draft-scope]")?.getAttribute("data-event-sequence-draft-scope")
        : null;

      Object.values(eventSequenceDrafts).forEach((draft) => {
        if (!draft || draft.scope === targetScope) return;
        applyEventSequenceDraft(draft);
      });
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
      const targetScope = event.target instanceof Element
        ? event.target.closest("[data-bar-relative-draft-scope]")?.getAttribute("data-bar-relative-draft-scope")
        : null;

      Object.values(barRelativeDrafts).forEach((draft) => {
        if (!draft || draft.scope === targetScope) return;
        applyEventBarRelativeDraft(draft);
      });

      Object.values(tempoBarRelativeDrafts).forEach((draft) => {
        if (!draft || draft.scope === targetScope) return;
        applyTempoBarRelativeDraft(draft);
      });
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("mousedown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("mousedown", handlePointerDown, true);
    };
  }, [barRelativeDrafts, tempoBarRelativeDrafts, applyEventBarRelativeDraft, applyTempoBarRelativeDraft]);

  const updateEventField = (snapshot, noteKey, field, rawValue) => {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) return;
    const pitchUnchanged = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0000005;

    const notes = (snapshot.notes ?? []).map((note) => {
      const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
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
        return midicents == null ? note : {
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

    onUpdateSnapshot(snapshot.id, { notes });
  };

  const restoreEventPitchLabel = (snapshot, noteKey) => {
    const notes = (snapshot.notes ?? []).map((note) => {
      const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
      if (noteIdentity(note, length) !== noteKey) return note;
      const originalMidicents = Number(note.originalMidicents);
      if (!Number.isFinite(originalMidicents)) return note;
      const {
        originalMidicents: _originalMidicents,
        originalDisplayLabel,
        displayLabelEdited: _displayLabelEdited,
        ...rest
      } = note;
      return {
        ...rest,
        midicents: originalMidicents,
        displayLabel: originalDisplayLabel ?? "",
      };
    });
    onUpdateSnapshot(snapshot.id, { notes });
  };

  const updateBarPosition = (barId, rawValue) => {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) return;
    onUpdateBar?.(barId, { position: Math.round(numeric * 1000000) / 1000000 });
  };

  const updateTempoPosition = (tempoId, rawValue) => {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) return;
    onUpdateTempo?.(tempoId, { position: Math.round(numeric * 1000000) / 1000000 });
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
    if (!Number.isFinite(numeric)) return;
    onAddBar?.(Math.round(numeric * 1000000) / 1000000);
    setNewBarPosition("1.000000");
  };

  const addTempoAtRequestedPosition = () => {
    const position = Number(newTempoPosition);
    const bpm = Number(newTempoBpm);
    if (!Number.isFinite(position) || !Number.isFinite(bpm) || bpm <= 0) return;
    onAddTempo?.(Math.round(position * 1000000) / 1000000, bpm);
    setNewTempoPosition("1.000000");
    setNewTempoBpm("60");
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

  const renderResponsiveHeading = (full, short = full) => (
    <>
      <span class="sequencer-events-grid__heading-label sequencer-events-grid__heading-label--full">{full}</span>
      <span class="sequencer-events-grid__heading-label sequencer-events-grid__heading-label--short">{short}</span>
    </>
  );

  const currentEventPane = eventPane === "expression" ? "expression" : "timing";

  const eventPaneToggleMeta = {
    timing: {
      next: "expression",
      label: "show expression controls",
      title: "Show expression controls",
    },
    expression: {
      next: "timing",
      label: "show bar-relative timing",
      title: "Show bar-relative timing",
    },
  };

  const renderPaneToggle = () => (
    <button
      type="button"
      class="sequencer-events-grid__pane-toggle"
      aria-label={eventPaneToggleMeta[currentEventPane].label}
      title={eventPaneToggleMeta[currentEventPane].title}
      onClick={() => setEventPane(eventPaneToggleMeta[currentEventPane].next)}
    >
      <span aria-hidden="true">
        →
      </span>
    </button>
  );

  const renderCueTransport = (cueIndex) => (
    <span class="sequencer-event__cue-actions">
      <button
        type="button"
        class="snapshot-play-btn sequencer-event__cue-play"
        title={`Play cue ${cueIndex}`}
        aria-label={`play cue ${cueIndex}`}
        onClick={(e) => {
          e.stopPropagation();
          runTransportAction(() => onPlayCue?.(cueIndex - 1));
        }}
      >
        <span className="snapshot-play-glyph snapshot-play-glyph--play" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="snapshot-play-btn snapshot-stop-btn sequencer-event__cue-stop"
        title="Stop cue playback"
        aria-label={`stop cue ${cueIndex}`}
        disabled={!playingSnapshotId}
        onClick={(e) => {
          e.stopPropagation();
          runTransportAction(() => onStopSnapshot?.());
        }}
      >
        <span class="snapshot-stop-glyph" aria-hidden="true">■</span>
      </button>
    </span>
  );

  const renderCueMarker = (snapshot, event, sequenceTime) => {
    if (event.cueDisplayLead) {
      return (
        <span class="sequencer-event__cue-marker" title={`Cue ${event.cueIndex} at ${sequenceTime}`}>
          <span class="sequencer-event__cue-number-wrap">
            <span class="sequencer-event__cue-number-group" aria-hidden="true">
              <span class="sequencer-event__cue-number">
                {event.cueIndex}
              </span>
            </span>
            <span class="sequencer-event__cue-dot" aria-hidden="true" />
          </span>
        </span>
      );
    }

    const isCourtesyStart =
      firstSnapshotEventIds.get(snapshot.id) === event.eventId &&
      snapshotStartCueIndexes.get(snapshot.id) === event.cueIndex;
    if (!isCourtesyStart) return null;

    return (
      <span
        class="sequencer-event__cue-marker sequencer-event__cue-marker--courtesy"
        title={`Cue ${event.cueIndex} continues here`}
      >
        <span class="sequencer-event__cue-number-wrap">
          <span class="sequencer-event__cue-number-group" aria-hidden="true">
            <span class="sequencer-event__cue-bracket">(</span>
            <span class="sequencer-event__cue-number">
              {event.cueIndex}
            </span>
            <span class="sequencer-event__cue-bracket">)</span>
          </span>
          <span class="sequencer-event__cue-dot" aria-hidden="true" />
        </span>
      </span>
    );
  };

  const renderBarRow = (bar) => {
    const barId = bar.barId ?? bar.id;
    const barNumber = barNumberById.get(barId) ?? 1;
    const barPosition = Number(bar.position ?? bar.absoluteTime);
    const sequenceTime = barPosition.toFixed(6);
    const isDraggable = true;
    const isAlwaysOnBar = barNumber === 1 && Math.abs(barPosition - 1) < 1e-9;
    const rowKey = `bar:${barId}:${sequenceTime}:${bar.numerator ?? 4}:${bar.denominator ?? 4}`;

    return (
      <div
        key={rowKey}
        class="sequencer-bar-row"
        onDragOver={(e) => {
          if (barDragIdRef.current == null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          if (barDragIdRef.current == null) return;
          e.preventDefault();
          onMoveBar?.(barDragIdRef.current, Number(bar.position));
          setDraggedBarId(null);
          barDragIdRef.current = null;
        }}
      >
        <div class="sequencer-bar-row__line" aria-hidden="true" />
        <div class="sequencer-row__delete-cell">
          {!isAlwaysOnBar ? (
            <button
              type="button"
              class="sequencer-gutter__delete"
              aria-label={`delete bar ${barNumber}`}
              title={`Delete bar ${barNumber}`}
              onClick={(e) => {
                e.stopPropagation();
                onDeleteBar?.(barId);
              }}
            >
              <span class="sequencer-gutter__delete-glyph" aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>
        <span
          class={`sequencer-bar-gutter${draggedBarId === (bar.barId ?? bar.id) ? " sequencer-bar-gutter--dragging" : ""}`}
          draggable={isDraggable}
          title={`Drag bar ${barNumber}`}
          onDragStart={(e) => {
            barDragIdRef.current = barId;
            setDraggedBarId(barId);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => {
            setDraggedBarId(null);
            barDragIdRef.current = null;
          }}
        >
          <span class="sequencer-bar-gutter__number">{barNumber}</span>
        </span>
        <div class="sequencer-event__cell sequencer-bar-row__position-cell">
          <input
            type="text"
            class="sequencer-event__input sequencer-event__position"
            defaultValue={sequenceTime}
            aria-label={`bar ${barNumber} position`}
            onFocus={(e) => {
              delete e.currentTarget.dataset.lastCommittedValue;
              e.currentTarget.select();
            }}
            onKeyDown={(e) => handleEnterCommit(e, (value) => updateBarPosition(barId, value))}
            onBlur={(e) => handleBlurCommit(e, (value) => updateBarPosition(barId, value))}
          />
        </div>
        <div class="sequencer-bar-row__signature-cell sequencer-grid-offset">
          <div class="sequencer-bar-row__time-signature" aria-label={`bar ${barNumber} time signature`}>
            <input
              type="number"
              step="1"
              min="0"
              class="sequencer-event__input sequencer-event__input--stepper sequencer-bar-row__signature-input"
              defaultValue={String(bar.numerator ?? 4)}
              aria-label={`bar ${barNumber} beats per bar`}
              onInput={(e) => updateBarTimeSignatureField(barId, "numerator", e.currentTarget.value)}
              onFocus={(e) => {
                delete e.currentTarget.dataset.lastCommittedValue;
                e.currentTarget.select();
              }}
              onKeyDown={(e) => handleEnterCommit(e, (value) => updateBarTimeSignatureField(barId, "numerator", value))}
              onBlur={(e) => handleBlurCommit(e, (value) => updateBarTimeSignatureField(barId, "numerator", value))}
            />
            <input
              type="number"
              step="1"
              min="1"
              class="sequencer-event__input sequencer-event__input--stepper sequencer-bar-row__signature-input"
              defaultValue={String(bar.denominator ?? 4)}
              aria-label={`bar ${barNumber} beat unit`}
              onInput={(e) => updateBarTimeSignatureField(barId, "denominator", e.currentTarget.value)}
              onFocus={(e) => {
                delete e.currentTarget.dataset.lastCommittedValue;
                e.currentTarget.select();
              }}
              onKeyDown={(e) => handleEnterCommit(e, (value) => updateBarTimeSignatureField(barId, "denominator", value))}
              onBlur={(e) => handleBlurCommit(e, (value) => updateBarTimeSignatureField(barId, "denominator", value))}
            />
          </div>
        </div>
        <div class="sequencer-bar-row__tail" aria-hidden="true" />
      </div>
    );
  };

  const renderTempoRow = (tempo) => {
    const tempoId = tempo.tempoId ?? tempo.id;
    const tempoPosition = Number(tempo.position ?? tempo.absoluteTime);
    const barBeat = absolutePositionToBarBeat(tempoPosition, sortedBars);
    const sequenceTime = tempoPosition.toFixed(6);
    const isAlwaysOnTempo = Math.abs(tempoPosition - 1) < 1e-9;
    const beatNumerator = String(tempo.beatNumerator ?? 1);
    const beatDenominator = String(tempo.beatDenominator ?? 4);
    const draftKey = tempoBarRelativeDraftKey(tempoId);
    const tempoBarRelativeDraft = tempoBarRelativeDrafts[draftKey] ?? null;
    const isTempoBarRelativeDraftActive = tempoBarRelativeDraft != null;
    const isTempoStoppedBar = stoppedBarStateForBarNumber(tempoBarRelativeDraft?.barNumber ?? barBeat?.barNumber ?? 1);
    const tempoBeatValue = isTempoStoppedBar ? "0" : (tempoBarRelativeDraft?.beat ?? String(barBeat?.beat ?? 1));
    const tempoNumValue = isTempoStoppedBar ? "0" : (tempoBarRelativeDraft?.numerator ?? String(barBeat?.numerator ?? 0));
    const tempoDenValue = isTempoStoppedBar ? "1" : (tempoBarRelativeDraft?.denominator ?? String(barBeat?.denominator ?? 1));

    return (
      <div
        key={`tempo:${tempoId}`}
        class={`sequencer-tempo-row${isTempoBarRelativeDraftActive ? " sequencer-tempo-row--bar-relative-draft" : ""}`}
        data-bar-relative-draft-scope={`tempo:${draftKey}`}
      >
        <div class="sequencer-tempo-row__line" aria-hidden="true" />
        <div class="sequencer-row__delete-cell">
          {!isAlwaysOnTempo ? (
            <button
              type="button"
              class="sequencer-gutter__delete"
              aria-label="delete tempo marker"
              title="Delete tempo marker"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteTempo?.(tempoId);
              }}
            >
              <span class="sequencer-gutter__delete-glyph" aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>
        <div class="sequencer-tempo-row__gutter-spacer" aria-hidden="true" />
        <div class="sequencer-tempo-row__summary sequencer-grid-offset">
          <input
            type="number"
            step="1"
            min="1"
            class="sequencer-event__input sequencer-event__input--stepper sequencer-tempo-row__summary-input sequencer-tempo-row__summary-input--fraction-num"
            defaultValue={beatNumerator}
            aria-label="tempo beat numerator"
            onFocus={(e) => {
              delete e.currentTarget.dataset.lastCommittedValue;
              e.currentTarget.select();
            }}
            onKeyDown={(e) => handleEnterCommit(e, () => {
              const row = e.currentTarget.closest(".sequencer-tempo-row");
              updateTempoBeatFraction(
                tempoId,
                readNumericInput(row, ".sequencer-tempo-row__summary-input--fraction-num", 1),
                readNumericInput(row, ".sequencer-tempo-row__summary-input--fraction-den", 4),
              );
            })}
            onBlur={(e) => handleBlurCommit(e, () => {
              const row = e.currentTarget.closest(".sequencer-tempo-row");
              updateTempoBeatFraction(
                tempoId,
                readNumericInput(row, ".sequencer-tempo-row__summary-input--fraction-num", 1),
                readNumericInput(row, ".sequencer-tempo-row__summary-input--fraction-den", 4),
              );
            })}
          />
          <span class="sequencer-tempo-row__summary-sep" aria-hidden="true">/</span>
          <input
            type="number"
            step="1"
            min="1"
            class="sequencer-event__input sequencer-event__input--stepper sequencer-tempo-row__summary-input sequencer-tempo-row__summary-input--fraction-den"
            defaultValue={beatDenominator}
            aria-label="tempo beat denominator"
            onFocus={(e) => {
              delete e.currentTarget.dataset.lastCommittedValue;
              e.currentTarget.select();
            }}
            onKeyDown={(e) => handleEnterCommit(e, () => {
              const row = e.currentTarget.closest(".sequencer-tempo-row");
              updateTempoBeatFraction(
                tempoId,
                readNumericInput(row, ".sequencer-tempo-row__summary-input--fraction-num", 1),
                readNumericInput(row, ".sequencer-tempo-row__summary-input--fraction-den", 4),
              );
            })}
            onBlur={(e) => handleBlurCommit(e, () => {
              const row = e.currentTarget.closest(".sequencer-tempo-row");
              updateTempoBeatFraction(
                tempoId,
                readNumericInput(row, ".sequencer-tempo-row__summary-input--fraction-num", 1),
                readNumericInput(row, ".sequencer-tempo-row__summary-input--fraction-den", 4),
              );
            })}
          />
          <span class="sequencer-tempo-row__summary-sep" aria-hidden="true">=</span>
          <input
            type="number"
            step="1"
            min="1"
            class="sequencer-event__input sequencer-event__input--stepper sequencer-tempo-row__summary-input sequencer-tempo-row__summary-input--bpm"
            defaultValue={String(tempo.bpm ?? 60)}
            aria-label="tempo bpm"
            onFocus={(e) => {
              delete e.currentTarget.dataset.lastCommittedValue;
              e.currentTarget.select();
            }}
            onKeyDown={(e) => handleEnterCommit(e, (value) => updateTempoBpm(tempoId, value))}
            onBlur={(e) => handleBlurCommit(e, (value) => updateTempoBpm(tempoId, value))}
          />
          <span class="sequencer-tempo-row__summary-unit">bpm</span>
        </div>
        <div class="sequencer-event__cell sequencer-bar-row__position-cell sequencer-tempo-row__position-cell">
          <input
            type="text"
            class="sequencer-event__input sequencer-event__position"
            defaultValue={sequenceTime}
            aria-label="tempo position"
            onFocus={(e) => {
              delete e.currentTarget.dataset.lastCommittedValue;
              e.currentTarget.select();
            }}
            onKeyDown={(e) => handleEnterCommit(e, (value) => updateTempoPosition(tempoId, value))}
            onBlur={(e) => handleBlurCommit(e, (value) => updateTempoPosition(tempoId, value))}
          />
        </div>
        <div class="sequencer-event__cell sequencer-tempo-row__time-cell sequencer-tempo-row__bar-cell sequencer-grid-offset">
          <input
            type="number"
            step="1"
            min="1"
            class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__bar${isTempoBarRelativeDraftActive ? " sequencer-event__input--draft" : ""}`}
            value={tempoBarRelativeDraft?.barNumber ?? String(barBeat?.barNumber ?? 1)}
            aria-label="tempo bar"
            onFocus={(e) => {
              delete e.currentTarget.dataset.lastCommittedValue;
              e.currentTarget.select();
            }}
            onInput={(e) => updateTempoBarRelativeDraftField(draftKey, barBeat, "bar", e.currentTarget.value, { tempoId })}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              commitTempoBarRelativeDraft(tempoId, draftKey);
            }}
          />
        </div>
        <div class="sequencer-event__cell sequencer-tempo-row__time-cell sequencer-tempo-row__beat-cell sequencer-grid-offset">
          <input
            type="number"
            step="1"
            min={isTempoStoppedBar ? "0" : "1"}
            class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__beat${isTempoBarRelativeDraftActive ? " sequencer-event__input--draft" : ""}`}
            value={tempoBeatValue}
            aria-label="tempo beat"
            disabled={isTempoStoppedBar}
            onFocus={(e) => {
              delete e.currentTarget.dataset.lastCommittedValue;
              e.currentTarget.select();
            }}
            onInput={(e) => updateTempoBarRelativeDraftField(draftKey, barBeat, "beat", e.currentTarget.value, { tempoId })}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              commitTempoBarRelativeDraft(tempoId, draftKey);
            }}
          />
        </div>
        <div class="sequencer-event__cell sequencer-tempo-row__time-cell sequencer-tempo-row__num-cell sequencer-grid-offset">
          <input
            type="number"
            step="1"
            min="0"
            class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__fraction-num${isTempoBarRelativeDraftActive ? " sequencer-event__input--draft" : ""}`}
            value={tempoNumValue}
            aria-label="tempo beat fraction numerator"
            disabled={isTempoStoppedBar}
            onFocus={(e) => {
              delete e.currentTarget.dataset.lastCommittedValue;
              e.currentTarget.select();
            }}
            onInput={(e) => updateTempoBarRelativeDraftField(draftKey, barBeat, "num", e.currentTarget.value, { tempoId })}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              commitTempoBarRelativeDraft(tempoId, draftKey);
            }}
          />
        </div>
        <div class="sequencer-event__cell sequencer-tempo-row__time-cell sequencer-tempo-row__den-cell sequencer-grid-offset">
          <input
            type="number"
            step="1"
            min="1"
            class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__fraction-den${isTempoBarRelativeDraftActive ? " sequencer-event__input--draft" : ""}`}
            value={tempoDenValue}
            aria-label="tempo beat fraction denominator"
            disabled={isTempoStoppedBar}
            onFocus={(e) => {
              delete e.currentTarget.dataset.lastCommittedValue;
              e.currentTarget.select();
            }}
            onInput={(e) => updateTempoBarRelativeDraftField(draftKey, barBeat, "den", e.currentTarget.value, { tempoId })}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              commitTempoBarRelativeDraft(tempoId, draftKey);
            }}
          />
        </div>
        <div class="sequencer-tempo-row__tail">
          {isTempoBarRelativeDraftActive ? (
            <span class="sequencer-event__draft-actions">
              <button
                type="button"
                class="sequencer-event__draft-btn"
                aria-label="commit tempo bar-relative timing"
                title="Commit timing edit"
                onClick={(e) => {
                  e.stopPropagation();
                  commitTempoBarRelativeDraft(tempoId, draftKey);
                }}
              >
                ✓
              </button>
              <button
                type="button"
                class="sequencer-event__draft-btn"
                aria-label="cancel tempo bar-relative timing"
                title="Cancel timing edit"
                onClick={(e) => {
                  e.stopPropagation();
                  cancelTempoBarRelativeDraft(draftKey);
                }}
              >
                ×
              </button>
            </span>
          ) : null}
        </div>
      </div>
    );
  };

  const renderEventRow = (snapshot, snapshotIndex, event, keySuffix = "row") => {
    const isMarkerSelected =
      selectedMarker?.snapshotId === snapshot.id &&
      selectedMarker?.time === event.relativeTime;
    const isCueActive = activeNavigationMode === "cue" && activeCueIndex === event.cueIndex;
    const isSnapshotActive = activeNavigationMode === "snapshot" && activeSnapshotId === snapshot.id;
    const isSoundingAttack = sequencePlaybackActive && event.kind === "attack" && (
      soundingAttackNoteKeys.has(event.noteKey) ||
      isCueActive ||
      isSnapshotActive
    );
    const sequenceTime = formatSequenceTime(
      snapshotIndexById.get(snapshot.id) ?? snapshotIndex + 1,
      event.relativeTime,
    );
    const eventSnapshotNumber = snapshotIndexById.get(snapshot.id) ?? snapshotIndex + 1;
    const barBeat = absolutePositionToBarBeat(event.absoluteTime, sortedBars, event.fractionDenominator, 9);
    const draftKey = eventBarRelativeDraftKey(snapshot.id, event.eventId, event.kind);
    const barRelativeDraft = barRelativeDrafts[draftKey] ?? null;
    const eventSequenceKey = eventSequenceDraftKey(snapshot.id, event.eventId, event.kind);
    const eventSequenceDraft = eventSequenceDrafts[eventSequenceKey] ?? null;
    const isEventSequenceDraftActive = eventSequenceDraft != null;
    const isBarRelativeDraftActive = eventPane === "timing" && barRelativeDraft != null;
    const isStoppedBar = stoppedBarStateForBarNumber(barRelativeDraft?.barNumber ?? barBeat?.barNumber ?? 1);
    const beatValue = isStoppedBar ? "0" : (barRelativeDraft?.beat ?? String(barBeat?.beat ?? 1));
    const numeratorValue = isStoppedBar ? "0" : (barRelativeDraft?.numerator ?? String(barBeat?.numerator ?? 0));
    const denominatorValue = isStoppedBar ? "1" : (barRelativeDraft?.denominator ?? String(barBeat?.denominator ?? 1));

    return (
      <div
        key={`${event.eventId}:${keySuffix}`}
        ref={(node) => {
          if (node) eventRowRefs.current.set(event.eventId, node);
          else eventRowRefs.current.delete(event.eventId);
        }}
        class={`sequencer-event-row sequencer-event-row--${event.kind}${isMarkerSelected ? " sequencer-group--selected" : ""}${isCueActive ? " sequencer-event-row--cue-active" : ""}${isSnapshotActive ? " sequencer-event-row--snapshot-active" : ""}${isBarRelativeDraftActive ? " sequencer-event-row--bar-relative-draft" : ""}${isEventSequenceDraftActive ? " sequencer-event-row--sequence-draft" : ""}${draggedEventId === event.eventId ? " sequencer-event-row--dragging" : ""}`}
        data-bar-relative-draft-scope={`event:${draftKey}`}
        data-event-sequence-draft-scope={`event-sequence:${eventSequenceKey}`}
        onClick={() => {
          onSelectMarker(snapshot.id, event.relativeTime);
        }}
        onDragOver={(e) => {
          if (barDragIdRef.current == null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          if (barDragIdRef.current == null) return;
          e.preventDefault();
          onMoveBar?.(barDragIdRef.current, event.absoluteTime);
          setDraggedBarId(null);
          barDragIdRef.current = null;
        }}
      >
        <div class="sequencer-event__delete-cell">
          <button
            type="button"
            class="sequencer-gutter__delete"
            aria-label={`delete snapshot ${snapshotIndex + 1} ${event.kind} event`}
            title={`Delete snapshot ${snapshotIndex + 1} ${event.kind} event`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              deleteEventNote(snapshot.id, event.noteKey);
            }}
          >
            <span class="sequencer-gutter__delete-glyph" aria-hidden="true">×</span>
          </button>
        </div>
        <div
          class="sequencer-event__cue-cell sequencer-event__cue-cell--draggable"
          draggable="true"
          aria-label={`drag snapshot ${snapshotIndex + 1} ${event.kind} event`}
          title="Drag to move this event; Option-drag to duplicate"
          onDragStart={(e) => {
            eventDragRef.current = {
              snapshotId: snapshot.id,
              noteKey: event.noteKey,
              kind: event.kind,
              eventId: event.eventId,
            };
            setDraggedEventId(event.eventId);
            e.dataTransfer.effectAllowed = "copyMove";
          }}
          onDragEnd={() => {
            eventDragRef.current = null;
            setDraggedEventId(null);
            setDragOverId(null);
          }}
        >
          {renderCueMarker(snapshot, event, sequenceTime)}
        </div>
        <div class="sequencer-event__cell">
          <input
            type="number"
            step="1"
            min="1"
            max={String(snapshots.length)}
            class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__snapshot-number${isEventSequenceDraftActive ? " sequencer-event__input--draft" : ""}`}
            value={eventSequenceDraft?.snapshotNumber ?? String(eventSnapshotNumber)}
            aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} snapshot`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => {
              e.stopPropagation();
              e.currentTarget.select();
            }}
            onInput={(e) => updateEventSequenceDraftField(eventSequenceKey, "snapshotNumber", e.currentTarget.value, {
              snapshotId: snapshot.id,
              noteKey: event.noteKey,
              kind: event.kind,
              snapshotNumber: eventSnapshotNumber,
              relativeTime: event.relativeTime,
            })}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              applyEventSequenceDraft(eventSequenceDrafts[eventSequenceKey]);
            }}
          />
        </div>
        <div class="sequencer-event__cell sequencer-grid-offset">
          <input
            key={`${event.eventId}-offset-${eventSequenceDraft?.offset ?? event.relativeTime}`}
            type="text"
            class={`sequencer-event__input sequencer-event__position${isOutOfSnapshotRange(snapshot, event.relativeTime) ? " sequencer-event__position--out-of-range" : ""}${isEventSequenceDraftActive ? " sequencer-event__input--draft" : ""}`}
            defaultValue={formatDisplaySequenceOffset(eventSequenceDraft?.offset ?? event.relativeTime)}
            aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} offset`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => {
              e.stopPropagation();
              e.currentTarget.value = formatSequenceOffset(eventSequenceDraft?.offset ?? event.relativeTime);
              e.currentTarget.select();
            }}
            onInput={(e) => updateEventSequenceDraftField(eventSequenceKey, "offset", e.currentTarget.value, {
              snapshotId: snapshot.id,
              noteKey: event.noteKey,
              kind: event.kind,
              snapshotNumber: eventSnapshotNumber,
              relativeTime: event.relativeTime,
            })}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              applyEventSequenceDraft(eventSequenceDrafts[eventSequenceKey]);
            }}
            onBlur={(e) => {
              const value = Number(e.currentTarget.value);
              e.currentTarget.value = formatDisplaySequenceOffset(
                Number.isFinite(value) ? value : (eventSequenceDraft?.offset ?? event.relativeTime),
              );
            }}
          />
        </div>
          <div
            class={`sequencer-event__cell sequencer-event__kind-cell sequencer-grid-offset${isSoundingAttack ? " sequencer-event__kind-cell--active" : ""}`}
          >
            <span
              class={`sequencer-event__content sequencer-event__kind${isSoundingAttack ? " sequencer-event__kind--active" : ""}`}
              style={soundingOnTextStyle(isSoundingAttack)}
            >
              {event.kind === "attack" ? "on" : "off"}
            </span>
          </div>
        <div class="sequencer-event__cell sequencer-grid-offset">
          <input
            key={`${event.eventId}-midicents-${event.midicents}`}
            type="text"
            class="sequencer-event__input"
            defaultValue={formatMidicents(event.midicents)}
            aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} midicents`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => {
              e.stopPropagation();
              delete e.currentTarget.dataset.lastCommittedValue;
              e.currentTarget.value = formatEditableMidicents(event.midicents);
              e.currentTarget.select();
            }}
            onKeyDown={(e) => handleEnterCommit(
              e,
              (value) => updateEventField(snapshot, event.noteKey, "midicents", value),
            )}
            onBlur={(e) => handleBlurCommit(
              e,
              (value) => updateEventField(snapshot, event.noteKey, "midicents", value),
              () => {
                const next = Number(e.currentTarget.value);
                e.currentTarget.value = Number.isFinite(next)
                  ? formatMidicents(next)
                  : formatMidicents(event.midicents);
              },
            )}
          />
        </div>
        <div class="sequencer-event__cell sequencer-grid-offset">
          <input
            key={`${event.eventId}-frequency-${event.frequency}`}
            type="text"
            class="sequencer-event__input"
            defaultValue={formatFrequency(event.frequency)}
            aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} frequency`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => {
              e.stopPropagation();
              delete e.currentTarget.dataset.lastCommittedValue;
              e.currentTarget.value = formatEditableFrequency(event.frequency);
              e.currentTarget.select();
            }}
            onKeyDown={(e) => handleEnterCommit(
              e,
              (value) => updateEventField(snapshot, event.noteKey, "frequency", value),
            )}
            onBlur={(e) => handleBlurCommit(
              e,
              (value) => updateEventField(snapshot, event.noteKey, "frequency", value),
              () => {
                const next = Number(e.currentTarget.value);
                e.currentTarget.value = Number.isFinite(next)
                  ? formatFrequency(next)
                  : formatFrequency(event.frequency);
              },
            )}
          />
        </div>
        <div class="sequencer-event__cell sequencer-grid-offset">
          <span class="sequencer-event__content sequencer-event__heji-wrap">
            <span class={`sequencer-event__heji${event.displayLabelEdited ? " sequencer-event__heji--edited" : ""}`}>
              {event.displayLabel || ""}
            </span>
            {event.canRestoreDisplayLabel ? (
              <button
                type="button"
                class="sequencer-event__restore-btn"
                aria-label={`restore snapshot ${snapshotIndex + 1} ${event.kind} captured pitch and name`}
                title="Restore captured pitch and name"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  restoreEventPitchLabel(snapshot, event.noteKey);
                }}
              >
                <span class="preset-refresh-glyph" aria-hidden="true">⟳</span>
              </button>
            ) : null}
          </span>
        </div>
        {currentEventPane === "timing" ? (
          <>
            <div key={`${event.eventId}-timing-bar`} class="sequencer-event__cell sequencer-grid-offset">
              <input
                type="number"
                step="1"
                min="1"
                class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__bar${isBarRelativeDraftActive ? " sequencer-event__input--draft" : ""}`}
                value={barRelativeDraft?.barNumber ?? String(barBeat?.barNumber ?? 1)}
                aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} bar`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => {
                  e.stopPropagation();
                  e.currentTarget.select();
                }}
                onInput={(e) => updateEventBarRelativeDraftField(draftKey, barBeat, "bar", e.currentTarget.value, {
                  snapshotId: snapshot.id,
                  noteKey: event.noteKey,
                  kind: event.kind,
                })}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  commitEventBarRelativeDraft(snapshot, event.noteKey, event.kind, draftKey);
                }}
              />
            </div>
            <div key={`${event.eventId}-timing-beat`} class="sequencer-event__cell sequencer-grid-offset">
              <input
                type="number"
                step="1"
                min={isStoppedBar ? "0" : "1"}
                class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__beat${isBarRelativeDraftActive ? " sequencer-event__input--draft" : ""}`}
                value={beatValue}
                aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} beat`}
                disabled={isStoppedBar}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => {
                  e.stopPropagation();
                  e.currentTarget.select();
                }}
                onInput={(e) => updateEventBarRelativeDraftField(draftKey, barBeat, "beat", e.currentTarget.value, {
                  snapshotId: snapshot.id,
                  noteKey: event.noteKey,
                  kind: event.kind,
                })}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  commitEventBarRelativeDraft(snapshot, event.noteKey, event.kind, draftKey);
                }}
              />
            </div>
            <div key={`${event.eventId}-timing-num`} class="sequencer-event__cell sequencer-grid-offset">
              <input
                type="number"
                step="1"
                min="0"
                class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__fraction-num${isBarRelativeDraftActive ? " sequencer-event__input--draft" : ""}`}
                value={numeratorValue}
                aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} beat fraction numerator`}
                disabled={isStoppedBar}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => {
                  e.stopPropagation();
                  e.currentTarget.select();
                }}
                onInput={(e) => updateEventBarRelativeDraftField(draftKey, barBeat, "numerator", e.currentTarget.value, {
                  snapshotId: snapshot.id,
                  noteKey: event.noteKey,
                  kind: event.kind,
                })}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  commitEventBarRelativeDraft(snapshot, event.noteKey, event.kind, draftKey);
                }}
              />
            </div>
            <div key={`${event.eventId}-timing-den`} class="sequencer-event__cell sequencer-grid-offset">
              <input
                type="number"
                step="1"
                min="1"
                class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__fraction-den${isBarRelativeDraftActive ? " sequencer-event__input--draft" : ""}`}
                value={denominatorValue}
                aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} beat fraction denominator`}
                disabled={isStoppedBar}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => {
                  e.stopPropagation();
                  e.currentTarget.select();
                }}
                onInput={(e) => updateEventBarRelativeDraftField(draftKey, barBeat, "denominator", e.currentTarget.value, {
                  snapshotId: snapshot.id,
                  noteKey: event.noteKey,
                  kind: event.kind,
                })}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  commitEventBarRelativeDraft(snapshot, event.noteKey, event.kind, draftKey);
                }}
              />
            </div>
          </>
        ) : (
          <>
            <div key={`${event.eventId}-expression-onvel`} class="sequencer-event__cell sequencer-grid-offset">
              <input
                type="text"
                class="sequencer-event__input"
                defaultValue={displayValue(event.attackVelocity)}
                aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} on velocity`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => {
                  e.stopPropagation();
                  delete e.currentTarget.dataset.lastCommittedValue;
                  e.currentTarget.select();
                }}
                onKeyDown={(e) => handleEnterCommit(
                  e,
                  (value) => updateEventField(snapshot, event.noteKey, "attackVelocity", value),
                )}
                onBlur={(e) => handleBlurCommit(
                  e,
                  (value) => updateEventField(snapshot, event.noteKey, "attackVelocity", value),
                )}
              />
            </div>
            <div key={`${event.eventId}-expression-offvel`} class="sequencer-event__cell sequencer-grid-offset">
              <input
                type="text"
                class="sequencer-event__input"
                defaultValue={displayValue(event.releaseVelocity)}
                aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} off velocity`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => {
                  e.stopPropagation();
                  delete e.currentTarget.dataset.lastCommittedValue;
                  e.currentTarget.select();
                }}
                onKeyDown={(e) => handleEnterCommit(
                  e,
                  (value) => updateEventField(snapshot, event.noteKey, "releaseVelocity", value),
                )}
                onBlur={(e) => handleBlurCommit(
                  e,
                  (value) => updateEventField(snapshot, event.noteKey, "releaseVelocity", value),
                )}
              />
            </div>
            <div key={`${event.eventId}-expression-pressure`} class="sequencer-event__cell sequencer-grid-offset">
              <input
                type="text"
                class="sequencer-event__input"
                defaultValue={displayValue(event.pressure)}
                aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} pressure`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => {
                  e.stopPropagation();
                  delete e.currentTarget.dataset.lastCommittedValue;
                  e.currentTarget.select();
                }}
                onKeyDown={(e) => handleEnterCommit(
                  e,
                  (value) => updateEventField(snapshot, event.noteKey, "pressure", value),
                )}
                onBlur={(e) => handleBlurCommit(
                  e,
                  (value) => updateEventField(snapshot, event.noteKey, "pressure", value),
                )}
              />
            </div>
            <div key={`${event.eventId}-expression-timbre`} class="sequencer-event__cell sequencer-grid-offset">
              <input
                type="text"
                class="sequencer-event__input"
                defaultValue={displayValue(event.timbre)}
                aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} timbre`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => {
                  e.stopPropagation();
                  delete e.currentTarget.dataset.lastCommittedValue;
                  e.currentTarget.select();
                }}
                onKeyDown={(e) => handleEnterCommit(
                  e,
                  (value) => updateEventField(snapshot, event.noteKey, "timbre", value),
                )}
                onBlur={(e) => handleBlurCommit(
                  e,
                  (value) => updateEventField(snapshot, event.noteKey, "timbre", value),
                )}
              />
            </div>
          </>
        )}
        <div class="sequencer-event__actions-cell">
          {isEventSequenceDraftActive ? (
            <span class="sequencer-event__draft-actions">
              <button
                type="button"
                class="sequencer-event__draft-btn"
                aria-label={`commit snapshot ${snapshotIndex + 1} ${event.kind} sequence placement`}
                title="Commit snapshot and offset edit"
                onClick={(e) => {
                  e.stopPropagation();
                  applyEventSequenceDraft(eventSequenceDrafts[eventSequenceKey]);
                }}
              >
                ✓
              </button>
              <button
                type="button"
                class="sequencer-event__draft-btn"
                aria-label={`cancel snapshot ${snapshotIndex + 1} ${event.kind} sequence placement`}
                title="Cancel snapshot and offset edit"
                onClick={(e) => {
                  e.stopPropagation();
                  cancelEventSequenceDraft(eventSequenceKey);
                }}
              >
                ×
              </button>
            </span>
          ) : isBarRelativeDraftActive ? (
            <span class="sequencer-event__draft-actions">
              <button
                type="button"
                class="sequencer-event__draft-btn"
                aria-label={`commit snapshot ${snapshotIndex + 1} ${event.kind} bar-relative timing`}
                title="Commit timing edit"
                onClick={(e) => {
                  e.stopPropagation();
                  commitEventBarRelativeDraft(snapshot, event.noteKey, event.kind, draftKey);
                }}
              >
                ✓
              </button>
              <button
                type="button"
                class="sequencer-event__draft-btn"
                aria-label={`cancel snapshot ${snapshotIndex + 1} ${event.kind} bar-relative timing`}
                title="Cancel timing edit"
                onClick={(e) => {
                  e.stopPropagation();
                  cancelEventBarRelativeDraft(draftKey);
                }}
              >
                ×
              </button>
            </span>
          ) : ((event.cueDisplayLead || (
            firstSnapshotEventIds.get(snapshot.id) === event.eventId &&
            snapshotStartCueIndexes.get(snapshot.id) === event.cueIndex
          )) ? renderCueTransport(event.cueIndex) : null)}
        </div>
      </div>
    );
  };

  return (
    <div role="group" aria-label="Sequencer workspace">
      <SequenceLibrary
        snapshots={snapshots}
        bars={bars}
        tempi={tempi}
        snapshotLabelMode={snapshotLabelMode}
        autoCreateBars={sequenceAutoCreateBars}
        activeSequenceName={activeSequenceName ?? ""}
        activeSequenceSavedName={activeSequenceSavedName ?? ""}
        activeSequenceDescription={activeSequenceDescription ?? ""}
        onLoadSequence={onLoadSequence}
        onClearSequence={onClearSequence}
        onSequenceSaved={onSequenceSaved}
      />

      <SequenceInfo
        name={activeSequenceName ?? ""}
        description={activeSequenceDescription ?? ""}
        onNameChange={onSequenceNameChange}
        onDescriptionChange={onSequenceDescriptionChange}
      />

      <fieldset class="sequencer-capture-fieldset">
        <legend>
          <b>Snapshot</b>
        </legend>
        <p>
          <em>
            ENTER stores currently sounding notes, including attack and release velocity, pressure, 
            and timbre data if available. May be layered with notes from a previous snapshot 
            to build up chords in stages. The Sequence panel, below, allows snapshots to be 
            played, ordered, and edited. Use the OPTION key while dragging to duplicate a snapshot.
          </em>
        </p>
        <div class="preset-actions preset-actions--library">
          <button type="button" class="preset-action-btn" onClick={onTakeSnapshot}>
            Capture
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
          <b>Sequence</b>
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

        {showAllEvents ? (
          <>
            <label class="sequencer-option-row">
              <span>Snapshot Labels</span>
              <select
                class="sidebar-input"
                value={snapshotLabelMode}
                onChange={(e) => onSetSnapshotLabelMode(e.currentTarget.value)}
              >
                {SNAPSHOT_LABEL_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>

            <div class="sequencer-option-row">
              <span>Choose Tempo Position</span>
              <span class="sequencer-bars-add">
                <input
                  type="text"
                  class={`sidebar-input sequencer-bars-add__position${newTempoPosition === "1.000000" ? " sequencer-bars-add__position--hint" : ""}`}
                  aria-label="new tempo position"
                  value={newTempoPosition}
                  onInput={(e) => setNewTempoPosition(e.currentTarget.value)}
                />
                <input
                  type="text"
                  class="sidebar-input sequencer-bars-add__position"
                  aria-label="new tempo bpm"
                  value={newTempoBpm}
                  onInput={(e) => setNewTempoBpm(e.currentTarget.value)}
                />
                <button type="button" class="preset-action-btn" onClick={addTempoAtRequestedPosition}>
                  Add Tempo
                </button>
              </span>
            </div>

            <div class="sequencer-option-row">
              <span>Choose Bar Position</span>
              <span class="sequencer-bars-add">
                <input
                  type="text"
                  class={`sidebar-input sequencer-bars-add__position${newBarPosition === "1.000000" ? " sequencer-bars-add__position--hint" : ""}`}
                  aria-label="new bar position"
                  value={newBarPosition}
                  onInput={(e) => setNewBarPosition(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    addBarAtRequestedPosition();
                  }}
                />
                <button type="button" class="preset-action-btn" onClick={addBarAtRequestedPosition}>
                  Add Bar
                </button>
              </span>
            </div>

            <label class="sequencer-option-row">
              <span>Auto-Create Bars</span>
              <span class="sequencer-option-row__controls">
                <input
                  type="checkbox"
                  checked={sequenceAutoCreateBars}
                  onChange={(e) => onSequenceAutoCreateBarsChange?.(e.currentTarget.checked)}
                />
                <button type="button" class="preset-action-btn" onClick={() => onAddBarsBeforeSnapshots?.()}>
                  Add Bars Before Snapshots
                </button>
              </span>
            </label>
          </>
        ) : null}

        {showAllEvents ? (
          <>
            <label class="sequencer-option-row">
              <span>Legato</span>
              <input
                type="checkbox"
                checked={sequenceLegato}
                onChange={(e) => onSequenceLegatoChange?.(e.currentTarget.checked)}
              />
            </label>

            <div class="preset-actions preset-actions--library">
              {snapshots.length > 0 || (bars?.length ?? 0) > 1 || (tempi?.length ?? 0) > 1 ? (
                <span class="preset-actions__clear-slot">
                  {confirmClearSequence ? (
                    <span class="preset-actions__confirm">
                      <em class="preset-actions__confirm-text">Clear sequence?</em>
                      <button
                        type="button"
                        class="delete-btn preset-utility-btn settings-form__inline-button--nowrap"
                        onClick={() => {
                          onClearSequence?.();
                          setConfirmClearSequence(false);
                        }}
                      >
                        Yes, clear
                      </button>
                      <button
                        type="button"
                        class="preset-utility-btn settings-form__inline-button--nowrap"
                        onClick={() => setConfirmClearSequence(false)}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      class="delete-btn preset-utility-btn preset-actions__clear-trigger settings-form__inline-button--nowrap sequencer-clear-sequence-btn"
                      onClick={() => setConfirmClearSequence(true)}
                    >
                      Clear Sequence
                    </button>
                  )}
                </span>
              ) : null}
            </div>
          </>
        ) : null}

        <div ref={playbackRowRef} class="sequencer-playback-row" aria-label="Sequence playback">
          <span class="sequencer-playback-label">PLAY FROM</span>

          <span class="sequencer-playback-control">
            <span class="sequencer-playback-key">BAR</span>
            <select
              class="sidebar-input sequencer-playback-select"
              value={playhead?.barIndex ?? 0}
              onChange={(e) => {
                transportScrollTargetRef.current = "bar";
                onSelectSequenceBar?.(Number(e.currentTarget.value));
              }}
            >
              {sortedBars.map((bar, index) => (
                <option key={bar.id ?? index} value={index}>
                  {index + 1}
                </option>
              ))}
            </select>
          </span>

          <span class="sequencer-playback-control">
            <span class="sequencer-playback-key">SNAPSHOT</span>
            <button
              type="button"
              class="sequencer-arrow-btn sequencer-arrow-btn--snapshot"
              aria-label="previous sequence step"
              title="Previous step"
              disabled={snapshots.length === 0 || (playheadIsOff ? prevSnapshotIndexFromBar < 0 : false)}
              onClick={() => {
                runTransportAction(() => onStepSequence?.(-1));
              }}
            >
              <span class="sequencer-arrow-glyph sequencer-arrow-glyph--left" aria-hidden="true" />
            </button>
            <select
              class="sidebar-input sequencer-playback-select sequencer-playback-select--pending"
              aria-label="next snapshot target"
              value={snapshotSelectValue}
              onChange={(e) => {
                const { value } = e.currentTarget;
                if (value === "") {
                  setPendingSnapshotJumpIndex("");
                  setPendingCueJumpIndex("");
                  return;
                }
                armPendingSnapshot(value);
              }}
            >
              {snapshots.map((snapshot, index) => (
                <option
                  key={snapshot.id ?? index}
                  value={String(index)}
                >
                  {impliedPendingSnapshotIndex === String(index) ? `(${index + 1})` : String(index + 1)}
                </option>
              ))}
            </select>
            <button
              type="button"
              class="sequencer-arrow-btn sequencer-arrow-btn--snapshot"
              aria-label="next sequence step"
              title="Next step"
              disabled={snapshots.length === 0 || (playheadIsOff
                ? nextSnapshotIndexFromBar < 0 || nextSnapshotIndexFromBar >= snapshots.length
                : false)}
              onClick={() => {
                if (pendingSnapshotJumpIndex !== "") {
                  const targetIndex = Number(pendingSnapshotJumpIndex);
                  setPendingSnapshotJumpIndex("");
                  setPendingCueJumpIndex("");
                  runTransportAction(() => onJumpSequenceSnapshot?.(targetIndex));
                  return;
                }
                if (playheadIsEnd) {
                  runTransportAction(() => onJumpSequenceSnapshot?.(0));
                  return;
                }
                runTransportAction(() => onStepSequence?.(1));
              }}
            >
              <span class="sequencer-arrow-glyph sequencer-arrow-glyph--right" aria-hidden="true" />
            </button>
          </span>

          <span class="sequencer-playback-control">
            <span class="sequencer-playback-key">CUE</span>
            <button
              type="button"
              class="sequencer-arrow-btn sequencer-arrow-btn--snapshot"
              aria-label="previous sequence marker"
              title="Previous marker"
              disabled={snapshots.length === 0 || (playheadIsOff ? prevCueIndexFromBar < 0 : false)}
              onClick={() => {
                runTransportAction(() => onStepSequenceMarker?.(-1));
              }}
            >
              <span class="sequencer-arrow-glyph sequencer-arrow-glyph--left" aria-hidden="true" />
            </button>
            <select
              class="sidebar-input sequencer-playback-select sequencer-playback-select--pending"
              aria-label="next cue target"
              value={cueSelectValue}
              onChange={(e) => {
                const { value } = e.currentTarget;
                if (value === "") {
                  setPendingCueJumpIndex("");
                  setPendingSnapshotJumpIndex("");
                  return;
                }
                armPendingCue(value);
              }}
            >
              {sequenceCueGroups.map((group, index) => (
                <option
                  key={`${group.snapshotIndex}:${group.time}:${index}`}
                  value={String(index)}
                >
                  {impliedPendingCueIndex === String(index) ? `(${index + 1})` : String(index + 1)}
                </option>
              ))}
            </select>
            <button
              type="button"
              class="sequencer-arrow-btn sequencer-arrow-btn--snapshot"
              aria-label="next sequence marker"
              title="Next marker"
              disabled={snapshots.length === 0 || (playheadIsOff
                ? nextCueIndexFromBar < 0
                : false)}
              onClick={() => {
                if (pendingCueJumpIndex !== "") {
                  const targetIndex = Number(pendingCueJumpIndex);
                  setPendingCueJumpIndex("");
                  setPendingSnapshotJumpIndex("");
                  runTransportAction(() => onJumpSequenceCue?.(targetIndex));
                  return;
                }
                if (playheadIsEnd) {
                  runTransportAction(() => onJumpSequenceCue?.(0));
                  return;
                }
                runTransportAction(() => onStepSequenceMarker?.(1));
              }}
            >
              <span class="sequencer-arrow-glyph sequencer-arrow-glyph--right" aria-hidden="true" />
            </button>
          </span>

          <span class="sequencer-playback-actions">
            <button
              type="button"
              class="snapshot-play-btn snapshot-play-btn--plain sequencer-transport-trigger-btn"
              title="Move playhead to start"
              aria-label="move sequence playhead to start"
              disabled={snapshots.length === 0 && playheadIsOff}
              onClick={() => {
                runTransportAction(() => onResetSequencePlayhead?.());
              }}
            >
              <svg
                class="snapshot-start-icon"
                viewBox="0 0 10 10"
                aria-hidden="true"
                focusable="false"
              >
                <rect x="1" y="1" width="1.4" height="8" rx="0.2" />
                <path d="M8.6 1.5 3.1 5l5.5 3.5Z" />
              </svg>
            </button>
            <button
              type="button"
              class="snapshot-play-btn"
              title="Play current sequence position"
              aria-label="play current sequence position"
              disabled={snapshots.length === 0}
              onClick={() => {
                runTransportAction(() => onPlaySequence?.());
              }}
            >
              <span className="snapshot-play-glyph snapshot-play-glyph--play" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="snapshot-play-btn snapshot-stop-btn"
              title="Stop sequence playback"
              aria-label="stop sequence playback"
              disabled={!playingSnapshotId}
              onClick={() => {
                runTransportAction(() => onStopSnapshot?.());
              }}
            >
              <span class="snapshot-stop-glyph" aria-hidden="true">
                ■
              </span>
            </button>
          </span>
        </div>

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
                    if (marker.structuralType !== "bar") return;
                    if (node) barRowRefs.current.set(marker.id, node);
                    else barRowRefs.current.delete(marker.id);
                  }}
                  class="sequencer-item sequencer-item--bar"
                >
                  {marker.structuralType === "bar" ? renderBarRow(marker) : renderTempoRow(marker)}
                </div>
              ))}
              {snapshots.map((snapshot, index) => {
              const isPlaying = snapshot.id === playingSnapshotId;
              const isSelected = snapshot.id === selectedSnapshotId;
              const isExpanded = showAllEvents || expandedIds.has(snapshot.id);
              const isDragOver = dragOverId === snapshot.id;
              const snapshotEvents = snapshotEventsById.get(snapshot.id) ?? [];
              const snapshotStructuralKeys = new Set(
                snapshotEvents
                  .filter((event) => event.type === "bar" || event.type === "tempo")
                  .map((event) => structuralEventRenderKey(event)),
              );

              return (
                <Fragment key={snapshot.id}>
                  <div
                    ref={(node) => {
                      if (node) snapshotRowRefs.current.set(snapshot.id, node);
                      else snapshotRowRefs.current.delete(snapshot.id);
                    }}
                    class={`sequencer-item${isSelected ? " sequencer-item--selected" : ""}${isDragOver ? " sequencer-item--drop-target" : ""}${isDragOver && dragOverSide === "before" ? " sequencer-item--drop-target-before" : ""}${isDragOver && dragOverSide === "after" ? " sequencer-item--drop-target-after" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = e.altKey ? "copy" : "move";
                      if (eventDragRef.current != null) {
                        setDragOverId(snapshot.id);
                        return;
                      }
                      if (barDragIdRef.current != null) return;
                      setDragOverId(snapshot.id);
                      setDragOverSide(resolveDropSide(e));
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      if (eventDragRef.current != null) {
                        setDragOverId(snapshot.id);
                        return;
                      }
                      if (barDragIdRef.current != null) return;
                      setDragOverId(snapshot.id);
                      setDragOverSide(resolveDropSide(e));
                    }}
                    onDragLeave={() => {
                      if (barDragIdRef.current != null) return;
                      setDragOverId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (eventDragRef.current != null) {
                        const draggedEvent = eventDragRef.current;
                        if (e.altKey) duplicateEventNoteToSnapshot(
                          draggedEvent.snapshotId,
                          draggedEvent.noteKey,
                          snapshot.id,
                          draggedEvent.kind,
                        );
                        else moveEventNoteToSnapshot(
                          draggedEvent.snapshotId,
                          draggedEvent.noteKey,
                          snapshot.id,
                          draggedEvent.kind,
                        );
                        setDragOverId(null);
                        setDraggedEventId(null);
                        eventDragRef.current = null;
                        return;
                      }
                      if (barDragIdRef.current != null) {
                        onMoveBar?.(barDragIdRef.current, index + 1);
                        setDraggedBarId(null);
                        barDragIdRef.current = null;
                        return;
                      }
                      setDragOverId(null);
                      setDraggedId(null);
                      const side = resolveDropSide(e);
                      if (dragIdRef.current !== null && dragIdRef.current !== snapshot.id) {
                        if (e.altKey) onDuplicateSnapshot?.(dragIdRef.current, snapshot.id, side);
                        else onMoveSnapshot(dragIdRef.current, snapshot.id, side);
                      }
                      dragIdRef.current = null;
                    }}
                    onDragEnd={() => {
                      setDragOverId(null);
                      setDraggedId(null);
                      setDraggedEventId(null);
                      dragIdRef.current = null;
                      eventDragRef.current = null;
                    }}
                  >
                    <div
                      class={`sequencer-row${isSelected ? " sequencer-row--selected" : ""}`}
                      onClick={() => {
                        onSelectSnapshot(snapshot.id);
                        if (!showAllEvents) toggleExpanded(snapshot.id);
                      }}
                    >
                      <span class="sequencer-row__delete-cell">
                        {isSelected && (
                          <button
                            type="button"
                            class="sequencer-gutter__delete"
                            aria-label={`delete snapshot ${index + 1}`}
                            title={`Delete snapshot ${index + 1}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteSnapshot(snapshot.id);
                            }}
                          >
                            <span class="sequencer-gutter__delete-glyph" aria-hidden="true">
                              ×
                            </span>
                          </button>
                        )}
                      </span>
                      <span
                        class={`sequencer-gutter${isSelected ? " sequencer-gutter--selected" : ""}${draggedId === snapshot.id ? " sequencer-gutter--dragging" : ""}`}
                        draggable="true"
                        title="Drag to reorder this chord"
                        onDragStart={(e) => {
                          dragIdRef.current = snapshot.id;
                          setDraggedId(snapshot.id);
                          e.dataTransfer.effectAllowed = "copyMove";
                        }}
                        onDragEnd={() => {
                          setDragOverId(null);
                          setDraggedId(null);
                          dragIdRef.current = null;
                        }}
                      >
                        <span class="sequencer-gutter__number">{index + 1}</span>
                      </span>
                      <span class="sequencer-row__count sequencer-cell">
                        {snapshot.notes.length} note{snapshot.notes.length !== 1 ? "s" : ""}
                      </span>
                      <input
                        type="text"
                        class="sequencer-row__description sequencer-cell"
                        value={snapshot.description ?? ""}
                        aria-label={`snapshot ${index + 1} description`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectSnapshot(snapshot.id);
                          ensureExpanded(snapshot.id);
                        }}
                        onInput={(e) =>
                          onUpdateSnapshot(snapshot.id, { description: e.currentTarget.value })
                        }
                      />
                      <button
                        type="button"
                        class="sequencer-row__reset preset-refresh-btn"
                        aria-label={`reset snapshot ${index + 1} description`}
                        title="Reset description to current auto-generated label"
                        onClick={(e) => {
                          e.stopPropagation();
                          onResetSnapshotDescription(snapshot.id);
                        }}
                      >
                        <span class="refresh-glyph preset-refresh-glyph" aria-hidden="true">
                          ⟳
                        </span>
                      </button>
                      <span class="sequencer-row__actions">
                        <button
                          type="button"
                          class="snapshot-play-btn"
                          title="Play snapshot"
                          aria-label={`play snapshot ${index + 1}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onPlaySnapshot(snapshot.id);
                          }}
                        >
                          <span
                            className="snapshot-play-glyph snapshot-play-glyph--play"
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          type="button"
                          class="snapshot-play-btn snapshot-stop-btn"
                          title="Stop snapshot"
                          aria-label={`stop snapshot ${index + 1}`}
                          disabled={!isPlaying}
                          onClick={(e) => {
                            e.stopPropagation();
                            onStopSnapshot?.(snapshot.id);
                          }}
                        >
                          <span class="snapshot-stop-glyph" aria-hidden="true">
                            ■
                          </span>
                        </button>
                      </span>
                    </div>

                    {isExpanded && (
                      <div class="sequencer-item__groups">
                        <div
                          class={`sequencer-events-grid sequencer-events-grid--pane-${eventPane}`}
                          role="table"
                          aria-label={`snapshot ${index + 1} events`}
                        >
                          <div class="sequencer-events-grid__header" role="row">
                            <div class="sequencer-events-grid__heading sequencer-events-grid__heading--delete" />
                            <div class="sequencer-events-grid__heading sequencer-events-grid__heading--cue" />
                            <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--snapshot">
                              <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("Snap", "Snap")}</span>
                            </div>
                            <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset-position">
                              <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("Offset", "Offs")}</span>
                            </div>
                            <div class="sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--kind-spacer" />
                            <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--midicents">
                              <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("MIDI¢", "MIDI¢")}</span>
                            </div>
                            <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--hz">
                              <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("Hz", "Hz")}</span>
                            </div>
                            <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--heji">
                              <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("Name", "Name")}</span>
                            </div>
                            {eventPane === "timing" ? (
                              <>
                                <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--bar">
                                  <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("Bar", "Bar")}</span>
                                </div>
                                <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--beat">
                                  <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("Beat", "Beat")}</span>
                                </div>
                                <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--num">
                                  <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("Num", "Num")}</span>
                                </div>
                                <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--den">
                                  <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("Den", "Den")}</span>
                                </div>
                              </>
                            ) : (
                              <>
                                <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset">
                                  <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("on-vel", "v-on")}</span>
                                </div>
                                <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset">
                                  <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("off-vel", "v-off")}</span>
                                </div>
                                <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset">
                                  <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("pressure", "prs")}</span>
                                </div>
                                <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset">
                                  <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("timbre", "tim")}</span>
                                </div>
                              </>
                            )}
                            <div class="sequencer-events-grid__heading sequencer-events-grid__heading--actions">
                              {renderPaneToggle()}
                            </div>
                          </div>
                          <div class="sequencer-events-grid__body">
                            {snapshotEvents.map((event) => (
                              event.type === "bar" || event.type === "tempo"
                                ? (
                                  <div
                                    key={structuralEventInstanceKey(event)}
                                    ref={(node) => {
                                      if (event.type !== "bar") return;
                                      if (node) barRowRefs.current.set(event.barId ?? event.id, node);
                                      else barRowRefs.current.delete(event.barId ?? event.id);
                                    }}
                                    class="sequencer-item sequencer-item--bar"
                                  >
                                    {event.type === "bar" ? renderBarRow(event) : renderTempoRow(event)}
                                  </div>
                                )
                                : renderEventRow(snapshot, index, event)
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  {(structuralMarkersByDisplayBucket.get(index) ?? [])
                    .filter((marker) => !isExpanded || !snapshotStructuralKeys.has(structuralEventRenderKey(marker)))
                    .map((marker) => (
                    <div
                      key={structuralEventInstanceKey(marker)}
                      ref={(node) => {
                        if (marker.structuralType !== "bar") return;
                        if (node) barRowRefs.current.set(marker.id, node);
                        else barRowRefs.current.delete(marker.id);
                      }}
                      class="sequencer-item sequencer-item--bar"
                    >
                      {marker.structuralType === "bar" ? renderBarRow(marker) : renderTempoRow(marker)}
                    </div>
                    ))}
                </Fragment>
              );
              })}
            </div>
          )}
        </div>
      </fieldset>
    </div>
  );
};

export default Sequencer;
