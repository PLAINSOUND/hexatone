import { CANONICAL_MONZO_BASIS } from "../../../tuning/interval.js";

// UI-facing search preferences for scale rationalisation. Values are stored as
// strings because they are edited directly in text inputs; adapter code parses
// them before calling the pure tuning search engine.

// All non-2 primes in the canonical basis — used to build the full prime grid.
export const PRIME_BOUND_KEYS = CANONICAL_MONZO_BASIS.filter((p) => p !== 2);
// Split into two rows: common primes (3–19) and extended primes (23+).
export const PRIME_BOUND_KEYS_LOW  = PRIME_BOUND_KEYS.filter((p) => p <= 19);
export const PRIME_BOUND_KEYS_HIGH = PRIME_BOUND_KEYS.filter((p) => p > 19);

export const DEFAULT_PRIME_BOUNDS = Object.fromEntries(PRIME_BOUND_KEYS.map((p) => {
  if (p === 3)  return [p, "8"];
  if (p === 5)  return [p, "3"];
  if (p === 7)  return [p, "2"];
  if (p === 11) return [p, "2"];
  if (p === 13) return [p, "2"];
  if (p === 17) return [p, "1"];
  if (p === 19) return [p, "1"];
  return [p, "0"];
}));

export const DEFAULT_SEARCH_PREFS = {
  region: "symmetric",
  primeLimit: "19",
  oddLimit: "255",
  centsTolerance: "6",
  contextTolerance: "14",
  // "keep": leave existing ratio entries unchanged; "search": re-search all degrees
  existingRatios: "keep",
  // primeBounds: overtonal maxima per prime (always used)
  primeBounds: { ...DEFAULT_PRIME_BOUNDS },
  // primeBoundsUt: undertonal maxima per prime (only used in "custom" region mode;
  // initialised equal to primeBounds so switching to custom starts symmetric)
  primeBoundsUt: { ...DEFAULT_PRIME_BOUNDS },
};

export function parseOptionalPositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function buildPrimeBoundsFromPrefs(searchPrefs, primeLimit = null) {
  const bounds = {};
  const boundsUt = {};
  const effectivePrimeLimit = parseOptionalPositiveInt(primeLimit);
  for (const prime of CANONICAL_MONZO_BASIS) {
    if (prime === 2) continue;
    if (effectivePrimeLimit != null && prime > effectivePrimeLimit) break;
    // Parse the stored bound value.  parseOptionalPositiveInt returns null for
    // "0", but 0 is a valid bound meaning "exclude this prime entirely".  We
    // must distinguish between a missing/unparseable value (default to 1) and
    // an explicit "0" (honour as 0 so the prime is skipped in boundsToRanges).
    const rawOt = searchPrefs?.primeBounds?.[prime];
    const rawUt = searchPrefs?.primeBoundsUt?.[prime];
    const parsedOt = parseOptionalPositiveInt(rawOt);
    const parsedUt = parseOptionalPositiveInt(rawUt);
    const isExplicitZeroOt = String(rawOt ?? "").trim() === "0";
    const isExplicitZeroUt = String(rawUt ?? "").trim() === "0";
    bounds[prime] = isExplicitZeroOt ? 0 : (parsedOt ?? 1);
    boundsUt[prime] = isExplicitZeroUt ? 0 : (parsedUt ?? 1);
  }
  const hasEntries = Object.keys(bounds).length > 0;
  return {
    primeBounds: hasEntries ? bounds : null,
    primeBoundsUt: hasEntries ? boundsUt : null,
  };
}
