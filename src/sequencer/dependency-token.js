// Dependency tokens give stable, human-readable identities to input references
// so diagnostics can report which playback-affecting inputs changed between
// runtime rebuilds without deep-serializing large sequencer structures.

const objectIds = new WeakMap();
let nextObjectId = 1;

function objectToken(value) {
  if (value == null) return String(value);
  const valueType = typeof value;
  if (valueType !== "object" && valueType !== "function") {
    return `${valueType}:${String(value)}`;
  }
  if (!objectIds.has(value)) {
    objectIds.set(value, nextObjectId);
    nextObjectId += 1;
  }
  const prefix = Array.isArray(value) ? "array" : valueType;
  return `${prefix}:${objectIds.get(value)}`;
}

export function buildDependencyToken(parts = []) {
  return parts.map((part) => objectToken(part)).join("|");
}
