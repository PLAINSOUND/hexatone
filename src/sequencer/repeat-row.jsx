import { useEffect, useState } from "preact/hooks";

import { absolutePositionToBarBeat } from "./transport.js";
import {
  buildBlurCommit,
  buildDraftEnterCommit,
  buildEnterCommit,
  buildSelectOnFocus,
} from "./field-props.js";

const RepeatRow = ({
  repeat,
  timing,
  editing,
}) => {
  const repeatId = repeat.repeatId ?? repeat.id;
  const repeatPosition = Number(repeat.position ?? repeat.absoluteTime);
  const barBeat = absolutePositionToBarBeat(
    repeatPosition,
    timing.sortedBars,
    null,
    9,
    timing.terminalBarlinePosition,
  );
  const sequenceTime = repeatPosition.toFixed(6);
  const draftKey = timing.repeatBarRelativeDraftKey(repeatId);
  const repeatBarRelativeDraft = timing.repeatBarRelativeDrafts[draftKey] ?? null;
  const isRepeatBarRelativeDraftActive = repeatBarRelativeDraft != null;
  const isRepeatStoppedBar = timing.stoppedBarStateForBarNumber(repeatBarRelativeDraft?.barNumber ?? barBeat?.barNumber ?? 1);
  const repeatBeatValue = isRepeatStoppedBar ? "0" : (repeatBarRelativeDraft?.beat ?? String(barBeat?.beat ?? 1));
  const repeatNumValue = isRepeatStoppedBar ? "0" : (repeatBarRelativeDraft?.numerator ?? String(barBeat?.numerator ?? 0));
  const repeatDenValue = isRepeatStoppedBar ? "1" : (repeatBarRelativeDraft?.denominator ?? String(barBeat?.denominator ?? 1));
  const isStart = (repeat.kind ?? repeat.structuralType) !== "end" && repeat.type !== "repeat-end";
  const repeatCount = Math.max(2, Math.round(Number(repeat.repeatCount) || 2));
  const [repeatCountDraft, setRepeatCountDraft] = useState(String(repeatCount));

  useEffect(() => {
    setRepeatCountDraft(String(repeatCount));
  }, [repeatCount]);

  const parsedRepeatCountDraft = Math.max(2, Math.round(Number(repeatCountDraft) || 2));
  const isRepeatCountHint = parsedRepeatCountDraft === 2;

  const commitRepeatCount = (value) => {
    const normalizedValue = String(Math.max(2, Math.round(Number(value) || 2)));
    setRepeatCountDraft(normalizedValue);
    editing.updateRepeatCount(repeatId, normalizedValue);
  };

  return (
    <div
      key={`repeat:${repeatId}`}
      class={`sequencer-repeat-row ${isStart ? "sequencer-repeat-row--start" : "sequencer-repeat-row--end"}${isRepeatBarRelativeDraftActive ? " sequencer-repeat-row--bar-relative-draft" : ""}`}
      data-bar-relative-draft-scope={`repeat:${draftKey}`}
    >
      <div class="sequencer-tempo-row__line" aria-hidden="true" />
      <div class="sequencer-repeat-row__line-thick" aria-hidden="true" />
      <div class="sequencer-row__delete-cell">
        <button
          type="button"
          class="sequencer-gutter__delete"
          aria-label="delete repeat marker"
          title="Delete repeat marker"
          onClick={(e) => {
            e.stopPropagation();
            editing.onDeleteRepeat?.(repeatId);
          }}
        >
          <span class="sequencer-gutter__delete-glyph" aria-hidden="true">×</span>
        </button>
      </div>
      <div class="sequencer-tempo-row__gutter-spacer" aria-hidden="true" />
      <div class={`sequencer-repeat-row__summary${isStart ? " sequencer-repeat-row__summary--start" : " sequencer-repeat-row__summary--end"}`} aria-hidden="true">
        <span class="sequencer-repeat-row__dots">
          <span class="sequencer-repeat-row__dot" />
          <span class="sequencer-repeat-row__dot" />
        </span>
      </div>
      <div class="sequencer-event__cell sequencer-bar-row__position-cell sequencer-tempo-row__position-cell">
        <input
          type="text"
          class="sequencer-event__input sequencer-event__position"
          defaultValue={sequenceTime}
          aria-label="repeat position"
          onFocus={buildSelectOnFocus({ clearCommitted: true })}
          onKeyDown={buildEnterCommit(editing, (value) => editing.updateRepeatPosition(repeatId, value))}
          onBlur={buildBlurCommit(editing, (value) => editing.updateRepeatPosition(repeatId, value))}
        />
      </div>
      <div class="sequencer-event__cell sequencer-tempo-row__time-cell sequencer-tempo-row__bar-cell sequencer-grid-offset">
        <input
          type="number"
          step="1"
          min="1"
          class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__bar${isRepeatBarRelativeDraftActive ? " sequencer-event__input--draft" : ""}`}
          value={repeatBarRelativeDraft?.barNumber ?? String(barBeat?.barNumber ?? 1)}
          aria-label="repeat bar"
          onFocus={buildSelectOnFocus({ clearCommitted: true })}
          onInput={(e) => editing.updateRepeatBarRelativeDraftField(draftKey, barBeat, "bar", e.currentTarget.value, { repeatId })}
          onKeyDown={buildDraftEnterCommit(() => editing.commitRepeatBarRelativeDraft(repeatId, draftKey))}
        />
      </div>
      <div class="sequencer-event__cell sequencer-tempo-row__time-cell sequencer-tempo-row__beat-cell sequencer-grid-offset">
        <input
          type="number"
          step="1"
          min={isRepeatStoppedBar ? "0" : "1"}
          class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__beat${isRepeatBarRelativeDraftActive ? " sequencer-event__input--draft" : ""}`}
          value={repeatBeatValue}
          aria-label="repeat beat"
          disabled={isRepeatStoppedBar}
          onFocus={buildSelectOnFocus({ clearCommitted: true })}
          onInput={(e) => editing.updateRepeatBarRelativeDraftField(draftKey, barBeat, "beat", e.currentTarget.value, { repeatId })}
          onKeyDown={buildDraftEnterCommit(() => editing.commitRepeatBarRelativeDraft(repeatId, draftKey))}
        />
      </div>
      <div class="sequencer-event__cell sequencer-tempo-row__time-cell sequencer-tempo-row__num-cell sequencer-grid-offset">
        <input
          type="number"
          step="1"
          min="0"
          class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__fraction-num${isRepeatBarRelativeDraftActive ? " sequencer-event__input--draft" : ""}`}
          value={repeatNumValue}
          aria-label="repeat beat fraction numerator"
          disabled={isRepeatStoppedBar}
          onFocus={buildSelectOnFocus({ clearCommitted: true })}
          onInput={(e) => editing.updateRepeatBarRelativeDraftField(draftKey, barBeat, "num", e.currentTarget.value, { repeatId })}
          onKeyDown={buildDraftEnterCommit(() => editing.commitRepeatBarRelativeDraft(repeatId, draftKey))}
        />
      </div>
      <div class="sequencer-event__cell sequencer-tempo-row__time-cell sequencer-tempo-row__den-cell sequencer-grid-offset">
        <input
          type="number"
          step="1"
          min="1"
          class={`sequencer-event__input sequencer-event__input--stepper sequencer-event__fraction-den${isRepeatBarRelativeDraftActive ? " sequencer-event__input--draft" : ""}`}
          value={repeatDenValue}
          aria-label="repeat beat fraction denominator"
          disabled={isRepeatStoppedBar}
          onFocus={buildSelectOnFocus({ clearCommitted: true })}
          onInput={(e) => editing.updateRepeatBarRelativeDraftField(draftKey, barBeat, "den", e.currentTarget.value, { repeatId })}
          onKeyDown={buildDraftEnterCommit(() => editing.commitRepeatBarRelativeDraft(repeatId, draftKey))}
        />
      </div>
      <div class="sequencer-repeat-row__tail">
        {!isStart ? (
          <span class="sequencer-repeat-row__count">
            <input
              type="text"
              inputMode="numeric"
              class={`sequencer-event__input sequencer-repeat-row__count-input${isRepeatCountHint ? " sequencer-repeat-row__count-input--hint" : ""}`}
              value={repeatCountDraft}
              aria-label="repeat count"
              onFocus={buildSelectOnFocus({ clearCommitted: true })}
              onInput={(e) => setRepeatCountDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                e.stopPropagation();
                commitRepeatCount(e.currentTarget.value);
                e.currentTarget.blur();
              }}
              onBlur={(e) => {
                e.stopPropagation();
                commitRepeatCount(e.currentTarget.value);
              }}
            />
            <span class={`sequencer-repeat-row__count-suffix${isRepeatCountHint ? " sequencer-repeat-row__count-suffix--hint" : ""}`}>x</span>
          </span>
        ) : null}
        {isRepeatBarRelativeDraftActive ? (
          <span class="sequencer-event__draft-actions">
            <button
              type="button"
              class="sequencer-event__draft-btn"
              aria-label="commit repeat bar-relative timing"
              title="Commit timing edit"
              onClick={(e) => {
                e.stopPropagation();
                editing.commitRepeatBarRelativeDraft(repeatId, draftKey);
              }}
            >
              ✓
            </button>
            <button
              type="button"
              class="sequencer-event__draft-btn"
              aria-label="cancel repeat bar-relative timing"
              title="Cancel timing edit"
              onClick={(e) => {
                e.stopPropagation();
                editing.cancelRepeatBarRelativeDraft(draftKey);
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

export default RepeatRow;
