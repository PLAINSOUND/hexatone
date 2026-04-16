import { Fraction, monzoToCents, primeLimit as xenPrimeLimit } from "xen-dev-utils";
import { CANONICAL_MONZO_BASIS, monzoToFractionOnBasis } from "./interval.js";
import {
  DEFAULT_TUNEABLE_INTERVALS,
  getNeighborFamilies,
} from "./tuneable-intervals.js";

// Maximum log2 of numerator or denominator we will try to materialise as a
// Fraction.  2^53 is Number.MAX_SAFE_INTEGER; anything beyond that breaks the
// Fraction library.  We leave a comfortable margin.
const MAX_LOG2_SAFE = 40;

function oddPart(n) {
  let x = Math.abs(Number(n));
  if (!Number.isFinite(x) || x === 0) return 0;
  while (x % 2 === 0) x /= 2;
  return x;
}

// Pitch-class collapse of DEFAULT_TUNEABLE_INTERVALS.
//
// Every entry from the 3-octave tuneable list is mapped to [0, 1200) by
// removing octave factors, preserving enough information to reconstruct
// the original interval:
//
//   cents        — pitch-class cents in [0, 1200)
//   octaveShift  — integer octaves removed (originalCents = cents + octaveShift * 1200)
//   ratio        — original ratio text (e.g. "3/1" → pc 1902 - 1200 = 702, shift 1)
//   ratioParts   — original [n, d]
//   radius       — harmonic radius computed from odd parts of n and d
//   weight       — consonance weight from the tuneable list
//   toleranceCents — matching tolerance (inherited, kept in original-interval scale)
//
// Multiple original intervals may share the same pitch class (e.g. 3/2 at 702c
// and 3/1 at 1902c both collapse to 702c). All are kept as separate entries.
// Sorted by radius ascending (most consonant first) so the first match found
// when scanning is always the strongest.
export const TUNEABLE_PC = DEFAULT_TUNEABLE_INTERVALS
  .map((entry) => {
    const [n, d] = entry.ratioParts;
    const radius = 0.5 * (Math.log2(oddPart(n)) + Math.log2(oddPart(d)));
    const octaveShift = Math.floor(entry.cents / 1200);
    const pc = entry.cents - octaveShift * 1200;
    return {
      ratio: entry.ratio,
      ratioParts: entry.ratioParts,
      cents: pc,
      octaveShift,
      radius,
      weight: entry.weight,
      toleranceCents: entry.toleranceCents,
    };
  })
  .sort((a, b) => a.radius - b.radius);

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

function fractionCompare(a, b) {
  return a.s * a.n * b.d - b.s * b.n * a.d;
}

