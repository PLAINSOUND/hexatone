function normalizeStructuralPosition(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 1000000) / 1000000;
}

function shiftMarkerAfterInsertion(marker, insertionPosition) {
  const position = normalizeStructuralPosition(marker?.position);
  if (position == null || position < insertionPosition - 1e-9) return marker;
  return {
    ...marker,
    position: normalizeStructuralPosition(position + 1),
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
} = {}) {
  const normalizedInsertionPosition = Math.max(1, Math.round(Number(insertionPosition) || 1));
  return {
    bars: Array.isArray(bars)
      ? bars.map((bar) => shiftMarkerAfterInsertion(bar, normalizedInsertionPosition))
      : [],
    tempi: Array.isArray(tempi)
      ? tempi.map((tempo) => shiftMarkerAfterInsertion(tempo, normalizedInsertionPosition))
      : [],
    repeats: Array.isArray(repeats)
      ? repeats.map((repeat) => shiftMarkerAfterInsertion(repeat, normalizedInsertionPosition))
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
