// This module defines transport-selection semantics for the sequencer.
// It separates "currently selected in the UI" from "armed to be played next".
// The armed target is one-shot: once a transport action consumes it, later
// stepping should advance from the real playhead rather than replaying stale
// selection state.

export const TERMINAL_SEQUENCE_TARGET = "__end__";

export function findSnapshotIndexById(snapshotId, snapshots = []) {
  if (snapshotId == null) return -1;
  return snapshots.findIndex((snapshot) => snapshot?.id === snapshotId);
}

export function findCueIndexBySnapshotMarker(
  selectedMarker,
  snapshots = [],
  sequenceCueGroups = [],
) {
  if (selectedMarker?.snapshotId == null || !Number.isFinite(Number(selectedMarker?.time))) {
    return null;
  }
  const markerSnapshotIndex = snapshots.findIndex(
    (snapshot) => snapshot?.id === selectedMarker.snapshotId,
  );
  if (markerSnapshotIndex < 0) return null;
  const markerTime = Number((markerSnapshotIndex + 1 + Number(selectedMarker.time)).toFixed(6));
  const cueIndex = sequenceCueGroups.findIndex(
    (group) => Math.abs(Number(group?.time) - markerTime) < 1e-6,
  );
  return cueIndex >= 0 ? cueIndex : null;
}

export function deriveSelectedCueAbsoluteTime(
  selectedMarker,
  playheadMarkerIndex,
  sequenceCueGroups = [],
  snapshotIndexById = new Map(),
) {
  if (selectedMarker?.snapshotId != null && Number.isFinite(Number(selectedMarker?.time))) {
    const snapshotStart = snapshotIndexById.get(selectedMarker.snapshotId);
    if (snapshotStart != null)
      return Number((snapshotStart + Number(selectedMarker.time)).toFixed(6));
  }
  if (playheadMarkerIndex != null) {
    const cueGroup = sequenceCueGroups[playheadMarkerIndex];
    if (cueGroup) return Number(cueGroup.time.toFixed(6));
  }
  return null;
}

export function findFirstCueIndexForSnapshot(snapshotIndex, sequenceCueGroups = []) {
  if (!Number.isFinite(snapshotIndex) || snapshotIndex < 0) return null;
  const cueIndex = sequenceCueGroups.findIndex(
    (group) => Number(group?.snapshotIndex) >= snapshotIndex,
  );
  return cueIndex >= 0 ? cueIndex : null;
}

export function clearPendingTransportSelection() {
  return {
    snapshotIndex: null,
    cueIndex: null,
  };
}

export function armPendingSnapshotSelection(snapshotIndex, sequenceCueGroups = []) {
  return {
    snapshotIndex,
    cueIndex: findFirstCueIndexForSnapshot(snapshotIndex, sequenceCueGroups),
  };
}

export function armPendingCueSelection(cueIndex, snapshotIndex = null) {
  return {
    snapshotIndex: Number.isFinite(snapshotIndex) && snapshotIndex >= 0 ? snapshotIndex : null,
    cueIndex: Number.isFinite(cueIndex) && cueIndex >= 0 ? cueIndex : null,
  };
}

function findBarIndexAtOrBeforeTime(sortedBars = [], time) {
  if (sortedBars.length === 0 || !Number.isFinite(time)) return null;
  let barIndex = 0;
  for (let index = 0; index < sortedBars.length; index += 1) {
    if ((Number(sortedBars[index]?.position) || 0) <= time) barIndex = index;
    else break;
  }
  return barIndex;
}

