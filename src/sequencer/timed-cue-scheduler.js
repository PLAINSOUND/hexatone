function normalizeIndex(value) {
  const numeric = Math.max(0, Math.round(Number(value) || 0));
  return Number.isFinite(numeric) ? numeric : 0;
}

export function collectTimedCueBurstsWithinLookahead(
  playbackBursts = [],
  startPlaybackIndex = 0,
  elapsedSeconds = 0,
  lookaheadSeconds = 0.15,
) {
  const bursts = Array.isArray(playbackBursts) ? playbackBursts : [];
  const horizon = Number(elapsedSeconds) + Math.max(0, Number(lookaheadSeconds) || 0);
  let nextPlaybackIndex = normalizeIndex(startPlaybackIndex);
  const cueBursts = [];

  while (nextPlaybackIndex < bursts.length) {
    const burst = bursts[nextPlaybackIndex];
    if (!Number.isFinite(Number(burst?.elapsedSeconds)) || Number(burst.elapsedSeconds) > horizon + 1e-9) break;
    if (Number.isFinite(burst?.sourceCueIndex)) cueBursts.push(burst);
    nextPlaybackIndex += 1;
  }

  return {
    cueBursts,
    nextPlaybackIndex,
  };
}
