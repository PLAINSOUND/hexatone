// SequenceControls renders the transport and playback control strips.
// It owns the PLAY FROM, TIMED PLAYBACK, and SPEED/PITCH row UI, while the
// sequencer and timed-transport controllers own the actual playback state.

import { useEffect, useRef, useState } from "preact/hooks";
import { SNAPSHOT_LABEL_MODES } from "./labels.js";
import {
  formatSequencePlaybackPitchCents,
  formatSequencePlaybackPitchCourtesy,
  formatSequencePlaybackSpeed,
  normaliseSequencePlaybackPitchInput,
  parseSequencePlaybackPitchInput,
  parseSequencePlaybackSpeedInput,
} from "./playback-modifiers-runtime.js";

function speedToSliderExponent(value) {
  const speed = Math.min(2, Math.max(0.5, Number(value) || 1));
  return Math.log2(speed);
}

function sliderExponentToSpeed(value) {
  const exponent = Math.min(1, Math.max(-1, Number(value) || 0));
  return Math.pow(2, exponent);
}

function deriveStickyCenterValue(rawValue, {
  lockRef,
  engageThreshold = 0,
  releaseThreshold = engageThreshold,
  maxAbs = 1,
  outputMaxAbs = maxAbs,
} = {}) {
  const raw = Number(rawValue) || 0;
  const distance = Math.abs(raw);
  const sign = Math.sign(raw);
  const safeEngageThreshold = Math.max(0, Number(engageThreshold) || 0);
  const safeReleaseThreshold = Math.max(safeEngageThreshold, Number(releaseThreshold) || 0);
  const safeMaxAbs = Math.max(safeReleaseThreshold, Number(maxAbs) || 0);
  const safeOutputMaxAbs = Math.max(0, Number(outputMaxAbs) || 0);

  if (lockRef?.current) {
    if (distance <= safeReleaseThreshold) {
      return { sliderValue: 0, outputValue: 0, locked: true };
    }
    lockRef.current = false;
  }

  if (distance <= safeEngageThreshold) {
    if (lockRef) lockRef.current = true;
    return { sliderValue: 0, outputValue: 0, locked: true };
  }

  if (safeMaxAbs <= safeReleaseThreshold) {
    return {
      sliderValue: raw,
      outputValue: sign * Math.min(safeOutputMaxAbs, distance),
      locked: false,
    };
  }

  const normalized = Math.max(
    0,
    Math.min(1, (distance - safeReleaseThreshold) / (safeMaxAbs - safeReleaseThreshold)),
  );
  return {
    sliderValue: sign * normalized * safeMaxAbs,
    outputValue: sign * normalized * safeOutputMaxAbs,
    locked: false,
  };
}

function formatEffectiveTempoCourtesy(tempo) {
  const bpm = Number(tempo?.effectiveBpm ?? tempo?.bpm);
  if (!Number.isFinite(bpm) || bpm <= 0) return "";
  return `${bpm.toFixed(1)} bpm`;
}

function selectControlValue(event) {
  event.currentTarget.select?.();
}

