/** Exact octave reduction shared by notation and rationalisation. */
import { Fraction } from "xen-dev-utils";

function fractionCompare(a, b) {
  return a.s * a.n * b.d - b.s * b.n * a.d;
}

export function normalizeFractionToPitchClass(ratio) {
  let out = ratio;
  while (fractionCompare(out, new Fraction(1, 1)) < 0) out = out.mul(2);
  while (fractionCompare(out, new Fraction(2, 1)) >= 0) out = out.div(2);
  return out;
}
