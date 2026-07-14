import {
  advanceTimedTransport,
  createTimedTransportState,
  currentTimedTransportElapsedSeconds,
  pauseTimedTransport,
  resumeTimedTransport,
  startTimedTransport,
  stopTimedTransport,
} from "./timed-transport-runtime.js";

const defaultClockSeconds = () => performance.now() / 1000;

/**
 * Dedicated timed-playback engine.
 *
 * React owns the UI state, but this engine owns the transport clock and the
 * scheduler lifecycle so playback does not depend on component render timing.
 */
export function createScheduledPlaybackEngine({
  getClockSeconds = defaultClockSeconds,
  setTimeoutFn = globalThis.setTimeout.bind(globalThis),
  clearTimeoutFn = globalThis.clearTimeout.bind(globalThis),
  setIntervalFn = globalThis.setInterval.bind(globalThis),
  clearIntervalFn = globalThis.clearInterval.bind(globalThis),
  displayIntervalMs = 125,
  guardIntervalMs = 25,
  onDispatchBursts = () => {},
  onReplayBurst = () => {},
  onStopPlayback = () => {},
  onStateChange = () => {},
} = {}) {
  let playbackBursts = [];
  let state = createTimedTransportState([]);
  let scheduledPlaybackIndex = 0;
  let timeoutId = null;
  let guardId = null;
  let displayId = null;
  let schedulerToken = 0;
  const lookaheadSeconds = 0.1;

  const emitState = () => {
    const clockSeconds = Number(getClockSeconds?.() ?? defaultClockSeconds());
    onStateChange({
      state,
      clockSeconds,
      elapsedSeconds: currentTimedTransportElapsedSeconds(state, clockSeconds),
    });
  };

  const clearScheduledCallbacks = () => {
    schedulerToken += 1;
    if (timeoutId != null) {
      clearTimeoutFn(timeoutId);
      timeoutId = null;
    }
  };

  const scheduleBurstsWithinLookahead = () => {
    if (state.status !== "running") return;
    const nowSeconds = Number(getClockSeconds?.() ?? defaultClockSeconds());
    const elapsedSeconds = currentTimedTransportElapsedSeconds(state, nowSeconds);
    const horizon = elapsedSeconds + lookaheadSeconds;
    const scheduled = [];

    while (scheduledPlaybackIndex >= 0 && scheduledPlaybackIndex < playbackBursts.length) {
      const burst = playbackBursts[scheduledPlaybackIndex] ?? null;
      if (!burst) break;
      if (Number(burst.elapsedSeconds) > horizon + 1e-9) break;
      scheduled.push({
        burst,
        initialize: Number(burst.playbackIndex) === Number(state.nextPlaybackIndex),
        scheduleAfterSeconds: Math.max(0, Number(burst.elapsedSeconds) - elapsedSeconds),
      });
      scheduledPlaybackIndex += 1;
    }

    if (scheduled.length > 0) onDispatchBursts(scheduled);
  };

  const stopIntervals = () => {
    if (guardId != null) {
      clearIntervalFn(guardId);
      guardId = null;
    }
    if (displayId != null) {
      clearIntervalFn(displayId);
      displayId = null;
    }
  };

  const stopScheduler = () => {
    clearScheduledCallbacks();
    stopIntervals();
  };

  const scheduleNextDispatch = () => {
    if (state.status !== "running") return;
    const nextPlaybackIndex = Number(state.nextPlaybackIndex);
    if (!Array.isArray(playbackBursts) || playbackBursts.length === 0 || nextPlaybackIndex < 0) return;
    const nextBurst = playbackBursts[nextPlaybackIndex] ?? null;
    if (!nextBurst) return;

    const nowSeconds = Number(getClockSeconds?.() ?? defaultClockSeconds());
    const elapsedSeconds = currentTimedTransportElapsedSeconds(state, nowSeconds);
    const delayMs = Math.max(0, (Number(nextBurst.elapsedSeconds) - elapsedSeconds) * 1000);
    const token = schedulerToken;

    timeoutId = setTimeoutFn(() => {
      timeoutId = null;
      if (schedulerToken !== token) return;
      if (state.status !== "running") return;
      dispatchDueBursts(Number(getClockSeconds?.() ?? defaultClockSeconds()));
    }, delayMs);
  };

  const dispatchDueBursts = (clockSeconds) => {
    const result = advanceTimedTransport(state, playbackBursts, clockSeconds);
    state = result.state;
    emitState();

    if (state.status === "finished") {
      stopScheduler();
      onStopPlayback();
      return;
    }

    scheduleNextDispatch();
  };

  const startIntervals = () => {
    clearScheduledCallbacks();
    stopIntervals();

    scheduleBurstsWithinLookahead();
    scheduleNextDispatch();

    guardId = setIntervalFn(() => {
      if (state.status !== "running") return;
      const nextPlaybackIndex = Number(state.nextPlaybackIndex);
      if (nextPlaybackIndex < 0) return;
      const nextBurst = playbackBursts[nextPlaybackIndex] ?? null;
      if (!nextBurst) return;
      const nowSeconds = Number(getClockSeconds?.() ?? defaultClockSeconds());
      const elapsedSeconds = currentTimedTransportElapsedSeconds(state, nowSeconds);
      scheduleBurstsWithinLookahead();
      if (Number(nextBurst.elapsedSeconds) > elapsedSeconds + 1e-9) return;
      if (timeoutId != null) {
        clearTimeoutFn(timeoutId);
        timeoutId = null;
      }
      dispatchDueBursts(nowSeconds);
    }, guardIntervalMs);

    displayId = setIntervalFn(() => {
      emitState();
    }, displayIntervalMs);
  };

  return {
    getState() {
      return state;
    },

    replacePlaybackBursts(nextPlaybackBursts = []) {
      playbackBursts = Array.isArray(nextPlaybackBursts) ? nextPlaybackBursts : [];
      const freshState = createTimedTransportState(playbackBursts);

      if (state.status !== "running" && state.status !== "paused") {
        state = freshState;
        emitState();
        return state;
      }

      const lastPlaybackIndex = Math.max(0, playbackBursts.length - 1);
      const nextPlaybackIndex = playbackBursts.length === 0
        ? -1
        : Math.max(0, Math.min(lastPlaybackIndex, Number(state?.nextPlaybackIndex ?? 0)));
      const lastDispatchedPlaybackIndex = playbackBursts.length === 0
        ? -1
        : Math.max(-1, Math.min(lastPlaybackIndex, Number(state?.lastDispatchedPlaybackIndex ?? -1)));
      state = {
        ...state,
        status: playbackBursts.length === 0 ? "empty" : state.status,
        nextPlaybackIndex,
        lastDispatchedPlaybackIndex,
      };
      emitState();
      return state;
    },

    start({ playbackIndex = 0 } = {}) {
      if (!playbackBursts.length) {
        state = createTimedTransportState([]);
        scheduledPlaybackIndex = 0;
        emitState();
        return state;
      }
      state = startTimedTransport(state, playbackBursts, {
        playbackIndex,
        clockSeconds: Number(getClockSeconds?.() ?? defaultClockSeconds()),
      });
      scheduledPlaybackIndex = Math.max(0, Number(playbackIndex) || 0);
      emitState();
      startIntervals();
      return state;
    },

    pause() {
      if (state.status !== "running") return state;
      stopScheduler();
      onStopPlayback();
      state = pauseTimedTransport(state, Number(getClockSeconds?.() ?? defaultClockSeconds()));
      emitState();
      return state;
    },

    resume() {
      if (state.status !== "paused") return state;
      const burst = Number.isFinite(Number(state.lastDispatchedPlaybackIndex))
        ? (playbackBursts[Number(state.lastDispatchedPlaybackIndex)] ?? null)
        : null;
      if (burst) onReplayBurst(burst);
      state = resumeTimedTransport(state, Number(getClockSeconds?.() ?? defaultClockSeconds()));
      scheduledPlaybackIndex = Math.max(0, Number(state.nextPlaybackIndex ?? 0));
      emitState();
      startIntervals();
      return state;
    },

    stop() {
      stopScheduler();
      onStopPlayback();
      state = stopTimedTransport(playbackBursts);
      scheduledPlaybackIndex = 0;
      emitState();
      return state;
    },

    dispose() {
      stopScheduler();
    },
  };
}

export default createScheduledPlaybackEngine;
