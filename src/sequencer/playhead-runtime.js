export function derivePlayheadNavigationState({
  playhead,
  sortedBars = [],
  sequenceCueGroups = [],
  snapshots = [],
  pendingSnapshotJumpIndex = "",
  pendingCueJumpIndex = "",
}) {
  const rawPlayheadStepIndex = Number.isFinite(playhead?.stepIndex) ? playhead.stepIndex : -1;
  const playheadIsOff = rawPlayheadStepIndex < 0 || snapshots.length === 0;
  const playheadIsEnd = !playheadIsOff && rawPlayheadStepIndex >= snapshots.length;
  const playheadStepIndex =
    playheadIsOff || playheadIsEnd
      ? -1
      : Math.max(0, Math.min(snapshots.length - 1, rawPlayheadStepIndex));
  const playheadMarkerIndex = Number.isFinite(playhead?.markerIndex) ? playhead.markerIndex : null;

  const selectedBarIndex = sortedBars.length === 0
    ? 0
    : Math.max(0, Math.min(sortedBars.length - 1, Number(playhead?.barIndex) || 0));
  const selectedBarTime = sortedBars.length === 0
    ? 1
    : Number(sortedBars[selectedBarIndex]?.position) || 1;
  const nextCueIndexFromBar = sequenceCueGroups.findIndex((group) => group.time >= selectedBarTime);
  const prevCueIndexFromBar = sequenceCueGroups.findLastIndex((group) => group.time < selectedBarTime);
  const nextSnapshotIndexFromBar = nextCueIndexFromBar >= 0
    ? sequenceCueGroups[nextCueIndexFromBar]?.snapshotIndex ?? -1
    : snapshots.findIndex((_, index) => index + 1 >= selectedBarTime);
  const normalizedNextSnapshotIndexFromBar = nextSnapshotIndexFromBar >= 0
    ? nextSnapshotIndexFromBar
    : snapshots.length;
  const prevSnapshotIndexFromBar = prevCueIndexFromBar >= 0
    ? sequenceCueGroups[prevCueIndexFromBar]?.snapshotIndex ?? -1
    : snapshots.findLastIndex((_, index) => index + 1 < selectedBarTime);

  const snapshotSelectValue = pendingSnapshotJumpIndex !== ""
    ? pendingSnapshotJumpIndex
    : playheadIsEnd
      ? snapshots.length > 0 ? "0" : ""
      : playheadIsOff || playheadStepIndex < 0
        ? normalizedNextSnapshotIndexFromBar >= 0 && normalizedNextSnapshotIndexFromBar < snapshots.length
          ? String(normalizedNextSnapshotIndexFromBar)
          : snapshots.length > 0 ? String(snapshots.length - 1) : ""
        : String(playheadStepIndex);
  const cueSelectValue = pendingCueJumpIndex !== ""
    ? pendingCueJumpIndex
    : playheadIsEnd
      ? sequenceCueGroups.length > 0 ? "0" : ""
      : playheadIsOff || (playheadMarkerIndex == null && sequenceCueGroups.length === 0)
        ? nextCueIndexFromBar >= 0 && nextCueIndexFromBar < sequenceCueGroups.length
          ? String(nextCueIndexFromBar)
          : sequenceCueGroups.length > 0 ? String(sequenceCueGroups.length - 1) : ""
        : playheadMarkerIndex != null
          ? String(playheadMarkerIndex)
          : nextCueIndexFromBar >= 0 && nextCueIndexFromBar < sequenceCueGroups.length
            ? String(nextCueIndexFromBar)
            : sequenceCueGroups.length > 0 ? String(sequenceCueGroups.length - 1) : "";
  const impliedPendingSnapshotIndex = pendingSnapshotJumpIndex !== ""
    ? pendingSnapshotJumpIndex
    : playheadIsEnd
      ? snapshots.length > 0 ? "0" : ""
      : playheadIsOff || playheadStepIndex < 0
        ? normalizedNextSnapshotIndexFromBar >= 0 && normalizedNextSnapshotIndexFromBar < snapshots.length
          ? String(normalizedNextSnapshotIndexFromBar)
          : ""
        : "";
  const impliedPendingCueIndex = pendingCueJumpIndex !== ""
    ? pendingCueJumpIndex
    : playheadIsEnd
      ? sequenceCueGroups.length > 0 ? "0" : ""
      : playheadIsOff
        ? nextCueIndexFromBar >= 0 && nextCueIndexFromBar < sequenceCueGroups.length
          ? String(nextCueIndexFromBar)
          : ""
        : "";

  return {
    playheadIsOff,
    playheadIsEnd,
    playheadStepIndex,
    playheadMarkerIndex,
    selectedBarIndex,
    selectedBarTime,
    nextCueIndexFromBar,
    prevCueIndexFromBar,
    nextSnapshotIndexFromBar: normalizedNextSnapshotIndexFromBar,
    prevSnapshotIndexFromBar,
    snapshotSelectValue,
    cueSelectValue,
    impliedPendingSnapshotIndex,
    impliedPendingCueIndex,
  };
}
