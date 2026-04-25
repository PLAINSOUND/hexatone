import { Fraction, monzoToCents, primeLimit as xenPrimeLimit, toMonzo } from "xen-dev-utils";
import { CANONICAL_MONZO_BASIS, monzoToFractionOnBasis } from "./interval.js";
import {
  DEFAULT_TUNEABLE_INTERVALS,
} from "./tuneable-intervals.js";

// Pure candidate-search and scoring engine for scale rationalisation.
// Input is a target cents value plus optional ScaleWorkspace context; output is
// ranked exact-ratio candidates. UI modules decide whether to preview or commit.

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
    // Compute monzo on CANONICAL_MONZO_BASIS from [n, d].
    // toMonzo(n/d) gives the full monzo; we expand/trim to basis length.
    let monzo;
    try {
      const raw = toMonzo(new Fraction(n, d));
      monzo = Array.from({ length: CANONICAL_MONZO_BASIS.length }, (_, i) => raw[i] ?? 0);
    } catch {
      monzo = null;
    }
    return {
      ratio: entry.ratio,
      ratioParts: entry.ratioParts,
      monzo,
      cents: pc,
      octaveShift,
      radius,
      weight: entry.weight,
      toleranceCents: entry.toleranceCents,
    };
  })
  .sort((a, b) => a.radius - b.radius);

// Overtonal series pitch classes: members of the harmonic series n/1 reduced to
// [0, 1200), derived from TUNEABLE_PC entries that are purely overtonal (all
// non-2 monzo exponents ≥ 0). The unison (n=1, 0¢) is included explicitly.
// Sorted by harmonic number ascending so the series is traversed in order.
// Each entry carries the full TUNEABLE_PC metadata plus harmonicNumber = n.
export const OVERTONAL_SERIES_PC = (() => {
  const entries = [];
  // Unison: always the root, contributes no deviation
  entries.push({
    ratio: "1/1", ratioParts: [1, 1], monzo: null,
    cents: 0, octaveShift: 0, radius: 0, weight: 1.0,
    harmonicNumber: 1,
  });
  for (const entry of TUNEABLE_PC) {
    if (!Array.isArray(entry.monzo)) continue;
    // Purely overtonal: all non-2 exponents ≥ 0, at least one > 0
    const nonTwoExps = entry.monzo.slice(1);
    if (nonTwoExps.every((e) => e >= 0) && nonTwoExps.some((e) => e > 0)) {
      // Harmonic number = product of prime^exp for non-2 primes
      let harmonicNumber = 1;
      for (let i = 1; i < CANONICAL_MONZO_BASIS.length; i++) {
        harmonicNumber *= Math.pow(CANONICAL_MONZO_BASIS[i], entry.monzo[i]);
      }
      entries.push({ ...entry, harmonicNumber });
    }
  }
  entries.sort((a, b) => a.harmonicNumber - b.harmonicNumber);
  return entries;
})();

