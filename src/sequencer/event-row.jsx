import {
  absolutePositionToBarBeat,
} from "./transport.js";
import {
  buildBlurCommit,
  buildDraftEnterCommit,
  buildEnterCommit,
  buildSelectOnFocus,
  buildStopPropagationProps,
} from "./field-props.js";
import {
  displayValue,
  formatDisplaySequenceOffset,
  formatEditableFrequency,
  formatEditableMidicents,
  formatFrequency,
  formatMidicents,
  formatSequenceOffset,
  formatSequenceTime,
  isOutOfSnapshotRange,
  soundingOnTextStyle,
} from "./value-runtime.js";

const renderCueTransport = ({
  cueIndex,
  playingSnapshotId,
  onPlayCue,
  onStopSnapshot,
  runTransportAction,
}) => (
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

const renderCueMarker = ({
  snapshot,
  event,
  sequenceTime,
  firstSnapshotCueEventIds,
}) => {
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

  const isCourtesyStart = firstSnapshotCueEventIds.get(`${snapshot.id}:${event.cueIndex}`) === event.eventId;
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

const EventRow = ({
  snapshot,
  snapshotIndex,
  event,
  keySuffix = "row",
  view,
  drafts,
  drag,
  editing,
  transport,
}) => {
  const stopProps = buildStopPropagationProps();
  const sourceSnapshot = view.findSnapshotById(snapshot.id) ?? snapshot;
  const isMarkerSelected =
    view.selectedMarker?.snapshotId === snapshot.id &&
    view.selectedMarker?.time === event.relativeTime;
  const isCueActive = view.activeNavigationMode === "cue" && view.activeCueIndex === event.cueIndex;
  const isSnapshotActive = view.activeNavigationMode === "snapshot" && view.activeSnapshotId === snapshot.id;
  const isSoundingAttack = view.sequencePlaybackActive && event.kind === "attack" && (
    view.soundingAttackEventIds.has(event.eventId) ||
    isCueActive ||
    isSnapshotActive
  );
  const sequenceTime = formatSequenceTime(
    view.snapshotIndexById.get(snapshot.id) ?? snapshotIndex + 1,
    event.relativeTime,
  );
  const eventSnapshotNumber = view.snapshotIndexById.get(snapshot.id) ?? snapshotIndex + 1;
  const barBeat = absolutePositionToBarBeat(
    event.absoluteTime,
    drafts.sortedBars,
    event.fractionDenominator,
    9,
    drafts.terminalBarlinePosition,
    event.kind === "release",
  );
  const draftKey = drafts.eventBarRelativeDraftKey(snapshot.id, event.eventId, event.kind);
  const barRelativeDraft = drafts.barRelativeDrafts[draftKey] ?? null;
  const eventSequenceKey = drafts.eventSequenceDraftKey(snapshot.id, event.eventId, event.kind);
  const eventSequenceDraft = drafts.eventSequenceDrafts[eventSequenceKey] ?? null;
  const isEventSequenceDraftActive = eventSequenceDraft != null;
  const isBarRelativeDraftActive = view.currentEventPane === "timing" && barRelativeDraft != null;
  const isStoppedBar = drafts.stoppedBarStateForBarNumber(barRelativeDraft?.barNumber ?? barBeat?.barNumber ?? 1);
  const beatValue = isStoppedBar ? "0" : (barRelativeDraft?.beat ?? String(barBeat?.beat ?? 1));
  const numeratorValue = isStoppedBar ? "0" : (barRelativeDraft?.numerator ?? String(barBeat?.numerator ?? 0));
  const denominatorValue = isStoppedBar ? "1" : (barRelativeDraft?.denominator ?? String(barBeat?.denominator ?? 1));

  return (
    <div
        key={`${event.eventId}:${keySuffix}`}
      ref={(node) => {
        if (node) drag.eventRowRefs.current.set(event.eventId, node);
        else drag.eventRowRefs.current.delete(event.eventId);
      }}
      class={`sequencer-event-row sequencer-event-row--${event.kind}${isMarkerSelected ? " sequencer-group--selected" : ""}${isCueActive ? " sequencer-event-row--cue-active" : ""}${isSnapshotActive ? " sequencer-event-row--snapshot-active" : ""}${isBarRelativeDraftActive ? " sequencer-event-row--bar-relative-draft" : ""}${isEventSequenceDraftActive ? " sequencer-event-row--sequence-draft" : ""}${drag.draggedEventId === event.eventId ? " sequencer-event-row--dragging" : ""}`}
      data-bar-relative-draft-scope={`event:${draftKey}`}
      data-event-sequence-draft-scope={`event-sequence:${eventSequenceKey}`}
      onClick={() => {
        editing.onSelectMarker(snapshot.id, event.relativeTime);
      }}
      onDragOver={(e) => {
        if (drag.barDragIdRef.current == null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        if (drag.barDragIdRef.current == null) return;
        e.preventDefault();
        drag.onMoveBar?.(drag.barDragIdRef.current, event.absoluteTime);
        drag.setDraggedBarId(null);
        drag.barDragIdRef.current = null;
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
              editing.deleteEventNote(snapshot.id, event.noteKey);
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
          drag.eventDragRef.current = {
            snapshotId: snapshot.id,
            noteKey: event.noteKey,
            kind: event.kind,
            eventId: event.eventId,
          };
          drag.setDraggedEventId(event.eventId);
          e.dataTransfer.effectAllowed = "copyMove";
        }}
        onDragEnd={() => {
          drag.eventDragRef.current = null;
          drag.setDraggedEventId(null);
          drag.setDragOverId(null);
        }}
      >
        {renderCueMarker({
          snapshot,
          event,
          sequenceTime,
          firstSnapshotCueEventIds: view.firstSnapshotCueEventIds,
        })}
      </div>
      <div class="sequencer-event__cell">
        <input
          type="number"
          step="1"
          min="1"
          max={String(view.snapshotIndexById.size)}
          class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__snapshot-number${isEventSequenceDraftActive ? " sequencer-event__input--draft" : ""}`}
          value={eventSequenceDraft?.snapshotNumber ?? String(eventSnapshotNumber)}
          aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} snapshot`}
          {...stopProps}
          onFocus={buildSelectOnFocus({ stop: true })}
          onInput={(e) => editing.updateEventSequenceDraftField(eventSequenceKey, "snapshotNumber", e.currentTarget.value, {
            snapshotId: snapshot.id,
            noteKey: event.noteKey,
            kind: event.kind,
            snapshotNumber: eventSnapshotNumber,
            relativeTime: event.relativeTime,
          })}
          onKeyDown={buildDraftEnterCommit(() => editing.applyEventSequenceDraft(drafts.eventSequenceDrafts[eventSequenceKey]))}
        />
      </div>
      <div class="sequencer-event__cell sequencer-grid-offset">
        <input
          key={`${event.eventId}-offset-${eventSequenceDraft?.offset ?? event.relativeTime}`}
          type="text"
          class={`sequencer-event__input sequencer-event__position${isOutOfSnapshotRange(snapshot, event.relativeTime) ? " sequencer-event__position--out-of-range" : ""}${isEventSequenceDraftActive ? " sequencer-event__input--draft" : ""}`}
          defaultValue={formatDisplaySequenceOffset(eventSequenceDraft?.offset ?? event.relativeTime)}
          aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} offset`}
          {...stopProps}
          onFocus={buildSelectOnFocus({
            stop: true,
            setValue: () => formatSequenceOffset(eventSequenceDraft?.offset ?? event.relativeTime),
          })}
          onInput={(e) => editing.updateEventSequenceDraftField(eventSequenceKey, "offset", e.currentTarget.value, {
            snapshotId: snapshot.id,
            noteKey: event.noteKey,
            kind: event.kind,
            snapshotNumber: eventSnapshotNumber,
            relativeTime: event.relativeTime,
          })}
          onKeyDown={buildDraftEnterCommit(() => editing.applyEventSequenceDraft(drafts.eventSequenceDrafts[eventSequenceKey]))}
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
          {...stopProps}
          onFocus={buildSelectOnFocus({
            stop: true,
            clearCommitted: true,
            setValue: () => formatEditableMidicents(event.midicents),
          })}
          disabled={editing.snapSequenceToCurrentTuning}
          onKeyDown={buildEnterCommit(editing, (value) => editing.updateEventField(sourceSnapshot, event.noteKey, "midicents", value))}
          onBlur={buildBlurCommit(
            editing,
            (value) => editing.updateEventField(sourceSnapshot, event.noteKey, "midicents", value),
            (eventArg) => {
              const next = Number(eventArg.currentTarget.value);
              eventArg.currentTarget.value = Number.isFinite(next)
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
          {...stopProps}
          onFocus={buildSelectOnFocus({
            stop: true,
            clearCommitted: true,
            setValue: () => formatEditableFrequency(event.frequency),
          })}
          disabled={editing.snapSequenceToCurrentTuning}
          onKeyDown={buildEnterCommit(editing, (value) => editing.updateEventField(sourceSnapshot, event.noteKey, "frequency", value))}
          onBlur={buildBlurCommit(
            editing,
            (value) => editing.updateEventField(sourceSnapshot, event.noteKey, "frequency", value),
            (eventArg) => {
              const next = Number(eventArg.currentTarget.value);
              eventArg.currentTarget.value = Number.isFinite(next)
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
                  editing.restoreEventPitchLabel(sourceSnapshot, event.noteKey);
                }}
            >
              <span class="preset-refresh-glyph" aria-hidden="true">⟳</span>
            </button>
          ) : null}
        </span>
      </div>
      {view.currentEventPane === "timing" ? (
        <>
          <div key={`${event.eventId}-timing-bar`} class="sequencer-event__cell sequencer-grid-offset">
            <input
              type="number"
              step="1"
              min="1"
              class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__bar${isBarRelativeDraftActive ? " sequencer-event__input--draft" : ""}`}
              value={barRelativeDraft?.barNumber ?? String(barBeat?.barNumber ?? 1)}
              aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} bar`}
              {...stopProps}
              onFocus={buildSelectOnFocus({ stop: true })}
              onInput={(e) => editing.updateEventBarRelativeDraftField(draftKey, barBeat, "bar", e.currentTarget.value, {
                snapshotId: snapshot.id,
                noteKey: event.noteKey,
                kind: event.kind,
              })}
              onKeyDown={buildDraftEnterCommit(() => editing.commitEventBarRelativeDraft(snapshot, event.noteKey, event.kind, draftKey))}
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
              {...stopProps}
              onFocus={buildSelectOnFocus({ stop: true })}
              onInput={(e) => editing.updateEventBarRelativeDraftField(draftKey, barBeat, "beat", e.currentTarget.value, {
                snapshotId: snapshot.id,
                noteKey: event.noteKey,
                kind: event.kind,
              })}
              onKeyDown={buildDraftEnterCommit(() => editing.commitEventBarRelativeDraft(snapshot, event.noteKey, event.kind, draftKey))}
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
              {...stopProps}
              onFocus={buildSelectOnFocus({ stop: true })}
              onInput={(e) => editing.updateEventBarRelativeDraftField(draftKey, barBeat, "numerator", e.currentTarget.value, {
                snapshotId: snapshot.id,
                noteKey: event.noteKey,
                kind: event.kind,
              })}
              onKeyDown={buildDraftEnterCommit(() => editing.commitEventBarRelativeDraft(snapshot, event.noteKey, event.kind, draftKey))}
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
              {...stopProps}
              onFocus={buildSelectOnFocus({ stop: true })}
              onInput={(e) => editing.updateEventBarRelativeDraftField(draftKey, barBeat, "denominator", e.currentTarget.value, {
                snapshotId: snapshot.id,
                noteKey: event.noteKey,
                kind: event.kind,
              })}
              onKeyDown={buildDraftEnterCommit(() => editing.commitEventBarRelativeDraft(snapshot, event.noteKey, event.kind, draftKey))}
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
              {...stopProps}
              onFocus={buildSelectOnFocus({ stop: true, clearCommitted: true })}
              onKeyDown={buildEnterCommit(editing, (value) => editing.updateEventField(snapshot, event.noteKey, "attackVelocity", value))}
              onBlur={buildBlurCommit(editing, (value) => editing.updateEventField(snapshot, event.noteKey, "attackVelocity", value))}
            />
          </div>
          <div key={`${event.eventId}-expression-offvel`} class="sequencer-event__cell sequencer-grid-offset">
            <input
              type="text"
              class="sequencer-event__input"
              defaultValue={displayValue(event.releaseVelocity)}
              aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} off velocity`}
              {...stopProps}
              onFocus={buildSelectOnFocus({ stop: true, clearCommitted: true })}
              onKeyDown={buildEnterCommit(editing, (value) => editing.updateEventField(snapshot, event.noteKey, "releaseVelocity", value))}
              onBlur={buildBlurCommit(editing, (value) => editing.updateEventField(snapshot, event.noteKey, "releaseVelocity", value))}
            />
          </div>
          <div key={`${event.eventId}-expression-pressure`} class="sequencer-event__cell sequencer-grid-offset">
            <input
              type="text"
              class="sequencer-event__input"
              defaultValue={displayValue(event.pressure)}
              aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} pressure`}
              {...stopProps}
              onFocus={buildSelectOnFocus({ stop: true, clearCommitted: true })}
              onKeyDown={buildEnterCommit(editing, (value) => editing.updateEventField(snapshot, event.noteKey, "pressure", value))}
              onBlur={buildBlurCommit(editing, (value) => editing.updateEventField(snapshot, event.noteKey, "pressure", value))}
            />
          </div>
          <div key={`${event.eventId}-expression-timbre`} class="sequencer-event__cell sequencer-grid-offset">
            <input
              type="text"
              class="sequencer-event__input"
              defaultValue={displayValue(event.timbre)}
              aria-label={`snapshot ${snapshotIndex + 1} ${event.kind} timbre`}
              {...stopProps}
              onFocus={buildSelectOnFocus({ stop: true, clearCommitted: true })}
              onKeyDown={buildEnterCommit(editing, (value) => editing.updateEventField(snapshot, event.noteKey, "timbre", value))}
              onBlur={buildBlurCommit(editing, (value) => editing.updateEventField(snapshot, event.noteKey, "timbre", value))}
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
                editing.applyEventSequenceDraft(drafts.eventSequenceDrafts[eventSequenceKey]);
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
                editing.cancelEventSequenceDraft(eventSequenceKey);
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
                editing.commitEventBarRelativeDraft(snapshot, event.noteKey, event.kind, draftKey);
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
                editing.cancelEventBarRelativeDraft(draftKey);
              }}
            >
              ×
            </button>
          </span>
        ) : ((event.cueDisplayLead || (
          view.firstSnapshotCueEventIds.get(`${snapshot.id}:${event.cueIndex}`) === event.eventId
        )) ? renderCueTransport({
          cueIndex: event.cueIndex,
          playingSnapshotId: transport.playingSnapshotId,
          onPlayCue: transport.onPlayCue,
          onStopSnapshot: transport.onStopSnapshot,
          runTransportAction: transport.runTransportAction,
        }) : null)}
      </div>
    </div>
  );
};

export default EventRow;
