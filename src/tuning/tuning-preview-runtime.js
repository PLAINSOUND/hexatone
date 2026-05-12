import { getWorkspaceSlot } from "./workspace.js";

const EMPTY_DEGREE_PREVIEWS = Object.freeze({});
const EMPTY_PREVIEW_STATE = Object.freeze({
  fundamentalDeltaCents: null,
  fundamentalComparing: false,
  degreePreviews: EMPTY_DEGREE_PREVIEWS,
});

function normalizePreviewState(state) {
  if (!state) return EMPTY_PREVIEW_STATE;
  return {
    fundamentalDeltaCents: state.fundamentalDeltaCents ?? null,
    fundamentalComparing: !!state.fundamentalComparing,
    degreePreviews: state.degreePreviews ?? EMPTY_DEGREE_PREVIEWS,
  };
}

export function createTuningPreviewState() {
  return {
    fundamentalDeltaCents: null,
    fundamentalComparing: false,
    degreePreviews: EMPTY_DEGREE_PREVIEWS,
  };
}

function withDegreePreviews(state, degreePreviews) {
  if (degreePreviews === state.degreePreviews) return state;
  return {
    ...state,
    degreePreviews,
  };
}

function cloneDegreePreviews(state) {
  return state.degreePreviews === EMPTY_DEGREE_PREVIEWS
    ? {}
    : { ...state.degreePreviews };
}

function getSourceScale(source) {
  if (Array.isArray(source?.slots)) return source.slots.map((slot) => slot.cents ?? 0);
  return Array.isArray(source?.scale) ? source.scale : [];
}

function getSourceEquivInterval(source) {
  if (source?.baseScale) return source.baseScale.equaveCents ?? 1200;
  return source?.equivInterval ?? 1200;
}

function getSourceFundamental(source) {
  if (source?.baseScale) return source.baseScale.fundamentalHz ?? 440;
  return source?.fundamental ?? 440;
}

function getSourceReferenceDegree(source) {
  if (source?.baseScale) return source.baseScale.referenceDegree ?? 0;
  return source?.referenceDegree ?? 0;
}

function getSourceDegreeCount(source) {
  if (Array.isArray(source?.slots)) return source.slots.length;
  return Array.isArray(source?.scale) ? source.scale.length : 0;
}

export function hasFundamentalPreview(state) {
  state = normalizePreviewState(state);
  return state.fundamentalDeltaCents !== null && Math.abs(state.fundamentalDeltaCents) > 0.001;
}

export function isFundamentalComparing(state) {
  return hasFundamentalPreview(state) && !!state.fundamentalComparing;
}

export function getFundamentalPreviewDeltaCents(state) {
  state = normalizePreviewState(state);
  if (!hasFundamentalPreview(state) || state.fundamentalComparing) return 0;
  return state.fundamentalDeltaCents;
}

export function getFundamentalDeviationCents(state) {
  state = normalizePreviewState(state);
  return hasFundamentalPreview(state) ? state.fundamentalDeltaCents : null;
}

export function setFundamentalPreview(state, deltaCents) {
  const nextDelta =
    deltaCents !== null && Math.abs(deltaCents) > 0.001 ? deltaCents : null;
  if (nextDelta === null) {
    if (!hasFundamentalPreview(state) && !state.fundamentalComparing) return state;
    return {
      ...state,
      fundamentalDeltaCents: null,
      fundamentalComparing: false,
    };
  }
  if (state.fundamentalDeltaCents === nextDelta) return state;
  return {
    ...state,
    fundamentalDeltaCents: nextDelta,
  };
}

export function setFundamentalComparing(state, comparing) {
  const nextComparing = !!comparing && hasFundamentalPreview(state);
  if (state.fundamentalComparing === nextComparing) return state;
  return {
    ...state,
    fundamentalComparing: nextComparing,
  };
}

export function clearFundamentalPreview(state) {
  return setFundamentalPreview(setFundamentalComparing(state, false), null);
}

export function getDegreePreview(state, degree) {
  state = normalizePreviewState(state);
  return state.degreePreviews[String(degree)] ?? null;
}

export function hasDegreePreview(state, degree) {
  const preview = getDegreePreview(state, degree);
  return preview?.cents !== null && preview?.cents !== undefined;
}

