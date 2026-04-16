import { Fraction, monzoToCents, primeLimit as xenPrimeLimit, toMonzo } from "xen-dev-utils";
import { CANONICAL_MONZO_BASIS, monzoToFractionOnBasis } from "./interval.js";
import {
  DEFAULT_TUNEABLE_INTERVALS,
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
    contextualBestMatch: 0,
    branchExtent: 0,
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

// s_branch: overtonal branch extent score.
//
// Treats the candidate as the root (harmonic 1) and searches the workspace for
// scale notes that approximate members of the overtonal series 1:3:5:7:9:11:13...
// up to the prime limit in options.primeLimit.
//
// Tolerance budget: starts at contextTolerance. Each matched member's absolute
// deviation from its ideal pitch is tracked. The remaining budget for subsequent
// members is (contextTolerance - maxDeviationSoFar), so the worst-case pairwise
// interval deviation within the branch never exceeds contextTolerance. When the
// budget runs out the branch terminates — no more members can match.
//
// Score: Σ (weight / max(radius, 0.001)) × (1 - deviation / budget) over all
// matched members including the root (which always matches at 0¢ deviation).
// This is on the same scale as s_ctx and s_ctx-tune: larger = better.
//
// Returns the score (0 if no overtonal matches beyond the root).
export function scoreBranchExtent(candidate, workspace, options = {}) {
  const ctxTol = options.contextTolerance ?? DEFAULT_CONTEXT_CONSONANCE_TOLERANCE;
  const primeLimit = options.primeLimit ?? DEFAULT_RATIONALISE_OPTIONS.primeLimit;
  const byDegree = workspace?.lookup?.byDegree;
  if (!byDegree) return 0;

  // Collect all scale cents values (excluding the candidate's own degree).
  const targetDegree = options.targetDegree ?? null;
  const scaleCents = [];
  for (const [degree, slot] of byDegree) {
    if (degree === targetDegree) continue;
    if (slot?.cents != null) scaleCents.push(slot.cents);
  }

  // Root always matches at 0¢ deviation — seed the score and budget tracking.
  const rootEntry = OVERTONAL_SERIES_PC[0]; // unison
  let score = rootEntry.weight; // radius=0, so full weight; root is free
  let maxDeviation = 0; // worst deviation seen so far (root is exact)

  // Walk the series in harmonic-number order, skipping the root (index 0).
  for (const member of OVERTONAL_SERIES_PC.slice(1)) {
    // Respect prime limit: skip members whose harmonic number exceeds the limit.
    // harmonicNumber for e.g. 9/1 is 9 — that's fine for primeLimit 7 since 9 = 3².
    // We filter by the actual prime factors: the prime limit of the member ratio.
    const memberPrimeLimit = member.monzo
      ? (() => {
          let lim = 2;
          for (let i = member.monzo.length - 1; i >= 1; i--) {
            if (member.monzo[i] > 0) { lim = CANONICAL_MONZO_BASIS[i]; break; }
          }
          return lim;
        })()
      : Infinity;
    if (memberPrimeLimit > primeLimit) continue;

    // Remaining tolerance budget — shrinks as deviations accumulate.
    const budget = ctxTol - maxDeviation;
    if (budget <= 0) break;

    // Ideal pitch of this series member above the candidate (mod octave).
    // member.cents is already the pitch-class of n/1 in [0, 1200).
    const idealPc = (candidate.cents + member.cents) % 1200;

    // Find the closest scale note to this ideal pitch class.
    let bestDiff = Infinity;
    for (const sc of scaleCents) {
      // Pitch-class distance: minimum of direct and wrapped distance.
      const raw = ((sc - idealPc) % 1200 + 1200) % 1200;
      const diff = Math.min(raw, 1200 - raw);
      if (diff < bestDiff) bestDiff = diff;
    }

    if (bestDiff > budget) continue; // outside remaining budget — skip this member

    // Proximity taper relative to the current budget (not the full tolerance).
    const proximity = 1 - bestDiff / budget;
    const baseScore = member.radius > 0 ? member.weight / member.radius : member.weight;
    score += baseScore * proximity;

    // Update worst deviation — this shrinks the budget for subsequent members.
    if (bestDiff > maxDeviation) maxDeviation = bestDiff;
  }

  // Return 0 if no overtonal members matched (only the free root counts).
  return score > rootEntry.weight ? score : 0;
}

// Returns { total, best } where:
//   total — sum of weight/radius×proximity across all context slots (breadth + quality)
//   best  — single highest per-slot score (best one consonant relationship)
// Both are on the same scale: larger = better contextual fit.
export function contextualConsonanceScore(candidate, context, options = {}) {
  let total = 0;
  let best = 0;
  for (const slot of context.committedSlots ?? []) {
    const result = scoreCandidateAgainstContext(candidate, slot, options);
    total += result.score;
    if (result.score > best) best = result.score;
  }
  return { total, best };
}

export function scoreRationalCandidate(candidate, context, options = {}) {
  const merged = { ...DEFAULT_RATIONALISE_OPTIONS, ...options };
  const { total, best } = contextualConsonanceScore(candidate, context, merged);
  const branch = scoreBranchExtent(candidate, context.workspace, merged);
  candidate.contextualConsonance = total;
  candidate.contextualBestMatch = best;
  candidate.branchExtent = branch;
  candidate.aggregateScore =
    merged.weightRadius * candidate.harmonicRadius +
    merged.weightDeviation * Math.abs(candidate.deviation) -
    merged.weightContext * total -
    merged.weightOvertonalReuse * best;
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
