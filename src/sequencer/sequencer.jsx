import { Fragment } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SNAPSHOT_LABEL_MODES } from "./labels.js";
import SequenceInfo from "./sequence-info.jsx";
import SequenceLibrary from "./sequence-library.jsx";
import {
  absolutePositionToBarBeat,
  barBeatToAbsolutePosition,
  normalizeBarMarkers,
  normalizeTempoMarkers,
} from "./transport.js";
import { deriveSequenceCueGroups, deriveSequenceEvents, isWholeSequencePosition } from "./trigger-groups.js";

function formatSequenceTime(snapshotIndex, relativeTime) {
  const baseIndex = Number(snapshotIndex);
  const offset = Number(relativeTime);
  if (!Number.isFinite(baseIndex) || !Number.isFinite(offset)) return "--";
  return (baseIndex + offset).toFixed(6);
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
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverSide, setDragOverSide] = useState("before");
  const [draggedId, setDraggedId] = useState(null);
  const [draggedBarId, setDraggedBarId] = useState(null);
  const [barRelativeDrafts, setBarRelativeDrafts] = useState({});
  const [tempoBarRelativeDrafts, setTempoBarRelativeDrafts] = useState({});
  const [editCommitTick, setEditCommitTick] = useState(0);
  const [eventPane, setEventPane] = useState("timing");
  const dragIdRef = useRef(null);
  const barDragIdRef = useRef(null);
  const pendingTransportActionRef = useRef(null);

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

  const snapshotNumberLabel = playheadIsOff
    ? nextSnapshotIndexFromBar >= 0 && nextSnapshotIndexFromBar < snapshots.length
      ? `(${nextSnapshotIndexFromBar + 1})`
      : "end"
    : playheadIsEnd
      ? "end"
      : String(playheadStepIndex + 1);
  const markerLabel = useMemo(() => {
    if (playheadIsOff) {
      if (nextCueIndexFromBar >= 0) return `(${nextCueIndexFromBar + 1})`;
      return "end";
    }
    if (playheadIsEnd) {
      return sequenceCueGroups.length > 0 ? String(sequenceCueGroups.length) : "0";
    }
    if (playheadMarkerIndex != null) return String(playheadMarkerIndex + 1);
    const currentTime = playheadStepIndex + 1;
    const cueIndex = sequenceCueGroups.findIndex((group) => group.time >= currentTime);
    return cueIndex >= 0 ? String(cueIndex + 1) : "end";
  }, [
    nextCueIndexFromBar,
    playheadIsEnd,
    playheadIsOff,
    playheadMarkerIndex,
    playheadStepIndex,
    sequenceCueGroups,
  ]);

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

  const activeNavigationMode = playheadMarkerIndex != null ? "cue" : "snapshot";
  const activeCueIndex = playheadMarkerIndex != null ? playheadMarkerIndex + 1 : null;
  const activeSnapshotId =
    playheadStepIndex >= 0 && !playheadIsEnd ? (snapshots[playheadStepIndex]?.id ?? null) : null;
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
    setExpandedIds((prev) => {
      if (prev.size === 1 && prev.has(selectedSnapshotId)) return prev;
      return new Set([selectedSnapshotId]);
    });
  }, [playheadIsEnd, playheadIsOff, selectedSnapshotId, showAllEvents]);

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

  const updateEventTime = (snapshot, noteKey, kind, absoluteTime) => {
    const baseIndex = snapshotIndexById.get(snapshot.id) ?? 1;
    const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
    const parsedAbsolute = Number(absoluteTime);
    if (!Number.isFinite(parsedAbsolute)) return;
    const relativeTime = Math.round((parsedAbsolute - baseIndex) * 1000000) / 1000000;

    const notes = (snapshot.notes ?? []).map((note) => {
      if (noteIdentity(note, length) !== noteKey) return note;
      const currentStart = Number.isFinite(Number(note?.start)) ? Number(note.start) : 0;
      const currentEnd = Number.isFinite(Number(note?.end)) ? Number(note.end) : length;
      if (kind === "attack") {
        // For now, out-of-range positions remain attached to this snapshot so
        // overlaps and temporary bitonality can be authored without implicitly
        // relocating notes between snapshots. A later mode may optionally
        // reinterpret such positions as reassignment to neighbouring snapshots.
        const nextStart = relativeTime;
        return {
          ...note,
          start: nextStart,
          end: Math.max(nextStart, currentEnd),
        };
      }
      const nextEnd = Math.max(currentStart, relativeTime);
      return {
        ...note,
        start: currentStart,
        end: nextEnd,
      };
    });

    onUpdateSnapshot(snapshot.id, { notes });
  };

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
      return {
        ...prev,
        [draftKey]: {
          ...buildBarRelativeDraft(current, field, { [draftField]: value }),
          ...meta,
          draftKey,
          scope: `event:${draftKey}`,
        },
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
      return {
        ...prev,
        [draftKey]: {
          ...buildBarRelativeDraft(current, field, { [draftField]: value }),
          ...meta,
          draftKey,
          scope: `tempo:${draftKey}`,
        },
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

    const notes = (snapshot.notes ?? []).map((note) => {
      const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
      if (noteIdentity(note, length) !== noteKey) return note;

      if (field === "midicents") {
        return { ...note, midicents: numeric };
      }
      if (field === "frequency") {
        const midicents = frequencyToMidicents(numeric);
        return midicents == null ? note : { ...note, midicents };
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
    const numeric = Math.max(1, Math.round(Number(rawValue) || 0));
    if (!Number.isFinite(numeric) || numeric <= 0) return;
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

  const renderPaneToggle = () => (
    <button
      type="button"
      class="sequencer-events-grid__pane-toggle"
      aria-label={eventPane === "timing" ? "show expression controls" : "show bar-relative timing"}
      title={eventPane === "timing" ? "Show expression controls" : "Show bar-relative timing"}
      onClick={() => setEventPane((value) => (value === "timing" ? "expression" : "timing"))}
    >
      <span aria-hidden="true">
        {eventPane === "timing" ? "→" : "←"}
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
            min="1"
            class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__beat${isTempoBarRelativeDraftActive ? " sequencer-event__input--draft" : ""}`}
            value={tempoBarRelativeDraft?.beat ?? String(barBeat?.beat ?? 1)}
            aria-label="tempo beat"
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
            value={tempoBarRelativeDraft?.numerator ?? String(barBeat?.numerator ?? 0)}
            aria-label="tempo beat fraction numerator"
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
            value={tempoBarRelativeDraft?.denominator ?? String(barBeat?.denominator ?? 1)}
            aria-label="tempo beat fraction denominator"
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
    const sequenceTime = formatSequenceTime(
      snapshotIndexById.get(snapshot.id) ?? snapshotIndex + 1,
      event.relativeTime,
    );
    const barBeat = absolutePositionToBarBeat(event.absoluteTime, sortedBars, event.fractionDenominator, 9);
    const draftKey = eventBarRelativeDraftKey(snapshot.id, event.eventId, event.kind);
    const barRelativeDraft = barRelativeDrafts[draftKey] ?? null;
    const isBarRelativeDraftActive = eventPane === "timing" && barRelativeDraft != null;

    return (
      <div
        key={`${event.eventId}:${keySuffix}`}
        class={`sequencer-event-row sequencer-event-row--${event.kind}${isMarkerSelected ? " sequencer-group--selected" : ""}${isCueActive ? " sequencer-event-row--cue-active" : ""}${isSnapshotActive ? " sequencer-event-row--snapshot-active" : ""}${isBarRelativeDraftActive ? " sequencer-event-row--bar-relative-draft" : ""}`}
        data-bar-relative-draft-scope={`event:${draftKey}`}
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
        <div class="sequencer-event__delete-cell" />
        <div class="sequencer-event__cue-cell">{renderCueMarker(snapshot, event, sequenceTime)}</div>
        <div class="sequencer-event__cell">
          <input
            type="text"
            class={`sequencer-event__input sequencer-event__position${isOutOfSnapshotRange(snapshot, event.relativeTime) ? " sequencer-event__position--out-of-range" : ""}`}
            defaultValue={sequenceTime}
            aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} position`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => {
              e.stopPropagation();
              delete e.currentTarget.dataset.lastCommittedValue;
              e.currentTarget.select();
            }}
            onKeyDown={(e) => handleEnterCommit(
              e,
              (value) => updateEventTime(snapshot, event.noteKey, event.kind, value),
            )}
            onBlur={(e) => handleBlurCommit(
              e,
              (value) => updateEventTime(snapshot, event.noteKey, event.kind, value),
            )}
          />
        </div>
        <div class="sequencer-event__cell sequencer-grid-offset">
          <span class="sequencer-event__content sequencer-event__kind">
            {event.kind === "attack" ? "on" : "off"}
          </span>
        </div>
        <div class="sequencer-event__cell sequencer-grid-offset">
          <input
            type="text"
            class="sequencer-event__input"
            defaultValue={formatMidicents(event.midicents)}
            aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} midicents`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => {
              e.stopPropagation();
              delete e.currentTarget.dataset.lastCommittedValue;
              e.currentTarget.select();
            }}
            onKeyDown={(e) => handleEnterCommit(
              e,
              (value) => updateEventField(snapshot, event.noteKey, "midicents", value),
            )}
            onBlur={(e) => handleBlurCommit(
              e,
              (value) => updateEventField(snapshot, event.noteKey, "midicents", value),
            )}
          />
        </div>
        <div class="sequencer-event__cell sequencer-grid-offset">
          <input
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
          <span class="sequencer-event__content sequencer-event__heji">
            {event.displayLabel || ""}
          </span>
        </div>
        {eventPane === "timing" ? (
          <>
            <div class="sequencer-event__cell sequencer-grid-offset">
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
            <div class="sequencer-event__cell sequencer-grid-offset">
              <input
                type="number"
                step="1"
                min={barBeat?.stopped ? "0" : "1"}
                class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__beat${isBarRelativeDraftActive ? " sequencer-event__input--draft" : ""}`}
                value={barRelativeDraft?.beat ?? String(barBeat?.beat ?? 1)}
                aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} beat`}
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
            <div class="sequencer-event__cell sequencer-grid-offset">
              <input
                type="number"
                step="1"
                min="0"
                class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__fraction-num${isBarRelativeDraftActive ? " sequencer-event__input--draft" : ""}`}
                value={barRelativeDraft?.numerator ?? String(barBeat?.numerator ?? 0)}
                aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} beat fraction numerator`}
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
            <div class="sequencer-event__cell sequencer-grid-offset">
              <input
                type="number"
                step="1"
                min="1"
                class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__fraction-den${isBarRelativeDraftActive ? " sequencer-event__input--draft" : ""}`}
                value={barRelativeDraft?.denominator ?? String(barBeat?.denominator ?? 1)}
                aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} beat fraction denominator`}
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
            <div class="sequencer-event__cell sequencer-grid-offset">
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
            <div class="sequencer-event__cell sequencer-grid-offset">
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
            <div class="sequencer-event__cell sequencer-grid-offset">
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
            <div class="sequencer-event__cell sequencer-grid-offset">
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
          {isBarRelativeDraftActive ? (
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
        activeSequenceDescription={activeSequenceDescription ?? ""}
        onLoadSequence={onLoadSequence}
      />

      <SequenceInfo
        name={activeSequenceName ?? ""}
        description={activeSequenceDescription ?? ""}
        onNameChange={onSequenceNameChange}
        onDescriptionChange={onSequenceDescriptionChange}
      />

      <fieldset style={{ marginTop: "1em" }}>
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
        <button type="button" class="preset-action-btn" onClick={onTakeSnapshot}>
          Capture
        </button>
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

        <div class="sequencer-playback-row" aria-label="Sequence playback">
          <span class="sequencer-playback-label">PLAY FROM</span>

          <span class="sequencer-playback-control">
            <span class="sequencer-playback-key">BAR</span>
            <select
              class="sidebar-input sequencer-playback-select"
              value={playhead?.barIndex ?? 0}
              onChange={(e) => onSelectSequenceBar?.(Number(e.currentTarget.value))}
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
            <span class="sequencer-playback-status">{snapshotNumberLabel}</span>
            <button
              type="button"
              class="sequencer-arrow-btn sequencer-arrow-btn--snapshot"
              aria-label="next sequence step"
              title="Next step"
              disabled={snapshots.length === 0 || (playheadIsOff
                ? nextSnapshotIndexFromBar < 0 || nextSnapshotIndexFromBar >= snapshots.length
                : playheadIsEnd)}
              onClick={() => {
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
            <span class="sequencer-playback-status">{markerLabel}</span>
            <button
              type="button"
              class="sequencer-arrow-btn sequencer-arrow-btn--snapshot"
              aria-label="next sequence marker"
              title="Next marker"
              disabled={snapshots.length === 0 || (playheadIsOff
                ? nextCueIndexFromBar < 0
                : playheadIsEnd)}
              onClick={() => {
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

        <label class="sequencer-option-row">
          <span>Legato</span>
          <input
            type="checkbox"
            checked={sequenceLegato}
            onChange={(e) => onSequenceLegatoChange?.(e.currentTarget.checked)}
          />
        </label>

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

        <label>
          Snapshot Labels
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

        {snapshots.length === 0 ? (
          <p>
            <em>No snapshots captured yet.</em>
          </p>
        ) : (
          <div class="sequencer-list">
            {(structuralMarkersByDisplayBucket.get(-1) ?? []).map((marker) => (
              <div key={structuralEventInstanceKey(marker)} class="sequencer-item sequencer-item--bar">
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
                    class={`sequencer-item${isSelected ? " sequencer-item--selected" : ""}${isDragOver ? " sequencer-item--drop-target" : ""}${isDragOver && dragOverSide === "before" ? " sequencer-item--drop-target-before" : ""}${isDragOver && dragOverSide === "after" ? " sequencer-item--drop-target-after" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = e.altKey ? "copy" : "move";
                      if (barDragIdRef.current != null) return;
                      setDragOverId(snapshot.id);
                      setDragOverSide(resolveDropSide(e));
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
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
                      dragIdRef.current = null;
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
                            <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--position">
                              <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("Position", "Pos")}</span>
                            </div>
                            <div class="sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--kind-spacer" />
                            <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--midicents">
                              <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("MIDI¢", "MIDI¢")}</span>
                            </div>
                            <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--hz">
                              <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("Hz", "Hz")}</span>
                            </div>
                            <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--heji">
                              <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("HEJI", "HEJI")}</span>
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
                    <div key={structuralEventInstanceKey(marker)} class="sequencer-item sequencer-item--bar">
                      {marker.structuralType === "bar" ? renderBarRow(marker) : renderTempoRow(marker)}
                    </div>
                    ))}
                </Fragment>
              );
            })}
          </div>
        )}
      </fieldset>
    </div>
  );
};

export default Sequencer;
