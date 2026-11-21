import { parseDegreeFilter as parseLumatoneDegreeFilter, formatDegreeFilter as formatLumatoneDegreeFilter } from "./degree-filter.js";
export { parseLumatoneDegreeFilter, formatLumatoneDegreeFilter };
/**
 * Parsing, normalisation and localStorage library for Lumatone LED degree filters.
 * The Lumatone settings panel and snapshot-filter generator supply lists; keyboard
 * LED rendering consumes the selected filter without changing the played tuning.
 */

export const LUMATONE_COLOR_FILTER_LIBRARY_KEY = "hexatone_lumatone_color_filters";
export const LUMATONE_COLOR_FILTER_SELECTED_KEY = "hexatone_lumatone_color_filter_selected";
export const LUMATONE_COLOR_FILTER_ALL = "all";
export const LUMATONE_COLOR_FILTER_DARK = "dark";
export const LUMATONE_COLOR_FILTER_CUSTOM = "__custom__";

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
