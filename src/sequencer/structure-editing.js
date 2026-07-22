// This module owns structural marker edits around snapshots.
// It updates bars, tempi, and repeats when snapshots are inserted, deleted, or
// moved so the sequence timeline stays aligned without embedding that logic in
// app.jsx or row components.

import {
  deriveTerminalBarlinePosition,
  deriveImplicitRepeatStartPosition,
  deriveImplicitRepeatStartPositionsForDanglingEnds,
  normalizeBarMarker,
  normalizeRepeatMarker,
  normalizeTempoMarkers,
} from "./transport.js";

function normalizeStructuralPosition(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 1000000) / 1000000;
}

function shiftMarkerAfterInsertion(marker, insertionPosition, snapshotCount = 1) {
  const position = normalizeStructuralPosition(marker?.position);
  if (position == null || position < insertionPosition - 1e-9) return marker;
  return {
    ...marker,
    position: normalizeStructuralPosition(position + snapshotCount),
  };
}

function shiftMarkerAfterDeletion(marker, deletionPosition, { collapseWithinSnapshot = false } = {}) {
  const position = normalizeStructuralPosition(marker?.position);
  if (position == null) return marker;
  const snapshotStart = deletionPosition;
  const snapshotEnd = deletionPosition + 1;

  if (collapseWithinSnapshot && position > snapshotStart + 1e-9 && position < snapshotEnd - 1e-9) {
    return {
      ...marker,
      position: snapshotStart,
    };
  }

  if (position >= snapshotEnd - 1e-9) {
    return {
      ...marker,
      position: normalizeStructuralPosition(position - 1),
    };
  }

  return marker;
}

function shiftMarkerAfterRangeDeletion(
  marker,
  startPosition,
  endPosition,
  {
    collapseWithinRange = false,
  } = {},
) {
  const position = normalizeStructuralPosition(marker?.position);
  if (position == null) return marker;
  const snapshotStart = startPosition;
  const snapshotEnd = endPosition + 1;
  const deletedCount = Math.max(1, endPosition - startPosition + 1);

  if (collapseWithinRange && position > snapshotStart + 1e-9 && position < snapshotEnd - 1e-9) {
    return {
      ...marker,
      position: snapshotStart,
    };
  }

  if (position >= snapshotEnd - 1e-9) {
    return {
      ...marker,
      position: normalizeStructuralPosition(position - deletedCount),
    };
  }

  return marker;
}

function chooseLaterMarker(left, right) {
  const leftOriginalPosition = normalizeStructuralPosition(left?._originalPosition);
  const rightOriginalPosition = normalizeStructuralPosition(right?._originalPosition);
  if (leftOriginalPosition == null) return right;
  if (rightOriginalPosition == null) return left;
  if (rightOriginalPosition > leftOriginalPosition + 1e-9) return right;
  if (leftOriginalPosition > rightOriginalPosition + 1e-9) return left;
  return right;
}

function dedupeStructuralCollisions(markers = []) {
  const byPosition = new Map();
  markers.forEach((marker) => {
    const position = normalizeStructuralPosition(marker?.position);
    if (position == null) return;
    const key = position.toFixed(6);
    const current = byPosition.get(key);
    const candidate = current == null ? marker : chooseLaterMarker(current, marker);
    byPosition.set(key, candidate);
  });
  return [...byPosition.values()].map(({ _originalPosition, ...marker }) => marker);
}

export function shiftStructuralMarkersAfterSnapshotInsertion({
  bars = [],
  tempi = [],
  repeats = [],
  insertionPosition,
  snapshotCount = 1,
} = {}) {
  const normalizedInsertionPosition = Math.max(1, Math.round(Number(insertionPosition) || 1));
  const normalizedSnapshotCount = Math.max(1, Math.round(Number(snapshotCount) || 1));
  return {
    bars: Array.isArray(bars)
      ? bars.map((bar) => shiftMarkerAfterInsertion(bar, normalizedInsertionPosition, normalizedSnapshotCount))
      : [],
    tempi: Array.isArray(tempi)
      ? tempi.map((tempo) => shiftMarkerAfterInsertion(tempo, normalizedInsertionPosition, normalizedSnapshotCount))
      : [],
    repeats: Array.isArray(repeats)
      ? repeats.map((repeat) => shiftMarkerAfterInsertion(repeat, normalizedInsertionPosition, normalizedSnapshotCount))
      : [],
  };
}

