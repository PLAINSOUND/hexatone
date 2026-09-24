/** Coordinates manual takeover of timed playback without owning playback state.
 * SequenceControls supplies current scheduler/readout callbacks; the edit-commit
 * controller may defer the requested action, but never cancellation of timing.
 * No timers, rendering, scrolling or musical scheduling belong here.
 */
export function stopTimedTransportBefore(action, state, stop) {
  if (state?.running || state?.paused) stop?.({ restoreStartTarget: false });
  action?.();
}

export function createManualTransportActions({
  timedTransportUiState,
  onTimedTransportStop,
  runEditAwareTransportAction,
  getTimedTransportDisplay,
  sequenceCueGroups = [],
  onJumpSequenceSnapshot,
  onJumpSequenceCue,
}) {
  const runTransportAction = (action) => {
    stopTimedTransportBefore(
      () => runEditAwareTransportAction(action),
      timedTransportUiState,
      onTimedTransportStop,
    );
  };
  const triggerManualTarget = (target, fallback) => {
    // Capture before stopping: PLAY FROM can still show the original origin.
    const cueIndex = timedTransportUiState?.running
      ? getTimedTransportDisplay?.()?.activeCueIndex
      : null;
    const cue = Number.isInteger(cueIndex) ? sequenceCueGroups[cueIndex] : null;
    if (!cue) return runTransportAction(fallback);
    runTransportAction(() => {
      if (target === "snapshot") onJumpSequenceSnapshot?.(cue.snapshotIndex);
      else onJumpSequenceCue?.(cueIndex);
    });
  };
  return { runTransportAction, triggerManualTarget };
}
