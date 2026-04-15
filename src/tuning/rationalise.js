import { Fraction, monzoToCents, primeLimit as xenPrimeLimit } from "xen-dev-utils";
import { CANONICAL_MONZO_BASIS, monzoToFractionOnBasis } from "./interval.js";
import {
  DEFAULT_TUNEABLE_INTERVALS,
  findTuneableFamilyMatches,
  getNeighborFamilies,
} from "./tuneable-intervals.js";

// Maximum log2 of numerator or denominator we will try to materialise as a
// Fraction.  2^53 is Number.MAX_SAFE_INTEGER; anything beyond that breaks the
// Fraction library.  We leave a comfortable margin.
const MAX_LOG2_SAFE = 40;

export const DEFAULT_RATIONALISE_OPTIONS = {
  primeLimit: 7,
  primeBounds: null,
  oddLimit: null,
  centsTolerance: 5,
  maxCandidates: 8,
  region: "symmetric",
  maxContextComparisons: 8,
  weightRadius: 1.0,
  weightDeviation: 1.0,
  weightContext: 0.6,
  weightOvertonalReuse: 0.35,
  tuneableIntervals: DEFAULT_TUNEABLE_INTERVALS,
};

const DEFAULT_CONTEXTUAL_TOLERANCE_TABLE = {
  "5/4": 8.0,
  "81/64": 8.0,
  "9/7": 10.0,
  "41/32": 10.0,
  "7/4": 8.0,
  "11/8": 10.0,
  "13/8": 12.0,
};

function oddPart(n) {
  let x = Math.abs(Number(n));
  if (!Number.isFinite(x) || x === 0) return 0;
  while (x % 2 === 0) x /= 2;
  return x;
}

function fractionCompare(a, b) {
  return a.s * a.n * b.d - b.s * b.n * a.d;
}

function normalizeCandidateRatioToPitchClass(ratio) {
  let out = ratio;
  while (fractionCompare(out, new Fraction(1, 1)) < 0) out = out.mul(2);
  while (fractionCompare(out, new Fraction(2, 1)) >= 0) out = out.div(2);
  return out;
}

function ratioToCents(ratio) {
  return 1200 * Math.log2((ratio.s * ratio.n) / ratio.d);
}

export function harmonicRadiusFromMonzo(monzo, basis = CANONICAL_MONZO_BASIS) {
  return (
    0.5 *
    monzo.reduce((sum, exp, index) => {
      const prime = basis[index] ?? 2;
      if (prime === 2) return sum;
      return sum + Math.abs(exp) * Math.log2(prime);
    }, 0)
  );
}

export function primeLimitToBounds(primeLimit) {
  const bounds = {};
  for (const prime of CANONICAL_MONZO_BASIS) {
    if (prime > primeLimit) break;
    if (prime === 2) continue;
    // Primes 3 and 5 get a small stack; higher primes are capped at 1.
    // This prevents combinatorial explosion and Fraction overflow when the
    // search ladder reaches primes like 23, 29, 31, 37.
    //
    // Formula: floor(log2(5) / log2(prime)) gives 3→2, 5→1, 7→1, 11+→1.
    // We then add 1 for primes ≤ 5 to give 3→3, 5→2, and cap at 1 for ≥ 7.
    let max;
    if (prime <= 3) {
      max = 3;
    } else if (prime <= 7) {
      max = 2; // 5, 7 — covers 25/x, 49/x without being excessive
    } else {
      max = 1; // 11, 13, 17, 19, 23, 29, 31, 37, … — single step only
    }
    // The overflow guard in monzoIsSafe() catches any combination of primes
    // whose product would exceed Number.MAX_SAFE_INTEGER at Fraction construction
    // time, so individual per-prime caps can stay permissive.
    bounds[prime] = max;
  }
  return bounds;
}

function buildRange(max, region) {
  if (region === "overtonal") return Array.from({ length: max + 1 }, (_, i) => i);
  if (region === "undertonal") return Array.from({ length: max + 1 }, (_, i) => -max + i);
  return Array.from({ length: 2 * max + 1 }, (_, i) => i - max);
}

