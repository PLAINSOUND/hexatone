import { parseDegreeFilter as parseContinuumRasterFilter, formatDegreeFilter as formatContinuumRasterFilter } from "./degree-filter.js";
export { parseContinuumRasterFilter, formatContinuumRasterFilter };
/**
 * Parsing, normalisation and localStorage library for Continuum degree filters.
 * The Haken settings panel edits these records; input pitch/raster handling uses
 * the resulting degree Set. Filtering does not itself send MIDI.
 */

export const CONTINUUM_RASTER_FILTER_LIBRARY_KEY = "hexatone_continuum_raster_filters";
export const CONTINUUM_RASTER_FILTER_SELECTED_KEY = "hexatone_continuum_raster_filter_selected";
export const CONTINUUM_RASTER_FILTER_ALL = "all";
export const CONTINUUM_RASTER_FILTER_CUSTOM = "__custom__";

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
