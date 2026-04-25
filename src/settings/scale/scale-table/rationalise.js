import { CANONICAL_MONZO_BASIS } from "../../../tuning/interval.js";
import { getWorkspaceSlot } from "../../../tuning/workspace.js";
import {
  findRationalCandidates,
  harmonicRadiusFromMonzo,
  scoreRationalCandidate,
  selectRationalisationContext,
} from "../../../tuning/rationalise.js";
import { parseOptionalPositiveInt, buildPrimeBoundsFromPrefs } from "./search-prefs.js";

// Scale-table adapter around the pure rationalisation engine.
// This file translates UI/workspace state into search requests, formats candidate
// metadata for display, and decides whether a preview can be saved as a ratio.

const PREVIEW_RATIO_TOLERANCE_CENTS = 0.05;

// Format the prime-limit of a candidate as an overtonal/undertonal pair.
// Overtonal limit = highest prime with a positive non-2 exponent, shown with ° suffix.
// Undertonal limit = highest prime with a negative non-2 exponent, shown with u prefix.
// Examples: 21/20 → "7°u5",  7/4 → "7°",  8/5 → "u5",  1/1 → "1"
// Fraction.toFraction() collapses "1/1" to "1". Always show the denominator.
export function formatRatioText(ratioText) {
  if (ratioText === "1") return "1/1";
  return ratioText;
}

export function formatPrimeLimits(monzo) {
  if (!Array.isArray(monzo)) return "?";
  let otLim = 1;
  let utLim = 1;
  for (let i = 1; i < monzo.length; i++) {
    const exp = monzo[i];
    if (exp > 0) otLim = CANONICAL_MONZO_BASIS[i];
    else if (exp < 0) utLim = CANONICAL_MONZO_BASIS[i];
  }
  if (utLim === 1) return `lim ${otLim}\u00B0`;
  if (otLim === 1) return `lim 1\u00B0u${utLim}`;
  return `lim ${otLim}\u00B0u${utLim}`;
}

export function getRowRuntime(workspace, degree, tunedCents = null, previewInterval = null) {
  const slot = getWorkspaceSlot(workspace, degree);
  const committedInterval = slot?.committedIdentity ?? null;
  const committedCents = slot?.cents ?? 0;
  return {
    slot,
    committedInterval,
    committedCents,
    previewInterval,
    effectiveCents: tunedCents ?? previewInterval?.cents ?? committedCents,
    ratioText: committedInterval?.ratio ? committedInterval.ratio.toFraction() : null,
    exact: !!committedInterval?.exact,
    harmonicRadius: slot?.analysis?.harmonicRadius ?? null,
  };
}

export function buildFrequencyContext({ degree, workspace, settings, frequencyAtDegree }) {
  const maxDegree = workspace?.slots?.length ?? 0;
  const nearbyDegrees = [degree - 1, degree + 1].filter(
    (candidateDegree) => candidateDegree >= 0 && candidateDegree < maxDegree,
  );
  return {
    targetDegree: degree,
    targetHz: typeof frequencyAtDegree === "function" ? frequencyAtDegree(degree) : null,
    referenceHz: settings?.fundamental ?? null,
    nearbyHz: nearbyDegrees.map((candidateDegree) => ({
      degree: candidateDegree,
      hz: frequencyAtDegree(candidateDegree),
    })),
  };
}

export function getRationalisationRequest({
  degree,
  tunedCents,
  workspace,
  settings,
  frequencyAtDegree,
  searchPrefs,
}) {
  // Package the row-local preview target together with workspace context and
  // search preferences. The pure engine should not know about TuneCell state.
  const primeLimit = parseOptionalPositiveInt(searchPrefs?.primeLimit) ?? 19;
  const { primeBounds, primeBoundsUt } = buildPrimeBoundsFromPrefs(searchPrefs, primeLimit);
  return {
    targetDegree: degree,
    workspace,
    primeLimit,
    primeBounds: primeBounds ?? null,
    primeBoundsUt: primeBoundsUt ?? null,
    oddLimit: parseOptionalPositiveInt(searchPrefs?.oddLimit) ?? 255,
    centsTolerance: parseOptionalPositiveInt(searchPrefs?.centsTolerance) ?? 6,
    contextTolerance:
      parseOptionalPositiveInt(searchPrefs?.contextTolerance) ?? 14,
    maxCandidates: 8,
    region: searchPrefs?.region ?? "symmetric",
    frequencyContext: buildFrequencyContext({
      degree,
      workspace,
      settings,
      frequencyAtDegree,
    }),
    targetCents: tunedCents,
  };
}

export function buildBatchRationalisationReferenceMonzos({
  keepExisting,
  preCommittedMonzos = [],
  pass1Monzos = [],
  degreeIndex,
}) {
  return [
    ...(keepExisting ? preCommittedMonzos : []),
    ...pass1Monzos.filter((monzo, index) => index !== degreeIndex && monzo != null),
  ];
}