function stopTimedTransportBefore(action, timedTransportDisplay, onTimedTransportStop) {
  if (timedTransportDisplay?.running || timedTransportDisplay?.paused) {
    onTimedTransportStop?.();
  }
  action?.();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function buildSliderText(value, formatValue) {
  return typeof formatValue === "function" ? formatValue(value) : String(value);
}

function StickyPlaybackSlider({
  ariaLabel,
  min,
  max,
  step,
  value,
  deadZone,
  releaseZone = deadZone,
  onInputValue,
  onCommitValue,
  formatAriaValue,
}) {
  const trackRef = useRef(null);
  const draggingRef = useRef(false);
  const lastDragValueRef = useRef(clamp(value, Number(min), Number(max)));
  const lockRef = useRef(Math.abs(Number(value) || 0) <= deadZone);
  const [isActive, setIsActive] = useState(false);
  const safeMin = Number(min);
  const safeMax = Number(max);
  const safeStep = Math.max(Number(step) || 0, 0);
  const safeDeadZone = Math.max(0, Number(deadZone) || 0);
  const safeReleaseZone = Math.max(safeDeadZone, Number(releaseZone) || 0);
  const clampedValue = clamp(value, safeMin, safeMax);

  useEffect(() => {
    if (!draggingRef.current) {
      lockRef.current = Math.abs(clampedValue) <= safeDeadZone;
    }
  }, [clampedValue, safeDeadZone]);

  const snapToStep = (nextValue) => {
    if (!safeStep) return nextValue;
    return Math.round(nextValue / safeStep) * safeStep;
  };

  const mapPointerValue = (rawValue) => {
    const { outputValue } = deriveStickyCenterValue(
      clamp(rawValue, safeMin, safeMax),
      {
        lockRef,
        engageThreshold: safeDeadZone,
        releaseThreshold: safeReleaseZone,
        maxAbs: safeMax,
        outputMaxAbs: safeMax,
      },
    );
    return snapToStep(outputValue);
  };

  const valueFromClientX = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0) return clampedValue;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return safeMin + (ratio * (safeMax - safeMin));
  };

  const commitPointerValue = (clientX) => {
    const nextValue = mapPointerValue(valueFromClientX(clientX));
    lastDragValueRef.current = nextValue;
    onInputValue?.(nextValue);
    return nextValue;
  };

  const handlePointerDown = (event) => {
    event.preventDefault();
    draggingRef.current = true;
    setIsActive(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    commitPointerValue(event.clientX);
  };

  const handlePointerMove = (event) => {
    if (!draggingRef.current) return;
    commitPointerValue(event.clientX);
  };

  const finishPointerDrag = (event) => {
    if (!draggingRef.current) return;
    const nextValue = event.type === "pointercancel"
      ? lastDragValueRef.current
      : commitPointerValue(event.clientX);
    draggingRef.current = false;
    lockRef.current = Math.abs(nextValue) <= safeDeadZone;
    setIsActive(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    onCommitValue?.(nextValue);
  };

  const handleLostPointerCapture = () => {
    if (!draggingRef.current) return;
    const nextValue = lastDragValueRef.current;
    draggingRef.current = false;
    lockRef.current = Math.abs(nextValue) <= safeDeadZone;
    setIsActive(false);
    onCommitValue?.(nextValue);
  };

  const handleKeyDown = (event) => {
    let nextValue = clampedValue;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") nextValue -= safeStep || 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") nextValue += safeStep || 1;
    else if (event.key === "Home") nextValue = 0;
    else if (event.key === "End") nextValue = clampedValue >= 0 ? safeMax : safeMin;
    else return;

    event.preventDefault();
    lockRef.current = Math.abs(nextValue) <= safeDeadZone;
    const committedValue = snapToStep(clamp(nextValue, safeMin, safeMax));
    onInputValue?.(committedValue);
    onCommitValue?.(committedValue);
  };

  const percent = ((clampedValue - safeMin) / (safeMax - safeMin)) * 100;
  const centerPercent = ((0 - safeMin) / (safeMax - safeMin)) * 100;

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      class={`sequencer-playback-slider${isActive ? " sequencer-playback-slider--active" : ""}`}
      aria-label={ariaLabel}
      aria-valuemin={safeMin}
      aria-valuemax={safeMax}
      aria-valuenow={clampedValue}
      aria-valuetext={buildSliderText(clampedValue, formatAriaValue)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
      onLostPointerCapture={handleLostPointerCapture}
      onKeyDown={handleKeyDown}
    >
      <span class="sequencer-playback-slider__track" aria-hidden="true" />
      <span
        class="sequencer-playback-slider__center"
        aria-hidden="true"
        style={{ left: `${centerPercent}%` }}
      />
      <span
        class="sequencer-playback-slider__thumb"
        aria-hidden="true"
        style={{ left: `${percent}%` }}
      />
    </div>
  );
}