function boundsToRanges(primeBounds, region) {
  const entries = [];
  for (let index = 0; index < CANONICAL_MONZO_BASIS.length; index += 1) {
    const prime = CANONICAL_MONZO_BASIS[index];
    if (prime === 2) continue;
    const max = primeBounds[prime];
    if (max == null || max === 0) continue;
    entries.push({
      index,
      prime,
      range: buildRange(max, region),
    });
  }
  return entries;
}

function buildMonzoFromCombination(combination, rangeEntries) {
  const monzo = new Array(CANONICAL_MONZO_BASIS.length).fill(0);
  for (let index = 0; index < combination.length; index += 1) {
    monzo[rangeEntries[index].index] = combination[index];
  }
  return monzo;
}

function normalizeMonzoToPitchClass(monzo) {
  const withoutTwos = [...monzo];
  withoutTwos[0] = 0;
  const centsWithoutTwos = monzoToCents(withoutTwos);
  const octaves = -Math.floor(centsWithoutTwos / 1200);
  const out = [...monzo];
  out[0] = octaves;
  return out;
}

function cartesianProduct(ranges) {
  return ranges.reduce(
    (acc, range) => acc.flatMap((prefix) => range.map((value) => [...prefix, value])),
    [[]],
  );
}

// Compute prime limit directly from a monzo — highest prime with non-zero exponent.
// Avoids constructing a Fraction for the limit check.
function primeLimitFromMonzo(monzo) {
  let highest = 2;
  for (let i = monzo.length - 1; i >= 0; i -= 1) {
    if (monzo[i] !== 0) {
      highest = CANONICAL_MONZO_BASIS[i] ?? 2;
      break;
    }
  }
  return highest;
}

// Compute max odd factor of numerator and denominator from a monzo.
// Odd part = product of all prime powers except 2.
// We work in log2 space to check safety before exponentiating.
function oddLimitFromMonzo(monzo) {
  // log2 of numerator odd part and denominator odd part
  let log2Num = 0;
  let log2Den = 0;
  for (let i = 1; i < monzo.length; i += 1) {
    const exp = monzo[i];
    if (exp === 0) continue;
    const contribution = exp * Math.log2(CANONICAL_MONZO_BASIS[i]);
    if (exp > 0) log2Num += contribution;
    else log2Den -= contribution; // contribution is positive, exp is negative
  }
  // If either side is above safe limit, return Infinity — oddLimit filter will
  // reject it; Fraction construction is not attempted.
  if (log2Num > MAX_LOG2_SAFE || log2Den > MAX_LOG2_SAFE) return Infinity;
  return Math.max(Math.round(Math.pow(2, log2Num)), Math.round(Math.pow(2, log2Den)));
}

// Check whether a monzo can be safely materialised as a Fraction.
// Sums positive and negative prime-power contributions in log2 space.
function monzoIsSafe(monzo) {
  let log2Num = 0;
  let log2Den = 0;
  for (let i = 0; i < monzo.length; i += 1) {
    const exp = monzo[i];
    if (exp === 0) continue;
    const contribution = Math.abs(exp) * Math.log2(CANONICAL_MONZO_BASIS[i]);
    if (exp > 0) log2Num += contribution;
    else log2Den += contribution;
  }
  return log2Num <= MAX_LOG2_SAFE && log2Den <= MAX_LOG2_SAFE;
}

// Build a candidate record without constructing a Fraction — safe for any monzo.
// The ratio field is populated lazily once the candidate passes all filters.
function buildCandidateRecordFromMonzo({ monzo, cents, targetCents }) {
  return {
    ratio: null,          // populated by materializeCandidateRatio() after filtering
    ratioText: null,
    monzo,
    cents,
    deviation: targetCents - cents,
    primeLimit: primeLimitFromMonzo(monzo),
    oddLimit: oddLimitFromMonzo(monzo),
    harmonicRadius: harmonicRadiusFromMonzo(monzo),
    region: "symmetric",
    contextualConsonance: 0,
    overtonalReuse: 0,
    familyMatches: [],
    aggregateScore: 0,
  };
}