export function shiftStructuralMarkersAfterSnapshotDeletion({
  bars = [],
  tempi = [],
  repeats = [],
  deletionPosition,
} = {}) {
  const normalizedDeletionPosition = Math.max(1, Math.round(Number(deletionPosition) || 1));
  const annotateOriginalPosition = (marker) => ({
    ...marker,
    _originalPosition: normalizeStructuralPosition(marker?.position),
  });

  const nextBars = dedupeStructuralCollisions(
    (Array.isArray(bars) ? bars : [])
      .map(annotateOriginalPosition)
      .map((bar) => shiftMarkerAfterDeletion(bar, normalizedDeletionPosition)),
  );

  const nextTempi = dedupeStructuralCollisions(
    (Array.isArray(tempi) ? tempi : [])
      .map(annotateOriginalPosition)
      .map((tempo) => shiftMarkerAfterDeletion(tempo, normalizedDeletionPosition, { collapseWithinSnapshot: true })),
  );

  const nextRepeats = (Array.isArray(repeats) ? repeats : [])
    .map((repeat) => shiftMarkerAfterDeletion(repeat, normalizedDeletionPosition, { collapseWithinSnapshot: true }));

  return {
    bars: nextBars,
    tempi: nextTempi,
    repeats: nextRepeats,
  };
}

export function shiftStructuralMarkersAfterSnapshotRangeDeletion({
  bars = [],
  tempi = [],
  repeats = [],
  startPosition,
  endPosition,
  deleteBarsInRange = false,
  deleteTempiInRange = false,
  deleteRepeatsInRange = false,
} = {}) {
  const normalizedStartPosition = Math.max(1, Math.round(Number(startPosition) || 1));
  const normalizedEndPosition = Math.max(normalizedStartPosition, Math.round(Number(endPosition) || normalizedStartPosition));
  const annotateOriginalPosition = (marker) => ({
    ...marker,
    _originalPosition: normalizeStructuralPosition(marker?.position),
  });
  const isWithinDeletedRange = (marker) => {
    const position = normalizeStructuralPosition(marker?.position);
    return position != null
      && position >= normalizedStartPosition - 1e-9
      && position < normalizedEndPosition + 1 - 1e-9;
  };

  const nextBars = dedupeStructuralCollisions(
    (Array.isArray(bars) ? bars : [])
      .filter((bar) => !(deleteBarsInRange && isWithinDeletedRange(bar)))
      .map(annotateOriginalPosition)
      .map((bar) => shiftMarkerAfterRangeDeletion(bar, normalizedStartPosition, normalizedEndPosition)),
  );

  const nextTempi = dedupeStructuralCollisions(
    (Array.isArray(tempi) ? tempi : [])
      .filter((tempo) => !(deleteTempiInRange && isWithinDeletedRange(tempo)))
      .map(annotateOriginalPosition)
      .map((tempo) => shiftMarkerAfterRangeDeletion(
        tempo,
        normalizedStartPosition,
        normalizedEndPosition,
        { collapseWithinRange: true },
      )),
  );

  const nextRepeats = (Array.isArray(repeats) ? repeats : [])
    .filter((repeat) => !(deleteRepeatsInRange && isWithinDeletedRange(repeat)))
    .map((repeat) => shiftMarkerAfterRangeDeletion(
      repeat,
      normalizedStartPosition,
      normalizedEndPosition,
      { collapseWithinRange: true },
    ));

  return {
    bars: nextBars,
    tempi: nextTempi,
    repeats: nextRepeats,
  };
}

function normalizeRequestedBarPosition(position, bars = []) {
  const explicitPosition = Number(position);
  if (Number.isFinite(explicitPosition)) {
    return Math.max(1, Math.round(explicitPosition));
  }
  return bars.length > 0
    ? Math.max(...bars.map((bar) => Number(bar.position) || 1)) + 1
    : 1;
}

function findExistingBarAtPosition(bars, excludedBarId, nextPosition, snapshots) {
  const remainingBars = (bars ?? []).filter((bar) => bar.id !== excludedBarId);
  const terminalPosition = deriveTerminalBarlinePosition(snapshots, remainingBars);
  if (Number(nextPosition) >= Number(terminalPosition) - 1e-9) return null;
  return (bars ?? []).find((bar) => (
    bar.id !== excludedBarId && Math.abs(Number(bar.position) - Number(nextPosition)) < 1e-9
  )) ?? null;
}

export function addSequenceBarMarker({
  bars = [],
  nextBarId,
  position = null,
  numerator = 4,
  denominator = 4,
  confirmReplace = () => true,
} = {}) {
  const id = Number(nextBarId);
  const nextPosition = normalizeRequestedBarPosition(position, bars);
  const nextNumerator = Math.max(0, Math.round(Number(numerator) || 0));
  const nextDenominator = Math.max(1, Math.round(Number(denominator) || 1));
  const existingBar = (bars ?? []).find((bar) => Math.abs(Number(bar.position) - nextPosition) < 1e-9) ?? null;
  if (existingBar) {
    if (!confirmReplace()) {
      return { bars, nextBarId: id - 1 };
    }
    return {
      bars: [
        ...(bars ?? []).filter((bar) => bar.id !== existingBar.id),
        normalizeBarMarker({
          id,
          position: nextPosition,
          numerator: nextNumerator,
          denominator: nextDenominator,
        }),
      ],
      nextBarId: id,
    };
  }
  return {
    bars: [
      ...(bars ?? []),
      normalizeBarMarker({
        id,
        position: nextPosition,
        numerator: nextNumerator,
        denominator: nextDenominator,
      }),
    ],
    nextBarId: id,
  };
}