const SequenceControls = ({
  showAllEvents,
  newTempoPosition,
  setNewTempoPosition,
  newTempoBpm,
  setNewTempoBpm,
  addTempoAtRequestedPosition,
  addTempoTransitionAtRequestedPosition,
  newBarPosition,
  newBarPositionIsSuggested,
  setNewBarPosition,
  addBarAtRequestedPosition,
  newBarNumerator,
  newBarDenominator,
  newBarMeterIsSuggested,
  updateNewBarMeterField,
  sequenceAutoCreateBars,
  onSequenceAutoCreateBarsChange,
  onAddBarsBeforeSnapshots,
  newRepeatPosition,
  setNewRepeatPosition,
  onAddRepeatMarker,
  snapshotLabelMode,
  onSetSnapshotLabelMode,
  sequenceLegato,
  onSequenceLegatoChange,
  sequencePlaybackSpeed,
  sequencePlaybackPitchOffset,
  onSequencePlaybackSpeedChange,
  onSequencePlaybackSpeedPreview,
  onSequencePlaybackPitchOffsetChange,
  onSequencePlaybackPitchOffsetPreview,
  sequencePlayRepeats,
  onSequencePlayRepeatsChange,
  autoScrollEnabled,
  onAutoScrollEnabledChange,
  snapSequenceToCurrentTuning,
  onSnapSequenceToCurrentTuningChange,
  playbackRowRef,
  playhead,
  sortedBars,
  transportScrollTargetRef,
  onSelectSequenceBar,
  snapshotSelectValue,
  renderedSnapshots,
  impliedPendingSnapshotIndex,
  armPendingSnapshot,
  snapshots,
  playheadIsOff,
  prevSnapshotIndexFromBar,
  nextSnapshotIndexFromBar,
  playheadIsEnd,
  runTransportAction,
  onJumpSequenceSnapshot,
  onStepSequence,
  cueSelectValue,
  sequenceCueGroups,
  impliedPendingCueIndex,
  armPendingCue,
  prevCueIndexFromBar,
  nextCueIndexFromBar,
  onJumpSequenceCue,
  onStepSequenceMarker,
  onResetSequencePlayhead,
  onJumpSequenceEnd,
  onPlaySequence,
  playingSnapshotId,
  onStopSnapshot,
  timedTransportUiState,
  getTimedTransportDisplay,
  onTimedTransportPlayPause,
  onTimedTransportStop,
  terminalSequenceTarget,
}) => (
  <>
    {showAllEvents ? (
      <>
        <div class="sequencer-option-row">
          <span>Choose Tempo Position</span>
          <span class="sequencer-bars-add sequencer-bars-add--tempo">
            <input
              type="text"
              class={`sidebar-input sequencer-bars-add__position${newTempoPosition === "1.000000" ? " sequencer-bars-add__position--hint" : ""}`}
              aria-label="new tempo position"
              value={newTempoPosition}
              onFocus={selectControlValue}
              onInput={(e) => setNewTempoPosition(e.currentTarget.value)}
            />
            <span class="sequencer-bars-add__tempo">
              <input
                type="text"
                class={`sidebar-input sequencer-bars-add__aux sequencer-bars-add__bpm${newTempoBpm === "60" ? " sequencer-bars-add__position--hint" : ""}`}
                aria-label="new tempo bpm"
                value={newTempoBpm}
                onFocus={selectControlValue}
                onInput={(e) => setNewTempoBpm(e.currentTarget.value)}
              />
              <span class="sequencer-bars-add__suffix">bpm</span>
            </span>
            <button type="button" class="preset-action-btn sequencer-bars-add__button" onClick={addTempoAtRequestedPosition}>
              Add Tempo
            </button>
          </span>
        </div>
        <div class="sequencer-option-row sequencer-option-row--tempo-transition-action sequencer-option-row--mobile-inline">
          <span>Make Gradual Transition</span>
          <span class="sequencer-bars-add__stacked-button-slot">
            <button
              type="button"
              class="preset-action-btn sequencer-bars-add__button sequencer-bars-add__button--stacked"
              onClick={addTempoTransitionAtRequestedPosition}
            >
              Add Target Tempo
            </button>
          </span>
        </div>

        <div class="sequencer-option-row">
          <span>Choose Bar Position</span>
          <span class="sequencer-bars-add sequencer-bars-add--bar">
            <input
              type="text"
              class={`sidebar-input sequencer-bars-add__position${newBarPositionIsSuggested ? " sequencer-bars-add__position--hint" : ""}`}
              aria-label="new bar position"
              value={newBarPosition}
              onFocus={selectControlValue}
              onInput={(e) => {
                const rawValue = String(e.currentTarget.value ?? "").trim();
                const integerPortion = rawValue.split(/[.,]/, 1)[0]?.replace(/[^\d]/g, "") ?? "";
                setNewBarPosition(integerPortion, false);
              }}
            />
            <span class="sequencer-bars-add__meter">
              <input
                type="number"
                step="1"
                min="1"
                class={`sidebar-input sequencer-bars-add__aux sequencer-bars-add__meter-input sequencer-bars-add__meter-input--numerator${newBarMeterIsSuggested ? " sequencer-bars-add__position--hint" : ""}`}
                aria-label="new bar numerator"
                value={newBarNumerator}
                onFocus={selectControlValue}
                onInput={(e) => updateNewBarMeterField("numerator", e.currentTarget.value)}
              />
              <span class="sequencer-bars-add__meter-separator">/</span>
              <input
                type="number"
                step="1"
                min="1"
                class={`sidebar-input sequencer-bars-add__aux sequencer-bars-add__meter-input${newBarMeterIsSuggested ? " sequencer-bars-add__position--hint" : ""}`}
                aria-label="new bar denominator"
                value={newBarDenominator}
                onFocus={selectControlValue}
                onInput={(e) => updateNewBarMeterField("denominator", e.currentTarget.value)}
              />
            </span>
            <button type="button" class="preset-action-btn sequencer-bars-add__button" onClick={addBarAtRequestedPosition}>
              Add Bar
            </button>
          </span>
        </div>

        <label class="sequencer-option-row sequencer-option-row--mobile-inline">
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
          <span>Choose Repeat Position</span>
          <span class="sequencer-bars-add sequencer-bars-add--tempo">
            <input
              type="text"
              class={`sidebar-input sequencer-bars-add__position${newRepeatPosition === "1.000000" ? " sequencer-bars-add__position--hint" : ""}`}
              aria-label="new repeat position"
              value={newRepeatPosition}
              onFocus={selectControlValue}
              onInput={(e) => setNewRepeatPosition?.(e.currentTarget.value)}
            />
            <button
              type="button"
              class="preset-action-btn sequencer-bars-add__button"
              onClick={() => onAddRepeatMarker?.("start")}
            >
              Start Marker
            </button>
            <button
              type="button"
              class="preset-action-btn sequencer-bars-add__button"
              onClick={() => onAddRepeatMarker?.("end")}
            >
              End Marker
            </button>
          </span>
        </div>

      </>
    ) : null}

    <label class="sequencer-option-row sequencer-option-row--label-left">
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

    <label class="sequencer-option-row sequencer-option-row--mobile-inline">
      <span>Legato</span>
      <input
        type="checkbox"
        checked={sequenceLegato}
        onChange={(e) => onSequenceLegatoChange?.(e.currentTarget.checked)}
      />
    </label>

    <label class="sequencer-option-row sequencer-option-row--mobile-inline">
      <span>Auto-Scroll</span>
      <input
        type="checkbox"
        checked={autoScrollEnabled}
        onChange={(e) => onAutoScrollEnabledChange?.(e.currentTarget.checked)}
      />
    </label>

    <label class="sequencer-option-row sequencer-option-row--mobile-inline">
      <span>Play Repeats</span>
      <input
        type="checkbox"
        checked={sequencePlayRepeats}
        onChange={(e) => onSequencePlayRepeatsChange?.(e.currentTarget.checked)}
      />
    </label>

    <label class="sequencer-option-row sequencer-option-row--mobile-inline">
      <span>Snap Sequence to Current Hexatone Tuning</span>
      <input
        type="checkbox"
        checked={snapSequenceToCurrentTuning}
        onChange={(e) => onSnapSequenceToCurrentTuningChange?.(e.currentTarget.checked)}
      />
    </label>

    <div ref={playbackRowRef} class="sequencer-playback-block">
      <div class="sequencer-playback-row" aria-label="Sequence playback">
        <span class="sequencer-playback-label">PLAY FROM</span>

        <span class="sequencer-playback-control sequencer-playback-control--bar">
          <span class="sequencer-playback-key">BAR</span>
          <select
            class="sidebar-input sequencer-playback-select"
            data-timed-transport-field="bar"
            value={playhead?.barIndex ?? 0}
            onChange={(e) => {
              stopTimedTransportBefore(() => {
                transportScrollTargetRef.current = "bar";
                onSelectSequenceBar?.(Number(e.currentTarget.value));
              }, timedTransportUiState, onTimedTransportStop);
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
            data-timed-transport-field="snapshot"
            value={snapshotSelectValue}
            onChange={(e) => {
              stopTimedTransportBefore(() => {
                const { value } = e.currentTarget;
                if (value === "") {
                  return;
                }
                if (value === terminalSequenceTarget) {
                  return;
                }
                armPendingSnapshot(value);
              }, timedTransportUiState, onTimedTransportStop);
            }}
          >
            {renderedSnapshots.map((snapshot, index) => (
              <option
                key={snapshot.id ?? index}
                value={String(index)}
              >
                {impliedPendingSnapshotIndex === String(index) ? `(${index + 1})` : String(index + 1)}
              </option>
            ))}
            {playheadIsEnd && snapshots.length > 0 && (
              <option value={terminalSequenceTarget}>
                {impliedPendingSnapshotIndex === terminalSequenceTarget ? "(end)" : "end"}
              </option>
            )}
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
            data-timed-transport-field="cue"
            value={cueSelectValue}
            onChange={(e) => {
              stopTimedTransportBefore(() => {
                const { value } = e.currentTarget;
                if (value === "") {
                  return;
                }
                if (value === terminalSequenceTarget) {
                  return;
                }
                armPendingCue(value);
              }, timedTransportUiState, onTimedTransportStop);
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
            {playheadIsEnd && sequenceCueGroups.length > 0 && (
              <option value={terminalSequenceTarget}>
                {impliedPendingCueIndex === terminalSequenceTarget ? "(end)" : "end"}
              </option>
            )}
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
          <button
            type="button"
            class="snapshot-play-btn snapshot-play-btn--plain sequencer-transport-trigger-btn"
            title="Move playhead to end"
            aria-label="move sequence playhead to end"
            disabled={snapshots.length === 0 && playheadIsEnd}
            onClick={() => {
              runTransportAction(() => onJumpSequenceEnd?.());
            }}
          >
            <svg
              class="snapshot-start-icon snapshot-start-icon--end"
              viewBox="0 0 10 10"
              aria-hidden="true"
              focusable="false"
            >
              <rect x="1" y="1" width="1.4" height="8" rx="0.2" />
              <path d="M8.6 1.5 3.1 5l5.5 3.5Z" />
            </svg>
          </button>
        </span>

        <span class="sequencer-playback-row__break" aria-hidden="true" />
      </div>

      <TimedPlaybackRow
        snapshots={snapshots}
        playheadIsOff={playheadIsOff}
        playheadIsEnd={playheadIsEnd}
        runTransportAction={runTransportAction}
        onResetSequencePlayhead={onResetSequencePlayhead}
        onJumpSequenceEnd={onJumpSequenceEnd}
        timedTransportUiState={timedTransportUiState}
        getTimedTransportDisplay={getTimedTransportDisplay}
        onTimedTransportPlayPause={onTimedTransportPlayPause}
        onTimedTransportStop={onTimedTransportStop}
      />

      <PlaybackModifiersRow
        sequencePlaybackSpeed={sequencePlaybackSpeed}
        sequencePlaybackPitchOffset={sequencePlaybackPitchOffset}
        onSequencePlaybackSpeedChange={onSequencePlaybackSpeedChange}
        onSequencePlaybackSpeedPreview={onSequencePlaybackSpeedPreview}
        onSequencePlaybackPitchOffsetChange={onSequencePlaybackPitchOffsetChange}
        onSequencePlaybackPitchOffsetPreview={onSequencePlaybackPitchOffsetPreview}
        timedTransportUiState={timedTransportUiState}
        getTimedTransportDisplay={getTimedTransportDisplay}
      />
    </div>

  </>
);

function PlaybackModifiersRow({
  sequencePlaybackSpeed,
  sequencePlaybackPitchOffset,
  onSequencePlaybackSpeedChange,
  onSequencePlaybackSpeedPreview,
  onSequencePlaybackPitchOffsetChange,
  onSequencePlaybackPitchOffsetPreview,
  timedTransportUiState,
  getTimedTransportDisplay,
}) {
  const [speedDraft, setSpeedDraft] = useState(() => formatSequencePlaybackSpeed(sequencePlaybackSpeed ?? 1));
  const [pitchDraft, setPitchDraft] = useState(() => formatSequencePlaybackPitchCents(sequencePlaybackPitchOffset ?? 0));
  const [speedSliderValue, setSpeedSliderValue] = useState(() => speedToSliderExponent(sequencePlaybackSpeed ?? 1));
  const [pitchSliderValue, setPitchSliderValue] = useState(() => Number(sequencePlaybackPitchOffset ?? 0));
  const speedFrameRef = useRef(null);
  const pitchFrameRef = useRef(null);
  const pendingSpeedValueRef = useRef(Number(sequencePlaybackSpeed ?? 1));
  const lastPreviewedSpeedValueRef = useRef(Number(sequencePlaybackSpeed ?? 1));
  const pendingPitchValueRef = useRef(Number(sequencePlaybackPitchOffset ?? 0));
  const lastPreviewedPitchValueRef = useRef(Number(sequencePlaybackPitchOffset ?? 0));
  const committedPitchTextRef = useRef("");
  const [timedTransportDisplay, setTimedTransportDisplay] = useState(() => (
    getTimedTransportDisplay?.() ?? {
      clock: "00:00:00",
      barBeat: "1:1",
      tempo: null,
    }
  ));

  useEffect(() => {
    setSpeedDraft(formatSequencePlaybackSpeed(sequencePlaybackSpeed ?? 1));
    setSpeedSliderValue(speedToSliderExponent(sequencePlaybackSpeed ?? 1));
    pendingSpeedValueRef.current = Number(sequencePlaybackSpeed ?? 1);
    lastPreviewedSpeedValueRef.current = Number(sequencePlaybackSpeed ?? 1);
  }, [sequencePlaybackSpeed]);

  useEffect(() => {
    const nextPitch = Number(sequencePlaybackPitchOffset ?? 0);
    const preservedText = committedPitchTextRef.current;
    const preservedValue = parseSequencePlaybackPitchInput(preservedText);
    const shouldPreserveText = preservedText
      && preservedValue != null
      && Math.abs(preservedValue - nextPitch) < 1e-9;
    setPitchDraft(
      shouldPreserveText
        ? preservedText
        : formatSequencePlaybackPitchCents(nextPitch),
    );
    setPitchSliderValue(Number(sequencePlaybackPitchOffset ?? 0));
  }, [sequencePlaybackPitchOffset]);

  useEffect(() => {
    lastPreviewedPitchValueRef.current = Number(sequencePlaybackPitchOffset ?? 0);
  }, [sequencePlaybackPitchOffset]);

  useEffect(() => () => {
    if (speedFrameRef.current != null) window.cancelAnimationFrame(speedFrameRef.current);
    if (pitchFrameRef.current != null) window.cancelAnimationFrame(pitchFrameRef.current);
  }, []);

  useEffect(() => {
    const refreshDisplay = () => {
      setTimedTransportDisplay(getTimedTransportDisplay?.() ?? {
        clock: "00:00:00",
        barBeat: "1:1",
        tempo: null,
      });
    };
    refreshDisplay();
    if (!timedTransportUiState?.running) return undefined;
    const intervalId = window.setInterval(refreshDisplay, 250);
    return () => window.clearInterval(intervalId);
  }, [getTimedTransportDisplay, timedTransportUiState?.running]);

  const schedulePitchChange = (value) => {
    pendingPitchValueRef.current = value;
    if (pitchFrameRef.current != null) return;
    pitchFrameRef.current = window.requestAnimationFrame(() => {
      pitchFrameRef.current = null;
      const nextValue = pendingPitchValueRef.current;
      if (Math.abs(nextValue - lastPreviewedPitchValueRef.current) < 1e-9) return;
      lastPreviewedPitchValueRef.current = nextValue;
      onSequencePlaybackPitchOffsetPreview?.(nextValue);
    });
  };

  const scheduleSpeedChange = (value) => {
    pendingSpeedValueRef.current = value;
    if (speedFrameRef.current != null) return;
    speedFrameRef.current = window.requestAnimationFrame(() => {
      speedFrameRef.current = null;
      const nextValue = pendingSpeedValueRef.current;
      if (Math.abs(nextValue - lastPreviewedSpeedValueRef.current) < 1e-9) return;
      lastPreviewedSpeedValueRef.current = nextValue;
      onSequencePlaybackSpeedPreview?.(nextValue);
    });
  };

  const commitSpeedDraft = (value = speedDraft) => {
    const parsed = parseSequencePlaybackSpeedInput(value);
    if (parsed == null) {
      setSpeedDraft(formatSequencePlaybackSpeed(sequencePlaybackSpeed ?? 1));
      return;
    }
    onSequencePlaybackSpeedChange?.(parsed);
    setSpeedDraft(formatSequencePlaybackSpeed(parsed));
  };

  const commitPitchDraft = (value = pitchDraft) => {
    const parsed = parseSequencePlaybackPitchInput(value);
    if (parsed == null) {
      committedPitchTextRef.current = "";
      setPitchDraft(formatSequencePlaybackPitchCents(sequencePlaybackPitchOffset ?? 0));
      return;
    }
    onSequencePlaybackPitchOffsetChange?.(parsed);
    const normalized = normaliseSequencePlaybackPitchInput(value);
    const nextText = normalized || formatSequencePlaybackPitchCents(parsed);
    committedPitchTextRef.current = nextText;
    setPitchDraft(nextText);
  };

  const parsedPitchDraft = parseSequencePlaybackPitchInput(pitchDraft);
  const parsedSpeedDraft = parseSequencePlaybackSpeedInput(speedDraft);
  const currentTimedTransportDisplay = timedTransportUiState?.running
    ? timedTransportDisplay
    : (
      getTimedTransportDisplay?.() ?? {
        clock: "00:00:00",
        barBeat: "1:1",
        tempo: null,
      }
    );
  const speedCourtesy = formatEffectiveTempoCourtesy(
    currentTimedTransportDisplay?.tempo
      ? {
        ...currentTimedTransportDisplay.tempo,
        effectiveBpm: Number(currentTimedTransportDisplay.tempo.bpm ?? 0)
          * (parsedSpeedDraft ?? sequencePlaybackSpeed ?? 1),
      }
      : null,
  );
  const pitchCourtesy = formatSequencePlaybackPitchCourtesy(
    parsedPitchDraft ?? sequencePlaybackPitchOffset ?? 0,
  );
  const handleSpeedSliderInput = (nextExponent) => {
    const clampedExponent = clamp(nextExponent, -1, 1);
    const nextSpeed = sliderExponentToSpeed(clampedExponent);
    setSpeedSliderValue(clampedExponent);
    setSpeedDraft(formatSequencePlaybackSpeed(nextSpeed));
    scheduleSpeedChange(nextSpeed);
  };
  const handlePitchSliderInput = (nextPitch) => {
    const clampedPitch = clamp(nextPitch, -1200, 1200);
    committedPitchTextRef.current = "";
    setPitchSliderValue(clampedPitch);
    setPitchDraft(formatSequencePlaybackPitchCents(clampedPitch));
    schedulePitchChange(clampedPitch);
  };
  const resetSpeed = () => {
    setSpeedSliderValue(0);
    setSpeedDraft(formatSequencePlaybackSpeed(1));
    onSequencePlaybackSpeedChange?.(1);
  };
  const resetPitch = () => {
    committedPitchTextRef.current = "";
    pendingPitchValueRef.current = 0;
    lastPreviewedPitchValueRef.current = 0;
    setPitchSliderValue(0);
    setPitchDraft(formatSequencePlaybackPitchCents(0));
    onSequencePlaybackPitchOffsetChange?.(0);
  };

  return (
    <div class="sequencer-playback-row sequencer-playback-row--modifiers" aria-label="Sequence playback modifiers">
      <div class="sequencer-playback-modifier">
        <span class="sequencer-playback-modifier__head">
          <span class="sequencer-playback-modifier__label">SPEED</span>
          <span class="sequencer-playback-modifier__value-wrap">
            <input
              type="text"
              class="sidebar-input sequencer-playback-input"
              aria-label="sequence playback speed"
              value={speedDraft}
              onFocus={selectControlValue}
              onInput={(e) => setSpeedDraft(e.currentTarget.value)}
              onBlur={(e) => commitSpeedDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                commitSpeedDraft(e.currentTarget.value);
              }}
            />
            <span class="sequencer-playback-modifier__courtesy">{speedCourtesy}</span>
          </span>
        </span>
        <span class="sequencer-playback-modifier__slider-row">
          <StickyPlaybackSlider
            ariaLabel="sequence playback speed slider"
            min={-1}
            max={1}
            step={0.001}
            value={speedSliderValue}
            deadZone={0.03}
            releaseZone={0.085}
            onInputValue={handleSpeedSliderInput}
            onCommitValue={(nextExponent) => {
              const nextValue = sliderExponentToSpeed(clamp(nextExponent, -1, 1));
              if (speedFrameRef.current != null) {
                window.cancelAnimationFrame(speedFrameRef.current);
                speedFrameRef.current = null;
              }
              pendingSpeedValueRef.current = nextValue;
              if (Math.abs(nextValue - lastPreviewedSpeedValueRef.current) >= 1e-9) {
                lastPreviewedSpeedValueRef.current = nextValue;
                onSequencePlaybackSpeedPreview?.(nextValue);
              }
              onSequencePlaybackSpeedChange?.(nextValue);
            }}
            formatAriaValue={(exponentValue) => formatSequencePlaybackSpeed(sliderExponentToSpeed(exponentValue))}
          />
          <button
            type="button"
            class="preset-action-btn sequencer-playback-reset-btn"
            aria-label="reset playback speed"
            title="Reset playback speed"
            onClick={resetSpeed}
          >
            ↺
          </button>
        </span>
      </div>

      <div class="sequencer-playback-modifier">
        <span class="sequencer-playback-modifier__head">
          <span class="sequencer-playback-modifier__label">PITCH</span>
          <span class="sequencer-playback-modifier__value-wrap">
            <input
              type="text"
              class="sidebar-input sequencer-playback-input"
              aria-label="sequence playback pitch"
              value={pitchDraft}
              onFocus={selectControlValue}
              onInput={(e) => setPitchDraft(e.currentTarget.value)}
              onBlur={(e) => commitPitchDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                commitPitchDraft(e.currentTarget.value);
              }}
            />
            <span class="sequencer-playback-modifier__courtesy">{pitchCourtesy}</span>
          </span>
        </span>
        <span class="sequencer-playback-modifier__slider-row">
          <StickyPlaybackSlider
            ariaLabel="sequence playback pitch slider"
            min={-1200}
            max={1200}
            step={1}
            value={pitchSliderValue}
            deadZone={24}
            releaseZone={52}
            onInputValue={handlePitchSliderInput}
            onCommitValue={(nextPitch) => {
              const nextValue = clamp(nextPitch, -1200, 1200);
              if (pitchFrameRef.current != null) {
                window.cancelAnimationFrame(pitchFrameRef.current);
                pitchFrameRef.current = null;
              }
              pendingPitchValueRef.current = nextValue;
              // Commit dispatches one synchronous full-chord retune. Mark the
              // pending preview consumed so it cannot run afterward.
              lastPreviewedPitchValueRef.current = nextValue;
              onSequencePlaybackPitchOffsetChange?.(nextValue);
            }}
            formatAriaValue={(pitchValue) => formatSequencePlaybackPitchCourtesy(pitchValue)}
          />
          <button
            type="button"
            class="preset-action-btn sequencer-playback-reset-btn"
            aria-label="reset playback pitch"
            title="Reset playback pitch"
            onClick={resetPitch}
          >
            ↺
          </button>
        </span>
      </div>
    </div>
  );
}

function TimedPlaybackRow({
  snapshots,
  playheadIsOff,
  playheadIsEnd,
  runTransportAction,
  onResetSequencePlayhead,
  onJumpSequenceEnd,
  timedTransportUiState,
  getTimedTransportDisplay,
  onTimedTransportPlayPause,
  onTimedTransportStop,
}) {
  const [timedTransportDisplay, setTimedTransportDisplay] = useState(() => (
    getTimedTransportDisplay?.() ?? {
      clock: "00:00:00",
      barBeat: "1:1",
    }
  ));

  useEffect(() => {
    const refreshDisplay = () => {
      setTimedTransportDisplay(getTimedTransportDisplay?.() ?? {
        clock: "00:00:00",
        barBeat: "1:1",
      });
    };
    refreshDisplay();
    if (!timedTransportUiState?.running) return undefined;
    const intervalId = window.setInterval(refreshDisplay, 250);
    return () => window.clearInterval(intervalId);
  }, [getTimedTransportDisplay, timedTransportUiState?.running]);

  return (
    <div class="sequencer-playback-row sequencer-playback-row--timed" aria-label="Timed sequence playback">
      <span class="sequencer-playback-label">TIMED PLAYBACK</span>

      <span class="sequencer-playback-control sequencer-playback-control--timed">
        <span class="sequencer-playback-key">CLOCK</span>
        <span class="sequencer-playback-status sequencer-playback-status--timed">
          {timedTransportDisplay.clock}
        </span>
      </span>

      <span class="sequencer-playback-control sequencer-playback-control--timed">
        <span class="sequencer-playback-key">BAR:BEAT</span>
        <span class="sequencer-playback-status sequencer-playback-status--timed">
          {timedTransportDisplay.barBeat}
        </span>
      </span>

      <span class="sequencer-playback-actions">
        <button
          type="button"
          class="snapshot-play-btn snapshot-play-btn--plain sequencer-transport-trigger-btn"
          title="Move playhead to start"
          aria-label="move timed transport to start"
          disabled={snapshots.length === 0 && playheadIsOff}
          onClick={() => {
            runTransportAction(() => stopTimedTransportBefore(
              () => onResetSequencePlayhead?.(),
              timedTransportUiState,
              onTimedTransportStop,
            ));
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
          title={timedTransportUiState?.running ? "Pause timed transport" : "Play timed transport"}
          aria-label={timedTransportUiState?.running ? "pause timed transport" : "play timed transport"}
          disabled={!timedTransportUiState?.canPlay}
          onClick={() => onTimedTransportPlayPause?.()}
        >
          {timedTransportUiState?.running ? (
            <span class="sequencer-pause-glyph" aria-hidden="true" />
          ) : (
            <span className="snapshot-play-glyph snapshot-play-glyph--play" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          class="snapshot-play-btn snapshot-stop-btn"
          title="Stop timed transport"
          aria-label="stop timed transport"
          disabled={!timedTransportUiState?.canStop}
          onClick={() => onTimedTransportStop?.()}
        >
          <span class="snapshot-stop-glyph" aria-hidden="true">
            ■
          </span>
        </button>
        <button
          type="button"
          class="snapshot-play-btn snapshot-play-btn--plain sequencer-transport-trigger-btn"
          title="Move playhead to end"
          aria-label="move timed transport to end"
          disabled={snapshots.length === 0 && playheadIsEnd}
          onClick={() => {
            runTransportAction(() => stopTimedTransportBefore(
              () => onJumpSequenceEnd?.(),
              timedTransportUiState,
              onTimedTransportStop,
            ));
          }}
        >
          <svg
            class="snapshot-start-icon snapshot-start-icon--end"
            viewBox="0 0 10 10"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="1" y="1" width="1.4" height="8" rx="0.2" />
            <path d="M8.6 1.5 3.1 5l5.5 3.5Z" />
          </svg>
        </button>
      </span>

      <span class="sequencer-playback-row__break" aria-hidden="true" />
    </div>
  );
}

export default SequenceControls;