export const DEFAULT_RATIONALISE_OPTIONS = {
  primeLimit: 7,
  primeBounds: null,
  oddLimit: null,
  centsTolerance: 5,
  maxCandidates: 8,
  region: "symmetric",
  maxContextComparisons: 8,
  weightRadius: 1.0,       // penalises harmonic complexity
  weightDeviation: 0.5,    // penalises pitch deviation (less critical than radius)
  weightContext: 0.6,      // rewards contextual consonance breadth
  weightBranch: 1.0,       // rewards overtonal branch membership (equal weight to radius)
  weightConsistency: 0.8,  // rewards harmonic adjacency to already-committed degrees
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

// ── Residual table for primes ≥ 7 ────────────────────────────────────────────
//
// The search space is split into three layers:
//   Outer loops : prime-3 (up to ±8 = 17 values) × prime-5 (up to ±3 = 7 values)
//   Residual    : all primes ≥ 7 combined
//
// For each (e3, e5) pair we compute the 3,5-limit pitch class, then look up
// which primes-≥7 combinations bring the total within `centsTolerance` of the
// target.  This binary search replaces iterating the full product for every
// (e3, e5) pair.
//
// At 47-limit with bounds {7:2, 11–47:1}: 5 × 3^12 ≈ 885k entries — well
// within budget and built once per search call.
//
// If the table would exceed RESIDUAL_TABLE_MAX we fall back to the flat scan.
const RESIDUAL_TABLE_MAX = 1_500_000;

// Module-level cache: residual table is keyed on the combination of
// residualEntries ranges + oddLimit.  Building 885k combinations for 47-limit
// takes ~100ms; caching means we pay that cost once per unique settings
// configuration rather than once per scale degree (81 × for an 81-note scale).
const _residualTableCache = new Map();

function _residualTableCacheKey(residualEntries, oddLimit) {
  // Key encodes primes + their range bounds + oddLimit.
  // Using a compact string rather than JSON.stringify(ranges) to avoid
  // allocating large arrays just for the key.
  const parts = residualEntries.map((e) => `${e.prime}:${e.range[0]}..${e.range[e.range.length - 1]}`);
  return `${parts.join(",")}|${oddLimit ?? ""}`;
}

// Build the residual table for primes ≥ 7.
// oddLimit (optional): pre-prune combinations whose odd-part contribution from
// these primes alone already exceeds oddLimit.  This is safe because the outer
// (e3, e5) layer contributes additional odd-part factors — if the residual
// already exceeds the limit, no outer combination can make it valid.
// The pruning is applied in log2 space to avoid overflow.
function buildResidualTable(residualEntries, oddLimit = null) {
  // Count total combinations to check against the materialise cap.
  // When oddLimit is set, the pruning inside the loop will eliminate most
  // combinations (e.g. at oddLimit=255 only ~128 odd products survive),
  // so we skip the raw-count guard and trust the pruner to keep the table small.
  // Without oddLimit we must guard against OOM from an unconstrained product.
  if (oddLimit == null || oddLimit <= 0) {
    let rawCount = 1;
    for (const e of residualEntries) {
      rawCount *= e.range.length;
      if (rawCount > RESIDUAL_TABLE_MAX) return null; // caller falls back to flat scan
    }
  }

  if (residualEntries.length === 0) {
    return [{ cents: 0, log2OddPart: 0, exps: [] }];
  }

  // Pre-compute log2 of each prime for efficiency.
  const log2Primes = residualEntries.map((e) => Math.log2(e.prime));
  const log2OddLimit = oddLimit != null && oddLimit > 0 ? Math.log2(oddLimit) : Infinity;

  const table = [];

  for (const combination of cartesianProductGenerator(residualEntries.map((e) => e.range))) {
    // Compute odd-part contribution and pitch-class cents simultaneously.
    let centsRaw = 0;
    let log2Num = 0; // log2 of numerator odd part
    let log2Den = 0; // log2 of denominator odd part

    for (let i = 0; i < combination.length; i++) {
      const exp = combination[i];
      if (exp === 0) continue;
      centsRaw += exp * log2Primes[i] * 1200;
      if (exp > 0) log2Num += exp * log2Primes[i];
      else log2Den -= exp * log2Primes[i]; // exp < 0, so subtract makes it positive
    }

    // Pre-prune: if the residual odd part already exceeds oddLimit, no outer
    // (e3, e5) combination can save this entry — skip it entirely.
    if (Math.max(log2Num, log2Den) > log2OddLimit) continue;

    const cents = ((centsRaw % 1200) + 1200) % 1200;
    // Store log2OddPart so the outer loop can quickly check the combined total.
    table.push({ cents, log2Num, log2Den, exps: combination.slice() });
  }

  // Sort ascending by pitch-class cents for binary search.
  table.sort((a, b) => a.cents - b.cents);
  return table;
}

// Binary search: index of first entry with cents >= lo.
function lowerBound(table, lo) {
  let left = 0;
  let right = table.length;
  while (left < right) {
    const mid = (left + right) >>> 1;
    if (table[mid].cents < lo) left = mid + 1;
    else right = mid;
  }
  return left;
}

// Collect residual table entries within `tol` of `target` (mod 1200).
function residualMatches(table, target, tol) {
  const lo = target - tol;
  const hi = target + tol;
  const matches = [];

  if (lo < 0) {
    // Window wraps below 0: also search [lo+1200, 1200).
    let i = lowerBound(table, lo + 1200);
    while (i < table.length) matches.push(table[i++]);
    i = 0;
    while (i < table.length && table[i].cents <= hi) matches.push(table[i++]);
  } else if (hi >= 1200) {
    // Window wraps above 1200: also search [0, hi-1200].
    let i = lowerBound(table, lo);
    while (i < table.length) matches.push(table[i++]);
    i = 0;
    while (i < table.length && table[i].cents <= hi - 1200) matches.push(table[i++]);
  } else {
    let i = lowerBound(table, lo);
    while (i < table.length && table[i].cents <= hi) matches.push(table[i++]);
  }

  return matches;
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
    contextualBestMatch: 0,
    contextualBestRatio: null,
    branchExtent: 0,
    primeConsistency: 0,
    aggregateScore: 0,
    globalScore: 0,
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
      .filter((slot) => slot?.cents != null)
      .slice(0, max);
  }

  // For every slot in the workspace (rational or cents-only), compute the dyad
  // it would form with the target and find the best-matching tuneable interval
  // (lowest harmonic radius within ctxTol cents). Slots that form no recognisable
  // consonance are excluded. The remaining slots are sorted by best-match radius.
  const targetCents = workspace?.lookup?.byDegree?.get(targetDegree)?.cents ?? null;
  if (targetCents == null) return [];

  const scored = [];
  for (const [degree, slot] of byDegree) {
    if (degree === targetDegree) continue;
    // Any slot with a usable cents value qualifies — no ratio required.
    if (slot?.cents == null) continue;

    const slotCents = slot.cents;
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
  const committedSlots = boundedContextSlots(workspace, targetDegree, options);
  return {
    targetDegree,
    workspace,
    activeFrame: options.activeFrame ?? null,
    nearbyDegrees: committedSlots.map((slot) => slot.degree),
    committedSlots,
  };
}

// Shared inner logic: given a fully-assembled monzo (already pitch-class
// normalised), check all filters and push a candidate if it passes.
function _tryPushCandidate(monzo, targetCents, tol, merged, candidates) {
  const cents = monzoToCents(monzo);
  if (!Number.isFinite(cents)) return;
  if (Math.abs(targetCents - cents) > tol) return;

  const candidate = buildCandidateRecordFromMonzo({ monzo, cents, targetCents });
  candidate.region = merged.region;

  if (merged.oddLimit != null && merged.oddLimit > 0 && candidate.oddLimit > merged.oddLimit) return;
  if (!materializeCandidateRatio(candidate)) return;

  candidates.push(candidate);
}

export function enumerateCandidatesFromBounds(targetCents, options = {}) {
  // Enumerates possible monzos inside the user's prime/region/odd-limit bounds.
  // Most filtering happens before Fraction construction so high-prime searches
  // stay safe and fast enough for scale-table interaction.
  const merged = { ...DEFAULT_RATIONALISE_OPTIONS, ...options };
  const primeBounds = merged.primeBounds ?? primeLimitToBounds(merged.primeLimit);
  const rangeEntries = boundsToRanges(primeBounds, merged.region, merged.primeBoundsUt ?? null);
  if (!rangeEntries.length) return [];

  const tol = merged.centsTolerance;
  const candidates = [];

  // ── Three-layer pruned search ─────────────────────────────────────────────
  //
  // The search space is split into three layers to avoid iterating the full
  // Cartesian product for every degree:
  //
  //   Layer A (outer loop) : prime-3  — up to ±8 = 17 values
  //   Layer B (middle loop): prime-5  — up to ±3 =  7 values
  //   Layer C (residual table, binary-searched): primes ≥ 7
  //
  // For fixed (e3, e5), the 3,5-limit pitch class is known exactly.  The
  // primes-≥7 combinations are pre-sorted by pitch class so we binary-search
  // for the subset within `tol` of the required residual.  This reduces per-
  // degree work from O(17 × 7 × |C|) iterations to O(17 × 7 × matches),
  // where `matches` is typically 0–5 even at 47-limit.
  //
  // At 47-limit with {7:2, 11–47:1}: |C| = 5 × 3^12 ≈ 885k — built once,
  // searched 17×7 = 119 times per degree.
  //
  // Fallback: if prime-3 or prime-5 are absent, or |C| > RESIDUAL_TABLE_MAX,
  // fall back to the original flat Cartesian scan.

  const prime3Entry = rangeEntries.find((e) => e.prime === 3) ?? null;
  const prime5Entry = rangeEntries.find((e) => e.prime === 5) ?? null;
  const residualEntries = rangeEntries.filter((e) => e.prime !== 3 && e.prime !== 5);

  const oddLimit = merged.oddLimit != null && merged.oddLimit > 0 ? merged.oddLimit : null;
  const log2OddLimit = oddLimit != null ? Math.log2(oddLimit) : Infinity;

  // Build the residual table with odd-limit pre-pruning: entries whose primes-≥7
  // odd part already exceeds the limit are dropped before the table is sorted.
  // The table is cached by (residualEntries ranges, oddLimit) so it is built
  // only once per unique settings configuration across all scale degrees.
  let residualTable = null;
  if (prime3Entry && prime5Entry) {
    const cacheKey = _residualTableCacheKey(residualEntries, oddLimit);
    if (_residualTableCache.has(cacheKey)) {
      residualTable = _residualTableCache.get(cacheKey);
    } else {
      residualTable = buildResidualTable(residualEntries, oddLimit);
      if (residualTable) _residualTableCache.set(cacheKey, residualTable);
    }
  }

  if (!prime3Entry || !prime5Entry || !residualTable) {
    // ── Fallback: flat Cartesian scan (original behaviour) ──────────────────
    for (const combination of cartesianProductGenerator(rangeEntries.map((e) => e.range))) {
      if (combination.every((v) => v === 0)) continue;
      const rawMonzo = buildMonzoFromCombination(combination, rangeEntries);
      _tryPushCandidate(normalizeMonzoToPitchClass(rawMonzo), targetCents, tol, merged, candidates);
    }
    candidates.sort((a, b) => cheapBaseScore(a, merged) - cheapBaseScore(b, merged));
    return candidates;
  }

  // ── Three-layer search with odd-limit early exit ─────────────────────────
  const log2p3 = Math.log2(3);
  const log2p5 = Math.log2(5);
  const p3Cents = log2p3 * 1200;
  const p5Cents = log2p5 * 1200;

  for (const e3 of prime3Entry.range) {
    const raw3 = e3 * p3Cents;
    for (const e5 of prime5Entry.range) {
      if (e3 === 0 && e5 === 0 && residualEntries.length === 0) continue; // unison

      // Log2 of the combined 3,5-limit odd parts for numerator and denominator.
      // 3^e3 × 5^e5 contributes to num if exp > 0, den if exp < 0.
      const log2Odd3num = e3 > 0 ? e3 * log2p3 : 0;
      const log2Odd3den = e3 < 0 ? -e3 * log2p3 : 0;
      const log2Odd5num = e5 > 0 ? e5 * log2p5 : 0;
      const log2Odd5den = e5 < 0 ? -e5 * log2p5 : 0;
      const log2Odd35num = log2Odd3num + log2Odd5num;
      const log2Odd35den = log2Odd3den + log2Odd5den;

      // Early exit: if the 3,5 layer alone already exceeds the odd limit on
      // either the numerator or denominator side, no residual can help.
      if (Math.max(log2Odd35num, log2Odd35den) > log2OddLimit) continue;

      // Headroom remaining for the residual layer on each side.
      const log2HeadroomNum = log2OddLimit - log2Odd35num;
      const log2HeadroomDen = log2OddLimit - log2Odd35den;

      // Pitch-class cents of the 3,5-limit component.
      const raw35 = raw3 + e5 * p5Cents;
      const pc35 = ((raw35 % 1200) + 1200) % 1200;

      // Residual the primes-≥7 layer must supply.
      const residualTarget = ((targetCents - pc35) % 1200 + 1200) % 1200;

      const matches = residualMatches(residualTable, residualTarget, tol);
      if (matches.length === 0) continue;

      for (const match of matches) {
        if (e3 === 0 && e5 === 0 && match.exps.every((v) => v === 0)) continue; // unison

        // Combined odd-limit check: residual's log2OddPart + outer layer's must
        // stay within the limit on both numerator and denominator sides.
        // match.log2Num / log2Den are the residual's contributions.
        if (match.log2Num > log2HeadroomNum) continue;
        if (match.log2Den > log2HeadroomDen) continue;

        // Assemble full monzo.
        const rawMonzo = new Array(CANONICAL_MONZO_BASIS.length).fill(0);
        rawMonzo[prime3Entry.index] = e3;
        rawMonzo[prime5Entry.index] = e5;
        for (let i = 0; i < residualEntries.length; i++) {
          rawMonzo[residualEntries[i].index] = match.exps[i];
        }

        _tryPushCandidate(normalizeMonzoToPitchClass(rawMonzo), targetCents, tol, merged, candidates);
      }
    }
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

// s_tune: is this candidate reachable by tuning from a standard tuneable interval?
//
// Tuning model: prime-3 (fifths/fourths) can bridge up to 3 steps — so a ratio
// that differs from a TUNEABLE_PC entry only in its prime-3 exponent, by at most
// ±3, is considered tuneable from that entry (4 consecutive exponents containing 0).
// All other non-2 prime exponents must match exactly: 25/16 is NOT tuneable from
// 5/4 just because both use prime 5; the extra factor of 5 requires its own step.
// Prime-2 is ignored entirely (octave equivalence).
//
// Returns 1 if a tuneable relative exists in TUNEABLE_PC, 0 otherwise.
export function scoreEnharmonicReuse(candidate, _context, _options = {}) {
  const cMonzo = candidate.monzo;
  if (!Array.isArray(cMonzo)) return 0;

  for (const entry of TUNEABLE_PC) {
    if (!Array.isArray(entry.monzo)) continue;
    // Check all non-2, non-3 primes match exactly (indices 2+).
    let otherPrimesMatch = true;
    for (let i = 2; i < CANONICAL_MONZO_BASIS.length; i++) {
      if ((cMonzo[i] ?? 0) !== (entry.monzo[i] ?? 0)) {
        otherPrimesMatch = false;
        break;
      }
    }
    if (!otherPrimesMatch) continue;
    // Prime-3 delta must be within ±3 (window of 4 containing 0).
    const delta3 = Math.abs((cMonzo[1] ?? 0) - (entry.monzo[1] ?? 0));
    if (delta3 <= 3) return 1;
  }
  return 0;
}

// Cross-degree prime consistency score.
//
// Returns a score in [0, 2] reflecting how well the candidate fits the prime
// vocabulary already established by committed scale degrees:
//
//   2.0 — candidate uses only primes already present in the committed set
//          AND is harmonically adjacent to at least one committed ratio
//   1.0 — candidate is adjacent to a committed ratio but introduces a new prime
//   0.0 — not adjacent to any committed ratio
//
// Adjacency (required for any score > 0): the candidate's monzo differs from a
// committed monzo in exactly one prime dimension, by a simple step:
//   prime 3 : |Δexp| ≤ 2  (fifth or ninth)
//   prime 5, 7, 11–19 : |Δexp| = 1
// All other non-2 exponents must match exactly.
//
// "Already present" means at least one committed monzo has a non-zero exponent
// for that prime. A candidate that uses only such primes scores 2.0 when adjacent,
// rewarding choices like 121/64 (uses 11²) when 121/96 (also 11²) is committed.
//
// Prime-2 is ignored throughout (octave equivalence).
export function scorePrimeConsistency(candidate, committedMonzos) {
  const cMonzo = candidate.monzo;
  if (!Array.isArray(cMonzo) || !committedMonzos?.length) return 0;

  // Collect the set of primes (indices) already used in committed monzos.
  const committedPrimeIndices = new Set();
  for (const ref of committedMonzos) {
    if (!Array.isArray(ref)) continue;
    for (let i = 1; i < CANONICAL_MONZO_BASIS.length; i++) {
      if ((ref[i] ?? 0) !== 0) committedPrimeIndices.add(i);
    }
  }

  // Check whether this candidate introduces any new prime.
  let allPrimesKnown = true;
  for (let i = 1; i < CANONICAL_MONZO_BASIS.length; i++) {
    if ((cMonzo[i] ?? 0) !== 0 && !committedPrimeIndices.has(i)) {
      allPrimesKnown = false;
      break;
    }
  }

  // Find the best adjacency match against any committed monzo.
  for (const ref of committedMonzos) {
    if (!Array.isArray(ref)) continue;

    let diffCount = 0;
    let adjacent = true;

    for (let i = 1; i < CANONICAL_MONZO_BASIS.length; i++) {
      const prime = CANONICAL_MONZO_BASIS[i];
      const delta = Math.abs((cMonzo[i] ?? 0) - (ref[i] ?? 0));
      if (delta === 0) continue;

      diffCount++;
      if (diffCount > 1) { adjacent = false; break; }

      if (prime === 3) {
        if (delta > 2) { adjacent = false; break; }
      } else if (prime <= 19) {
        if (delta !== 1) { adjacent = false; break; }
      } else {
        adjacent = false; break;
      }
    }

    if (adjacent && diffCount > 0) {
      // Adjacent: score 2 if all primes known, 1 if a new prime is introduced.
      return allPrimesKnown ? 2 : 1;
    }
  }
  return 0;
}

// Helper: compute the prime limit of a series entry from its monzo.
function seriesMemberPrimeLimit(member) {
  if (!Array.isArray(member.monzo)) return Infinity;
  for (let i = member.monzo.length - 1; i >= 1; i--) {
    if (member.monzo[i] > 0) return CANONICAL_MONZO_BASIS[i];
  }
  return 2; // unison
}

// Score a single branch hypothesis: the candidate occupies the role of
// `identity` (a member of OVERTONAL_SERIES_PC) and the implied root is at
// rootCents. Searches scaleCents for the other series members and returns
// the branch score using the budget-shrinking tolerance model.
function scoreBranchFromRoot(rootCents, identity, scaleCents, ctxTol, primeLimit) {
  // The candidate itself is exact (0¢ deviation) as the fixed identity.
  const identityScore = identity.radius > 0
    ? identity.weight / identity.radius
    : identity.weight;
  let score = identityScore;
  let maxDeviation = 0;

  for (const member of OVERTONAL_SERIES_PC) {
    if (member.harmonicNumber === identity.harmonicNumber) continue; // already counted
    if (seriesMemberPrimeLimit(member) > primeLimit) continue;

    const budget = ctxTol - maxDeviation;
    if (budget <= 0) break;

    // Ideal pitch class of this member above the implied root.
    const idealPc = (rootCents + member.cents) % 1200;

    // Find closest scale note.
    let bestDiff = Infinity;
    for (const sc of scaleCents) {
      const raw = ((sc - idealPc) % 1200 + 1200) % 1200;
      const diff = Math.min(raw, 1200 - raw);
      if (diff < bestDiff) bestDiff = diff;
    }

    if (bestDiff > budget) continue;

    const proximity = 1 - bestDiff / budget;
    const baseScore = member.radius > 0 ? member.weight / member.radius : member.weight;
    score += baseScore * proximity;

    if (bestDiff > maxDeviation) maxDeviation = bestDiff;
  }

  // Only count hypotheses where at least one *other* series member matched.
  return score > identityScore ? score : 0;
}

// s_oton: overtonal branch extent score.
//
// The candidate is tested as every possible odd identity in the series
// (harmonic 1, 3, 5, 7, 9, 11, 13, 15...) up to the prime limit. For each
// identity the implied root is computed and the scale is searched for the
// remaining series members. The highest-scoring hypothesis is returned.
//
// This means e.g. a candidate that is harmonic 15 in a 1:3:5:7:9:11:13:15
// chord scores well even though it is not itself the root.
//
// Tolerance budget: starts at contextTolerance. The worst deviation seen so
// far among matched members reduces the remaining budget for subsequent ones,
// so the maximum pairwise interval deviation within the branch never exceeds
// contextTolerance.
//
// Score: Σ (weight / radius) × (1 - deviation / budget) over matched members.
// Same scale as s_ctx and s_ctx-tune: larger = better.
export function scoreBranchExtent(candidate, workspace, options = {}) {
  const ctxTol = options.contextTolerance ?? DEFAULT_CONTEXT_CONSONANCE_TOLERANCE;
  const primeLimit = options.primeLimit ?? DEFAULT_RATIONALISE_OPTIONS.primeLimit;
  const byDegree = workspace?.lookup?.byDegree;
  if (!byDegree) return 0;

  // Collect all scale cents values including the candidate itself.
  const scaleCents = [];
  for (const slot of byDegree.values()) {
    if (slot?.cents != null) scaleCents.push(slot.cents);
  }

  return scoreBranchExtentFromScaleCents(candidate, scaleCents, ctxTol, primeLimit);
}

// Inner hot-path: accepts pre-computed scaleCents and identities to avoid
// rebuilding them for every candidate when scoring a batch.
function scoreBranchExtentFromScaleCents(candidate, scaleCents, ctxTol, primeLimit) {
  // Try each possible identity for the candidate (up to prime limit).
  let bestScore = 0;
  for (const identity of OVERTONAL_SERIES_PC) {
    if (seriesMemberPrimeLimit(identity) > primeLimit) continue;

    // Implied root: where would harmonic 1 be if candidate is harmonic `k`?
    const rootCents = ((candidate.cents - identity.cents) % 1200 + 1200) % 1200;

    const score = scoreBranchFromRoot(rootCents, identity, scaleCents, ctxTol, primeLimit);
    if (score > bestScore) bestScore = score;
  }

  return bestScore;
}

// Returns { total, best, bestRatio } where:
//   total     — sum of weight/radius×proximity across all context slots (breadth + quality)
//   best      — single highest per-slot score (best one consonant relationship)
//   bestRatio — ratio string of the TUNEABLE_PC entry that produced the best score
// Both score values are on the same scale: larger = better contextual fit.
export function contextualConsonanceScore(candidate, context, options = {}) {
  let total = 0;
  let best = 0;
  let bestRatio = null;
  for (const slot of context.committedSlots ?? []) {
    const result = scoreCandidateAgainstContext(candidate, slot, options);
    total += result.score;
    if (result.score > best) {
      best = result.score;
      bestRatio = result.matches[0] ?? null;
    }
  }
  return { total, best, bestRatio };
}

export function scoreRationalCandidate(candidate, context, options = {}, _scaleCents = null, _committedMonzos = null) {
  // Combines local fit (radius/deviation) with scale context. This is the main
  // ranking boundary that future retuning work can replace or extend without
  // changing TuneCell's preview/commit mechanics.
  const merged = { ...DEFAULT_RATIONALISE_OPTIONS, ...options };
  const { total, best, bestRatio } = contextualConsonanceScore(candidate, context, merged);
  const ctxTol = merged.contextTolerance ?? DEFAULT_CONTEXT_CONSONANCE_TOLERANCE;
  const primeLimit = merged.primeLimit ?? DEFAULT_RATIONALISE_OPTIONS.primeLimit;
  // Use pre-computed scaleCents if provided (batch path), otherwise derive from workspace.
  let branch;
  if (_scaleCents) {
    branch = scoreBranchExtentFromScaleCents(candidate, _scaleCents, ctxTol, primeLimit);
  } else {
    branch = scoreBranchExtent(candidate, context.workspace, merged);
  }
  // Collect committed monzos from workspace if not pre-computed.
  // Excludes the target degree itself so a degree doesn't self-reinforce.
  const committedMonzos = _committedMonzos ?? (() => {
    const byDegree = context?.workspace?.lookup?.byDegree;
    if (!byDegree) return [];
    const monzos = [];
    for (const [degree, slot] of byDegree) {
      if (degree === context.targetDegree) continue;
      if (Array.isArray(slot?.committedIdentity?.monzo)) monzos.push(slot.committedIdentity.monzo);
    }
    return monzos;
  })();
  const consistency = scorePrimeConsistency(candidate, committedMonzos);

  candidate.contextualConsonance = total;
  candidate.contextualBestMatch = best;
  candidate.contextualBestRatio = bestRatio;
  candidate.branchExtent = branch;
  candidate.primeConsistency = consistency;
  // aggregateScore: cost function — lower = better. Used for sorting.
  // Penalises harmonic complexity (radius) and pitch deviation; rewards
  // contextual consonance breadth, overtonal branch membership, and
  // harmonic adjacency to already-committed degrees (consistency).
  candidate.aggregateScore =
    merged.weightRadius * candidate.harmonicRadius +
    merged.weightDeviation * Math.abs(candidate.deviation) -
    merged.weightContext * total -
    merged.weightBranch * branch -
    merged.weightConsistency * consistency;
  candidate.globalScore = -candidate.aggregateScore;
  return candidate;
}

export function rerankCandidatesInContext(candidates, context, options = {}) {
  // Pre-compute scaleCents and committedMonzos once per degree batch.
  // Both are static across all candidates for a given target degree.
  const byDegree = context?.workspace?.lookup?.byDegree;
  const scaleCents = options._scaleCents ?? (byDegree
    ? Array.from(byDegree.values()).filter((s) => s?.cents != null).map((s) => s.cents)
    : null);
  const committedMonzos = options._committedMonzos ?? (() => {
    if (!byDegree) return [];
    const monzos = [];
    for (const [degree, slot] of byDegree) {
      if (degree === context.targetDegree) continue;
      if (Array.isArray(slot?.committedIdentity?.monzo)) monzos.push(slot.committedIdentity.monzo);
    }
    return monzos;
  })();
  const scored = candidates.map((candidate) =>
    scoreRationalCandidate({ ...candidate }, context, options, scaleCents, committedMonzos),
  );
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
  // Public entry point for callers: search a bounded ratio field, then rerank
  // against workspace context when available.
  const merged = { ...DEFAULT_RATIONALISE_OPTIONS, ...options };
  const candidates = enumerateCandidatesFromBounds(targetCents, merged);
  const prefiltered = candidates.slice(0, Math.max(merged.maxCandidates * 3, 16));
  if (!merged.workspace || merged.targetDegree == null) {
    return prefiltered.slice(0, merged.maxCandidates).map((candidate) => {
      candidate.aggregateScore = cheapBaseScore(candidate, merged);
      candidate.globalScore = -candidate.aggregateScore;
      return candidate;
    });
  }
  const context = selectRationalisationContext(merged.workspace, merged.targetDegree, merged);
  return rerankCandidatesInContext(prefiltered, context, merged).slice(0, merged.maxCandidates);
}