function mergeUniqueCandidates(candidateSets, maxCandidates = 8) {
  const merged = [];
  const seen = new Set();
  for (const candidateSet of candidateSets) {
    for (const candidate of candidateSet) {
      if (seen.has(candidate.ratioText)) continue;
      seen.add(candidate.ratioText);
      merged.push(candidate);
    }
  }
  // Sort by aggregateScore ascending (lower cost = better).
  merged.sort((a, b) => a.aggregateScore - b.aggregateScore);
  return merged.slice(0, maxCandidates);
}

function buildCommittedRatioCandidate(slot, baseRequest) {
  const committed = slot?.committedIdentity;
  if (!committed?.ratio || !Array.isArray(committed?.monzo) || committed?.cents == null) return null;
  const context =
    baseRequest.workspace && baseRequest.targetDegree != null
      ? selectRationalisationContext(baseRequest.workspace, baseRequest.targetDegree, baseRequest)
      : { committedSlots: [] };
  return scoreRationalCandidate(
    {
      ratio: committed.ratio,
      ratioText: committed.ratio.toFraction(),
      monzo: [...committed.monzo],
      cents: committed.cents,
      deviation: baseRequest.targetCents - committed.cents,
      primeLimit: committed.primeLimit ?? null,
      oddLimit: committed.ratio ? Math.max(committed.ratio.n, committed.ratio.d) : null,
      harmonicRadius:
        slot?.analysis?.harmonicRadius ?? harmonicRadiusFromMonzo(committed.monzo),
      region: baseRequest.region ?? "symmetric",
      contextualConsonance: 0,
      contextualBestMatch: 0,
      contextualBestRatio: null,
      branchExtent: 0,
      primeConsistency: 0,
      aggregateScore: 0,
    },
    context,
    baseRequest,
  );
}

export function getHumanTestableRationalCandidates(baseRequest) {
  // Keeps the candidate list inspectable for humans: include the committed ratio
  // when relevant, search within the selected bounds, and return a small ranked
  // set with enough scoring metadata for judgement.
  const maxCandidates = baseRequest.maxCandidates ?? 8;
  const committedCandidate = buildCommittedRatioCandidate(
    getWorkspaceSlot(baseRequest.workspace, baseRequest.targetDegree),
    baseRequest,
  );
  // The tolerance is fixed at the user's setting — we never widen it in the
  // ladder. The ladder is only used to broaden prime coverage when primeBounds
  // is not set (legacy path); with primeBounds the search is already fully
  // specified and a single pass suffices.
  const tol = baseRequest.centsTolerance ?? 6;
  const searchLadder = baseRequest.primeBounds
    ? [{ centsTolerance: tol }]
    : [
        { centsTolerance: tol, primeLimit: baseRequest.primeLimit ?? 19 },
        { centsTolerance: tol, primeLimit: Math.max(baseRequest.primeLimit ?? 19, 23) },
        { centsTolerance: tol, primeLimit: Math.max(baseRequest.primeLimit ?? 19, 29) },
        { centsTolerance: tol, primeLimit: Math.max(baseRequest.primeLimit ?? 19, 37) },
      ];

  const candidateSets = [];
  // skipCommitted: when re-searching all degrees, don't seed the candidate list
  // with the existing committed ratio — we want the search to find the best
  // within-limit candidate, not anchor on whatever is already there.
  if (committedCandidate && !baseRequest.skipCommitted) {
    committedCandidate.isCommitted = true;
    candidateSets.push([committedCandidate]);
  }
  for (const searchStep of searchLadder) {
    candidateSets.push(
      findRationalCandidates(baseRequest.targetCents, {
        ...baseRequest,
        ...searchStep,
        maxCandidates,
      }),
    );
    const merged = mergeUniqueCandidates(candidateSets, maxCandidates);
    if (merged.length >= 6) return merged;
  }
  return mergeUniqueCandidates(candidateSets, maxCandidates);
}

export function getSaveString({ committedInterval, previewInterval, tunedCents, committedCents }) {
  // Exact preview identity is only saved when it still matches the audible
  // preview cents. A later free drag must not accidentally commit a stale ratio.
  if (previewInterval && tunedCents !== null) {
    const previewCents = previewInterval?.cents ?? null;
    if (previewCents !== null && Math.abs(previewCents - tunedCents) <= PREVIEW_RATIO_TOLERANCE_CENTS) {
      if (previewInterval?.ratio) return previewInterval.ratio.toFraction();
    }
  }
  const saveVal = tunedCents !== null ? tunedCents : committedCents;
  if (saveVal === committedCents && committedInterval?.ratio) {
    return committedInterval.ratio.toFraction();
  }
  return saveVal.toFixed(6);
}
