import {
  Fraction,
  PRIMES,
  monzoToCents,
  primeLimit as xenPrimeLimit,
  toMonzo,
} from "xen-dev-utils";

export const DEFAULT_MONZO_BASIS = [2, 3, 5, 7, 11, 13, 17, 19, 23];

export const EXTENDED_MONZO_BASIS = [
  2, 3, 5, 7, 11, 13, 17, 19, 23,
  29, 31, 37, 41, 43, 47,
];

// Canonical exact basis for future HEJI / modulation work.
export const CANONICAL_MONZO_BASIS = EXTENDED_MONZO_BASIS;

const RATIO_RE = /^\s*(\d+)\s*\/\s*(\d+)\s*$/;
const EDO_RE = /^\s*(-?\d+)\s*\\\s*(\d+)\s*$/;
const CENTS_RE = /^\s*(-?\d+(?:\.\d*)?|\.\d+)\s*$/;
const INTEGER_RE = /^\s*(\d+)\s*$/;

function cloneBasis(basis) {
  return [...basis];
}

function isBasisPrefixOfPrimes(basis) {
  return basis.every((prime, index) => PRIMES[index] === prime);
}

function fractionFromRatioParts(numerator, denominator) {
  return new Fraction(Number(numerator), Number(denominator));
}

function unityFraction() {
  return new Fraction(1, 1);
}

function multiplyPrimePower(acc, prime, power) {
  if (!power) return acc;
  const factor = new Fraction(Number(prime), 1).pow(Math.abs(power));
  return power > 0 ? acc.mul(factor) : acc.div(factor);
}

export function residualFractionFromMonzo(fullMonzo, basis = CANONICAL_MONZO_BASIS) {
  const residual = fullMonzo.slice(basis.length);
  if (!residual.length || residual.every((power) => power === 0)) return null;

  let out = unityFraction();
  for (let index = 0; index < residual.length; index += 1) {
    out = multiplyPrimePower(out, PRIMES[basis.length + index], residual[index]);
  }
  return out;
}

export function expandMonzoToBasis(fullMonzo, basis = CANONICAL_MONZO_BASIS) {
  if (!isBasisPrefixOfPrimes(basis)) {
    throw new Error("Monzo basis must be a prefix of xen-dev-utils PRIMES.");
  }
  const projected = new Array(basis.length).fill(0);
  for (let index = 0; index < basis.length; index += 1) {
    projected[index] = fullMonzo[index] ?? 0;
  }
  return projected;
}

export function monzoToFractionOnBasis(monzo, basis = CANONICAL_MONZO_BASIS) {
  let out = unityFraction();
  for (let index = 0; index < basis.length; index += 1) {
    out = multiplyPrimePower(out, basis[index], monzo[index] ?? 0);
  }
  return out;
}

export function monzoToCentsOnBasis(monzo, basis = CANONICAL_MONZO_BASIS) {
  if (!isBasisPrefixOfPrimes(basis)) {
    throw new Error("Monzo basis must be a prefix of xen-dev-utils PRIMES.");
  }
  return monzoToCents(monzo);
}

export function ratioToMonzoParts(ratio, basis = CANONICAL_MONZO_BASIS) {
  const fullMonzo = toMonzo(ratio);
  const monzo = expandMonzoToBasis(fullMonzo, basis);
  const residual = residualFractionFromMonzo(fullMonzo, basis);
  return {
    basis: cloneBasis(basis),
    monzo,
    residual,
    fullMonzo,
  };
}

export function classifyIntervalText(sourceText) {
  if (typeof sourceText !== "string") return "unknown";
  if (RATIO_RE.test(sourceText)) return "ratio";
  if (EDO_RE.test(sourceText)) return "edo";
  if (sourceText.includes(".")) return CENTS_RE.test(sourceText) ? "cents" : "unknown";
  if (INTEGER_RE.test(sourceText)) return "integer";
  return "unknown";
}

export function parseExactInterval(sourceText, options = {}) {
  const basis = options.basis ?? CANONICAL_MONZO_BASIS;
  const kind = classifyIntervalText(sourceText);
  const trimmed = typeof sourceText === "string" ? sourceText.trim() : "";

  if (kind === "ratio" || kind === "integer") {
    const match = kind === "ratio"
      ? trimmed.match(RATIO_RE)
      : trimmed.match(INTEGER_RE);
    const numerator = match[1];
    const denominator = kind === "ratio" ? match[2] : "1";
    const ratio = fractionFromRatioParts(numerator, denominator);
    const { monzo, residual, fullMonzo } = ratioToMonzoParts(ratio, basis);
    return {
      sourceText,
      kind,
      exact: true,
      cents: monzoToCents(fullMonzo),
      ratio,
      monzo,
      basis: cloneBasis(basis),
      residual,
      edo: null,
      primeLimit: xenPrimeLimit(ratio),
    };
  }

  if (kind === "edo") {
    const [, stepsText, edoText] = trimmed.match(EDO_RE);
    const steps = Number.parseInt(stepsText, 10);
    const edo = Number.parseInt(edoText, 10);
    return {
      sourceText,
      kind,
      exact: false,
      cents: (steps * 1200) / edo,
      ratio: null,
      monzo: null,
      basis: cloneBasis(basis),
      residual: null,
      edo: { steps, edo },
      primeLimit: null,
    };
  }

  if (kind === "cents") {
    return {
      sourceText,
      kind,
      exact: false,
      cents: Number.parseFloat(trimmed),
      ratio: null,
      monzo: null,
      basis: cloneBasis(basis),
      residual: null,
      edo: null,
      primeLimit: null,
    };
  }

  return {
    sourceText,
    kind: "unknown",
    exact: false,
    cents: null,
    ratio: null,
    monzo: null,
    basis: cloneBasis(basis),
    residual: null,
    edo: null,
    primeLimit: null,
  };
}

export function intervalToCents(interval) {
  return interval?.cents ?? null;
}

export function intervalHasExactMonzo(interval) {
  return Array.isArray(interval?.monzo);
}

export function intervalResidualToString(interval) {
  return interval?.residual ? interval.residual.toFraction() : null;
}
