export const CONTINUUM_RASTER_FILTER_LIBRARY_KEY = "hexatone_continuum_raster_filters";
export const CONTINUUM_RASTER_FILTER_SELECTED_KEY = "hexatone_continuum_raster_filter_selected";
export const CONTINUUM_RASTER_FILTER_ALL = "all";
export const CONTINUUM_RASTER_FILTER_CUSTOM = "__custom__";

function uniqueSortedDegrees(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

export function parseContinuumRasterFilter(raw) {
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

export function formatContinuumRasterFilter(degrees) {
  return uniqueSortedDegrees(
    (Array.isArray(degrees) ? degrees : [])
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value >= 0),
  ).join(",");
}

export function normalizeContinuumRasterFilterLibrary(library) {
  if (!Array.isArray(library)) return [];
  const seen = new Set();
  const normalized = [];
  for (const entry of library) {
    const name = String(entry?.name ?? "").trim();
    if (!name || seen.has(name)) continue;
    const rawDegrees = Array.isArray(entry?.degrees)
      ? formatContinuumRasterFilter(entry.degrees)
      : formatContinuumRasterFilter(parseContinuumRasterFilter(entry?.filter ?? "") ?? []);
    seen.add(name);
    normalized.push({ name, filter: rawDegrees });
  }
  return normalized;
}

export function readContinuumRasterFilterLibrary(storage = localStorage) {
  try {
    const raw = storage.getItem(CONTINUUM_RASTER_FILTER_LIBRARY_KEY);
    if (!raw) return [];
    return normalizeContinuumRasterFilterLibrary(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeContinuumRasterFilterLibrary(library, storage = localStorage) {
  storage.setItem(
    CONTINUUM_RASTER_FILTER_LIBRARY_KEY,
    JSON.stringify(
      normalizeContinuumRasterFilterLibrary(library).map((entry) => ({
        name: entry.name,
        degrees: parseContinuumRasterFilter(entry.filter) ?? [],
      })),
    ),
  );
}

export function exportableContinuumRasterFilterLibrary(library) {
  return {
    version: 1,
    filters: normalizeContinuumRasterFilterLibrary(library).map((entry) => ({
      name: entry.name,
      degrees: parseContinuumRasterFilter(entry.filter) ?? [],
    })),
  };
}

export function importContinuumRasterFilterLibrary(payload) {
  if (Array.isArray(payload)) return normalizeContinuumRasterFilterLibrary(payload);
  return normalizeContinuumRasterFilterLibrary(payload?.filters);
}

export function continuumRasterFilterSetFromRuntime(inputRuntime) {
  if (inputRuntime?.hakenRasterFilterMode !== "filter") return null;
  const parsed = parseContinuumRasterFilter(inputRuntime?.hakenRasterFilter ?? "");
  if (!parsed) return new Set();
  return new Set(parsed);
}
