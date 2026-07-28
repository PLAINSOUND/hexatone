// Concurrent, generation-safe timer ownership for manual snapshot formations.
// Synth operations remain on the main thread and are supplied as callbacks.

export function createManualSnapshotGestureRuntime({
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  let nextGestureId = 1;
  const active = new Map();

  const cancel = (gestureId) => {
    const gesture = active.get(gestureId);
    if (!gesture) return false;
    gesture.cancelled = true;
    for (const timer of gesture.timers) clearTimer(timer);
    gesture.timers.clear();
    active.delete(gestureId);
    gesture.onCancel?.(gestureId);
    return true;
  };

  const cancelAll = () => {
    for (const gestureId of [...active.keys()]) cancel(gestureId);
  };

  const start = (plan, callbacks = {}) => {
    const gestureId = nextGestureId;
    nextGestureId += 1;
    const gesture = {
      cancelled: false,
      timers: new Set(),
      onCancel: callbacks.onCancel,
      remainingEvents: 0,
      scheduled: false,
      completesAfterEvents: false,
    };
    active.set(gestureId, gesture);
    callbacks.onStart?.(gestureId);

    const events = Array.isArray(plan?.events) ? plan.events : [];
    gesture.remainingEvents = events.length;
    gesture.completesAfterEvents = events.some((event) => event?.type === "release");
    const completeIfFinished = () => {
      if (
        !gesture.scheduled
        || !gesture.completesAfterEvents
        || gesture.remainingEvents > 0
        || active.get(gestureId) !== gesture
      ) return;
      active.delete(gestureId);
      callbacks.onComplete?.(gestureId);
    };
    for (const event of events) {
      const dispatch = () => {
        if (gesture.cancelled || active.get(gestureId) !== gesture) return;
        if (event?.type === "release") callbacks.onRelease?.(event, gestureId);
        else callbacks.onAttack?.(event, gestureId);
        gesture.remainingEvents -= 1;
        completeIfFinished();
      };
      const delayMs = Math.max(0, Number(event?.offsetMs) || 0);
      if (delayMs === 0) {
        dispatch();
        continue;
      }
      const timer = setTimer(() => {
        gesture.timers.delete(timer);
        dispatch();
      }, delayMs);
      gesture.timers.add(timer);
    }
    gesture.scheduled = true;
    callbacks.onScheduled?.(gestureId);
    completeIfFinished();
    return gestureId;
  };

  return {
    start,
    cancel,
    cancelAll,
    activeGestureIds: () => [...active.keys()],
  };
}
