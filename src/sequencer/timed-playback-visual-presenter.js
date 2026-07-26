// Timed playback visuals are deliberately split into independent presenters.
// Highlighting never locates or scrolls rows. Autoscroll may mount/locate rows,
// but is disposable and may drop intermediate positions. Transport readouts
// mutate only their own controls.

export const TIMED_PLAYBACK_ROW_CLASS = "sequencer-item--timed-playing";
export const TIMED_PLAYBACK_EVENT_CLASS = "sequencer-event-row--timed-sounding";
export const SEQUENCER_VIEWPORT_OWNER_NAVIGATION = "navigation";
export const SEQUENCER_VIEWPORT_OWNER_TIMED_PLAYBACK = "timed-playback";

export function resolveSequencerViewportOwner({ timedPlaybackRunning = false } = {}) {
  return timedPlaybackRunning
    ? SEQUENCER_VIEWPORT_OWNER_TIMED_PLAYBACK
    : SEQUENCER_VIEWPORT_OWNER_NAVIGATION;
}

export function createTimedPlaybackHighlightPresenter({
  resolveSnapshotRow,
  resolveEventRow,
} = {}) {
  let activeSnapshotId = null;
  let activeEventIds = new Set();
  let disposed = false;

  const removeSnapshotClass = (snapshotId) => {
    if (snapshotId == null) return;
    resolveSnapshotRow?.(snapshotId)?.classList?.remove(TIMED_PLAYBACK_ROW_CLASS);
  };

  const removeEventClass = (eventId) => {
    resolveEventRow?.(eventId)?.classList?.remove(TIMED_PLAYBACK_EVENT_CLASS);
  };

  const refresh = () => {
    if (disposed) return;
    if (activeSnapshotId != null) {
      resolveSnapshotRow?.(activeSnapshotId)?.classList?.add(TIMED_PLAYBACK_ROW_CLASS);
    }
    for (const eventId of activeEventIds) {
      resolveEventRow?.(eventId)?.classList?.add(TIMED_PLAYBACK_EVENT_CLASS);
    }
  };

  const present = ({ snapshotId = null, soundingEventIds = [] } = {}) => {
    if (disposed) return;
    const nextSnapshotId = snapshotId ?? null;
    const nextEventIds = new Set(soundingEventIds.filter((eventId) => eventId != null));

    if (activeSnapshotId !== nextSnapshotId) removeSnapshotClass(activeSnapshotId);
    for (const eventId of activeEventIds) {
      if (!nextEventIds.has(eventId)) removeEventClass(eventId);
    }

    activeSnapshotId = nextSnapshotId;
    activeEventIds = nextEventIds;
    refresh();
  };

  const clear = () => {
    removeSnapshotClass(activeSnapshotId);
    for (const eventId of activeEventIds) removeEventClass(eventId);
    activeSnapshotId = null;
    activeEventIds = new Set();
  };

  return {
    present,
    refresh,
    clear,
    dispose() {
      if (disposed) return;
      clear();
      disposed = true;
    },
  };
}

export function createTimedTransportReadoutPresenter({
  presentTransportPosition,
  clearTransportPosition,
} = {}) {
  let disposed = false;
  return {
    present(position) {
      if (!disposed) presentTransportPosition?.(position ?? null);
    },
    clear({ restore = true } = {}) {
      if (!disposed && restore) clearTransportPosition?.();
    },
    dispose() {
      disposed = true;
    },
  };
}

export function createTimedPlaybackAutoscrollPresenter({
  isEnabled = () => true,
  resolveSnapshotRow,
  resolveEventRow,
  prepareSnapshotRow,
  scrollSnapshotRow,
  scrollSnapshotRows,
  requestFrame = (callback) => window.requestAnimationFrame(callback),
  cancelFrame = (frameId) => window.cancelAnimationFrame(frameId),
  now = () => performance.now(),
  scrollIntervalMs = 0,
  maxPrepareFrames = 3,
} = {}) {
  let pendingPosition = null;
  let frameId = null;
  let disposed = false;
  let lastScrollAtMs = -Infinity;
  let prepareFrames = 0;
  let preparedTargetKey = "";

  const cancel = () => {
    pendingPosition = null;
    prepareFrames = 0;
    preparedTargetKey = "";
    if (frameId != null) {
      cancelFrame(frameId);
      frameId = null;
    }
  };

  const flush = () => {
    frameId = null;
    if (disposed || !isEnabled()) {
      cancel();
      return;
    }
    const position = pendingPosition;
    pendingPosition = null;
    const startId = position?.scrollSnapshotId ?? null;
    const endId = position?.scrollSnapshotEndId ?? startId;
    if (startId == null) return;

    const eventIds = Array.isArray(position?.scrollEventIds)
      ? position.scrollEventIds.filter((eventId) => eventId != null)
      : [];
    const targetKey = `${startId}:${endId}:${eventIds.join(",")}`;
    if (preparedTargetKey !== targetKey) {
      preparedTargetKey = targetKey;
      prepareFrames = 0;
    }

    const startRow = resolveSnapshotRow?.(startId) ?? null;
    const endRow = endId == null ? startRow : (resolveSnapshotRow?.(endId) ?? null);
    const eventRows = eventIds
      .map((eventId) => resolveEventRow?.(eventId) ?? null);
    const missingIds = [
      startRow == null ? startId : null,
      endRow == null && endId !== startId ? endId : null,
    ].filter((id) => id != null);
    const hasMissingEventRows = eventRows.some((row) => row == null);

    if ((missingIds.length > 0 || hasMissingEventRows) && prepareFrames < maxPrepareFrames) {
      prepareFrames += 1;
      for (const id of missingIds) {
        if (!isEnabled()) return;
        prepareSnapshotRow?.(id);
      }
      if (missingIds.length === 0 && startId != null) {
        prepareSnapshotRow?.(startId);
      }
      if (isEnabled()) {
        pendingPosition = position;
        frameId = requestFrame(flush);
      }
      return;
    }

    if (!isEnabled() || startRow == null) return;
    const nowMs = now();
    if (nowMs - lastScrollAtMs < scrollIntervalMs) return;
    lastScrollAtMs = nowMs;
    const resolvedEventRows = eventRows.filter((row) => row != null);
    if (typeof scrollSnapshotRows === "function") {
      scrollSnapshotRows(
        resolvedEventRows.length > 0
          ? resolvedEventRows
          : (endRow && endRow !== startRow ? [startRow, endRow] : [startRow]),
      );
    } else {
      scrollSnapshotRow?.(resolvedEventRows.at(-1) ?? startRow);
    }
  };

  return {
    enqueue(position) {
      if (disposed || !isEnabled()) {
        cancel();
        return;
      }
      pendingPosition = position;
      if (frameId == null) frameId = requestFrame(flush);
    },
    cancel,
    dispose() {
      if (disposed) return;
      cancel();
      disposed = true;
    },
  };
}
