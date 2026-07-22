// Timed playback visuals are intentionally imperative. The sequencer list is
// large enough that publishing a playhead through component state can starve
// the audio scheduler. This presenter coalesces positions to one animation
// frame and touches only the previously active and next active row.

export const TIMED_PLAYBACK_ROW_CLASS = "sequencer-item--timed-playing";
export const TIMED_PLAYBACK_EVENT_CLASS = "sequencer-event-row--timed-sounding";

export function createTimedPlaybackVisualPresenter({
  resolveSnapshotRow,
  resolveEventRow,
  scrollSnapshotRow,
  presentTransportPosition,
  clearTransportPosition,
  requestFrame = (callback) => window.requestAnimationFrame(callback),
  cancelFrame = (frameId) => window.cancelAnimationFrame(frameId),
  now = () => performance.now(),
  scrollIntervalMs = 200,
} = {}) {
  let activeSnapshotId = null;
  let activeEventIds = new Set();
  let pendingPosition = null;
  let frameId = null;
  let disposed = false;
  let lastScrollAtMs = -Infinity;

  const removeActiveClass = () => {
    if (activeSnapshotId == null) return;
    resolveSnapshotRow?.(activeSnapshotId)?.classList?.remove(TIMED_PLAYBACK_ROW_CLASS);
    activeSnapshotId = null;
  };

  const clearActiveEvents = () => {
    for (const eventId of activeEventIds) {
      resolveEventRow?.(eventId)?.classList?.remove(TIMED_PLAYBACK_EVENT_CLASS);
    }
    activeEventIds = new Set();
  };

  const presentActiveEvents = (eventIds = []) => {
    const nextEventIds = new Set(eventIds.filter((eventId) => eventId != null));
    for (const eventId of activeEventIds) {
      if (nextEventIds.has(eventId)) continue;
      resolveEventRow?.(eventId)?.classList?.remove(TIMED_PLAYBACK_EVENT_CLASS);
    }
    for (const eventId of nextEventIds) {
      if (activeEventIds.has(eventId)) continue;
      resolveEventRow?.(eventId)?.classList?.add(TIMED_PLAYBACK_EVENT_CLASS);
    }
    activeEventIds = nextEventIds;
  };

  const flush = () => {
    frameId = null;
    if (disposed) return;
    const nextPosition = pendingPosition;
    pendingPosition = null;
    const nextSnapshotId = nextPosition?.snapshotId ?? null;
    const nextScrollSnapshotId = nextPosition?.scrollSnapshotId ?? nextSnapshotId;
    if (nextSnapshotId == null) {
      removeActiveClass();
    } else if (nextSnapshotId !== activeSnapshotId) {
      removeActiveClass();
      const nextRow = resolveSnapshotRow?.(nextSnapshotId) ?? null;
      if (nextRow) {
        nextRow.classList?.add(TIMED_PLAYBACK_ROW_CLASS);
        activeSnapshotId = nextSnapshotId;
      }
    }

    const scrollRow = nextScrollSnapshotId == null
      ? null
      : (resolveSnapshotRow?.(nextScrollSnapshotId) ?? null);
    const nowMs = now();
    if (scrollRow && nowMs - lastScrollAtMs >= scrollIntervalMs) {
      lastScrollAtMs = nowMs;
      scrollSnapshotRow?.(scrollRow);
    }

    presentActiveEvents(nextPosition?.soundingEventIds ?? []);
    presentTransportPosition?.(nextPosition?.transport ?? null);
  };

  const clear = () => {
    pendingPosition = null;
    if (frameId != null) {
      cancelFrame(frameId);
      frameId = null;
    }
    removeActiveClass();
    clearActiveEvents();
    clearTransportPosition?.();
  };

  return {
    enqueue(position) {
      if (disposed) return;
      pendingPosition = position != null && typeof position === "object"
        ? position
        : { snapshotId: position ?? null };
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
