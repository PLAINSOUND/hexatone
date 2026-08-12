// Display projections are JSON-shaped. Reuse the previous projection when a
// live tuning runtime changes identity without changing any rendered value so
// the full sequence runtime does not rebuild for an identity-only change.

function jsonValuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (left == null || right == null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!jsonValuesEqual(left[index], right[index])) return false;
    }
    return true;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!jsonValuesEqual(left[key], right[key])) return false;
  }
  return true;
}

export function reuseEquivalentDisplaySnapshots(previousSnapshots, nextSnapshots) {
  if (!Array.isArray(previousSnapshots) || !Array.isArray(nextSnapshots)) return nextSnapshots;
  return jsonValuesEqual(previousSnapshots, nextSnapshots) ? previousSnapshots : nextSnapshots;
}
