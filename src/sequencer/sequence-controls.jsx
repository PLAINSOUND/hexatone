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

function selectControlValue(event) {
  event.currentTarget.select?.();
}

function stopTimedTransportBefore(action, timedTransportDisplay, onTimedTransportStop) {
  if (timedTransportDisplay?.running || timedTransportDisplay?.paused) {
    onTimedTransportStop?.();
  }
  action?.();
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
  onSequencePlaybackPitchOffsetChange,
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
        <div class="sequencer-option-row sequencer-option-row--tempo-transition-action">
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

        <span class="sequencer-playback-control">
          <span class="sequencer-playback-key">BAR</span>
          <select
            class="sidebar-input sequencer-playback-select"
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
        onSequencePlaybackPitchOffsetChange={onSequencePlaybackPitchOffsetChange}
      />
    </div>

  </>
);

function PlaybackModifiersRow({
  sequencePlaybackSpeed,
  sequencePlaybackPitchOffset,
  onSequencePlaybackSpeedChange,
  onSequencePlaybackPitchOffsetChange,
}) {
  const [speedDraft, setSpeedDraft] = useState(() => formatSequencePlaybackSpeed(sequencePlaybackSpeed ?? 1));
  const [pitchDraft, setPitchDraft] = useState(() => formatSequencePlaybackPitchCents(sequencePlaybackPitchOffset ?? 0));
  const [speedSliderValue, setSpeedSliderValue] = useState(() => speedToSliderExponent(sequencePlaybackSpeed ?? 1));
  const [pitchSliderValue, setPitchSliderValue] = useState(() => Number(sequencePlaybackPitchOffset ?? 0));
  const speedSlidingRef = useRef(false);
  const pitchSlidingRef = useRef(false);
  const speedFrameRef = useRef(null);
  const pitchFrameRef = useRef(null);
  const pendingSpeedValueRef = useRef(Number(sequencePlaybackSpeed ?? 1));
  const pendingPitchValueRef = useRef(Number(sequencePlaybackPitchOffset ?? 0));
  const committedPitchTextRef = useRef("");

  useEffect(() => {
    setSpeedDraft(formatSequencePlaybackSpeed(sequencePlaybackSpeed ?? 1));
    if (!speedSlidingRef.current) setSpeedSliderValue(speedToSliderExponent(sequencePlaybackSpeed ?? 1));
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
    if (!pitchSlidingRef.current) setPitchSliderValue(Number(sequencePlaybackPitchOffset ?? 0));
  }, [sequencePlaybackPitchOffset]);

  useEffect(() => () => {
    if (speedFrameRef.current != null) window.cancelAnimationFrame(speedFrameRef.current);
    if (pitchFrameRef.current != null) window.cancelAnimationFrame(pitchFrameRef.current);
  }, []);

  const scheduleSpeedChange = (value) => {
    pendingSpeedValueRef.current = value;
    if (speedFrameRef.current != null) return;
    speedFrameRef.current = window.requestAnimationFrame(() => {
      speedFrameRef.current = null;
      onSequencePlaybackSpeedChange?.(pendingSpeedValueRef.current);
    });
  };

  const schedulePitchChange = (value) => {
    pendingPitchValueRef.current = value;
    if (pitchFrameRef.current != null) return;
    pitchFrameRef.current = window.requestAnimationFrame(() => {
      pitchFrameRef.current = null;
      onSequencePlaybackPitchOffsetChange?.(pendingPitchValueRef.current);
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
  const pitchCourtesy = formatSequencePlaybackPitchCourtesy(
    parsedPitchDraft ?? sequencePlaybackPitchOffset ?? 0,
  );
  const resetSpeed = () => {
    speedSlidingRef.current = false;
    pendingSpeedValueRef.current = 1;
    setSpeedSliderValue(0);
    setSpeedDraft(formatSequencePlaybackSpeed(1));
    onSequencePlaybackSpeedChange?.(1);
  };
  const resetPitch = () => {
    pitchSlidingRef.current = false;
    committedPitchTextRef.current = "";
    pendingPitchValueRef.current = 0;
    setPitchSliderValue(0);
    setPitchDraft(formatSequencePlaybackPitchCents(0));
    onSequencePlaybackPitchOffsetChange?.(0);
  };

  return (
    <div class="sequencer-playback-row sequencer-playback-row--modifiers" aria-label="Sequence playback modifiers">
      <label class="sequencer-playback-modifier">
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
            <span class="sequencer-playback-modifier__suffix">×</span>
          </span>
        </span>
        <span class="sequencer-playback-modifier__slider-row">
          <input
            type="range"
            class="sequencer-playback-slider"
            aria-label="sequence playback speed slider"
            min="-1"
            max="1"
            step="0.001"
            value={speedSliderValue}
            onPointerDown={() => {
              speedSlidingRef.current = true;
            }}
            onPointerUp={() => {
              speedSlidingRef.current = false;
              onSequencePlaybackSpeedChange?.(pendingSpeedValueRef.current);
            }}
            onInput={(e) => {
              const nextExponent = Number(e.currentTarget.value);
              const nextValue = sliderExponentToSpeed(nextExponent);
              setSpeedSliderValue(nextExponent);
              setSpeedDraft(formatSequencePlaybackSpeed(nextValue));
              scheduleSpeedChange(nextValue);
            }}
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
      </label>

      <label class="sequencer-playback-modifier">
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
          <input
            type="range"
            class="sequencer-playback-slider"
            aria-label="sequence playback pitch slider"
            min="-1200"
            max="1200"
            step="1"
            value={pitchSliderValue}
            onPointerDown={() => {
              pitchSlidingRef.current = true;
            }}
            onPointerUp={() => {
              pitchSlidingRef.current = false;
              onSequencePlaybackPitchOffsetChange?.(pendingPitchValueRef.current);
            }}
            onInput={(e) => {
              const nextValue = Number(e.currentTarget.value);
              committedPitchTextRef.current = "";
              setPitchSliderValue(nextValue);
              setPitchDraft(formatSequencePlaybackPitchCents(nextValue));
              schedulePitchChange(nextValue);
            }}
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
      </label>
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
    </div>
  );
}

export default SequenceControls;
