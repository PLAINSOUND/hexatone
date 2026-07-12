/**
 * src/hexatone/preset-tunings/index.js
 *
 * Built-in Hexatone tuning library loader.
 *
 * This module is the entrypoint for built-in tuning presets. It eagerly loads
 * the JSON preset files grouped under `preset-tunings/`, applies registry-based
 * ordering metadata, normalizes each record into the shared tuning-record
 * format, and then merges the file-backed library with any still-unmigrated
 * legacy preset groups from `settings/presets/preset_values`.
 */
import {
  default_settings as legacyDefaultSettings,
  presets as legacyPresetGroups,
} from "../../settings/presets/preset_values";
import { normalizeTuningGroup, normalizeTuningRecord } from "../tuning-record.js";
import presetRegistry from "./preset-registry.json";

function categorySlugFromPath(pathname) {
  const match = pathname.match(/^\.\/([^/]+)\//);
  return match?.[1] ?? "";
}

function fileSlugFromPath(pathname) {
  const match = pathname.match(/\/([^/]+)\.json$/);
  return match?.[1] ?? "";
}

function categoryNameFromSlug(slug) {
  return String(slug ?? "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildFilePresetTuningGroups({
  jsonModules,
  presetRegistry: registry = presetRegistry,
}) {
  const presetsByCategory = new Map();

  for (const [pathname, moduleValue] of Object.entries(jsonModules)) {
    const categorySlug = categorySlugFromPath(pathname);
    if (!categorySlug) continue;
    const preset = normalizeTuningRecord(moduleValue?.default ?? moduleValue);
    if (!preset) continue;
    const presetSlug = fileSlugFromPath(pathname);
    const entry = {
      ...preset,
      __fileSlug: presetSlug,
    };
    const existing = presetsByCategory.get(categorySlug) ?? [];
    existing.push(entry);
    presetsByCategory.set(categorySlug, existing);
  }

  const registryCategories = Array.isArray(registry?.categories) ? registry.categories : [];
  const registryBySlug = new Map(
    registryCategories
      .filter((entry) => entry && typeof entry.slug === "string")
      .map((entry) => [entry.slug, entry]),
  );
  const registryOrder = registryCategories
    .map((entry) => entry?.slug)
    .filter((slug) => typeof slug === "string");
  const discoveredSlugs = new Set([
    ...presetsByCategory.keys(),
    ...registryBySlug.keys(),
  ]);

  const categoryEntries = [...discoveredSlugs].map((slug) => {
    const metadata = registryBySlug.get(slug);
    return {
      slug,
      name: metadata?.name ?? categoryNameFromSlug(slug),
      order: Array.isArray(metadata?.presets) ? metadata.presets.map((item) => String(item)) : [],
    };
  });

  categoryEntries.sort((a, b) => {
    const aIndex = registryOrder.indexOf(a.slug);
    const bIndex = registryOrder.indexOf(b.slug);
    const normalizedAIndex = aIndex === -1 ? Number.POSITIVE_INFINITY : aIndex;
    const normalizedBIndex = bIndex === -1 ? Number.POSITIVE_INFINITY : bIndex;
    if (normalizedAIndex !== normalizedBIndex) return normalizedAIndex - normalizedBIndex;
    return a.name.localeCompare(b.name);
  });

  return categoryEntries.map((entry) => {
    const orderIndex = new Map(entry.order.map((slug, index) => [slug, index]));
    const settings = [...(presetsByCategory.get(entry.slug) ?? [])]
      .sort((a, b) => {
        const aIndex = orderIndex.has(a.__fileSlug) ? orderIndex.get(a.__fileSlug) : Number.POSITIVE_INFINITY;
        const bIndex = orderIndex.has(b.__fileSlug) ? orderIndex.get(b.__fileSlug) : Number.POSITIVE_INFINITY;
        if (aIndex !== bIndex) return aIndex - bIndex;
        return a.name.localeCompare(b.name);
      })
      .map(({ __fileSlug: _fileSlug, ...preset }) => preset);
    return {
      name: entry.name,
      settings,
    };
  });
}

function mergePresetTuningGroups(fileGroups, legacyGroups) {
  const normalizedFileGroups = fileGroups
    .map((group) => normalizeTuningGroup(group))
    .filter(Boolean);
  const normalizedLegacyGroups = legacyGroups
    .map((group) => normalizeTuningGroup(group))
    .filter(Boolean);

  const migratedNames = new Set(
    normalizedFileGroups.flatMap((group) => group.settings.map((setting) => setting.name)),
  );
  const fileGroupByName = new Map(normalizedFileGroups.map((group) => [group.name, group]));
  const consumedFileGroupNames = new Set();

  const merged = normalizedLegacyGroups.flatMap((legacyGroup) => {
    const remainingLegacySettings = legacyGroup.settings.filter(
      (setting) => !migratedNames.has(setting.name),
    );
    const fileGroup = fileGroupByName.get(legacyGroup.name);
    if (!fileGroup) {
      return remainingLegacySettings.length > 0
        ? [{ ...legacyGroup, settings: remainingLegacySettings }]
        : [];
    }
    consumedFileGroupNames.add(legacyGroup.name);
    return [{
      name: legacyGroup.name,
      settings: [...fileGroup.settings, ...remainingLegacySettings],
    }];
  });

  for (const fileGroup of normalizedFileGroups) {
    if (!consumedFileGroupNames.has(fileGroup.name)) merged.push(fileGroup);
  }

  return merged;
}

// Eager import keeps the built-in tuning list synchronous for the sidebar UI.
const filePresetJsonModules = import.meta.glob("./*/*.json", { eager: true });
export const filePresetTuningGroups = buildFilePresetTuningGroups({
  jsonModules: filePresetJsonModules,
});

export const presetTuningGroups = mergePresetTuningGroups(filePresetTuningGroups, legacyPresetGroups);

export function findPresetTuningByName(name) {
  const target = String(name ?? "").trim();
  if (!target) return null;
  for (const group of presetTuningGroups) {
    const found = group.settings.find((setting) => setting.name === target);
    if (found) return found;
  }
  return null;
}

export const defaultTuningRecord =
  findPresetTuningByName(legacyDefaultSettings?.name) ?? normalizeTuningRecord(legacyDefaultSettings);

export const legacyPresetTuningGroups = legacyPresetGroups
  .map((group) => normalizeTuningGroup(group))
  .filter(Boolean);