function normalizeCandidateRatioToPitchClass(ratio) {
  let out = ratio;
  while (fractionCompare(out, new Fraction(1, 1)) < 0) out = out.mul(2);
  while (fractionCompare(out, new Fraction(2, 1)) >= 0) out = out.div(2);
  return out;
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

function buildRange(max, region, utMax = null) {
  if (region === "overtonal") return Array.from({ length: max + 1 }, (_, i) => i);
  if (region === "undertonal") return Array.from({ length: max + 1 }, (_, i) => -max + i);
  if (region === "custom") {
    // Independent overtonal (otMax = max) and undertonal (utMax) bounds.
    const ut = utMax ?? max;
    return Array.from({ length: ut + max + 1 }, (_, i) => i - ut);
  }
  // symmetric: range is [-max, ..., max]
  return Array.from({ length: 2 * max + 1 }, (_, i) => i - max);
}

function boundsToRanges(primeBounds, region, primeBoundsUt = null) {
  const entries = [];
  for (let index = 0; index < CANONICAL_MONZO_BASIS.length; index += 1) {
    const prime = CANONICAL_MONZO_BASIS[index];
    if (prime === 2) continue;
    const otMax = primeBounds[prime];
    if (otMax == null || otMax === 0) {
      // In custom mode an undertonal-only prime (otMax=0, utMax>0) still needs
      // an entry; skip only when both sides are zero or absent.
      if (region !== "custom") continue;
      const utMax = primeBoundsUt?.[prime] ?? 0;
      if (utMax === 0) continue;
      entries.push({
        index,
        prime,
        range: buildRange(0, "custom", utMax),
      });
      continue;
    }
    entries.push({
      index,
      prime,
      range: buildRange(otMax, region, region === "custom" ? (primeBoundsUt?.[prime] ?? otMax) : null),
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

// Lazy Cartesian product generator — yields one combination at a time using
// index arithmetic. O(depth) memory regardless of total product size, so large
// prime-bound searches don't materialise millions of arrays before filtering.
function* cartesianProductGenerator(ranges) {
  if (ranges.length === 0) return;
  const indices = new Array(ranges.length).fill(0);
  while (true) {
    yield indices.map((idx, i) => ranges[i][idx]);
    let pos = indices.length - 1;
    while (pos >= 0) {
      indices[pos]++;
      if (indices[pos] < ranges[pos].length) break;
      indices[pos] = 0;
      pos--;
    }
    if (pos < 0) return;
  }
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

// Default tolerance (in cents) for matching dyads against TUNEABLE_PC entries
// when evaluating contextual consonance. Can be overridden via options.contextTolerance.
// Wider than the search centsTolerance to accept near-pure intervals that are
// slightly mistuned in the committed scale (e.g. a tempered third counts as
// contextually consonant even when it deviates from just by several cents).
const DEFAULT_CONTEXT_CONSONANCE_TOLERANCE = 14;

function boundedContextSlots(workspace, targetDegree, options = {}) {
  const byDegree = workspace?.lookup?.byDegree;
  if (!byDegree) return [];
  const max = options.maxContextComparisons ?? DEFAULT_RATIONALISE_OPTIONS.maxContextComparisons;
  const ctxTol = options.contextTolerance ?? DEFAULT_CONTEXT_CONSONANCE_TOLERANCE;

  if (options.contextDegrees) {
    // Explicit degree list provided — use it as-is.
    const unique = [...new Set(options.contextDegrees.filter((d) => d !== targetDegree))];
    return unique
      .map((d) => byDegree.get(d))
      .filter((slot) => slot?.committedIdentity?.ratio)
      .slice(0, max);
  }

  // For each committed rational slot, compute the dyad it would form with the
  // target cents and find the best-matching tuneable interval (lowest harmonic
  // radius within ctxTol cents). Slots that form no recognisable consonance
  // are excluded. The remaining slots are sorted by best-match harmonic radius.
  const targetCents = workspace?.lookup?.byDegree?.get(targetDegree)?.cents ?? null;
  if (targetCents == null) return [];

  const scored = [];
  for (const [degree, slot] of byDegree) {
    if (degree === targetDegree) continue;
    if (!slot?.committedIdentity?.ratio) continue;

    const slotCents = slot.cents ?? 0;
    // Directed dyad in [0, 1200): interval measured from slot UP to target,
    // wrapping within the octave. We do NOT fold to [0, 600] so that 3/2 (702c)
    // and 4/3 (498c) remain distinct — both are counted when present.
    const dyadCents = ((targetCents - slotCents) % 1200 + 1200) % 1200;

    // Find the tuneable pitch class with the lowest harmonic radius that is
    // within ctxTol of this directed dyad.
    // TUNEABLE_PC is pre-sorted by radius ascending, so first match is best.
    let bestRadius = Infinity;
    for (const tuneable of TUNEABLE_PC) {
      if (Math.abs(dyadCents - tuneable.cents) <= ctxTol) {
        bestRadius = tuneable.radius;
        break;
      }
    }
    if (!Number.isFinite(bestRadius)) continue; // no consonant match — skip

    scored.push({ slot, bestRadius });
  }

  scored.sort((a, b) => a.bestRadius - b.bestRadius);
  return scored.slice(0, max).map((entry) => entry.slot);
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
  const rangeEntries = boundsToRanges(primeBounds, merged.region, merged.primeBoundsUt ?? null);
  if (!rangeEntries.length) return [];

  const candidates = [];

  for (const combination of cartesianProductGenerator(rangeEntries.map((entry) => entry.range))) {
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


// Score a single directed dyad (slot → candidate) against TUNEABLE_PC.
//
// Contribution = (weight / radius) × proximity_factor
//
// proximity_factor = 1 - |deviation| / ctxTol  — linear taper from 1.0 (exact
// match) to 0.0 (at the edge of the tolerance window). This means:
//   - an exact 3/2 scores its full weight/radius value
//   - a slightly tempered 3/2 (e.g. quarter-comma meantone, ~5¢ off) still
//     contributes meaningfully
//   - a dyad at the tolerance boundary contributes nearly nothing
//
// Using weight/radius means very consonant intervals (low radius, e.g. 3/2)
// contribute more per match than complex ones (high radius, e.g. 11/9).
// Multiple distinct consonances accumulate additively, so having both 3/2 AND
// 4/3 above a note scores better than having just one of them.
export function scoreCandidateAgainstContext(candidate, contextSlot, options = {}) {
  const ctxTol = options.contextTolerance ?? DEFAULT_CONTEXT_CONSONANCE_TOLERANCE;
  const slotCents = contextSlot.cents ?? 0;
  const targetCents = candidate.cents;
  // Directed dyad: slot → target in [0, 1200), preserving direction so that
  // 3/2 (702c above) and 4/3 (498c above, or equivalently 702c below) are distinct.
  const dyadCents = ((targetCents - slotCents) % 1200 + 1200) % 1200;

  // Scan TUNEABLE_PC (sorted by radius ascending) for the best match.
  for (const tuneable of TUNEABLE_PC) {
    const diff = Math.abs(dyadCents - tuneable.cents);
    if (diff <= ctxTol) {
      // Linear proximity taper: exact = 1.0, edge = 0.0.
      const proximity = 1 - diff / ctxTol;
      // radius > 0 always for non-unison intervals in the tuneable list.
      const baseScore = tuneable.radius > 0 ? tuneable.weight / tuneable.radius : tuneable.weight;
      return { score: baseScore * proximity, matches: [tuneable.ratio] };
    }
  }
  return { score: 0, matches: [] };
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
