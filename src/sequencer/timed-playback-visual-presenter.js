// Timed playback visuals are intentionally imperative. The sequencer list is
// large enough that publishing a playhead through component state can starve
// the audio scheduler. This presenter coalesces positions to one animation
// frame and touches only the previously active and next active row.

export const TIMED_PLAYBACK_ROW_CLASS = "sequencer-item--timed-playing";

export function createTimedPlaybackVisualPresenter({
  resolveSnapshotRow,
  scrollSnapshotRow,
  requestFrame = (callback) => window.requestAnimationFrame(callback),
  cancelFrame = (frameId) => window.cancelAnimationFrame(frameId),
  now = () => performance.now(),
  scrollIntervalMs = 200,
} = {}) {
  let activeSnapshotId = null;
  let pendingSnapshotId = null;
  let frameId = null;
  let disposed = false;
  let lastScrollAtMs = -Infinity;

  const removeActiveClass = () => {
    if (activeSnapshotId == null) return;
    resolveSnapshotRow?.(activeSnapshotId)?.classList?.remove(TIMED_PLAYBACK_ROW_CLASS);
    activeSnapshotId = null;
  };

  const flush = () => {
    frameId = null;
    if (disposed) return;
    const nextSnapshotId = pendingSnapshotId;
    pendingSnapshotId = null;
    if (nextSnapshotId == null) {
      removeActiveClass();
      return;
    }
    if (nextSnapshotId === activeSnapshotId) return;

    removeActiveClass();
    const nextRow = resolveSnapshotRow?.(nextSnapshotId) ?? null;
    if (!nextRow) return;
    nextRow.classList?.add(TIMED_PLAYBACK_ROW_CLASS);
    activeSnapshotId = nextSnapshotId;
    const nowMs = now();
    if (nowMs - lastScrollAtMs >= scrollIntervalMs) {
      lastScrollAtMs = nowMs;
      scrollSnapshotRow?.(nextRow);
    }
  };

  const clear = () => {
    pendingSnapshotId = null;
    if (frameId != null) {
      cancelFrame(frameId);
      frameId = null;
    }
    removeActiveClass();
  };

  return {
    enqueue(snapshotId) {
      if (disposed) return;
      pendingSnapshotId = snapshotId ?? null;
      if (frameId != null) return;
      frameId = requestFrame(flush);
    },
    clear,
    dispose() {
      if (disposed) return;
      clear();
      disposed = true;
    },
  };
}