// Populate ratio and ratioText on a candidate that was built from a monzo.
// Returns false if the monzo is unsafe to materialise (numerator above safe limit).
function materializeCandidateRatio(candidate) {
  if (candidate.ratio) return true;
  if (!monzoIsSafe(candidate.monzo)) return false;
  try {
    const raw = monzoToFractionOnBasis(candidate.monzo);
    candidate.ratio = normalizeCandidateRatioToPitchClass(raw);
    candidate.ratioText = candidate.ratio.toFraction();
    // Now that we have a Fraction we can get exact primeLimit and oddLimit.
    candidate.primeLimit = xenPrimeLimit(candidate.ratio);
    candidate.oddLimit = Math.max(oddPart(candidate.ratio.n), oddPart(candidate.ratio.d));
    return true;
  } catch {
    return false;
  }
}

function cheapBaseScore(candidate, options) {
  return (
    options.weightRadius * candidate.harmonicRadius +
    options.weightDeviation * Math.abs(candidate.deviation)
  );
}

export function buildConsonantFamilyLibrary(options = {}) {
  const toleranceTable = options.contextualToleranceTable ?? DEFAULT_CONTEXTUAL_TOLERANCE_TABLE;
  const tuneableIntervals = options.tuneableIntervals ?? DEFAULT_TUNEABLE_INTERVALS;
  return tuneableIntervals.map((entry) => ({
    ratio: entry.ratio,
    tolerance: toleranceTable[entry.ratio] ?? entry.toleranceCents,
    weight: entry.weight,
    cents: entry.cents,
  }));
}

function boundedContextSlots(workspace, targetDegree, options = {}) {
  const byDegree = workspace?.lookup?.byDegree;
  if (!byDegree) return [];
  const requestedDegrees = options.contextDegrees ?? [
    0,
    workspace.baseScale.referenceDegree,
    targetDegree - 1,
    targetDegree + 1,
  ];
  const unique = [...new Set(requestedDegrees.filter((degree) => degree !== targetDegree))];
  return unique
    .map((degree) => byDegree.get(degree))
    .filter((slot) => slot?.committedIdentity?.ratio)
    .slice(0, options.maxContextComparisons ?? DEFAULT_RATIONALISE_OPTIONS.maxContextComparisons);
}

export function selectRationalisationContext(workspace, targetDegree, options = {}) {
  return {
    targetDegree,
    workspace,
    activeFrame: options.activeFrame ?? null,
    nearbyDegrees: boundedContextSlots(workspace, targetDegree, options).map((slot) => slot.degree),
    committedSlots: boundedContextSlots(workspace, targetDegree, options),
  };
}

export function enumerateCandidatesFromBounds(targetCents, options = {}) {
  const merged = { ...DEFAULT_RATIONALISE_OPTIONS, ...options };
  const primeBounds = merged.primeBounds ?? primeLimitToBounds(merged.primeLimit);
  const rangeEntries = boundsToRanges(primeBounds, merged.region);
  if (!rangeEntries.length) return [];

  const combinations = cartesianProduct(rangeEntries.map((entry) => entry.range));
  const candidates = [];

  for (const combination of combinations) {
    if (combination.every((value) => value === 0)) continue;

    const rawMonzo = buildMonzoFromCombination(combination, rangeEntries);
    const monzo = normalizeMonzoToPitchClass(rawMonzo);

    // Compute cents and deviation from the monzo — no Fraction constructed yet.
    const cents = monzoToCents(monzo);
    if (!Number.isFinite(cents)) continue;
    const deviation = targetCents - cents;
    if (Math.abs(deviation) > merged.centsTolerance) continue;

    // Build a monzo-only candidate record (ratio = null at this point).
    const candidate = buildCandidateRecordFromMonzo({ monzo, cents, targetCents });
    candidate.region = merged.region;

    // Apply oddLimit pre-filter using the monzo-derived approximation.
    // Candidates with Infinity oddLimit (overflow) are dropped here.
    if (merged.oddLimit != null && merged.oddLimit > 0 && candidate.oddLimit > merged.oddLimit) {
      continue;
    }

    // Materialise the Fraction now — only for candidates that passed all monzo-level
    // filters.  Skip silently if the numerator would overflow the safe integer limit.
    if (!materializeCandidateRatio(candidate)) continue;

    candidates.push(candidate);
  }

  candidates.sort((a, b) => cheapBaseScore(a, merged) - cheapBaseScore(b, merged));
  return candidates;
}

