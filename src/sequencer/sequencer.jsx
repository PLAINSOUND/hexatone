import { useMemo, useRef, useState } from "preact/hooks";
import { SNAPSHOT_LABEL_MODES } from "./labels.js";
import { deriveSnapshotTriggerGroups } from "./trigger-groups.js";

function formatSequenceTime(snapshotIndex, relativeTime) {
  const baseIndex = Number(snapshotIndex);
  const offset = Number(relativeTime);
  if (!Number.isFinite(baseIndex) || !Number.isFinite(offset)) return "--";
  return (baseIndex + offset).toFixed(3);
}

function formatFrequency(value) {
  if (!Number.isFinite(value)) return "--";
  return value >= 100 ? value.toFixed(2) : value.toFixed(3);
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

function frequencyToMidicents(value) {
  const frequency = Number(value);
  if (!Number.isFinite(frequency) || frequency <= 0) return null;
  return 69 + Math.log2(frequency / 440) * 12;
}

/**
 * Sequencer — early sidebar workspace for building sequencer material from
 * captured snapshots while keeping the existing Hexatone canvas active.
 */
const Sequencer = ({
  snapshots,
  snapshotLabelMode,
  selectedSnapshotId,
  selectedMarker,
  playingSnapshotId,
  playhead,
  onTakeSnapshot,
  onSetSnapshotLabelMode,
  onSelectSnapshot,
  onSelectMarker,
  onPlaySnapshot,
  onStopSnapshot,
  onSelectSequenceBar,
  onStepSequence,
  onStepSequenceMarker,
  onPlaySequence,
  onDeleteSnapshot,
  onMoveSnapshot,
  onUpdateSnapshot,
  onResetSnapshotDescription,
}) => {
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverSide, setDragOverSide] = useState("before");
  const [draggedId, setDraggedId] = useState(null);
  const dragIdRef = useRef(null);

  const triggerGroupsById = useMemo(() => {
    const entries = snapshots.map((snapshot) => [
      snapshot.id,
      deriveSnapshotTriggerGroups(snapshot),
    ]);
    return new Map(entries);
  }, [snapshots]);

  const playheadStepIndex = Math.max(0, Math.min(snapshots.length - 1, playhead?.stepIndex ?? 0));
  const playheadSnapshot = snapshots[playheadStepIndex] ?? null;
  const playheadGroups = playheadSnapshot ? (triggerGroupsById.get(playheadSnapshot.id) ?? []) : [];
  const playheadMarkerIndex = playhead?.markerIndex;
  const markerLabel = playheadMarkerIndex == null
    ? "Chord"
    : `${Math.min(playheadMarkerIndex + 1, playheadGroups.length)}/${playheadGroups.length}`;
  const stepLabel = snapshots.length ? `${playheadStepIndex + 1}/${snapshots.length}` : "0/0";

  const snapshotIndexById = useMemo(() => {
    const entries = snapshots.map((snapshot, index) => [snapshot.id, index + 1]);
    return new Map(entries);
  }, [snapshots]);

  const ensureExpanded = (id) => {
    setExpandedIds((prev) => {
      if (prev.size === 1 && prev.has(id)) return prev;
      return new Set([id]);
    });
  };

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => (
      prev.has(id) ? new Set() : new Set([id])
    ));
  };

  const resolveDropSide = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  };

  const updateEventTime = (snapshot, noteId, kind, absoluteTime) => {
    const baseIndex = snapshotIndexById.get(snapshot.id) ?? 1;
    const length = Number.isFinite(Number(snapshot?.length)) ? Number(snapshot.length) : 1;
    const parsedAbsolute = Number(absoluteTime);
    if (!Number.isFinite(parsedAbsolute)) return;
    const relativeTime = clamp(parsedAbsolute - baseIndex, 0, length);

    const notes = (snapshot.notes ?? []).map((note) => {
      if (note.id !== noteId) return note;
      const currentStart = Number.isFinite(Number(note?.start)) ? Number(note.start) : 0;
      const currentEnd = Number.isFinite(Number(note?.end)) ? Number(note.end) : length;
      if (kind === "attack") {
        const nextStart = clamp(relativeTime, 0, currentEnd);
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
        end: clamp(nextEnd, currentStart, length),
      };
    });

    onUpdateSnapshot(snapshot.id, { notes });
  };

  const updateEventField = (snapshot, noteId, field, rawValue) => {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) return;

    const notes = (snapshot.notes ?? []).map((note) => {
      if (note.id !== noteId) return note;

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

  return (
    <div role="group" aria-label="Sequencer workspace">
      <fieldset style={{ marginTop: "1em" }}>
        <legend>
          <b>Snapshot</b>
        </legend>             
        <p>
          <em>
            Store currently sounding notes, including attack and release velocity if sustained, as well as pressure and timbre data if available. May be layered with notes from a previous snapshot to build up chords in stages. The Sequence panel, below, allows snapshots to be played, ordered, and edited.
          </em>
        </p>
        <button
          type="button"
          class="preset-action-btn"
          onClick={onTakeSnapshot}
        >
          Capture
        </button>
      </fieldset>

      <fieldset>
        <legend>
          <b>Sequence</b>
        </legend>
        <div class="sequencer-playback-row" aria-label="Sequence playback">
          <span class="sequencer-playback-label">Playback</span>
          <label class="sequencer-playback-control">
            Bar
            <select
              class="sidebar-input sequencer-playback-select"
              value={playhead?.barIndex ?? 0}
              onChange={(e) => onSelectSequenceBar?.(Number(e.currentTarget.value))}
            >
              <option value={0}>1</option>
            </select>
          </label>
          <span class="sequencer-playback-control">
            Step
            <button
              type="button"
              class="snapshot-play-btn sequencer-transport-btn"
              aria-label="previous sequence step"
              title="Previous step"
              disabled={snapshots.length === 0 || playheadStepIndex === 0}
              onClick={() => onStepSequence?.(-1)}
            >
              <span aria-hidden="true">◀</span>
            </button>
            <span class="sequencer-playback-status">{stepLabel}</span>
            <button
              type="button"
              class="snapshot-play-btn sequencer-transport-btn"
              aria-label="next sequence step"
              title="Next step"
              disabled={snapshots.length === 0 || playheadStepIndex >= snapshots.length - 1}
              onClick={() => onStepSequence?.(1)}
            >
              <span aria-hidden="true">▶</span>
            </button>
          </span>
          <span class="sequencer-playback-control">
            Marker
            <button
              type="button"
              class="snapshot-play-btn sequencer-transport-btn"
              aria-label="previous sequence marker"
              title="Previous marker"
              disabled={snapshots.length === 0}
              onClick={() => onStepSequenceMarker?.(-1)}
            >
              <span aria-hidden="true">◂</span>
            </button>
            <span class="sequencer-playback-status">{markerLabel}</span>
            <button
              type="button"
              class="snapshot-play-btn sequencer-transport-btn"
              aria-label="next sequence marker"
              title="Next marker"
              disabled={snapshots.length === 0}
              onClick={() => onStepSequenceMarker?.(1)}
            >
              <span aria-hidden="true">▸</span>
            </button>
          </span>
          <span class="sequencer-playback-actions">
            <button
              type="button"
              class="snapshot-play-btn"
              title="Play current sequence position"
              aria-label="play current sequence position"
              disabled={snapshots.length === 0}
              onClick={() => onPlaySequence?.()}
            >
              <span className="snapshot-play-glyph snapshot-play-glyph--play" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="snapshot-play-btn snapshot-stop-btn"
              title="Stop sequence playback"
              aria-label="stop sequence playback"
              disabled={!playingSnapshotId}
              onClick={() => onStopSnapshot?.()}
            >
              <span className="snapshot-play-glyph snapshot-play-glyph--stop" aria-hidden="true" />
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
              <option key={mode.value} value={mode.value}>{mode.label}</option>
            ))}
          </select>
        </label>
        {snapshots.length === 0 ? (
          <p>
            <em>No snapshots captured yet.</em>
          </p>
        ) : (
          <div class="sequencer-list">
            {snapshots.map((snapshot, index) => {
              const isPlaying = snapshot.id === playingSnapshotId;
              const isSelected = snapshot.id === selectedSnapshotId;
              const isExpanded = expandedIds.has(snapshot.id);
              const isDragOver = dragOverId === snapshot.id;
              const triggerGroups = triggerGroupsById.get(snapshot.id) ?? [];

              return (
                <div
                  key={snapshot.id}
                  class={`sequencer-item${isSelected ? " sequencer-item--selected" : ""}${isDragOver ? " sequencer-item--drop-target" : ""}${isDragOver && dragOverSide === "before" ? " sequencer-item--drop-target-before" : ""}${isDragOver && dragOverSide === "after" ? " sequencer-item--drop-target-after" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOverId(snapshot.id);
                    setDragOverSide(resolveDropSide(e));
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDragOverId(snapshot.id);
                    setDragOverSide(resolveDropSide(e));
                  }}
                  onDragLeave={() => setDragOverId(null)}
                  onDrop={(e) => {
                    e.preventDefault();
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
                      toggleExpanded(snapshot.id);
                    }}
                  >
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
                          <span class="sequencer-gutter__delete-glyph" aria-hidden="true">×</span>
                        </button>
                      )}
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
                      onInput={(e) => onUpdateSnapshot(snapshot.id, { description: e.currentTarget.value })}
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
                      <span class="refresh-glyph preset-refresh-glyph" aria-hidden="true">⟳</span>
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
                        <span
                          className="snapshot-play-glyph snapshot-play-glyph--stop"
                          aria-hidden="true"
                        />
                      </button>
                    </span>
                  </div>

                  {isExpanded && (
                    <div class="sequencer-item__groups">
                      <table class="sequencer-events-table">
                        <colgroup>
                          <col />
                          <col />
                          <col />
                          <col />
                          <col />
                          <col />
                          <col />
                          <col />
                        </colgroup>
                        <thead>
                          <tr class="sequencer-events-header">
                            <th scope="col"><span class="sequencer-events-header__content">Position</span></th>
                            <th scope="col"><span class="sequencer-events-header__content">on/off</span></th>
                            <th scope="col"><span class="sequencer-events-header__content">MIDI¢</span></th>
                            <th scope="col"><span class="sequencer-events-header__content">Hz</span></th>
                            <th scope="col"><span class="sequencer-events-header__content">on-vel</span></th>
                            <th scope="col"><span class="sequencer-events-header__content">off-vel</span></th>
                            <th scope="col"><span class="sequencer-events-header__content">pressure</span></th>
                            <th scope="col"><span class="sequencer-events-header__content">timbre</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {triggerGroups.map((group) => {
                            const isMarkerSelected = (
                              selectedMarker?.snapshotId === snapshot.id &&
                              selectedMarker?.time === group.time
                            );
                            const sequenceTime = formatSequenceTime(
                              snapshotIndexById.get(snapshot.id) ?? index + 1,
                              group.time,
                            );
                            return group.events.map((event) => (
                              <tr
                                key={`${event.noteId}:${event.kind}:${event.time}`}
                                class={`sequencer-event sequencer-event--${event.kind}${isMarkerSelected ? " sequencer-group--selected" : ""}`}
                                onClick={() => {
                                  onSelectMarker(snapshot.id, group.time);
                                }}
                              >
                                <td class="sequencer-event__cell">
                                  <input
                                    type="text"
                                    class="sequencer-event__input sequencer-event__position"
                                    defaultValue={sequenceTime}
                                    aria-label={`snapshot ${index + 1} ${event.kind} position`}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => e.stopPropagation()}
                                    onFocus={(e) => {
                                      e.stopPropagation();
                                      e.currentTarget.select();
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") e.currentTarget.blur();
                                    }}
                                    onBlur={(e) => {
                                      updateEventTime(snapshot, event.noteId, event.kind, e.currentTarget.value);
                                    }}
                                  />
                                </td>
                                <td class="sequencer-event__cell"><span class="sequencer-event__content sequencer-event__kind">
                                  {event.kind === "attack" ? "on" : "off"}
                                </span></td>
                                <td class="sequencer-event__cell">
                                  <input
                                    type="text"
                                    class="sequencer-event__input"
                                    defaultValue={formatMidicents(event.midicents)}
                                    aria-label={`snapshot ${index + 1} ${event.kind} midicents`}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => e.stopPropagation()}
                                    onFocus={(e) => {
                                      e.stopPropagation();
                                      e.currentTarget.select();
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") e.currentTarget.blur();
                                    }}
                                    onBlur={(e) => {
                                      updateEventField(snapshot, event.noteId, "midicents", e.currentTarget.value);
                                    }}
                                  />
                                </td>
                                <td class="sequencer-event__cell">
                                  <input
                                    type="text"
                                    class="sequencer-event__input"
                                    defaultValue={formatFrequency(event.frequency)}
                                    aria-label={`snapshot ${index + 1} ${event.kind} frequency`}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => e.stopPropagation()}
                                    onFocus={(e) => {
                                      e.stopPropagation();
                                      e.currentTarget.select();
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") e.currentTarget.blur();
                                    }}
                                    onBlur={(e) => {
                                      updateEventField(snapshot, event.noteId, "frequency", e.currentTarget.value);
                                    }}
                                  />
                                </td>
                                <td class="sequencer-event__cell">
                                  <input
                                    type="text"
                                    class="sequencer-event__input"
                                    defaultValue={displayValue(event.attackVelocity)}
                                    aria-label={`snapshot ${index + 1} ${event.kind} on velocity`}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => e.stopPropagation()}
                                    onFocus={(e) => {
                                      e.stopPropagation();
                                      e.currentTarget.select();
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") e.currentTarget.blur();
                                    }}
                                    onBlur={(e) => {
                                      updateEventField(snapshot, event.noteId, "attackVelocity", e.currentTarget.value);
                                    }}
                                  />
                                </td>
                                <td class="sequencer-event__cell">
                                  <input
                                    type="text"
                                    class="sequencer-event__input"
                                    defaultValue={displayValue(event.releaseVelocity)}
                                    aria-label={`snapshot ${index + 1} ${event.kind} off velocity`}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => e.stopPropagation()}
                                    onFocus={(e) => {
                                      e.stopPropagation();
                                      e.currentTarget.select();
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") e.currentTarget.blur();
                                    }}
                                    onBlur={(e) => {
                                      updateEventField(snapshot, event.noteId, "releaseVelocity", e.currentTarget.value);
                                    }}
                                  />
                                </td>
                                <td class="sequencer-event__cell">
                                  <input
                                    type="text"
                                    class="sequencer-event__input"
                                    defaultValue={displayValue(event.pressure)}
                                    aria-label={`snapshot ${index + 1} ${event.kind} pressure`}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => e.stopPropagation()}
                                    onFocus={(e) => {
                                      e.stopPropagation();
                                      e.currentTarget.select();
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") e.currentTarget.blur();
                                    }}
                                    onBlur={(e) => {
                                      updateEventField(snapshot, event.noteId, "pressure", e.currentTarget.value);
                                    }}
                                  />
                                </td>
                                <td class="sequencer-event__cell">
                                  <input
                                    type="text"
                                    class="sequencer-event__input"
                                    defaultValue={displayValue(event.timbre)}
                                    aria-label={`snapshot ${index + 1} ${event.kind} timbre`}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => e.stopPropagation()}
                                    onFocus={(e) => {
                                      e.stopPropagation();
                                      e.currentTarget.select();
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") e.currentTarget.blur();
                                    }}
                                    onBlur={(e) => {
                                      updateEventField(snapshot, event.noteId, "timbre", e.currentTarget.value);
                                    }}
                                  />
                                </td>
                              </tr>
                            ));
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </fieldset>

    </div>
  );
};

export default Sequencer;
