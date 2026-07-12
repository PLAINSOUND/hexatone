import { normalizeModulationHistory } from "../tuning/modulation-runtime.js";
import { resolveKeyColorsMode } from "../settings/scale/key-colors-mode.js";
import { derivePresetControllerAnchorFields } from "../settings/scale/parse-scale.js";

const CONTROLLER_ANCHOR_FIELDS = [
  "lumatone_anchor_note",
  "lumatone_anchor_channel",
  "exquis_anchor_note",
  "exquis_anchor_channel",
  "linnstrument_anchor_note",
  "linnstrument_anchor_channel",
  "haken_anchor_note",
  "haken_anchor_channel",
];

const PASSTHROUGH_ARRAY_FIELDS = [
  "scale",
  "note_names",
  "heji_names",
  "note_colors",
  "prime_family_colors",
];

const PASSTHROUGH_STRING_FIELDS = [
  "name",
  "description",
  "short_description",
  "built_in_group",
  "key_labels",
  "fundamental_color",
  "heji_anchor_ratio",
  "heji_anchor_label",
  "source_type",
  "source_file",
];

const PASSTHROUGH_NUMBER_FIELDS = [
  "equivSteps",
  "equivInterval",
  "fundamental",
  "reference_degree",
  "center_degree",
  "heji_anchor_frequency",
  "rSteps",
  "drSteps",
  "hexSize",
  "rotation",
];

const PASSTHROUGH_BOOLEAN_FIELDS = [
  "modulation_display_active",
  "modulation_history_collapsed",
  "temper_only",
  "always_include_cents_on_keys",
  "cautionary_natural",
  "heji_palette_visible",
];

const SETTINGS_RECORD_FIELDS = [
  "name",
  "description",
  "short_description",
  "scale_import",
  "scale",
  "equivSteps",
  "equivInterval",
  "note_names",
  "heji_names",
  "note_colors",
  "key_labels",
  "fundamental_color",
  "prime_family_colors",
  "fundamental",
  "reference_degree",
  "center_degree",
  "heji_anchor_ratio",
  "heji_anchor_label",
  "heji_anchor_frequency",
  "rSteps",
  "drSteps",
  "hexSize",
  "rotation",
  "temper_only",
  "always_include_cents_on_keys",
  "cautionary_natural",
  "heji_decimal_places",
  "heji_palette_visible",
  "modulation_display_active",
  "modulation_history_position",
  "modulation_history_collapsed",
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function copyIfFinite(target, source, key) {
  if (Number.isFinite(source?.[key])) target[key] = source[key];
}

function copyIfString(target, source, key, { allowEmpty = true } = {}) {
  if (typeof source?.[key] !== "string") return;
  const value = allowEmpty ? source[key] : source[key].trim();
  if (!allowEmpty && !value) return;
  target[key] = value;
}

function copyIfArray(target, source, key) {
  if (!Array.isArray(source?.[key])) return;
  target[key] = clone(source[key]);
}

function copyIfBoolean(target, source, key) {
  if (typeof source?.[key] === "boolean") target[key] = source[key];
}

export function normalizeTuningRecord(record, options = {}) {
  if (!record || typeof record !== "object") return null;
  const name = String(record.name ?? "").trim();
  const scale = Array.isArray(record.scale) ? record.scale : null;
  const allowEmptyScale = options.allowEmptyScale === true;
  if (!name) return null;
  if (!allowEmptyScale && (!scale || scale.length === 0)) return null;

  const normalized = {
    name,
    description: String(record.description ?? ""),
    scale: clone(scale ?? []),
    key_colors_mode: resolveKeyColorsMode(record),
  };

  for (const key of PASSTHROUGH_STRING_FIELDS) {
    if (key === "name" || key === "description") continue;
    copyIfString(normalized, record, key);
  }

  for (const key of PASSTHROUGH_ARRAY_FIELDS) copyIfArray(normalized, record, key);
  for (const key of PASSTHROUGH_NUMBER_FIELDS) copyIfFinite(normalized, record, key);
  for (const key of PASSTHROUGH_BOOLEAN_FIELDS) copyIfBoolean(normalized, record, key);
  for (const key of CONTROLLER_ANCHOR_FIELDS) copyIfFinite(normalized, record, key);

  if (!Number.isFinite(normalized.equivSteps)) {
    normalized.equivSteps = normalized.scale.length;
  }

  if (Array.isArray(record.modulation_library)) {
    const normalizedLibrary = normalizeModulationHistory(record.modulation_library, { zeroCounts: true });
    if (normalizedLibrary.length > 0) normalized.modulation_library = normalizedLibrary;
  }

  if (record.modulation_history_position && typeof record.modulation_history_position === "object") {
    normalized.modulation_history_position = clone(record.modulation_history_position);
  }

  if (Array.isArray(record.source_comments) && record.source_comments.length > 0) {
    normalized.source_comments = clone(record.source_comments);
  }

  copyIfString(normalized, record, "imported_at");

  return normalized;
}

export function normalizeTuningGroup(group, options = {}) {
  if (!group || typeof group !== "object") return null;
  const name = String(group.name ?? "").trim();
  if (!name) return null;
  const settings = Array.isArray(group.settings)
    ? group.settings
      .map((setting) => normalizeTuningRecord({ ...setting, built_in_group: name }, options))
      .filter(Boolean)
    : [];
  return settings.length > 0 ? { name, settings } : null;
}

export function settingsToTuningRecord(settings = {}, extra = {}) {
  const raw = {};
  for (const key of SETTINGS_RECORD_FIELDS) {
    if (key === "key_colors_mode") {
      raw[key] = resolveKeyColorsMode(settings);
    } else if (settings[key] !== undefined) {
      raw[key] = clone(settings[key]);
    }
  }

  raw.key_colors_mode = resolveKeyColorsMode(settings);
  Object.assign(raw, derivePresetControllerAnchorFields(settings));

  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0)) {
      raw[key] = clone(value);
    }
  }

  if (Array.isArray(raw.modulation_library)) {
    const normalizedLibrary = normalizeModulationHistory(raw.modulation_library, { zeroCounts: true });
    if (normalizedLibrary.length > 0) raw.modulation_library = normalizedLibrary;
    else delete raw.modulation_library;
  }

  return normalizeTuningRecord(raw, { allowEmptyScale: false });
}

export function serializeTuningRecord(record, options = {}) {
  const normalized = normalizeTuningRecord(record, options);
  return normalized ? JSON.stringify(normalized, null, 2) : null;
}

export { CONTROLLER_ANCHOR_FIELDS };
