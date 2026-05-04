import Point from "./point";

function intOrZero(value) {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

export function normalizeGeometryDelta(entry = {}) {
  const legacyX = Number(entry?.surfaceDeltaX);
  const legacyY = Number(entry?.surfaceDeltaY);
  const deltaRSteps = Number(entry?.deltaRSteps);
  const deltaDrSteps = Number(entry?.deltaDrSteps);
  return {
    deltaRSteps: Number.isFinite(deltaRSteps) ? Math.trunc(deltaRSteps) : intOrZero(legacyX),
    deltaDrSteps: Number.isFinite(deltaDrSteps) ? Math.trunc(deltaDrSteps) : intOrZero(legacyY),
  };
}

export function geometryDeltaFromCoords(sourceCoords, targetCoords) {
  if (!sourceCoords || !targetCoords) return null;
  return {
    deltaRSteps: Math.trunc(targetCoords.x - sourceCoords.x),
    deltaDrSteps: Math.trunc(targetCoords.y - sourceCoords.y),
  };
}

export function deriveGeometryShiftForHistory(history = [], fixedDoEnabled = false) {
  if (!fixedDoEnabled || !Array.isArray(history) || history.length === 0) {
    return { deltaRSteps: 0, deltaDrSteps: 0 };
  }

  return history.reduce((sum, entry) => {
    const count = intOrZero(entry?.count);
    if (count === 0) return sum;
    const delta = normalizeGeometryDelta(entry);
    return {
      deltaRSteps: sum.deltaRSteps + count * delta.deltaRSteps,
      deltaDrSteps: sum.deltaDrSteps + count * delta.deltaDrSteps,
    };
  }, { deltaRSteps: 0, deltaDrSteps: 0 });
}

export function applyGeometryShiftToCoords(coords, frame = null) {
  if (!coords) return coords;
  const dx = intOrZero(frame?.geometryShiftRSteps);
  const dy = intOrZero(frame?.geometryShiftDrSteps);
  if (dx === 0 && dy === 0) return coords;
  return new Point(coords.x + dx, coords.y + dy);
}
