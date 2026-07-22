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

function normalizeSequenceModule(pathname, moduleValue, metadata = null) {
  if (typeof moduleValue === "function") {
    const categorySlug = categorySlugFromPath(pathname);
    if (!categorySlug) return null;
    const fileSlug = fileSlugFromPath(pathname);
    return {
      categorySlug,
      fileSlug,
      sequence: {
        name: String(metadata?.name ?? fileSlug).trim(),
        load: moduleValue,
      },
    };
  }
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

  const registryCategories = Array.isArray(registry?.categories) ? registry.categories : [];
  const registrySequenceMetadata = new Map();
  for (const category of registryCategories) {
    for (const item of Array.isArray(category?.sequences) ? category.sequences : []) {
      if (item && typeof item === "object") {
        registrySequenceMetadata.set(`${category.slug}/${item.slug}`, item);
      }
    }
  }

  for (const [pathname, moduleValue] of Object.entries(jsonModules)) {
    const categorySlug = categorySlugFromPath(pathname);
    const fileSlug = fileSlugFromPath(pathname);
    const metadata = registrySequenceMetadata.get(`${categorySlug}/${fileSlug}`) ?? null;
    const entry = normalizeSequenceModule(pathname, moduleValue, metadata);
    if (!entry) continue;
    const existing = sequencesByCategory.get(entry.categorySlug) ?? [];
    existing.push(entry);
    sequencesByCategory.set(entry.categorySlug, existing);
  }

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
      order: Array.isArray(metadata?.sequences)
        ? metadata.sequences.map((item) => String(item?.slug ?? item))
        : [],
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

// The registry supplies menu metadata; each large sequence payload becomes its
// own Vite chunk and is fetched only when selected.
const presetSequenceModules = import.meta.glob("./*/*.json", {
  import: "default",
});

export const presetSequenceGroups = buildPresetSequenceGroups({
  jsonModules: presetSequenceModules,
});

const loadedPresetSequences = new Map();

function findPresetSequenceDescriptorByName(name) {
  const target = String(name ?? "").trim();
  if (!target) return null;
  for (const group of presetSequenceGroups) {
    const match = group.sequences.find((sequence) => sequence.name === target);
    if (match) return match;
  }
  return null;
}

export function findPresetSequenceByName(name) {
  return loadedPresetSequences.get(String(name ?? "").trim()) ?? null;
}

export async function loadPresetSequenceByName(name) {
  const target = String(name ?? "").trim();
  if (!target) return null;
  const cached = loadedPresetSequences.get(target);
  if (cached) return cached;
  const descriptor = findPresetSequenceDescriptorByName(target);
  if (!descriptor) return null;
  if (typeof descriptor.load !== "function") {
    loadedPresetSequences.set(target, descriptor);
    return descriptor;
  }
  const moduleValue = await descriptor.load();
  const sequence = moduleValue?.default ?? moduleValue;
  if (!sequence || typeof sequence !== "object") return null;
  loadedPresetSequences.set(target, sequence);
  return sequence;
}
