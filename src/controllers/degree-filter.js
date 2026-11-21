/** Shared degree-list syntax; controller-specific modes and storage stay local. */
function uniqueSortedDegrees(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

export function parseDegreeFilter(raw) {
  if (raw == null) return [];
  const tokens = String(raw)
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const degrees = [];
  for (const token of tokens) {
    if (!/^\d+$/.test(token)) return null;
    degrees.push(Number.parseInt(token, 10));
  }
  return uniqueSortedDegrees(degrees);
}

export function formatDegreeFilter(degrees) {
  return uniqueSortedDegrees(
    (Array.isArray(degrees) ? degrees : [])
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value >= 0),
  ).join(",");
}
