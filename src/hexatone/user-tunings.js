import { findPresetTuningByName } from "./preset-tunings/index.js";
import { normalizeTuningRecord } from "./tuning-record.js";

export const USER_TUNINGS_STORAGE_KEY = "hexatone_custom_presets";

export function loadUserTunings() {
  try {
    const raw = localStorage.getItem(USER_TUNINGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.map((record) => normalizeTuningRecord(record)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export function saveUserTunings(records) {
  const normalized = Array.isArray(records)
    ? records.map((record) => normalizeTuningRecord(record)).filter(Boolean)
    : [];
  localStorage.setItem(USER_TUNINGS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function upsertUserTuning(record, existing = loadUserTunings()) {
  const normalized = normalizeTuningRecord(record);
  if (!normalized) return existing;
  const next = existing.some((entry) => entry.name === normalized.name)
    ? existing.map((entry) => (entry.name === normalized.name ? normalized : entry))
    : [...existing, normalized];
  return saveUserTunings(next);
}

export function deleteUserTuning(name, existing = loadUserTunings()) {
  const trimmed = String(name ?? "").trim();
  const next = existing.filter((entry) => entry.name !== trimmed);
  return saveUserTunings(next);
}

export function clearUserTunings() {
  localStorage.setItem(USER_TUNINGS_STORAGE_KEY, JSON.stringify([]));
  return [];
}

export function uniqueTuningName(baseName, existing = loadUserTunings()) {
  const base = String(baseName ?? "").trim() || "User Tuning";
  const taken = new Set(existing.map((entry) => entry.name));
  if (findPresetTuningByName(base)) taken.add(base);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base} ${suffix}`) || findPresetTuningByName(`${base} ${suffix}`)) {
    suffix += 1;
  }
  return `${base} ${suffix}`;
}

export function parseTuningJson(text) {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((record) => normalizeTuningRecord(record)).filter(Boolean);
    }
    const normalized = normalizeTuningRecord(parsed);
    return normalized ? [normalized] : [];
  } catch {
    return [];
  }
}
