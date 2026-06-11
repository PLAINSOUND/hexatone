import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SNAPSHOT_LABEL_MODES } from "./labels.js";
import SequenceInfo from "./sequence-info.jsx";
import SequenceLibrary from "./sequence-library.jsx";
import { deriveSequenceCueGroups, deriveSequenceEvents } from "./trigger-groups.js";

function formatSequenceTime(snapshotIndex, relativeTime) {
  const baseIndex = Number(snapshotIndex);
  const offset = Number(relativeTime);
  if (!Number.isFinite(baseIndex) || !Number.isFinite(offset)) return "--";
  return (baseIndex + offset).toFixed(3);
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
  snapshotLabelMode,
  activeSequenceName,
  activeSequenceDescription,
  sequenceLegato,
  selectedSnapshotId,
  selectedMarker,
  playingSnapshotId,
  playhead,
  onTakeSnapshot,
  onLoadSequence,
  onSequenceNameChange,
  onSequenceDescriptionChange,
  onSequenceLegatoChange,
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
  onDeleteBar,
  onUpdateBar,
  onMoveBar,
  onDeleteSnapshot,
  onMoveSnapshot,
  onUpdateSnapshot,
  onResetSnapshotDescription,
}) => {
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [newBarPosition, setNewBarPosition] = useState("1.000");
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverSide, setDragOverSide] = useState("before");
  const [draggedId, setDraggedId] = useState(null);
  const [draggedBarId, setDraggedBarId] = useState(null);
  const [editCommitTick, setEditCommitTick] = useState(0);
  const dragIdRef = useRef(null);
  const barDragIdRef = useRef(null);
  const pendingTransportActionRef = useRef(null);

  const sequenceEvents = useMemo(() => deriveSequenceEvents(snapshots, bars), [bars, snapshots]);
  const sequenceCueGroups = useMemo(() => deriveSequenceCueGroups(snapshots, bars), [bars, snapshots]);

  const rawPlayheadStepIndex = Number.isFinite(playhead?.stepIndex) ? playhead.stepIndex : -1;
  const playheadIsOff = rawPlayheadStepIndex < 0 || snapshots.length === 0;
  const playheadIsEnd = !playheadIsOff && rawPlayheadStepIndex >= snapshots.length;
  const playheadStepIndex =
    playheadIsOff || playheadIsEnd
      ? -1
      : Math.max(0, Math.min(snapshots.length - 1, rawPlayheadStepIndex));
  const playheadMarkerIndex = Number.isFinite(playhead?.markerIndex) ? playhead.markerIndex : null;
  const snapshotNumberLabel = playheadIsOff
    ? "0"
    : playheadIsEnd
      ? "end"
      : String(playheadStepIndex + 1);
  const markerLabel = useMemo(() => {
    if (playheadIsOff) return "0";
    if (playheadIsEnd) {
      return sequenceCueGroups.length > 0 ? String(sequenceCueGroups.length) : "0";
    }
    if (playheadMarkerIndex != null) return String(playheadMarkerIndex + 1);
    const currentTime = playheadStepIndex + 1;
    const cueIndex = sequenceCueGroups.findIndex((group) => group.time >= currentTime);
    return cueIndex >= 0 ? String(cueIndex + 1) : "end";
  }, [playheadIsEnd, playheadIsOff, playheadMarkerIndex, playheadStepIndex, sequenceCueGroups]);

  const snapshotIndexById = useMemo(() => {
    const entries = snapshots.map((snapshot, index) => [snapshot.id, index + 1]);
    return new Map(entries);
  }, [snapshots]);

  const snapshotEventsById = useMemo(() => {
    const groups = new Map();
    for (const event of sequenceEvents) {
      if (event.type !== "note") continue;
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

  const sortedBars = useMemo(
    () => [...(Array.isArray(bars) ? bars : [])].sort((a, b) => (
      Number(a.position) - Number(b.position) || Number(a.id) - Number(b.id)
    )),
    [bars],
  );

  const barNumberById = useMemo(() => {
    const entries = sortedBars.map((bar, index) => [bar.id, index + 1]);
    return new Map(entries);
  }, [sortedBars]);

  const barsByDisplayBucket = useMemo(() => {
    const groups = new Map();
    for (const bar of sortedBars) {
      const bucket = barDisplayBucket(bar.position);
      if (!groups.has(bucket)) groups.set(bucket, []);
      groups.get(bucket).push(bar);
    }
    return groups;
  }, [sortedBars]);

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
      if (snapshotStart != null) return Number((snapshotStart + Number(selectedMarker.time)).toFixed(3));
    }
    if (playheadMarkerIndex != null) {
      const cueGroup = sequenceCueGroups[playheadMarkerIndex];
      if (cueGroup) return Number(cueGroup.time.toFixed(3));
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
    setNewBarPosition(selectedCueAbsoluteTime.toFixed(3));
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
    const relativeTime = parsedAbsolute - baseIndex;

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
    onUpdateBar?.(barId, { position: Math.round(numeric * 1000) / 1000 });
  };

  const addBarAtRequestedPosition = () => {
    const numeric = Number(newBarPosition);
    if (!Number.isFinite(numeric)) return;
    onAddBar?.(Math.round(numeric * 1000) / 1000);
    setNewBarPosition("1.000");
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
    const sequenceTime = Number(bar.position ?? bar.absoluteTime).toFixed(3);
    const isDraggable = true;

    return (
      <div
        key={`bar:${barId}`}
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
        <div class="sequencer-event__delete-cell">
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
        <div class="sequencer-event__cell">
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
        <div class="sequencer-bar-row__filler" aria-hidden="true" />
        <div class="sequencer-bar-row__filler" aria-hidden="true" />
        <div class="sequencer-bar-row__filler" aria-hidden="true" />
        <div class="sequencer-bar-row__filler" aria-hidden="true" />
        <div class="sequencer-bar-row__filler" aria-hidden="true" />
        <div class="sequencer-bar-row__filler" aria-hidden="true" />
        <div class="sequencer-bar-row__filler" aria-hidden="true" />
        <div class="sequencer-bar-row__filler" aria-hidden="true" />
        <div class="sequencer-bar-row__spacer" aria-hidden="true" />
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

    return (
      <div
        key={`${event.eventId}:${keySuffix}`}
        class={`sequencer-event-row sequencer-event-row--${event.kind}${isMarkerSelected ? " sequencer-group--selected" : ""}${isCueActive ? " sequencer-event-row--cue-active" : ""}${isSnapshotActive ? " sequencer-event-row--snapshot-active" : ""}`}
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
        <div class="sequencer-event__cell">
          <span class="sequencer-event__content sequencer-event__kind">
            {event.kind === "attack" ? "on" : "off"}
          </span>
        </div>
        <div class="sequencer-event__cell">
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
        <div class="sequencer-event__cell">
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
        <div class="sequencer-event__cell">
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
        <div class="sequencer-event__cell">
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
        <div class="sequencer-event__cell">
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
        <div class="sequencer-event__cell">
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
        <div class="sequencer-event__actions-cell">
          {(event.cueDisplayLead || (
            firstSnapshotEventIds.get(snapshot.id) === event.eventId &&
            snapshotStartCueIndexes.get(snapshot.id) === event.cueIndex
          )) ? renderCueTransport(event.cueIndex) : null}
        </div>
      </div>
    );
  };

  return (
    <div role="group" aria-label="Sequencer workspace">
      <SequenceLibrary
        snapshots={snapshots}
        bars={bars}
        snapshotLabelMode={snapshotLabelMode}
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
            Store currently sounding notes, including attack and release velocity if sustained, as
            well as pressure and timbre data if available. May be layered with notes from a
            previous snapshot to build up chords in stages. The Sequence panel, below, allows
            snapshots to be played, ordered, and edited.
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
              disabled={snapshots.length === 0 || playheadIsOff}
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
              disabled={snapshots.length === 0 || playheadIsEnd}
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
              disabled={snapshots.length === 0 || playheadIsOff}
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
              disabled={snapshots.length === 0 || playheadIsEnd}
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

        <div class="sequencer-option-row">
          <span>Choose Bar Position</span>
          <span class="sequencer-bars-add">
            <input
              type="text"
              class={`sidebar-input sequencer-bars-add__position${newBarPosition === "1.000" ? " sequencer-bars-add__position--hint" : ""}`}
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
            {(barsByDisplayBucket.get(-1) ?? []).map((bar) => (
              <div key={`bar:${bar.id}`} class="sequencer-item sequencer-item--bar">
                {renderBarRow(bar)}
              </div>
            ))}
            {snapshots.map((snapshot, index) => {
              const isPlaying = snapshot.id === playingSnapshotId;
              const isSelected = snapshot.id === selectedSnapshotId;
              const isExpanded = showAllEvents || expandedIds.has(snapshot.id);
              const isDragOver = dragOverId === snapshot.id;
              const snapshotEvents = snapshotEventsById.get(snapshot.id) ?? [];

              return (
                <>
                  <div
                    key={snapshot.id}
                    class={`sequencer-item${isSelected ? " sequencer-item--selected" : ""}${isDragOver ? " sequencer-item--drop-target" : ""}${isDragOver && dragOverSide === "before" ? " sequencer-item--drop-target-before" : ""}${isDragOver && dragOverSide === "after" ? " sequencer-item--drop-target-after" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
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
                        onMoveSnapshot(dragIdRef.current, snapshot.id, side);
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
                          e.dataTransfer.effectAllowed = "move";
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
                          class="sequencer-events-grid"
                          role="table"
                          aria-label={`snapshot ${index + 1} events`}
                        >
                          <div class="sequencer-events-grid__header" role="row">
                            <div class="sequencer-events-grid__heading sequencer-events-grid__heading--delete" />
                            <div class="sequencer-events-grid__heading sequencer-events-grid__heading--cue" />
                            <div class="sequencer-events-grid__heading">Position</div>
                            <div class="sequencer-events-grid__heading">on/off</div>
                            <div class="sequencer-events-grid__heading">MIDI¢</div>
                            <div class="sequencer-events-grid__heading">Hz</div>
                            <div class="sequencer-events-grid__heading">on-vel</div>
                            <div class="sequencer-events-grid__heading">off-vel</div>
                            <div class="sequencer-events-grid__heading">pressure</div>
                            <div class="sequencer-events-grid__heading">timbre</div>
                            <div class="sequencer-events-grid__heading sequencer-events-grid__heading--actions" />
                          </div>
                          <div class="sequencer-events-grid__body">
                            {snapshotEvents.map((event) => renderEventRow(snapshot, index, event))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  {(barsByDisplayBucket.get(index) ?? []).map((bar) => (
                    <div key={`bar:${bar.id}`} class="sequencer-item sequencer-item--bar">
                      {renderBarRow(bar)}
                    </div>
                  ))}
                </>
              );
            })}
          </div>
        )}
      </fieldset>
    </div>
  );
};

export default Sequencer;
