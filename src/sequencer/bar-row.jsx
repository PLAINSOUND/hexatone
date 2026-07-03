import {
  buildBlurCommit,
  buildEnterCommit,
  buildSelectOnFocus,
} from "./field-props.js";

const BarRow = ({
  bar,
  barNumberById,
  dnd,
  editing,
}) => {
  const barId = bar.barId ?? bar.id;
  const barNumber = barNumberById.get(barId) ?? 1;
  const barPosition = Number(bar.position ?? bar.absoluteTime);
  const sequenceTime = String(Math.max(1, Math.round(barPosition)));
  const isDraggable = true;
  const isAlwaysOnBar = barNumber === 1 && Math.abs(barPosition - 1) < 1e-9;
  const rowKey = `bar:${barId}:${sequenceTime}:${bar.numerator ?? 4}:${bar.denominator ?? 4}`;

  return (
    <div
      key={rowKey}
      class="sequencer-bar-row"
      onDragOver={(e) => {
        if (dnd.barDragIdRef.current == null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        if (dnd.barDragIdRef.current == null) return;
        e.preventDefault();
        dnd.onMoveBar?.(dnd.barDragIdRef.current, Number(bar.position));
        dnd.setDraggedBarId(null);
        dnd.barDragIdRef.current = null;
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
              editing.onDeleteBar?.(barId);
            }}
          >
            <span class="sequencer-gutter__delete-glyph" aria-hidden="true">×</span>
          </button>
        ) : null}
      </div>
      <span
        class={`sequencer-bar-gutter${dnd.draggedBarId === (bar.barId ?? bar.id) ? " sequencer-bar-gutter--dragging" : ""}`}
        draggable={isDraggable}
        title={`Drag bar ${barNumber}`}
        onDragStart={(e) => {
          dnd.barDragIdRef.current = barId;
          dnd.setDraggedBarId(barId);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => {
          dnd.setDraggedBarId(null);
          dnd.barDragIdRef.current = null;
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
          onFocus={buildSelectOnFocus({ clearCommitted: true })}
          onKeyDown={buildEnterCommit(editing, (value) => editing.updateBarPosition(barId, value))}
          onBlur={buildBlurCommit(editing, (value) => editing.updateBarPosition(barId, value))}
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
            onInput={(e) => editing.updateBarTimeSignatureField(barId, "numerator", e.currentTarget.value)}
            onFocus={buildSelectOnFocus({ clearCommitted: true })}
            onKeyDown={buildEnterCommit(editing, (value) => editing.updateBarTimeSignatureField(barId, "numerator", value))}
            onBlur={buildBlurCommit(editing, (value) => editing.updateBarTimeSignatureField(barId, "numerator", value))}
          />
          <input
            type="number"
            step="1"
            min="1"
            class="sequencer-event__input sequencer-event__input--stepper sequencer-bar-row__signature-input"
            defaultValue={String(bar.denominator ?? 4)}
            aria-label={`bar ${barNumber} beat unit`}
            onInput={(e) => editing.updateBarTimeSignatureField(barId, "denominator", e.currentTarget.value)}
            onFocus={buildSelectOnFocus({ clearCommitted: true })}
            onKeyDown={buildEnterCommit(editing, (value) => editing.updateBarTimeSignatureField(barId, "denominator", value))}
            onBlur={buildBlurCommit(editing, (value) => editing.updateBarTimeSignatureField(barId, "denominator", value))}
          />
        </div>
      </div>
      <div class="sequencer-bar-row__tail" aria-hidden="true" />
    </div>
  );
};

export default BarRow;
