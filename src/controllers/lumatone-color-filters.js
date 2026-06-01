export const LUMATONE_COLOR_FILTER_LIBRARY_KEY = "hexatone_lumatone_color_filters";
export const LUMATONE_COLOR_FILTER_SELECTED_KEY = "hexatone_lumatone_color_filter_selected";
export const LUMATONE_COLOR_FILTER_ALL = "all";
export const LUMATONE_COLOR_FILTER_DARK = "dark";
export const LUMATONE_COLOR_FILTER_CUSTOM = "__custom__";

function uniqueSortedDegrees(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

export function parseLumatoneDegreeFilter(raw) {
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

export function formatLumatoneDegreeFilter(degrees) {
  return uniqueSortedDegrees(
    (Array.isArray(degrees) ? degrees : [])
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value >= 0),
  ).join(",");
}

export function normalizeLumatoneColorFilterLibrary(library) {
  if (!Array.isArray(library)) return [];
  const seen = new Set();
  const normalized = [];
  for (const entry of library) {
    const name = String(entry?.name ?? "").trim();
    if (!name || seen.has(name)) continue;
    const rawDegrees = Array.isArray(entry?.degrees)
      ? formatLumatoneDegreeFilter(entry.degrees)
      : formatLumatoneDegreeFilter(parseLumatoneDegreeFilter(entry?.filter ?? "") ?? []);
    seen.add(name);
    normalized.push({ name, filter: rawDegrees });
  }
  return normalized;
}

export function readLumatoneColorFilterLibrary(storage = localStorage) {
  try {
    const raw = storage.getItem(LUMATONE_COLOR_FILTER_LIBRARY_KEY);
    if (!raw) return [];
    return normalizeLumatoneColorFilterLibrary(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeLumatoneColorFilterLibrary(library, storage = localStorage) {
  storage.setItem(
    LUMATONE_COLOR_FILTER_LIBRARY_KEY,
    JSON.stringify(
      normalizeLumatoneColorFilterLibrary(library).map((entry) => ({
        name: entry.name,
        degrees: parseLumatoneDegreeFilter(entry.filter) ?? [],
      })),
    ),
  );
}

export function exportableLumatoneColorFilterLibrary(library) {
  return {
    version: 1,
    filters: normalizeLumatoneColorFilterLibrary(library).map((entry) => ({
      name: entry.name,
      degrees: parseLumatoneDegreeFilter(entry.filter) ?? [],
    })),
  };
}

export function importLumatoneColorFilterLibrary(payload) {
  if (Array.isArray(payload)) return normalizeLumatoneColorFilterLibrary(payload);
  return normalizeLumatoneColorFilterLibrary(payload?.filters);
}

export function degreeFilterSetFromSettings(settings) {
  if (settings?.lumatone_degree_filter_mode !== "filter") return null;
  const parsed = parseLumatoneDegreeFilter(settings?.lumatone_degree_filter ?? "");
  if (!parsed) return new Set();
  return new Set(parsed);
}
