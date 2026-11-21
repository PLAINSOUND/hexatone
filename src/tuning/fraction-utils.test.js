import { expect, it } from "vitest";
import { Fraction } from "xen-dev-utils";
import { normalizeFractionToPitchClass } from "./fraction-utils.js";

it.each([
  ["1/1", "1"], ["2/1", "1"], ["16/1", "1"],
  ["1/48", "4/3"], ["27/4", "27/16"], ["81/80", "81/80"],
])("reduces %s exactly into the octave as %s without mutating its source", (source, expected) => {
  const ratio = new Fraction(source);
  const before = ratio.toFraction();
  expect(normalizeFractionToPitchClass(ratio).toFraction()).toBe(expected);
  expect(ratio.toFraction()).toBe(before);
});