export function isDegreeComparing(state, degree) {
  const preview = getDegreePreview(state, degree);
  return !!preview?.comparing && hasDegreePreview(state, degree);
}

export function setDegreePreview(state, degree, cents) {
  const key = String(degree);
  if (cents === null || cents === undefined) return clearDegreePreview(state, degree);
  const current = state.degreePreviews[key];
  if (current?.cents === cents) return state;
  const degreePreviews = cloneDegreePreviews(state);
  degreePreviews[key] = {
    cents,
    comparing: current?.comparing ?? false,
  };
  return withDegreePreviews(state, degreePreviews);
}

export function setDegreeComparing(state, degree, comparing) {
  const key = String(degree);
  const current = state.degreePreviews[key];
  if (!current || current.cents === null || current.cents === undefined) return state;
  const nextComparing = !!comparing;
  if (current.comparing === nextComparing) return state;
  const degreePreviews = cloneDegreePreviews(state);
  degreePreviews[key] = {
    ...current,
    comparing: nextComparing,
  };
  return withDegreePreviews(state, degreePreviews);
}

export function clearDegreePreview(state, degree) {
  const key = String(degree);
  if (!Object.prototype.hasOwnProperty.call(state.degreePreviews, key)) return state;
  const degreePreviews = cloneDegreePreviews(state);
  delete degreePreviews[key];
  return withDegreePreviews(
    state,
    Object.keys(degreePreviews).length ? degreePreviews : EMPTY_DEGREE_PREVIEWS,
  );
}

export function clearAllTuningPreviews(state) {
  if (!hasFundamentalPreview(state) && !state.fundamentalComparing && state.degreePreviews === EMPTY_DEGREE_PREVIEWS) {
    return state;
  }
  return createTuningPreviewState();
}

export function getCommittedDegreeCents(source, degree) {
  const degreeCount = getSourceDegreeCount(source);
  if (degree === degreeCount) return getSourceEquivInterval(source);
  if (source?.baseScale) {
    return getWorkspaceSlot(source, degree)?.cents ?? 0;
  }
  return getSourceScale(source)[degree] ?? 0;
}

export function getEffectiveDegreeCents(source, state, degree) {
  const degreeCount = getSourceDegreeCount(source);
  if (degree === degreeCount) return getSourceEquivInterval(source);
  const committed = getCommittedDegreeCents(source, degree);
  const preview = getDegreePreview(state, degree);
  if (!preview || preview.cents === null || preview.cents === undefined) return committed;
  return preview.comparing ? committed : preview.cents;
}

export function getDegreeDeviationCents(source, state, degree) {
  const degreeCount = getSourceDegreeCount(source);
  if (degree === degreeCount) return null;
  const preview = getDegreePreview(state, degree);
  if (!preview || preview.cents === null || preview.cents === undefined) return null;
  return preview.cents - getCommittedDegreeCents(source, degree);
}

export function getEffectiveFundamentalHz(source, state) {
  const committed = getSourceFundamental(source);
  const delta = getFundamentalPreviewDeltaCents(state);
  if (Math.abs(delta) <= 0.001) return committed;
  return committed * Math.pow(2, delta / 1200);
}

export function getEffectiveReferenceCents(source, state) {
  return getEffectiveDegreeCents(source, state, getSourceReferenceDegree(source));
}

export function getEffectiveFrequencyAtDegree(
  source,
  state,
  degree,
  { modulationTranspositionCents = 0 } = {},
) {
  const liveFundamental =
    getEffectiveFundamentalHz(source, state) * Math.pow(2, modulationTranspositionCents / 1200);
  const cents = getEffectiveDegreeCents(source, state, degree);
  const referenceCents = getEffectiveReferenceCents(source, state);
  return liveFundamental * Math.pow(2, (cents - referenceCents) / 1200);
}

export function getEffectiveScaleRuntime(source, state) {
  const scale = getSourceScale(source).map((_, degree) => getEffectiveDegreeCents(source, state, degree));
  return {
    scale,
    equivInterval: getSourceEquivInterval(source),
    equivSteps: scale.length,
    referenceDegree: getSourceReferenceDegree(source),
    fundamental: getEffectiveFundamentalHz(source, state),
  };
}