export function addBarsBeforeSnapshots({
  bars = [],
  snapshotCount = 0,
  nextBarId = 0,
} = {}) {
  const existingPositions = new Set(
    (bars ?? [])
      .map((bar) => Number(bar.position))
      .filter((position) => Number.isFinite(position))
      .map((position) => position.toFixed(3)),
  );

  const additions = [];
  let resolvedNextId = Number(nextBarId) || 0;
  for (let i = 0; i < snapshotCount; i += 1) {
    const position = i + 1;
    const key = position.toFixed(3);
    if (existingPositions.has(key)) continue;
    resolvedNextId += 1;
    additions.push(normalizeBarMarker({ id: resolvedNextId, position }));
    existingPositions.add(key);
  }

  if (additions.length === 0) {
    return { bars, nextBarId: Number(nextBarId) || 0 };
  }
  return {
    bars: [...(bars ?? []), ...additions],
    nextBarId: resolvedNextId,
  };
}

export function addSequenceTempoMarker({
  tempi = [],
  position = null,
  bpm = 60,
  mode = "immediate",
} = {}) {
  const id = (Array.isArray(tempi) ? tempi : []).reduce((max, tempo) => Math.max(max, Number(tempo?.id) || 0), 0) + 1;
  const nextTempo = normalizeTempoMarkers([{
    id,
    position,
    bpm,
    beatNumerator: 1,
    beatDenominator: 4,
    beatLength: 1,
    mode,
  }], { includeDefault: false })[0];
  return [...(tempi ?? []), nextTempo];
}

export function updateSequenceTempoMarker({
  tempi = [],
  tempoId,
  updates = {},
} = {}) {
  const source = Array.isArray(tempi) ? tempi : [];
  const hasMatchingTempo = source.some((tempo) => tempo.id === tempoId);
  if (!hasMatchingTempo && tempoId === "tempo:default") {
    const id = source.reduce(
      (max, tempo) => Math.max(max, Number(tempo?.id) || 0),
      0,
    ) + 1;
    const materializedDefault = normalizeTempoMarkers([{
      id,
      position: 1,
      bpm: 60,
      beatNumerator: 1,
      beatDenominator: 4,
      beatLength: 1,
      mode: "immediate",
      ...updates,
    }], { includeDefault: false })[0];
    return [materializedDefault, ...source];
  }

  return source.map((tempo) => (
    tempo.id === tempoId
      ? normalizeTempoMarkers([{ ...tempo, ...updates }], { includeDefault: false })[0]
      : tempo
  ));
}

export function addSequenceRepeatMarker({
  repeats = [],
  position = null,
  kind = "start",
} = {}) {
  let nextId = (Array.isArray(repeats) ? repeats : []).reduce((max, marker) => Math.max(max, Number(marker?.id) || 0), 0) + 1;
  const normalizedKind = kind === "end" ? "end" : "start";
  const normalizedPosition = Number.isFinite(Number(position))
    ? Math.round(Number(position) * 1000000) / 1000000
    : 1;

  if (normalizedKind === "end" && normalizedPosition <= 1) {
    return repeats;
  }

  const additions = [];
  if (normalizedKind === "end") {
    const implicitStartPosition = deriveImplicitRepeatStartPosition(repeats, normalizedPosition);
    if (implicitStartPosition != null) {
      additions.push(normalizeRepeatMarker({
        id: nextId,
        position: implicitStartPosition,
        kind: "start",
        repeatCount: null,
      }));
      nextId += 1;
    }
  }

  additions.push(normalizeRepeatMarker({
    id: nextId,
    position: normalizedPosition,
    kind: normalizedKind,
    repeatCount: normalizedKind === "end" ? 2 : null,
  }));
  nextId += 1;

  if (normalizedKind === "end") {
    const completed = [...(repeats ?? []), ...additions];
    const supplementalStartPositions = deriveImplicitRepeatStartPositionsForDanglingEnds(completed);
    supplementalStartPositions.forEach((startPosition) => {
      if (
        additions.some((marker) => marker.kind === "start" && Math.abs(Number(marker.position) - Number(startPosition)) < 1e-9)
      ) {
        return;
      }
      additions.push(normalizeRepeatMarker({
        id: nextId,
        position: startPosition,
        kind: "start",
        repeatCount: null,
      }));
      nextId += 1;
    });
  }

  return [...(repeats ?? []), ...additions];
}

