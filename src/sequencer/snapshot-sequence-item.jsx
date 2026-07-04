import { Fragment } from "preact";
import EventsGridHeader from "./events-grid-header.jsx";
import BarRow from "./bar-row.jsx";
import BarlineRow from "./barline-row.jsx";
import TempoRow from "./tempo-row.jsx";
import RepeatRow from "./repeat-row.jsx";
import EventRow from "./event-row.jsx";
import {
  structuralEventInstanceKey,
  structuralEventRenderKey,
} from "./value-runtime.js";

const SnapshotSequenceItem = ({
  snapshot,
  index,
  selectedSnapshotId,
  playingSnapshotId,
  showAllEvents,
  expandedIds,
  dragState,
  structure,
  rows,
  actions,
}) => {
  const isPlaying = snapshot.id === playingSnapshotId;
  const isSelected = snapshot.id === selectedSnapshotId;
  const isExpanded = showAllEvents || expandedIds.has(snapshot.id);
  const isDragOver = dragState.dragOverId === snapshot.id;
  const snapshotEvents = structure.snapshotEventsById.get(snapshot.id) ?? [];
  const snapshotStructuralKeys = new Set(
    snapshotEvents
      .filter((event) => event.type === "bar" || event.type === "tempo" || event.type === "repeat-start" || event.type === "repeat-end")
      .map((event) => structuralEventRenderKey(event)),
  );

  return (
    <Fragment key={snapshot.id}>
      <div
        ref={(node) => {
          if (node) dragState.snapshotRowRefs.current.set(snapshot.id, node);
          else dragState.snapshotRowRefs.current.delete(snapshot.id);
        }}
        class={`sequencer-item${isSelected ? " sequencer-item--selected" : ""}${isDragOver ? " sequencer-item--drop-target" : ""}${isDragOver && dragState.dragOverSide === "before" ? " sequencer-item--drop-target-before" : ""}${isDragOver && dragState.dragOverSide === "after" ? " sequencer-item--drop-target-after" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = e.altKey ? "copy" : "move";
          if (dragState.eventDragRef.current != null) {
            dragState.setDragOverId(snapshot.id);
            return;
          }
          if (dragState.barDragIdRef.current != null) return;
          dragState.setDragOverId(snapshot.id);
          dragState.setDragOverSide(actions.resolveDropSide(e));
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          if (dragState.eventDragRef.current != null) {
            dragState.setDragOverId(snapshot.id);
            return;
          }
          if (dragState.barDragIdRef.current != null) return;
          dragState.setDragOverId(snapshot.id);
          dragState.setDragOverSide(actions.resolveDropSide(e));
        }}
        onDragLeave={() => {
          if (dragState.barDragIdRef.current != null) return;
          dragState.setDragOverId(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragState.eventDragRef.current != null) {
            const draggedEvent = dragState.eventDragRef.current;
            if (e.altKey) {
              actions.duplicateEventNoteToSnapshot(
                draggedEvent.snapshotId,
                draggedEvent.noteKey,
                snapshot.id,
                draggedEvent.kind,
              );
            } else {
              actions.moveEventNoteToSnapshot(
                draggedEvent.snapshotId,
                draggedEvent.noteKey,
                snapshot.id,
                draggedEvent.kind,
              );
            }
            dragState.setDragOverId(null);
            dragState.setDraggedEventId(null);
            dragState.eventDragRef.current = null;
            return;
          }
          if (dragState.barDragIdRef.current != null) {
            dragState.onMoveBar?.(dragState.barDragIdRef.current, index + 1);
            dragState.setDraggedBarId(null);
            dragState.barDragIdRef.current = null;
            return;
          }
          dragState.setDragOverId(null);
          dragState.setDraggedId(null);
          const side = actions.resolveDropSide(e);
          if (dragState.dragIdRef.current !== null && dragState.dragIdRef.current !== snapshot.id) {
            if (e.altKey) actions.onDuplicateSnapshot?.(dragState.dragIdRef.current, snapshot.id, side);
            else actions.onMoveSnapshot(dragState.dragIdRef.current, snapshot.id, side);
          }
          dragState.dragIdRef.current = null;
        }}
        onDragEnd={() => {
          dragState.setDragOverId(null);
          dragState.setDraggedId(null);
          dragState.setDraggedEventId(null);
          dragState.dragIdRef.current = null;
          dragState.eventDragRef.current = null;
        }}
      >
        <div
          class={`sequencer-row${isSelected ? " sequencer-row--selected" : ""}`}
          onClick={() => {
            actions.onSelectSnapshot(snapshot.id);
            if (!showAllEvents) actions.toggleExpanded(snapshot.id);
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
                  actions.onDeleteSnapshot(snapshot.id);
                }}
              >
                <span class="sequencer-gutter__delete-glyph" aria-hidden="true">
                  ×
                </span>
              </button>
            )}
          </span>
          <span
            class={`sequencer-gutter${isSelected ? " sequencer-gutter--selected" : ""}${dragState.draggedId === snapshot.id ? " sequencer-gutter--dragging" : ""}`}
            draggable="true"
            title="Drag to reorder this chord"
            onDragStart={(e) => {
              dragState.dragIdRef.current = snapshot.id;
              dragState.setDraggedId(snapshot.id);
              e.dataTransfer.effectAllowed = "copyMove";
            }}
            onDragEnd={() => {
              dragState.setDragOverId(null);
              dragState.setDraggedId(null);
              dragState.dragIdRef.current = null;
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
              actions.onSelectSnapshot(snapshot.id);
              actions.ensureExpanded(snapshot.id);
            }}
            onInput={(e) =>
              actions.onUpdateSnapshot(snapshot.id, { description: e.currentTarget.value })}
          />
          <button
            type="button"
            class="sequencer-row__reset preset-refresh-btn"
            aria-label={`reset snapshot ${index + 1} description`}
            title="Reset description to current auto-generated label"
            onClick={(e) => {
              e.stopPropagation();
              actions.onResetSnapshotDescription(snapshot.id);
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
                actions.onPlaySnapshot(snapshot.id);
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
                actions.onStopSnapshot?.(snapshot.id);
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
              class={`sequencer-events-grid sequencer-events-grid--pane-${rows.eventPane}`}
              role="table"
              aria-label={`snapshot ${index + 1} events`}
            >
              <EventsGridHeader eventPane={rows.eventPane} onTogglePane={rows.setEventPane} />
              <div class="sequencer-events-grid__body">
                {snapshotEvents.map((event) => (
                  event.type === "bar" || event.type === "tempo" || event.type === "barline" || event.type === "repeat-start" || event.type === "repeat-end"
                    ? (
                      <div
                        key={event.type === "barline" ? event.eventId : structuralEventInstanceKey(event)}
                        ref={(node) => {
                          const structuralKey = structuralEventRenderKey(event);
                          if (event.type === "bar") {
                            if (node) structure.barRowRefs.current.set(event.barId ?? event.id, node);
                            else structure.barRowRefs.current.delete(event.barId ?? event.id);
                          }
                          if (structuralKey != null) {
                            if (node) structure.barRowRefs.current.set(structuralKey, node);
                            else structure.barRowRefs.current.delete(structuralKey);
                          }
                        }}
                        class="sequencer-item sequencer-item--bar"
                      >
                        {event.type === "bar" ? (
                          <BarRow bar={event} barNumberById={structure.barNumberById} dnd={rows.barRowDnd} editing={rows.barRowEditing} />
                        ) : event.type === "repeat-start" || event.type === "repeat-end" ? (
                          <RepeatRow repeat={event} timing={rows.repeatRowTiming} editing={rows.repeatRowEditing} />
                        ) : event.type === "barline" ? (
                          <BarlineRow />
                        ) : (
                          <TempoRow tempo={event} timing={rows.tempoRowTiming} editing={rows.tempoRowEditing} />
                        )}
                      </div>
                    )
                    : (
                      <EventRow
                        snapshot={snapshot}
                        snapshotIndex={index}
                        event={event}
                        view={rows.eventRowView}
                        drafts={rows.eventRowDrafts}
                        drag={rows.eventRowDrag}
                        editing={rows.eventRowEditing}
                        transport={rows.eventRowTransport}
                      />
                    )
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {(structure.structuralMarkersByDisplayBucket.get(index) ?? [])
        .filter((marker) => !isExpanded || !snapshotStructuralKeys.has(structuralEventRenderKey(marker)))
        .map((marker) => (
          <div
            key={structuralEventInstanceKey(marker)}
            ref={(node) => {
              const structuralKey = structuralEventRenderKey(marker);
              if (marker.structuralType === "bar") {
                if (node) structure.barRowRefs.current.set(marker.id, node);
                else structure.barRowRefs.current.delete(marker.id);
              }
              if (structuralKey != null) {
                if (node) structure.barRowRefs.current.set(structuralKey, node);
                else structure.barRowRefs.current.delete(structuralKey);
              }
            }}
            class="sequencer-item sequencer-item--bar"
          >
            {marker.structuralType === "bar" ? (
              <BarRow bar={marker} barNumberById={structure.barNumberById} dnd={rows.barRowDnd} editing={rows.barRowEditing} />
            ) : marker.structuralType === "repeat-start" || marker.structuralType === "repeat-end" ? (
              <RepeatRow repeat={marker} timing={rows.repeatRowTiming} editing={rows.repeatRowEditing} />
            ) : (
              <TempoRow tempo={marker} timing={rows.tempoRowTiming} editing={rows.tempoRowEditing} />
            )}
          </div>
        ))}
    </Fragment>
  );
};

export default SnapshotSequenceItem;
