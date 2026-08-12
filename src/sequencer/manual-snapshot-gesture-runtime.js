// Concurrent, generation-safe timer ownership for manual snapshot formations.
// Synth operations remain on the main thread and are supplied as callbacks.

export function createManualSnapshotGestureRuntime({
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  let nextGestureId = 1;
  const active = new Map();

  const complete = (gestureId, gesture) => {
    if (active.get(gestureId) !== gesture) return;
    for (const timer of gesture.timers) clearTimer(timer);
    gesture.timers.clear();
    active.delete(gestureId);
    gesture.callbacks.onComplete?.(gestureId);
  };

  const cancel = (gestureId) => {
    const gesture = active.get(gestureId);
    if (!gesture) return false;
    gesture.cancelled = true;
    for (const timer of gesture.timers) clearTimer(timer);
    gesture.timers.clear();
    active.delete(gestureId);
    gesture.callbacks.onCancel?.(gestureId);
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
      callbacks,
      attackEvents: (Array.isArray(plan?.events) ? plan.events : []).filter(
        (event) => event?.type !== "release",
      ),
      closedEventIds: new Set(),
      releaseScheduled: false,
      remainingReleaseEvents: 0,
    };
    active.set(gestureId, gesture);
    callbacks.onStart?.(gestureId);

    for (const event of gesture.attackEvents) {
      const dispatch = () => {
        if (gesture.cancelled || active.get(gestureId) !== gesture) return;
        if (gesture.closedEventIds.has(event?.eventId)) return;
        callbacks.onAttack?.(event, gestureId);
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
    callbacks.onScheduled?.(gestureId);
    return gestureId;
  };

  const release = (gestureId, plan) => {
    const gesture = active.get(gestureId);
    if (!gesture || gesture.releaseScheduled) return false;
    const events = Array.isArray(plan?.events) ? plan.events : [];
    if (events.length === 0) return false;
    gesture.releaseScheduled = true;
    gesture.remainingReleaseEvents = events.length;

    const dispatch = (event) => {
      if (gesture.cancelled || active.get(gestureId) !== gesture) return;
      gesture.closedEventIds.add(event?.eventId);
      gesture.callbacks.onRelease?.(event, gestureId);
      gesture.remainingReleaseEvents -= 1;
      if (gesture.remainingReleaseEvents === 0) complete(gestureId, gesture);
    };

    for (const event of events) {
      const delayMs = Math.max(0, Number(event?.offsetMs) || 0);
      if (delayMs === 0) {
        dispatch(event);
        continue;
      }
      const timer = setTimer(() => {
        gesture.timers.delete(timer);
        dispatch(event);
      }, delayMs);
      gesture.timers.add(timer);
    }
    return true;
  };

  return {
    start,
    release,
    cancel,
    cancelAll,
    attackEvents: (gestureId) => [...(active.get(gestureId)?.attackEvents ?? [])],
    activeGestureIds: () => [...active.keys()],
  };
}
