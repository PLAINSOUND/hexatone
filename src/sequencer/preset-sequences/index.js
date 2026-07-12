/**
 * src/sequencer/preset-sequences/index.js
 *
 * Built-in Sequencer library loader.
 *
 * This mirrors the Hexatone preset-tunings strategy in a lighter form: folder
 * names are treated as lowercase slug categories, display names are derived or
 * overridden by registry metadata, and per-sequence file slugs can be ordered
 * explicitly through a small registry JSON file.
 */
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

function normalizeSequenceModule(pathname, moduleValue) {
  const sequence = moduleValue?.default ?? moduleValue;
  if (!sequence || typeof sequence !== "object") return null;
  const name = String(sequence.name ?? "").trim();
  if (!name) return null;
  const categorySlug = categorySlugFromPath(pathname);
  if (!categorySlug) return null;
  return {
    categorySlug,
    fileSlug: fileSlugFromPath(pathname),
    sequence,
  };
}

export function buildPresetSequenceGroups({
  jsonModules,
  presetRegistry: registry = presetRegistry,
}) {
  const sequencesByCategory = new Map();

  for (const [pathname, moduleValue] of Object.entries(jsonModules)) {
    const entry = normalizeSequenceModule(pathname, moduleValue);
    if (!entry) continue;
    const existing = sequencesByCategory.get(entry.categorySlug) ?? [];
    existing.push(entry);
    sequencesByCategory.set(entry.categorySlug, existing);
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
    ...sequencesByCategory.keys(),
    ...registryBySlug.keys(),
  ]);

  const categoryEntries = [...discoveredSlugs].map((slug) => {
    const metadata = registryBySlug.get(slug);
    return {
      slug,
      name: metadata?.name ?? categoryNameFromSlug(slug),
      order: Array.isArray(metadata?.sequences) ? metadata.sequences.map((item) => String(item)) : [],
    };
  });

  categoryEntries.sort((a, b) => {
    const aIndex = registryOrder.indexOf(a.slug);
    const bIndex = registryOrder.indexOf(b.slug);
    const normalizedAIndex = aIndex === -1 ? Number.POSITIVE_INFINITY : aIndex;
    const normalizedBIndex = bIndex === -1 ? Number.POSITIVE_INFINITY : bIndex;
    if (normalizedAIndex !== normalizedBIndex) return normalizedAIndex - normalizedBIndex;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  return categoryEntries.map((entry) => {
    const orderIndex = new Map(entry.order.map((slug, index) => [slug, index]));
    return {
      name: entry.name,
      sequences: [...(sequencesByCategory.get(entry.slug) ?? [])]
        .sort((a, b) => {
          const aIndex = orderIndex.has(a.fileSlug) ? orderIndex.get(a.fileSlug) : Number.POSITIVE_INFINITY;
          const bIndex = orderIndex.has(b.fileSlug) ? orderIndex.get(b.fileSlug) : Number.POSITIVE_INFINITY;
          if (aIndex !== bIndex) return aIndex - bIndex;
          return a.sequence.name.localeCompare(b.sequence.name, undefined, { numeric: true });
        })
        .map((item) => item.sequence),
    };
  });
}

// Eager import keeps the built-in sequence list synchronous for the sidebar UI.
const presetSequenceModules = import.meta.glob("./*/*.json", {
  eager: true,
  import: "default",
});

export const presetSequenceGroups = buildPresetSequenceGroups({
  jsonModules: presetSequenceModules,
});

export function findPresetSequenceByName(name) {
  const target = String(name ?? "").trim();
  if (!target) return null;
  for (const group of presetSequenceGroups) {
    const match = group.sequences.find((sequence) => sequence.name === target);
    if (match) return match;
  }
  return null;
}
