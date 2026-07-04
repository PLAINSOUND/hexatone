import { normalizeRepeatMarkers } from "./transport.js";

export function deriveRepeatSections(sequenceCueGroups = [], repeats = []) {
  const cueGroups = Array.isArray(sequenceCueGroups) ? sequenceCueGroups : [];
  const normalizedRepeats = normalizeRepeatMarkers(repeats);
  const sections = [];

  normalizedRepeats.forEach((marker, index) => {
    if (marker.kind === "start") return;

    let startMarker = null;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = normalizedRepeats[cursor];
      if (candidate?.kind !== "start") continue;
      startMarker = candidate;
      break;
    }
    if (!startMarker) return;

    const startCueIndex = cueGroups.findIndex((group) => Number(group?.time) >= Number(startMarker.position) - 1e-9);
    const endCueIndex = cueGroups.findLastIndex((group) => Number(group?.time) < Number(marker.position) - 1e-9);
    if (startCueIndex < 0 || endCueIndex < 0 || startCueIndex > endCueIndex) return;

    sections.push({
      repeatId: marker.id,
      startRepeatId: startMarker.id,
      startPosition: Number(startMarker.position),
      endPosition: Number(marker.position),
      repeatCount: Math.max(2, Math.round(Number(marker.repeatCount) || 2)),
      startCueIndex,
      endCueIndex,
    });
  });

  return sections.sort((left, right) => (
    left.endCueIndex - right.endCueIndex ||
    right.startCueIndex - left.startCueIndex
  ));
}

export function advanceCueIndexWithRepeats({
  currentCueIndex,
  cueCount,
  cueGroups = [],
  repeatSections = [],
  repeatPlaybackState = {},
}) {
  const safeCueCount = Number(cueCount) || 0;
  if (safeCueCount <= 0) {
    return {
      nextCueIndex: -1,
      nextRepeatPlaybackState: repeatPlaybackState,
      didLoop: false,
    };
  }

  const safeCurrentCueIndex = Number(currentCueIndex);
  if (!Number.isFinite(safeCurrentCueIndex) || safeCurrentCueIndex < 0) {
    return {
      nextCueIndex: 0,
      nextRepeatPlaybackState: {},
      didLoop: false,
    };
  }

  const naturalNextCueIndex = safeCurrentCueIndex + 1;
  const currentCueTime = safeCurrentCueIndex < cueGroups.length
    ? Number(cueGroups[safeCurrentCueIndex]?.time)
    : -Infinity;
  const nextCueTime = naturalNextCueIndex < cueGroups.length
    ? Number(cueGroups[naturalNextCueIndex]?.time)
    : Infinity;
  const matchingSection = repeatSections.find((section) => {
    if (!Number.isFinite(currentCueTime)) return false;
    if (currentCueTime < Number(section.startPosition) - 1e-9) return false;
    if (currentCueTime >= Number(section.endPosition) - 1e-9) return false;
    return nextCueTime >= Number(section.endPosition) - 1e-9;
  });
  if (matchingSection) {
    const remaining = Number.isFinite(Number(repeatPlaybackState[matchingSection.repeatId]))
      ? Number(repeatPlaybackState[matchingSection.repeatId])
      : matchingSection.repeatCount - 1;
    if (remaining > 0) {
      return {
        nextCueIndex: matchingSection.startCueIndex,
        nextRepeatPlaybackState: {
          ...repeatPlaybackState,
          [matchingSection.repeatId]: remaining - 1,
        },
        didLoop: true,
      };
    }

    const nextRepeatPlaybackState = { ...repeatPlaybackState };
    delete nextRepeatPlaybackState[matchingSection.repeatId];
    return {
      nextCueIndex: naturalNextCueIndex,
      nextRepeatPlaybackState,
      didLoop: false,
    };
  }

  return {
    nextCueIndex: naturalNextCueIndex,
    nextRepeatPlaybackState: repeatPlaybackState,
    didLoop: false,
  };
}
