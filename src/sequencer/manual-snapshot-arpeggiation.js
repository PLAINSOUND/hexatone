// Persistent settings and normalization for manual snapshot arpeggiation.
// Playback scheduling deliberately lives elsewhere: these values must not
// affect timed sequence playback.

export const MANUAL_ARPEGGIATION_MODES = Object.freeze([
  { value: "off", label: "Off" },
  { value: "per-snapshot", label: "Per Snapshot" },
  { value: "all", label: "All Snapshots" },
]);

export const DEFAULT_MANUAL_ARPEGGIATION = Object.freeze({
  mode: "off",
  styleId: "positional",
  initialSpreadMs: 2000,
  spreadVariation: 0.3,
  timingVariation: 0.5,
  decayMs: 5000,
  decayVariation: 0.75,
  styleParameters: Object.freeze({}),
});

export const DEFAULT_MANUAL_SNAPSHOT_TRIGGER = Object.freeze({
  articulation: "chord",
  styleId: null,
  styleParameters: null,
});

const VALID_MODES = new Set(MANUAL_ARPEGGIATION_MODES.map(({ value }) => value));
const VALID_ARTICULATIONS = new Set(["chord", "arpeggiate"]);

function clamp(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function cloneParameters(value, fallback) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  return { ...value };
}

export function normalizeManualArpeggiation(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const styleId = String(source.styleId ?? DEFAULT_MANUAL_ARPEGGIATION.styleId).trim();
  return {
    mode: VALID_MODES.has(source.mode) ? source.mode : DEFAULT_MANUAL_ARPEGGIATION.mode,
    styleId: styleId || DEFAULT_MANUAL_ARPEGGIATION.styleId,
    initialSpreadMs: Math.round(
      clamp(source.initialSpreadMs, 0, 5000, DEFAULT_MANUAL_ARPEGGIATION.initialSpreadMs),
    ),
    spreadVariation: clamp(
      source.spreadVariation,
      0,
      1,
      DEFAULT_MANUAL_ARPEGGIATION.spreadVariation,
    ),
    timingVariation: clamp(
      source.timingVariation,
      0,
      1,
      DEFAULT_MANUAL_ARPEGGIATION.timingVariation,
    ),
    decayMs: Math.round(
      clamp(source.decayMs, 0, 20000, DEFAULT_MANUAL_ARPEGGIATION.decayMs),
    ),
    decayVariation: clamp(
      source.decayVariation,
      0,
      1,
      DEFAULT_MANUAL_ARPEGGIATION.decayVariation,
    ),
    styleParameters: cloneParameters(source.styleParameters, {}),
  };
}

export function normalizeManualSnapshotTrigger(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const rawStyleId = source.styleId;
  const styleId = rawStyleId == null ? null : String(rawStyleId).trim() || null;
  return {
    articulation: VALID_ARTICULATIONS.has(source.articulation)
      ? source.articulation
      : DEFAULT_MANUAL_SNAPSHOT_TRIGGER.articulation,
    styleId,
    styleParameters:
      source.styleParameters == null ? null : cloneParameters(source.styleParameters, null),
  };
}

export function normalizeSnapshotManualTrigger(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  return {
    ...snapshot,
    manualTrigger: normalizeManualSnapshotTrigger(snapshot.manualTrigger),
  };
}

export function effectiveManualSnapshotArticulation(mode, snapshotTrigger) {
  const normalizedMode = normalizeManualArpeggiation({ mode }).mode;
  if (normalizedMode === "off") return "chord";
  if (normalizedMode === "all") return "arpeggiate";
  return normalizeManualSnapshotTrigger(snapshotTrigger).articulation;
}
