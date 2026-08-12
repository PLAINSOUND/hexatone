// Persistent settings and normalization for manual snapshot arpeggiation.
// Playback scheduling deliberately lives elsewhere: these values must not
// affect timed sequence playback.

export const MANUAL_ARPEGGIATION_MODES = Object.freeze([
  { value: "off", label: "Off" },
  { value: "per-snapshot", label: "Per Snapshot" },
  { value: "all", label: "All Snapshots" },
]);

export const MAX_MANUAL_ARPEGGIATION_DECAY_MS = 10000;
export const SUSTAIN_MANUAL_ARPEGGIATION_DECAY_SLIDER_VALUE =
  MAX_MANUAL_ARPEGGIATION_DECAY_MS + 100;

export const DEFAULT_MANUAL_ARPEGGIATION = Object.freeze({
  mode: "off",
  styleId: "positional",
  initialSpreadMs: 2000,
  spreadVariation: 0.3,
  timingVariation: 0.5,
  decayMode: "timed",
  decayMs: 500,
  decayVariation: 0.3,
  styleParameters: Object.freeze({}),
});

export const DEFAULT_MANUAL_SNAPSHOT_TRIGGER = Object.freeze({
  articulation: "chord",
  styleId: null,
  styleParameters: null,
});

const VALID_MODES = new Set(MANUAL_ARPEGGIATION_MODES.map(({ value }) => value));
const VALID_ARTICULATIONS = new Set(["chord", "arpeggiate"]);
const VALID_DECAY_MODES = new Set(["immediate", "timed", "sustain"]);

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
  const legacyDecayMs = Number(source.decayMs);
  // Before decayMode existed, zero meant "never schedule an automatic release";
  // preserve that stored-session meaning by migrating it to sustain.
  const decayMode = VALID_DECAY_MODES.has(source.decayMode)
    ? source.decayMode
    : Number.isFinite(legacyDecayMs) && legacyDecayMs === 0
      ? "sustain"
      : "timed";
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
    decayMode,
    decayMs: Math.round(
      clamp(
        source.decayMs,
        100,
        MAX_MANUAL_ARPEGGIATION_DECAY_MS,
        DEFAULT_MANUAL_ARPEGGIATION.decayMs,
      ),
    ),
    decayVariation: clamp(source.decayVariation, 0, 1, DEFAULT_MANUAL_ARPEGGIATION.decayVariation),
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

export function manualArpeggiationDecaySliderValue(value) {
  const normalized = normalizeManualArpeggiation(value);
  if (normalized.decayMode === "immediate") return 0;
  if (normalized.decayMode === "sustain") {
    return SUSTAIN_MANUAL_ARPEGGIATION_DECAY_SLIDER_VALUE;
  }
  return normalized.decayMs;
}

export function manualArpeggiationDecayDisplay(value) {
  const normalized = normalizeManualArpeggiation(value);
  if (normalized.decayMode === "immediate") return "immediate";
  if (normalized.decayMode === "sustain") return "sustain";
  return `${normalized.decayMs} ms`;
}

export function manualArpeggiationDecayFromSlider(value) {
  const numeric = Number(value);
  if (numeric <= 0) return { decayMode: "immediate" };
  if (numeric >= SUSTAIN_MANUAL_ARPEGGIATION_DECAY_SLIDER_VALUE) {
    return { decayMode: "sustain" };
  }
  return {
    decayMode: "timed",
    decayMs: Math.min(MAX_MANUAL_ARPEGGIATION_DECAY_MS, Math.max(100, numeric)),
  };
}
