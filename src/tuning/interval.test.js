import {
  CANONICAL_MONZO_BASIS,
  DEFAULT_MONZO_BASIS,
  EXTENDED_MONZO_BASIS,
  intervalHasExactMonzo,
  intervalResidualToString,
  parseExactInterval,
} from "./interval.js";

describe("tuning/interval", () => {
  it("uses the 23-limit default basis and 47-limit canonical basis", () => {
    expect(DEFAULT_MONZO_BASIS).toEqual([2, 3, 5, 7, 11, 13, 17, 19, 23]);
    expect(EXTENDED_MONZO_BASIS).toEqual([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47]);
    expect(CANONICAL_MONZO_BASIS).toEqual(EXTENDED_MONZO_BASIS);
  });

  it("parses 11/8 as an exact ratio with full monzo support", () => {
    const interval = parseExactInterval("11/8");
    expect(interval.kind).toBe("ratio");
    expect(interval.exact).toBe(true);
    expect(interval.ratio.toFraction()).toBe("11/8");
    expect(interval.primeLimit).toBe(11);
    expect(intervalHasExactMonzo(interval)).toBe(true);
    expect(interval.monzo).toEqual([-3, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(interval.residual).toBeNull();
  });

  it("treats plain integers as exact n/1 ratios", () => {
    const interval = parseExactInterval("3");
    expect(interval.kind).toBe("integer");
    expect(interval.ratio.toFraction()).toBe("3");
    expect(interval.monzo[0]).toBe(0);
    expect(interval.monzo[1]).toBe(1);
  });

  it("parses cents as non-rational intervals", () => {
    const interval = parseExactInterval("701.955");
    expect(interval.kind).toBe("cents");
    expect(interval.exact).toBe(false);
    expect(interval.cents).toBeCloseTo(701.955, 3);
    expect(interval.ratio).toBeNull();
    expect(interval.monzo).toBeNull();
  });

  it("parses edo notation as structured non-rational intervals", () => {
    const interval = parseExactInterval("7\\12");
    expect(interval.kind).toBe("edo");
    expect(interval.exact).toBe(false);
    expect(interval.edo).toEqual({ steps: 7, edo: 12 });
    expect(interval.cents).toBeCloseTo(700, 6);
    expect(interval.monzo).toBeNull();
  });

  it("keeps residual factors above the chosen basis", () => {
    const interval = parseExactInterval("29/23", { basis: DEFAULT_MONZO_BASIS });
    expect(interval.monzo).toEqual([0, 0, 0, 0, 0, 0, 0, 0, -1]);
    expect(intervalResidualToString(interval)).toBe("29");
    expect(interval.primeLimit).toBe(29);
  });

  it("keeps residual factors above the canonical 47-limit basis", () => {
    const interval = parseExactInterval("53/47");
    expect(interval.primeLimit).toBe(53);
    expect(interval.monzo).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1]);
    expect(intervalResidualToString(interval)).toBe("53");
  });

  it("returns unknown for unsupported text", () => {
    const interval = parseExactInterval("abc");
    expect(interval.kind).toBe("unknown");
    expect(interval.cents).toBeNull();
    expect(interval.ratio).toBeNull();
  });
});