export function updateSequenceRepeatMarker({
  repeats = [],
  repeatId,
  updates = {},
} = {}) {
  return (repeats ?? []).map((marker) => {
    if (marker.id !== repeatId) return marker;
    const nextMarker = normalizeRepeatMarker({ ...marker, ...updates });
    if (
      nextMarker.kind === "end"
      && updates != null
      && Object.hasOwn(updates, "position")
      && Number(nextMarker.position) <= 1
    ) {
      return marker;
    }
    return nextMarker;
  });
}

export function updateSequenceBarMarker({
  bars = [],
  snapshots = [],
  barId,
  updates = {},
  nextBarId = 0,
  confirmReplace = () => true,
} = {}) {
  const currentBar = (bars ?? []).find((bar) => bar.id === barId);
  const isRootBar = currentBar != null && Math.abs(Number(currentBar.position) - 1) < 1e-9;
  const rawNextPosition = Number(updates?.position);
  const nextPosition = Number.isFinite(rawNextPosition)
    ? Math.max(1, Math.round(rawNextPosition))
    : NaN;
  const normalizedUpdates = Number.isFinite(nextPosition)
    ? { ...updates, position: nextPosition }
    : updates;

  if (Number.isFinite(nextPosition) && isRootBar) {
    const existingBar = findExistingBarAtPosition(bars, barId, nextPosition, snapshots);
    if (existingBar) {
      if (!confirmReplace()) return { bars, nextBarId };
      const replacementId = Number(nextBarId) + 1;
      return {
        bars: [
          ...(bars ?? []).filter((bar) => bar.id !== existingBar.id),
          normalizeBarMarker({ ...currentBar, ...normalizedUpdates, id: replacementId, position: nextPosition }),
        ],
        nextBarId: replacementId,
      };
    }
    const replacementId = Number(nextBarId) + 1;
    return {
      bars: [
        ...(bars ?? []),
        normalizeBarMarker({ ...currentBar, ...normalizedUpdates, id: replacementId, position: nextPosition }),
      ],
      nextBarId: replacementId,
    };
  }

  if (Number.isFinite(nextPosition)) {
    const existingBar = findExistingBarAtPosition(bars, barId, nextPosition, snapshots);
    if (existingBar) {
      if (!confirmReplace()) return { bars, nextBarId };
      return {
        bars: (bars ?? [])
          .filter((bar) => bar.id !== existingBar.id)
          .map((bar) => (bar.id === barId ? { ...bar, ...normalizedUpdates } : bar)),
        nextBarId,
      };
    }
  }

  return {
    bars: (bars ?? []).map((bar) => (
      bar.id === barId ? { ...bar, ...normalizedUpdates } : bar
    )),
    nextBarId,
  };
}

export function moveSequenceBarMarker({
  bars = [],
  snapshots = [],
  barId,
  position,
  nextBarId = 0,
  confirmReplace = () => true,
} = {}) {
  const rawPosition = Number(position);
  const nextPosition = Number.isFinite(rawPosition)
    ? Math.max(1, Math.round(rawPosition))
    : NaN;
  if (!Number.isFinite(nextPosition)) {
    return { bars, nextBarId };
  }

  const currentBar = (bars ?? []).find((bar) => bar.id === barId);
  const isRootBar = currentBar != null && Math.abs(Number(currentBar.position) - 1) < 1e-9;
  if (isRootBar) {
    const existingBar = findExistingBarAtPosition(bars, barId, nextPosition, snapshots);
    if (existingBar) {
      if (!confirmReplace()) return { bars, nextBarId };
      const replacementId = Number(nextBarId) + 1;
      return {
        bars: [
          ...(bars ?? []).filter((bar) => bar.id !== existingBar.id),
          normalizeBarMarker({ ...currentBar, id: replacementId, position: nextPosition }),
        ],
        nextBarId: replacementId,
      };
    }
    const replacementId = Number(nextBarId) + 1;
    return {
      bars: [
        ...(bars ?? []),
        normalizeBarMarker({ ...currentBar, id: replacementId, position: nextPosition }),
      ],
      nextBarId: replacementId,
    };
  }

  const existingBar = findExistingBarAtPosition(bars, barId, nextPosition, snapshots);
  if (existingBar) {
    if (!confirmReplace()) return { bars, nextBarId };
    return {
      bars: (bars ?? [])
        .filter((bar) => bar.id !== existingBar.id)
        .map((bar) => (bar.id === barId ? { ...bar, position: nextPosition } : bar)),
      nextBarId,
    };
  }

  return {
    bars: (bars ?? []).map((bar) => (
      bar.id === barId ? { ...bar, position: nextPosition } : bar
    )),
    nextBarId,
  };
}
