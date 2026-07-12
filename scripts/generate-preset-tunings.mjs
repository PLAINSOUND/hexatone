import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const presetTuningsDir = path.join(repoRoot, "src/hexatone/preset-tunings");
const presetRegistryFile = path.join(presetTuningsDir, "preset-registry.json");

function categoryNameFromSlug(slug) {
  return String(slug ?? "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function readExistingPresetRegistry() {
  if (!fs.existsSync(presetRegistryFile)) return { categories: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(presetRegistryFile, "utf8"));
    return Array.isArray(parsed?.categories) ? parsed : { categories: [] };
  } catch {
    return { categories: [] };
  }
}

function discoverPresetFolders() {
  return fs.readdirSync(presetTuningsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function discoverPresetSlugsForCategory(categorySlug) {
  const categoryDir = path.join(presetTuningsDir, categorySlug);
  return fs.readdirSync(categoryDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.replace(/\.json$/, ""))
    .sort((a, b) => a.localeCompare(b));
}

function buildPresetRegistry(existingRegistry) {
  const discoveredCategories = discoverPresetFolders();
  const existingCategories = Array.isArray(existingRegistry?.categories)
    ? existingRegistry.categories
    : [];
  const existingBySlug = new Map(
    existingCategories
      .filter((entry) => entry && typeof entry.slug === "string")
      .map((entry) => [entry.slug, entry]),
  );
  const existingOrder = existingCategories
    .map((entry) => entry?.slug)
    .filter((slug) => typeof slug === "string" && discoveredCategories.includes(slug));
  const categoryOrder = [
    ...existingOrder,
    ...discoveredCategories.filter((slug) => !existingOrder.includes(slug)),
  ];

  return {
    categories: categoryOrder.map((slug) => {
      const existingCategory = existingBySlug.get(slug);
      const discoveredPresetSlugs = discoverPresetSlugsForCategory(slug);
      const existingPresetOrder = Array.isArray(existingCategory?.presets)
        ? existingCategory.presets.map((item) => String(item))
        : [];
      const presetOrder = [
        ...existingPresetOrder.filter((presetSlug) => discoveredPresetSlugs.includes(presetSlug)),
        ...discoveredPresetSlugs.filter((presetSlug) => !existingPresetOrder.includes(presetSlug)),
      ];
      return {
        slug,
        name: String(existingCategory?.name ?? categoryNameFromSlug(slug)),
        presets: presetOrder,
      };
    }),
  };
}

function main() {
  const presetRegistry = buildPresetRegistry(readExistingPresetRegistry());
  fs.writeFileSync(presetRegistryFile, `${JSON.stringify(presetRegistry, null, 2)}\n`);
  console.log(
    `Generated preset registry for ${presetRegistry.categories.length} tuning groups in ${
      path.relative(repoRoot, presetTuningsDir)
    }`,
  );
}

main();
