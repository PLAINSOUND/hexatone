// TempoRow renders one immediate or gradual tempo marker row.
// It handles the local editor behavior for tempo position, beat unit, bpm, and
// gradual-change hints, while the sequencer controllers own the mutations.

import { absolutePositionToBarBeat } from "./transport.js";
import { readNumericInput } from "./value-runtime.js";
import {
  buildBlurCommit,
  buildDraftEnterCommit,
  buildEnterCommit,
  buildSelectOnFocus,
} from "./field-props.js";

const TempoRow = ({
  tempo,
  timing,
  editing,
}) => {
  const tempoId = tempo.tempoId ?? tempo.id;
  const tempoPosition = Number(tempo.position ?? tempo.absoluteTime);
  const barBeat = timing.barBeatByEventId?.get(tempo.eventId) ?? absolutePositionToBarBeat(
    tempoPosition,
    timing.sortedBars,
    null,
    9,
    timing.terminalBarlinePosition,
  );
  const sequenceTime = tempoPosition.toFixed(6);
  const isAlwaysOnTempo = Math.abs(tempoPosition - 1) < 1e-9;
  const isGradualTempo = tempo.mode === "gradual";
  const tempoLabel = isGradualTempo ? "target:" : "tempo:";
  const transitionCue = timing.tempoTransitionCueMap?.get(tempoId) ?? null;
  const beatNumerator = String(tempo.beatNumerator ?? 1);
  const beatDenominator = String(tempo.beatDenominator ?? 4);
  const draftKey = timing.tempoBarRelativeDraftKey(tempoId);
  const tempoBarRelativeDraft = timing.tempoBarRelativeDrafts[draftKey] ?? null;
  const isTempoBarRelativeDraftActive = tempoBarRelativeDraft != null;
  const tempoBeatValue = tempoBarRelativeDraft?.beat ?? String(barBeat?.beat ?? 1);
  const tempoNumValue = tempoBarRelativeDraft?.numerator ?? String(barBeat?.numerator ?? 0);
  const tempoDenValue = tempoBarRelativeDraft?.denominator ?? String(barBeat?.denominator ?? 1);
  const commitTempoBeatFraction = (event) => {
    const row = event.currentTarget.closest(".sequencer-tempo-row");
    editing.updateTempoBeatFraction(
      tempoId,
      readNumericInput(row, ".sequencer-tempo-row__summary-input--fraction-num", 1),
      readNumericInput(row, ".sequencer-tempo-row__summary-input--fraction-den", 4),
    );
  };

  return (
    <div
      key={`tempo:${tempoId}`}
      class={`sequencer-tempo-row${isTempoBarRelativeDraftActive ? " sequencer-tempo-row--bar-relative-draft" : ""}${isGradualTempo ? " sequencer-tempo-row--gradual" : " sequencer-tempo-row--immediate"}`}
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
              editing.onDeleteTempo?.(tempoId);
            }}
          >
            <span class="sequencer-gutter__delete-glyph" aria-hidden="true">×</span>
          </button>
        ) : null}
      </div>
      <div class="sequencer-tempo-row__gutter-spacer" aria-hidden="true" />
      <div class="sequencer-tempo-row__summary sequencer-grid-offset">
        {isAlwaysOnTempo ? (
          <span
            class="sequencer-tempo-row__label"
            title="The opening tempo is always immediate"
          >
            {tempoLabel}
          </span>
        ) : (
          <button
            type="button"
            class="sequencer-tempo-row__label sequencer-tempo-row__mode-toggle"
            aria-label={`tempo mode ${isGradualTempo ? "gradual" : "immediate"}; change to ${isGradualTempo ? "immediate" : "gradual"}`}
            aria-pressed={isGradualTempo}
            title={`Change to ${isGradualTempo ? "immediate" : "gradual"} tempo`}
            onClick={(event) => {
              event.stopPropagation();
              editing.updateTempoMode(
                tempoId,
                isGradualTempo ? "immediate" : "gradual",
              );
            }}
          >
            {tempoLabel}
          </button>
        )}
        <input
          type="number"
          step="1"
          min="1"
          class="sequencer-event__input sequencer-event__input--stepper sequencer-tempo-row__summary-input sequencer-tempo-row__summary-input--fraction-num"
          defaultValue={beatNumerator}
          aria-label="tempo beat numerator"
          onFocus={buildSelectOnFocus({ clearCommitted: true })}
          onKeyDown={(e) => editing.handleEnterCommit(e, () => commitTempoBeatFraction(e))}
          onBlur={(e) => editing.handleBlurCommit(e, () => commitTempoBeatFraction(e))}
        />
        <span class="sequencer-tempo-row__summary-sep" aria-hidden="true">/</span>
        <input
          type="number"
          step="1"
          min="1"
          class="sequencer-event__input sequencer-event__input--stepper sequencer-tempo-row__summary-input sequencer-tempo-row__summary-input--fraction-den"
          defaultValue={beatDenominator}
          aria-label="tempo beat denominator"
          onFocus={buildSelectOnFocus({ clearCommitted: true })}
          onKeyDown={(e) => editing.handleEnterCommit(e, () => commitTempoBeatFraction(e))}
          onBlur={(e) => editing.handleBlurCommit(e, () => commitTempoBeatFraction(e))}
        />
        <span class="sequencer-tempo-row__summary-sep" aria-hidden="true">=</span>
        <input
          type="number"
          step="1"
          min="1"
          class="sequencer-event__input sequencer-event__input--stepper sequencer-tempo-row__summary-input sequencer-tempo-row__summary-input--bpm"
          defaultValue={String(tempo.bpm ?? 60)}
          aria-label="tempo bpm"
          onFocus={buildSelectOnFocus({ clearCommitted: true })}
          onKeyDown={buildEnterCommit(editing, (value) => editing.updateTempoBpm(tempoId, value))}
          onBlur={buildBlurCommit(editing, (value) => editing.updateTempoBpm(tempoId, value))}
        />
        <span class="sequencer-tempo-row__summary-unit">bpm</span>
      </div>
      {transitionCue ? (
        <div class="sequencer-tempo-row__transition-cue sequencer-grid-offset">
          {transitionCue.text}
        </div>
      ) : null}
      <div class="sequencer-event__cell sequencer-bar-row__position-cell sequencer-tempo-row__position-cell">
        <input
          type="text"
          class="sequencer-event__input sequencer-event__position"
          defaultValue={sequenceTime}
          aria-label="tempo position"
          onFocus={buildSelectOnFocus({ clearCommitted: true })}
          onKeyDown={buildEnterCommit(editing, (value) => editing.updateTempoPosition(tempoId, value))}
          onBlur={buildBlurCommit(editing, (value) => editing.updateTempoPosition(tempoId, value))}
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
          onFocus={buildSelectOnFocus({ clearCommitted: true })}
          onInput={(e) => editing.updateTempoBarRelativeDraftField(draftKey, barBeat, "bar", e.currentTarget.value, { tempoId })}
          onKeyDown={buildDraftEnterCommit(() => editing.commitTempoBarRelativeDraft(tempoId, draftKey))}
        />
      </div>
      <div class="sequencer-event__cell sequencer-tempo-row__time-cell sequencer-tempo-row__beat-cell sequencer-grid-offset">
        <input
          type="number"
          step="1"
          min="1"
          class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__beat${isTempoBarRelativeDraftActive ? " sequencer-event__input--draft" : ""}`}
          value={tempoBeatValue}
          aria-label="tempo beat"
          onFocus={buildSelectOnFocus({ clearCommitted: true })}
          onInput={(e) => editing.updateTempoBarRelativeDraftField(draftKey, barBeat, "beat", e.currentTarget.value, { tempoId })}
          onKeyDown={buildDraftEnterCommit(() => editing.commitTempoBarRelativeDraft(tempoId, draftKey))}
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
          onFocus={buildSelectOnFocus({ clearCommitted: true })}
          onInput={(e) => editing.updateTempoBarRelativeDraftField(draftKey, barBeat, "num", e.currentTarget.value, { tempoId })}
          onKeyDown={buildDraftEnterCommit(() => editing.commitTempoBarRelativeDraft(tempoId, draftKey))}
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
          onFocus={buildSelectOnFocus({ clearCommitted: true })}
          onInput={(e) => editing.updateTempoBarRelativeDraftField(draftKey, barBeat, "den", e.currentTarget.value, { tempoId })}
          onKeyDown={buildDraftEnterCommit(() => editing.commitTempoBarRelativeDraft(tempoId, draftKey))}
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
                editing.commitTempoBarRelativeDraft(tempoId, draftKey);
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
                editing.cancelTempoBarRelativeDraft(draftKey);
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

export default TempoRow;
