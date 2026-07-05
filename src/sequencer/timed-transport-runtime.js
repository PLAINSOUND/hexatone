function normalizePlaybackIndex(value, playbackBursts) {
  const lastIndex = Math.max(0, (playbackBursts?.length ?? 0) - 1);
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(lastIndex, numeric));
}

export function findPlaybackStartIndex(playbackBursts = [], selector = {}) {
  if (!Array.isArray(playbackBursts) || playbackBursts.length === 0) return -1;

  if (Number.isFinite(Number(selector.playbackIndex))) {
    return normalizePlaybackIndex(selector.playbackIndex, playbackBursts);
  }

  if (Number.isFinite(Number(selector.sequenceTime))) {
    const target = Number(selector.sequenceTime);
    const index = playbackBursts.findIndex((burst) => Number(burst?.sequenceTime) >= target - 1e-9);
    return index >= 0 ? index : playbackBursts.length - 1;
  }

  if (Number.isFinite(Number(selector.cueIndex))) {
    const target = Number(selector.cueIndex);
    const index = playbackBursts.findIndex((burst) => Number(burst?.sourceCueIndex) >= target);
    return index >= 0 ? index : playbackBursts.length - 1;
  }

  if (Number.isFinite(Number(selector.snapshotIndex))) {
    const target = Number(selector.snapshotIndex);
    const index = playbackBursts.findIndex((burst) => (burst?.sourceSnapshotIndexes ?? []).some((value) => value >= target));
    return index >= 0 ? index : playbackBursts.length - 1;
  }

  return 0;
}

export function createTimedTransportState(playbackBursts = []) {
  const hasBursts = Array.isArray(playbackBursts) && playbackBursts.length > 0;
  return {
    status: hasBursts ? "stopped" : "empty",
    anchorClockSeconds: 0,
    pausedElapsedSeconds: 0,
    nextPlaybackIndex: hasBursts ? 0 : -1,
    lastDispatchedPlaybackIndex: -1,
  };
}

function transportElapsedSeconds(state, clockSeconds) {
  return Math.max(0, Number(clockSeconds) - Number(state.anchorClockSeconds));
}

export function currentTimedTransportElapsedSeconds(state, clockSeconds = 0) {
  if (state?.status === "running") return transportElapsedSeconds(state, clockSeconds);
  return Math.max(0, Number(state?.pausedElapsedSeconds ?? 0));
}

export function startTimedTransport(state, playbackBursts = [], { playbackIndex = 0, clockSeconds = 0 } = {}) {
  if (!Array.isArray(playbackBursts) || playbackBursts.length === 0) {
    return createTimedTransportState([]);
  }
  const nextPlaybackIndex = normalizePlaybackIndex(playbackIndex, playbackBursts);
  const nextBurst = playbackBursts[nextPlaybackIndex];
  return {
    status: "running",
    anchorClockSeconds: Number(clockSeconds) - Number(nextBurst?.elapsedSeconds ?? 0),
    pausedElapsedSeconds: Number(nextBurst?.elapsedSeconds ?? 0),
    nextPlaybackIndex,
    lastDispatchedPlaybackIndex: nextPlaybackIndex - 1,
  };
}

export function pauseTimedTransport(state, clockSeconds = 0) {
  if (state?.status !== "running") return state;
  return {
    ...state,
    status: "paused",
    pausedElapsedSeconds: transportElapsedSeconds(state, clockSeconds),
  };
}

export function resumeTimedTransport(state, clockSeconds = 0) {
  if (state?.status !== "paused") return state;
  return {
    ...state,
    status: "running",
    anchorClockSeconds: Number(clockSeconds) - Number(state.pausedElapsedSeconds ?? 0),
  };
}

export function stopTimedTransport(playbackBursts = []) {
  return createTimedTransportState(playbackBursts);
}

export function seekTimedTransport(state, playbackBursts = [], { playbackIndex = 0, clockSeconds = null } = {}) {
  if (!Array.isArray(playbackBursts) || playbackBursts.length === 0) {
    return createTimedTransportState([]);
  }
  const nextPlaybackIndex = normalizePlaybackIndex(playbackIndex, playbackBursts);
  const nextBurst = playbackBursts[nextPlaybackIndex];
  const nextElapsedSeconds = Number(nextBurst?.elapsedSeconds ?? 0);
  const isRunning = state?.status === "running";
  const nextState = {
    ...state,
    nextPlaybackIndex,
    lastDispatchedPlaybackIndex: nextPlaybackIndex - 1,
    pausedElapsedSeconds: nextElapsedSeconds,
  };
  if (isRunning && Number.isFinite(Number(clockSeconds))) {
    nextState.anchorClockSeconds = Number(clockSeconds) - nextElapsedSeconds;
  }
  return nextState;
}

export function advanceTimedTransport(state, playbackBursts = [], clockSeconds = 0) {
  if (state?.status !== "running" || !Array.isArray(playbackBursts) || playbackBursts.length === 0) {
    return { state, dueBursts: [] };
  }

  const elapsedSeconds = transportElapsedSeconds(state, clockSeconds);
  const dueBursts = [];
  let nextPlaybackIndex = state.nextPlaybackIndex;

  while (nextPlaybackIndex >= 0 && nextPlaybackIndex < playbackBursts.length) {
    const burst = playbackBursts[nextPlaybackIndex];
    if (Number(burst?.elapsedSeconds) > elapsedSeconds + 1e-9) break;
    dueBursts.push(burst);
    nextPlaybackIndex += 1;
  }

  const finished = nextPlaybackIndex >= playbackBursts.length;
  return {
    state: {
      ...state,
      status: finished ? "finished" : state.status,
      pausedElapsedSeconds: elapsedSeconds,
      nextPlaybackIndex: finished ? -1 : nextPlaybackIndex,
      lastDispatchedPlaybackIndex: dueBursts.length > 0
        ? dueBursts.at(-1).playbackIndex
        : state.lastDispatchedPlaybackIndex,
    },
    dueBursts,
  };
}