function familyMatchScore(cents, familyLibrary) {
  const matches = findTuneableFamilyMatches(cents, {
    intervals: familyLibrary.map((family) => ({
      ratio: family.ratio,
      cents: family.cents,
      toleranceCents: family.tolerance,
      weight: family.weight,
    })),
  });
  return {
    score: matches.reduce((sum, match) => sum + match.score, 0),
    matches: matches.map((match) => match.ratio),
  };
}

export function scoreCandidateAgainstContext(candidate, contextSlot, options = {}) {
  const familyLibrary = buildConsonantFamilyLibrary(options);
  const dyad = normalizeCandidateRatioToPitchClass(
    candidate.ratio.div(contextSlot.committedIdentity.ratio),
  );
  const dyadCents = ratioToCents(dyad);
  return familyMatchScore(dyadCents, familyLibrary);
}

export function scoreEnharmonicReuse(candidate, context, options = {}) {
  const toleranceTable = options.contextualToleranceTable ?? DEFAULT_CONTEXTUAL_TOLERANCE_TABLE;
  const tolerance = toleranceTable[candidate.ratioText] ?? null;
  const familyLibrary = buildConsonantFamilyLibrary(options);
  const nearbyFamily = familyLibrary.find((family) => family.ratio === candidate.ratioText);
  const directReuse = nearbyFamily && tolerance != null ? nearbyFamily.weight * (tolerance / 12) : 0;
  const neighborFamilies = getNeighborFamilies(candidate.ratioText);
  const neighborReuse = neighborFamilies.reduce((sum, ratioText) => {
    const family = familyLibrary.find((entry) => entry.ratio === ratioText);
    return sum + (family ? family.weight * 0.05 : 0);
  }, 0);
  return directReuse + neighborReuse;
}

export function contextualConsonanceScore(candidate, context, options = {}) {
  let score = 0;
  const familyMatches = new Set(candidate.familyMatches ?? []);
  for (const slot of context.committedSlots ?? []) {
    const result = scoreCandidateAgainstContext(candidate, slot, options);
    score += result.score;
    result.matches.forEach((match) => familyMatches.add(match));
  }
  candidate.familyMatches = [...familyMatches];
  return score;
}

export function scoreRationalCandidate(candidate, context, options = {}) {
  const merged = { ...DEFAULT_RATIONALISE_OPTIONS, ...options };
  const contextual = contextualConsonanceScore(candidate, context, merged);
  const overtonalReuse = scoreEnharmonicReuse(candidate, context, merged);
  candidate.contextualConsonance = contextual;
  candidate.overtonalReuse = overtonalReuse;
  candidate.aggregateScore =
    merged.weightRadius * candidate.harmonicRadius +
    merged.weightDeviation * Math.abs(candidate.deviation) -
    merged.weightContext * contextual -
    merged.weightOvertonalReuse * overtonalReuse;
  return candidate;
}

export function rerankCandidatesInContext(candidates, context, options = {}) {
  const scored = candidates.map((candidate) => scoreRationalCandidate({ ...candidate }, context, options));
  scored.sort((a, b) => a.aggregateScore - b.aggregateScore);
  return scored;
}

export function chooseBestRationalCandidate(candidates, strategy = "harmonic_radius") {
  if (!candidates.length) return null;
  if (strategy === "aggregate_score") {
    return [...candidates].sort((a, b) => a.aggregateScore - b.aggregateScore)[0];
  }
  return [...candidates].sort((a, b) => a.harmonicRadius - b.harmonicRadius)[0];
}

export function findRationalCandidates(targetCents, options = {}) {
  const merged = { ...DEFAULT_RATIONALISE_OPTIONS, ...options };
  const candidates = enumerateCandidatesFromBounds(targetCents, merged);
  const prefiltered = candidates.slice(0, Math.max(merged.maxCandidates * 3, 16));
  if (!merged.workspace || merged.targetDegree == null) {
    return prefiltered.slice(0, merged.maxCandidates).map((candidate) => {
      candidate.aggregateScore = cheapBaseScore(candidate, merged);
      return candidate;
    });
  }
  const context = selectRationalisationContext(merged.workspace, merged.targetDegree, merged);
  return rerankCandidatesInContext(prefiltered, context, merged).slice(0, merged.maxCandidates);
}
