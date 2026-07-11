import { SNAPSHOT_LABEL_MODES } from "./labels.js";

function selectControlValue(event) {
  event.currentTarget.select?.();
}

const SequenceControls = ({
  showAllEvents,
  newTempoPosition,
  setNewTempoPosition,
  newTempoBpm,
  setNewTempoBpm,
  addTempoAtRequestedPosition,
  newBarPosition,
  setNewBarPosition,
  addBarAtRequestedPosition,
  newBarNumerator,
  newBarDenominator,
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
  setPendingSnapshotJumpIndex,
  setPendingCueJumpIndex,
  armPendingSnapshot,
  snapshots,
  playheadIsOff,
  prevSnapshotIndexFromBar,
  nextSnapshotIndexFromBar,
  pendingSnapshotJumpIndex,
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
  pendingCueJumpIndex,
  onJumpSequenceCue,
  onStepSequenceMarker,
  onResetSequencePlayhead,
  onJumpSequenceEnd,
  onPlaySequence,
  playingSnapshotId,
  onStopSnapshot,
  timedTransportDisplay,
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

        <div class="sequencer-option-row">
          <span>Choose Bar Position</span>
          <span class="sequencer-bars-add sequencer-bars-add--bar">
            <input
              type="text"
              class={`sidebar-input sequencer-bars-add__position${newBarPosition === "1" ? " sequencer-bars-add__position--hint" : ""}`}
              aria-label="new bar position"
              value={newBarPosition}
              onFocus={selectControlValue}
              onInput={(e) => {
                const rawValue = String(e.currentTarget.value ?? "").trim();
                const integerPortion = rawValue.split(/[.,]/, 1)[0]?.replace(/[^\d]/g, "") ?? "";
                setNewBarPosition(integerPortion);
              }}
            />
            <span class="sequencer-bars-add__meter">
              <input
                type="number"
                step="1"
                min="0"
                class={`sidebar-input sequencer-bars-add__aux sequencer-bars-add__meter-input sequencer-bars-add__meter-input--numerator${newBarNumerator === "4" ? " sequencer-bars-add__position--hint" : ""}`}
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
                class={`sidebar-input sequencer-bars-add__aux sequencer-bars-add__meter-input${newBarDenominator === "4" ? " sequencer-bars-add__position--hint" : ""}`}
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
          <span>Snap Sequence to Current Hexatone Tuning</span>
          <input
            type="checkbox"
            checked={snapSequenceToCurrentTuning}
            onChange={(e) => onSnapSequenceToCurrentTuningChange?.(e.currentTarget.checked)}
          />
        </label>
      </>
    ) : null}

    <div ref={playbackRowRef} class="sequencer-playback-row" aria-label="Sequence playback">
      <span class="sequencer-playback-label">PLAY FROM</span>

      <span class="sequencer-playback-control">
        <span class="sequencer-playback-key">BAR</span>
        <select
          class="sidebar-input sequencer-playback-select"
          value={playhead?.barIndex ?? 0}
          onChange={(e) => {
            transportScrollTargetRef.current = "bar";
            onSelectSequenceBar?.(Number(e.currentTarget.value));
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
            const { value } = e.currentTarget;
            if (value === "") {
              setPendingSnapshotJumpIndex("");
              setPendingCueJumpIndex("");
              return;
            }
            if (value === terminalSequenceTarget) {
              setPendingSnapshotJumpIndex("");
              setPendingCueJumpIndex("");
              return;
            }
            armPendingSnapshot(value);
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
            if (pendingSnapshotJumpIndex !== "") {
              const targetIndex = Number(pendingSnapshotJumpIndex);
              setPendingSnapshotJumpIndex("");
              setPendingCueJumpIndex("");
              runTransportAction(() => onJumpSequenceSnapshot?.(targetIndex));
              return;
            }
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
            const { value } = e.currentTarget;
            if (value === "") {
              setPendingCueJumpIndex("");
              setPendingSnapshotJumpIndex("");
              return;
            }
            if (value === terminalSequenceTarget) {
              setPendingCueJumpIndex("");
              setPendingSnapshotJumpIndex("");
              return;
            }
            armPendingCue(value);
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
            if (pendingCueJumpIndex !== "") {
              const targetIndex = Number(pendingCueJumpIndex);
              setPendingCueJumpIndex("");
              setPendingSnapshotJumpIndex("");
              runTransportAction(() => onJumpSequenceCue?.(targetIndex));
              return;
            }
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

    <div class="sequencer-playback-row sequencer-playback-row--timed" aria-label="Timed sequence playback">
      <span class="sequencer-playback-label">TIMED PLAYBACK</span>

      <span class="sequencer-playback-control sequencer-playback-control--timed">
        <span class="sequencer-playback-key">CLOCK</span>
        <span class="sequencer-playback-status sequencer-playback-status--timed">
          {timedTransportDisplay?.clock ?? "00:00:00"}
        </span>
      </span>

      <span class="sequencer-playback-control sequencer-playback-control--timed">
        <span class="sequencer-playback-key">BAR:BEAT</span>
        <span class="sequencer-playback-status sequencer-playback-status--timed">
          {timedTransportDisplay?.barBeat ?? "1:1"}
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
          title={timedTransportDisplay?.running ? "Pause timed transport" : "Play timed transport"}
          aria-label={timedTransportDisplay?.running ? "pause timed transport" : "play timed transport"}
          disabled={!timedTransportDisplay?.canPlay}
          onClick={() => onTimedTransportPlayPause?.()}
        >
          {timedTransportDisplay?.running ? (
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
          disabled={!timedTransportDisplay?.canStop}
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
  </>
);

export default SequenceControls;