export function deriveTransportSelectionState({
  playhead,
  sortedBars = [],
  sequenceCueGroups = [],
  snapshots = [],
  selectedSnapshotId = null,
  selectedMarker = null,
  pendingTransportSelection = null,
  pendingSnapshotJumpIndex = "",
  pendingCueJumpIndex = "",
}) {
  const rawPlayheadStepIndex = Number.isFinite(playhead?.stepIndex) ? playhead.stepIndex : -1;
  const playheadIsOff = rawPlayheadStepIndex < 0 || snapshots.length === 0;
  const playheadIsPreStart = playheadIsOff && playhead?.preStart === true;
  const playheadIsEnd = !playheadIsOff && rawPlayheadStepIndex >= snapshots.length;
  const playheadStepIndex =
    playheadIsOff || playheadIsEnd
      ? -1
      : Math.max(0, Math.min(snapshots.length - 1, rawPlayheadStepIndex));
  const playheadMarkerIndex = Number.isFinite(playhead?.markerIndex) ? playhead.markerIndex : null;
  const selectedSnapshotIndex = findSnapshotIndexById(selectedSnapshotId, snapshots);
  const selectedCueIndex = findCueIndexBySnapshotMarker(
    selectedMarker,
    snapshots,
    sequenceCueGroups,
  );
  const effectiveStoppedSnapshotIndex =
    selectedSnapshotIndex >= 0 ? selectedSnapshotIndex : playheadStepIndex;
  const selectedSnapshotPosition = selectedSnapshotIndex >= 0 ? selectedSnapshotIndex + 1 : null;
  const armedSnapshotIndex = Number.isFinite(pendingTransportSelection?.snapshotIndex)
    ? pendingTransportSelection.snapshotIndex
    : null;
  const armedCueIndex = Number.isFinite(pendingTransportSelection?.cueIndex)
    ? pendingTransportSelection.cueIndex
    : null;

  const playheadBarIndex =
    sortedBars.length === 0
      ? 0
      : Math.max(0, Math.min(sortedBars.length - 1, Number(playhead?.barIndex) || 0));
  const armedCueIsPlayheadTarget =
    armedCueIndex != null && Number(playhead?.markerIndex) === armedCueIndex;
  const armedCueTime = armedCueIsPlayheadTarget
    ? Number(sequenceCueGroups[armedCueIndex]?.time)
    : NaN;
  const armedSnapshotTime = armedSnapshotIndex == null ? null : armedSnapshotIndex + 1;
  const armedTransportTime = Number.isFinite(armedCueTime) ? armedCueTime : armedSnapshotTime;
  const selectedBarIndex =
    findBarIndexAtOrBeforeTime(sortedBars, armedTransportTime) ?? playheadBarIndex;
  const selectedBarTime =
    sortedBars.length === 0 ? 1 : Number(sortedBars[selectedBarIndex]?.position) || 1;
  const nextCueIndexFromBar = sequenceCueGroups.findIndex((group) => group.time >= selectedBarTime);
  const prevCueIndexFromBar = sequenceCueGroups.findLastIndex(
    (group) => group.time < selectedBarTime,
  );
  const nextSnapshotIndexFromBar =
    nextCueIndexFromBar >= 0
      ? (sequenceCueGroups[nextCueIndexFromBar]?.snapshotIndex ?? -1)
      : snapshots.findIndex((_, index) => index + 1 >= selectedBarTime);
  const normalizedNextSnapshotIndexFromBar =
    nextSnapshotIndexFromBar >= 0 ? nextSnapshotIndexFromBar : snapshots.length;
  const nextCueIndexFromSnapshot =
    findFirstCueIndexForSnapshot(effectiveStoppedSnapshotIndex, sequenceCueGroups) ?? -1;
  const prevSnapshotIndexFromBar =
    prevCueIndexFromBar >= 0
      ? (sequenceCueGroups[prevCueIndexFromBar]?.snapshotIndex ?? -1)
      : snapshots.findLastIndex((_, index) => index + 1 < selectedBarTime);
  const impliedSnapshotBracketIndex =
    armedSnapshotIndex != null
      ? armedSnapshotIndex
      : armedCueIndex != null
        ? Number.isFinite(pendingTransportSelection?.snapshotIndex)
          ? pendingTransportSelection.snapshotIndex
          : null
        : playheadIsOff
          ? !playheadIsPreStart &&
            normalizedNextSnapshotIndexFromBar >= 0 &&
            normalizedNextSnapshotIndexFromBar < snapshots.length
            ? normalizedNextSnapshotIndexFromBar
            : null
          : null;
  const impliedCueBracketIndex =
    armedCueIndex != null
      ? armedCueIndex
      : armedSnapshotIndex != null
        ? findFirstCueIndexForSnapshot(armedSnapshotIndex, sequenceCueGroups)
        : playheadIsOff
          ? !playheadIsPreStart &&
            nextCueIndexFromBar >= 0 &&
            nextCueIndexFromBar < sequenceCueGroups.length
            ? nextCueIndexFromBar
            : null
          : null;

  const snapshotSelectValue =
    pendingSnapshotJumpIndex !== ""
      ? pendingSnapshotJumpIndex
      : armedSnapshotIndex != null
        ? String(armedSnapshotIndex)
        : armedCueIndex != null && Number.isFinite(pendingTransportSelection?.snapshotIndex)
          ? String(pendingTransportSelection.snapshotIndex)
          : playheadIsPreStart
            ? ""
            : playheadIsEnd
              ? snapshots.length > 0
                ? TERMINAL_SEQUENCE_TARGET
                : ""
              : playheadStepIndex >= 0
                ? String(playheadStepIndex)
                : playheadIsOff || playheadStepIndex < 0
                  ? normalizedNextSnapshotIndexFromBar >= 0 &&
                    normalizedNextSnapshotIndexFromBar < snapshots.length
                    ? String(normalizedNextSnapshotIndexFromBar)
                    : snapshots.length > 0
                      ? String(snapshots.length - 1)
                      : ""
                  : "";
  const cueSelectValue =
    pendingCueJumpIndex !== ""
      ? pendingCueJumpIndex
      : armedCueIndex != null
        ? String(armedCueIndex)
        : armedSnapshotIndex != null
          ? (() => {
              const firstCueIndex = findFirstCueIndexForSnapshot(
                armedSnapshotIndex,
                sequenceCueGroups,
              );
              return firstCueIndex != null ? String(firstCueIndex) : "";
            })()
          : playheadIsPreStart
            ? ""
            : playheadIsEnd
              ? sequenceCueGroups.length > 0
                ? TERMINAL_SEQUENCE_TARGET
                : ""
              : playheadMarkerIndex != null
                ? String(playheadMarkerIndex)
                : playheadStepIndex >= 0 &&
                    nextCueIndexFromSnapshot >= 0 &&
                    nextCueIndexFromSnapshot < sequenceCueGroups.length
                  ? String(nextCueIndexFromSnapshot)
                  : playheadIsOff || (playheadMarkerIndex == null && sequenceCueGroups.length === 0)
                    ? nextCueIndexFromBar >= 0 && nextCueIndexFromBar < sequenceCueGroups.length
                      ? String(nextCueIndexFromBar)
                      : sequenceCueGroups.length > 0
                        ? String(sequenceCueGroups.length - 1)
                        : ""
                    : sequenceCueGroups.length > 0
                      ? String(sequenceCueGroups.length - 1)
                      : "";
  const impliedPendingSnapshotIndex =
    pendingSnapshotJumpIndex !== ""
      ? pendingSnapshotJumpIndex
      : impliedSnapshotBracketIndex != null
        ? String(impliedSnapshotBracketIndex)
        : playheadIsEnd
          ? snapshots.length > 0
            ? TERMINAL_SEQUENCE_TARGET
            : ""
          : "";
  const impliedPendingCueIndex =
    pendingCueJumpIndex !== ""
      ? pendingCueJumpIndex
      : impliedCueBracketIndex != null
        ? String(impliedCueBracketIndex)
        : playheadIsEnd
          ? sequenceCueGroups.length > 0
            ? TERMINAL_SEQUENCE_TARGET
            : ""
          : "";

  return {
    playheadIsOff,
    playheadIsPreStart,
    playheadIsEnd,
    playheadStepIndex,
    playheadMarkerIndex,
    selectedSnapshotIndex,
    selectedSnapshotPosition,
    selectedCueIndex,
    effectiveStoppedSnapshotIndex,
    selectedBarIndex,
    selectedBarTime,
    nextCueIndexFromBar,
    prevCueIndexFromBar,
    nextSnapshotIndexFromBar: normalizedNextSnapshotIndexFromBar,
    prevSnapshotIndexFromBar,
    nextCueIndexFromSnapshot,
    activeNavigationMode: playheadMarkerIndex != null ? "cue" : "snapshot",
    activeCueIndex: playheadMarkerIndex != null ? playheadMarkerIndex + 1 : null,
    activeSnapshotId:
      playheadStepIndex >= 0 && !playheadIsEnd ? (snapshots[playheadStepIndex]?.id ?? null) : null,
    snapshotSelectValue,
    cueSelectValue,
    impliedPendingSnapshotIndex,
    impliedPendingCueIndex,
    terminalSequenceTarget: TERMINAL_SEQUENCE_TARGET,
  };
}
