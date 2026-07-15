import { clampSequencePlaybackSpeed } from "./playback-modifiers-runtime.js";

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

export function createTimedTransportState(playbackBursts = [], { speedMultiplier = 1 } = {}) {
  const hasBursts = Array.isArray(playbackBursts) && playbackBursts.length > 0;
  return {
    status: hasBursts ? "stopped" : "empty",
    anchorClockSeconds: 0,
    pausedElapsedSeconds: 0,
    speedMultiplier: clampSequencePlaybackSpeed(speedMultiplier),
    nextPlaybackIndex: hasBursts ? 0 : -1,
    lastDispatchedPlaybackIndex: -1,
  };
}

function transportElapsedSeconds(state, clockSeconds) {
  return Math.max(
    0,
    Number(state.pausedElapsedSeconds ?? 0)
      + (Number(clockSeconds) - Number(state.anchorClockSeconds))
        * clampSequencePlaybackSpeed(state?.speedMultiplier ?? 1),
  );
}

export function currentTimedTransportElapsedSeconds(state, clockSeconds = 0) {
  if (state?.status === "running") return transportElapsedSeconds(state, clockSeconds);
  return Math.max(0, Number(state?.pausedElapsedSeconds ?? 0));
}

export function startTimedTransport(
  state,
  playbackBursts = [],
  { playbackIndex = 0, clockSeconds = 0, speedMultiplier = null } = {},
) {
  if (!Array.isArray(playbackBursts) || playbackBursts.length === 0) {
    return createTimedTransportState([], { speedMultiplier });
  }
  const nextPlaybackIndex = normalizePlaybackIndex(playbackIndex, playbackBursts);
  const nextBurst = playbackBursts[nextPlaybackIndex];
  return {
    status: "running",
    anchorClockSeconds: Number(clockSeconds),
    pausedElapsedSeconds: Number(nextBurst?.elapsedSeconds ?? 0),
    speedMultiplier: clampSequencePlaybackSpeed(speedMultiplier ?? state?.speedMultiplier ?? 1),
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
    anchorClockSeconds: Number(clockSeconds),
  };
}

export function stopTimedTransport(playbackBursts = [], { speedMultiplier = 1 } = {}) {
  return createTimedTransportState(playbackBursts, { speedMultiplier });
}

export function seekTimedTransport(state, playbackBursts = [], { playbackIndex = 0, clockSeconds = null } = {}) {
  if (!Array.isArray(playbackBursts) || playbackBursts.length === 0) {
    return createTimedTransportState([], { speedMultiplier: state?.speedMultiplier ?? 1 });
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
    nextState.anchorClockSeconds = Number(clockSeconds);
  }
  return nextState;
}

export function updateTimedTransportSpeed(state, clockSeconds = 0, speedMultiplier = 1) {
  if (!state) return state;
  const nextSpeedMultiplier = clampSequencePlaybackSpeed(speedMultiplier);
  if (nextSpeedMultiplier === clampSequencePlaybackSpeed(state.speedMultiplier ?? 1)) return state;
  if (state.status === "running") {
    return {
      ...state,
      pausedElapsedSeconds: transportElapsedSeconds(state, clockSeconds),
      anchorClockSeconds: Number(clockSeconds),
      speedMultiplier: nextSpeedMultiplier,
    };
  }
  return {
    ...state,
    speedMultiplier: nextSpeedMultiplier,
  };
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
      nextPlaybackIndex: finished ? -1 : nextPlaybackIndex,
      lastDispatchedPlaybackIndex: dueBursts.length > 0
        ? dueBursts.at(-1).playbackIndex
        : state.lastDispatchedPlaybackIndex,
    },
    dueBursts,
  };
}
