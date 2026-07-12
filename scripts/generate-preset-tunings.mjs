import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseScale } from "../src/settings/scale/parse-scale.js";
import { normalizeTuningRecord } from "../src/hexatone/tuning-record.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const legacyPresetFile = path.join(repoRoot, "src/settings/presets/preset_values.js");
const scalesDir = path.join(repoRoot, "scales");
const presetTuningsDir = path.join(repoRoot, "src/hexatone/preset-tunings");
const presetRegistryFile = path.join(presetTuningsDir, "preset-registry.json");

const GROUP_SPECS = [
  { name: "Marc Sabat NYKY Ensemble", slug: "marc-sabat-nyky-ensemble" },
  { name: "12 Note Scales", slug: "12-note-scales" },
  { name: "Arabic and Persian Theoretical Systems", slug: "arabic-and-persian-theoretical-systems" },
  { name: "Indian Theoretical Systems", slug: "indian-theoretical-systems" },
  { name: "Harmonics and Subharmonics", slug: "harmonics-and-subharmonics" },
  { name: "Odd Partial Pitch Class Sets", slug: "odd-partial-pitch-class-sets" },
  { name: "Rational Intonation (JI)", slug: "rational-intonation-ji" },
  { name: "Extended Meantone", slug: "extended-meantone" },
  { name: "Equal Divisions", slug: "equal-divisions" },
  { name: "Scordatura", slug: "scordatura" },
];

const reservedFiles = new Set(["index.js", "index.test.js", "manifest.js"]);

function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-")
    .toLowerCase() || "preset";
}

function identifierFromSlug(value) {
  const base = String(value ?? "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safe = /^[A-Za-z_]/.test(base) ? base : `preset_${base}`;
  return safe || "preset_item";
}

function stripLegacyOnlyFields(record) {
  const next = { ...record };
  delete next.scale_import;
  return next;
}

function categoryNameFromSlug(slug) {
  return String(slug ?? "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function readLegacyPresets() {
  const source = fs.readFileSync(legacyPresetFile, "utf8");
  const scaleImports = [
    ...source.matchAll(/import\s+(scale_[A-Za-z0-9_]+)\s+from\s+"scales\/([^"]+)\?raw";/g),
  ];
  const vars = Object.fromEntries(
    scaleImports.map(([, name, file]) => [name, fs.readFileSync(path.join(scalesDir, file), "utf8")]),
  );
  const start = source.indexOf("export const presets =");
  const end = source.indexOf("export const default_settings =");
  let expr = source.slice(start, end).replace("export const presets =", "").trim();
  expr = expr.replace("\n\nexport default presets;", "");
  expr = expr.trim().replace(/;\s*$/, "");
  const argNames = [...Object.keys(vars), "parseScale"];
  const argValues = [...Object.values(vars), parseScale];
  return Function(...argNames, `return ${expr}`)(...argValues);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeOldJsonFiles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (reservedFiles.has(entry)) continue;
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isFile() && entry.endsWith(".json")) {
      fs.unlinkSync(fullPath);
    }
  }
}

function writeJsonPreset(group, preset) {
  const groupDir = path.join(presetTuningsDir, group.slug);
  ensureDir(groupDir);
  const filename = `${slugify(preset.name)}.json`;
  const output = stripLegacyOnlyFields(
    normalizeTuningRecord({ ...preset, built_in_group: group.name }),
  );
  fs.writeFileSync(path.join(groupDir, filename), `${JSON.stringify(output, null, 2)}\n`);
  return { importName: `${identifierFromSlug(group.slug)}_${identifierFromSlug(slugify(preset.name))}`, filename };
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

function buildPresetRegistry(groupsWithPresets, existingPresetRegistry) {
  const existingCategories = Array.isArray(existingPresetRegistry?.categories)
    ? existingPresetRegistry.categories
    : [];
  const existingBySlug = new Map(
    existingCategories
      .filter((entry) => entry && typeof entry.slug === "string")
      .map((entry) => [entry.slug, entry]),
  );
  const existingCategoryOrder = existingCategories
    .map((entry) => entry?.slug)
    .filter((slug) => typeof slug === "string");

  const discoveredSlugs = groupsWithPresets.map((group) => group.slug);
  const defaultCategoryOrder = GROUP_SPECS.map((spec) => spec.slug);
  const mergedCategoryOrder = [
    ...existingCategoryOrder.filter((slug) => discoveredSlugs.includes(slug)),
    ...defaultCategoryOrder.filter(
      (slug) => discoveredSlugs.includes(slug) && !existingCategoryOrder.includes(slug),
    ),
    ...discoveredSlugs.filter(
      (slug) => !existingCategoryOrder.includes(slug) && !defaultCategoryOrder.includes(slug),
    ),
  ];

  return {
    categories: mergedCategoryOrder.map((slug) => {
      const group = groupsWithPresets.find((entry) => entry.slug === slug);
      const existing = existingBySlug.get(slug);
      const discoveredPresetSlugs = group.presetFiles.map((preset) => preset.filename.replace(/\.json$/, ""));
      const existingPresetOrder = Array.isArray(existing?.presets)
        ? existing.presets.map((item) => String(item))
        : [];
      const mergedPresetOrder = [
        ...existingPresetOrder.filter((presetSlug) => discoveredPresetSlugs.includes(presetSlug)),
        ...discoveredPresetSlugs.filter((presetSlug) => !existingPresetOrder.includes(presetSlug)),
      ];
      return {
        slug,
        name: String(existing?.name ?? group.name ?? categoryNameFromSlug(slug)),
        presets: mergedPresetOrder,
      };
    }),
  };
}

function main() {
  const legacyGroups = readLegacyPresets();
  const groupByName = new Map(legacyGroups.map((group) => [group.name, group]));
  const groupsWithPresets = [];

  for (const group of GROUP_SPECS) {
    const groupDir = path.join(presetTuningsDir, group.slug);
    ensureDir(groupDir);
    removeOldJsonFiles(groupDir);
    const legacyGroup = groupByName.get(group.name);
    if (!legacyGroup) {
      groupsWithPresets.push({ ...group, presetFiles: [] });
      continue;
    }
    const presetFiles = legacyGroup.settings.map((preset) => writeJsonPreset(group, preset));
    groupsWithPresets.push({ ...group, presetFiles });
  }
  const presetRegistry = buildPresetRegistry(groupsWithPresets, readExistingPresetRegistry());
  fs.writeFileSync(presetRegistryFile, `${JSON.stringify(presetRegistry, null, 2)}\n`);
  console.log(`Generated ${GROUP_SPECS.length} preset-tuning groups in ${path.relative(repoRoot, presetTuningsDir)}`);
}

main();
