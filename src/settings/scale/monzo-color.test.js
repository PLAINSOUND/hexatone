import {
  DEFAULT_PRIME_FAMILY_COLORS,
  getFifthsFrameFromMonzo,
  getPrimeFamilyColorMap,
  monzoToSuggestedColor,
} from "./monzo-color.js";
import { srgb_to_okhsl } from "./okhsl.js";

function hexToRgb(hex) {
  const normalized = hex.replace(/^#/, "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function hexToChannels(hex) {
  const [r, g, b] = hexToRgb(hex);
  return { r, g, b };
}

describe("monzoToSuggestedColor", () => {
  it("builds a D-centered fifths frame with rank, sign, and band", () => {
    expect(getFifthsFrameFromMonzo([0, 2])).toMatchObject({
      absoluteFifthSteps: 2,
      fifthSteps: 0,
      rank: 0,
      rankMagnitude: 0,
      sign: 0,
      band: "core",
      pure3Limit: true,
    });
    expect(getFifthsFrameFromMonzo([0, 6])).toMatchObject({
      absoluteFifthSteps: 6,
      fifthSteps: 4,
      rank: 1,
      sign: 1,
      band: "contrast",
    });
    expect(getFifthsFrameFromMonzo([0, -6])).toMatchObject({
      absoluteFifthSteps: -6,
      fifthSteps: -8,
      rank: -1,
      sign: -1,
      band: "contrast",
    });
    expect(getFifthsFrameFromMonzo([0, 11])).toMatchObject({
      absoluteFifthSteps: 11,
      fifthSteps: 9,
      rank: 2,
      band: "secondary",
    });
    expect(getFifthsFrameFromMonzo([0, -14])).toMatchObject({
      absoluteFifthSteps: -14,
      fifthSteps: -16,
      rank: -3,
      band: "tertiary",
    });
    expect(getFifthsFrameFromMonzo([0, 22])).toMatchObject({
      absoluteFifthSteps: 22,
      fifthSteps: 20,
      rank: 3,
      band: "tertiary",
    });
    expect(getFifthsFrameFromMonzo([0, 23])).toMatchObject({
      absoluteFifthSteps: 23,
      fifthSteps: 21,
      rank: 4,
      band: "seam",
    });
  });

  it("can center the fifths frame on an inferred D other than the default", () => {
    expect(getFifthsFrameFromMonzo([0, 0], undefined, { centerAbsoluteFifthSteps: 0 })).toMatchObject({
      absoluteFifthSteps: 0,
      centerAbsoluteFifthSteps: 0,
      fifthSteps: 0,
      rank: 0,
    });
    expect(monzoToSuggestedColor([0, 4], undefined, { centerAbsoluteFifthSteps: 0 }).screenHex).toBe("#dee2da");
  });

  it("keeps 23-family overtonal identities visually unified", () => {
    expect(monzoToSuggestedColor([0, 0, 0, 0, 0, 0, 0, 0, 1]).screenHex).toBe("#95c69b");
    expect(monzoToSuggestedColor([-7, 2, 0, 0, 0, 0, 0, 0, 1]).screenHex).toBe("#95c69b");
  });

  it("keeps 43-family overtonal identities visually unified", () => {
    expect(monzoToSuggestedColor([-7, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]).screenHex).toBe("#c9a573");
  });

  it("matches curated Tree variants for exact odd-partial overtones", () => {
    expect(monzoToSuggestedColor([-5, 0, 1, 1]).screenHex).toBe("#ffcba8");
    expect(monzoToSuggestedColor([-6, 0, 1, 0, 0, 1]).screenHex).toBe("#e9d7d3");
    expect(monzoToSuggestedColor([-7, 0, 0, 0, 1, 1]).screenHex).toBe("#90f9cd");
  });

  it("chooses the highest active prime family over lower-prime tints", () => {
    const result = monzoToSuggestedColor([0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1]);
    expect(result.familyPrime).toBe(31);
    expect(result.familyName).toBe("turquoise");
  });

  it("assigns 59-limit notes a family between 11° and 13° instead of falling back to white", () => {
    const over = monzoToSuggestedColor([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    const under = monzoToSuggestedColor([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1]);
    expect(over.familyPrime).toBe(59);
    expect(over.familyName).toBe("green-purple");
    expect(over.screenHex).toBe("#d2eee9");
    expect(under.screenHex).toBe("#cae4e0");
  });

  it("can ignore a shared per-scale monzo offset for colour analysis", () => {
    const shifted = [0, 0, 0, 1, 0, 0, -1];
    expect(monzoToSuggestedColor(shifted).familyPrime).toBe(17);
    const reduced = monzoToSuggestedColor(shifted, undefined, {
      colorMonzoOffset: [0, 0, 0, 0, 0, 0, -1],
    });
    expect(reduced.familyPrime).toBe(7);
    expect(reduced.screenHex).toBe("#ffe5e5");
  });

  it("darkens undertonal dominant primes while keeping the same family", () => {
    const over = monzoToSuggestedColor([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    const under = monzoToSuggestedColor([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1]);
    expect(over.familyPrime).toBe(31);
    expect(under.familyPrime).toBe(31);
    expect(under.screenHex).not.toBe(over.screenHex);
  });

  it("makes undertonal 5-family notes darker and less saturated than overtonal ones", () => {
    const over = monzoToSuggestedColor([0, 0, 1]);
    const under = monzoToSuggestedColor([0, 0, -1]);
    const [, overS, overL] = srgb_to_okhsl(...hexToRgb(over.screenHex));
    const [, underS, underL] = srgb_to_okhsl(...hexToRgb(under.screenHex));
    expect(underS).toBeLessThan(overS);
    expect(underL).toBeLessThan(overL);
  });

  it("uses quintal-chain colors for pure 5-limit overtonal diatonics and sharps", () => {
    expect(monzoToSuggestedColor([-2, 0, 1]).screenHex).toBe("#fffae5");
    expect(monzoToSuggestedColor([-7, 3, 1]).screenHex).toBe("#e6e0cb");
    expect(monzoToSuggestedColor([2, -4, 2]).screenHex).toBe("#fef5be");
    expect(monzoToSuggestedColor([-3, -1, 2]).screenHex).toBe("#ddd5a4");
    expect(monzoToSuggestedColor([-3, -1, 2]).screenHex).toBe("#ddd5a4");
  });

  it("uses quintal-chain colors for pure 5-limit undertonal diatonics and darker flats", () => {
    expect(monzoToSuggestedColor([-2, 3, -1]).screenHex).toBe("#e9e1b4");
    expect(monzoToSuggestedColor([4, -1, -1]).screenHex).not.toBe("#e9e1b4");
    expect(monzoToSuggestedColor([-6, 7, -2]).screenHex).toBe("#dfd39a");
    expect(monzoToSuggestedColor([2, 2, -2]).screenHex).not.toBe("#dfd39a");
  });

  it("uses septimal-chain colors for pure 7-limit overtonal chromatics and diatonics", () => {
    const overtoneChromatic = monzoToSuggestedColor([4, -4, 0, 1]).screenHex;
    const overtoneDiatonic = monzoToSuggestedColor([-4, 1, 0, 1]).screenHex;
    const overtoneCenteredDiatonic = monzoToSuggestedColor([-3, 0, 0, 1]).screenHex;
    const [, overtoneChromaticS, overtoneChromaticL] = srgb_to_okhsl(...hexToRgb(overtoneChromatic));
    const [, overtoneDiatonicS, overtoneDiatonicL] = srgb_to_okhsl(...hexToRgb(overtoneDiatonic));
    expect(overtoneDiatonic).toBe("#ffe5e5");
    expect(overtoneCenteredDiatonic).toBe("#ffe5e5");
    expect(overtoneChromatic).not.toBe(overtoneDiatonic);
    expect(overtoneChromaticS).toBeLessThan(overtoneDiatonicS);
    expect(overtoneChromaticL).toBeLessThan(overtoneDiatonicL);
  });

  it("can disable septimal chromatic darkening when a tuning has no undertonal 7 dimension", () => {
    const overtoneChromatic = monzoToSuggestedColor([4, -4, 0, 1], undefined, {
      chromaticOverlayPrimes: { 7: false },
    }).screenHex;
    const overtoneDiatonic = monzoToSuggestedColor([-4, 1, 0, 1], undefined, {
      chromaticOverlayPrimes: { 7: false },
    }).screenHex;
    expect(overtoneChromatic).toBe("#ffe5e5");
    expect(overtoneDiatonic).toBe("#ffe5e5");
  });

  it("preserves stronger exact 49-branch colors under the septimal profile", () => {
    expect(
      monzoToSuggestedColor([-4, -1, 0, 2], undefined, {
        structuralOverlay: "fifths",
        chromaticOverlayPrimes: { 7: false },
        notationRole: "chromatic",
      }).screenHex,
    ).toBe("#f8c9c9");
    expect(
      monzoToSuggestedColor([-2, -2, 0, 2], undefined, {
        structuralOverlay: "fifths",
        chromaticOverlayPrimes: { 7: false },
        notationRole: "diatonic",
      }).screenHex,
    ).toBe("#f8c9c9");
  });

  it("gives u7 diatonics a distinct darker rose than overtonal chromatics", () => {
    const overtoneChromatic = monzoToSuggestedColor([4, -4, 0, 1]).screenHex;
    const undertoneDiatonic = monzoToSuggestedColor([0, 2, 0, -1]).screenHex;
    const undertoneChromatic = monzoToSuggestedColor([-3, 4, 0, -1]).screenHex;
    const over49 = monzoToSuggestedColor([-4, 0, 0, 2]).screenHex;
    const [, overtoneChromaticS, overtoneChromaticL] = srgb_to_okhsl(...hexToRgb(overtoneChromatic));
    const [, undertoneDiatonicS, undertoneDiatonicL] = srgb_to_okhsl(...hexToRgb(undertoneDiatonic));
    const [, undertoneChromaticS, undertoneChromaticL] = srgb_to_okhsl(...hexToRgb(undertoneChromatic));
    expect(undertoneDiatonic).not.toBe(overtoneChromatic);
    expect(undertoneDiatonic).not.toBe(over49);
    expect(undertoneChromatic).not.toBe(undertoneDiatonic);
    expect(undertoneDiatonicS).toBeGreaterThan(overtoneChromaticS);
    expect(Math.abs(undertoneDiatonicL - overtoneChromaticL)).toBeGreaterThan(0.01);
    expect(undertoneChromaticS).toBeLessThan(undertoneDiatonicS);
    expect(undertoneChromaticL).toBeLessThan(undertoneDiatonicL);
  });

  it("distinguishes pure 3-limit rank-0 notes from flat- and sharp-side contrast notes", () => {
    expect(monzoToSuggestedColor([0, 0]).screenHex).toBe("#ffffff");
    expect(monzoToSuggestedColor([0, -1]).screenHex).toBe("#ffffff");
    expect(monzoToSuggestedColor([0, 5]).screenHex).toBe("#ffffff");
    expect(monzoToSuggestedColor([0, -2]).screenHex).toBe("#d0d0d7");
    expect(monzoToSuggestedColor([0, 6]).screenHex).toBe("#dee2da");
  });

  it("assigns distinct colors to higher pure 3-limit ranks instead of collapsing them to white", () => {
    expect(monzoToSuggestedColor([0, 11]).screenHex).toBe("#e2caca");
    expect(monzoToSuggestedColor([0, 18]).screenHex).toBe("#e6d7fe");
    expect(monzoToSuggestedColor([0, 25]).screenHex).toBe("#dfffd6");
    expect(monzoToSuggestedColor([0, -7]).screenHex).toBe("#fffae5");
    expect(monzoToSuggestedColor([0, -14]).screenHex).toBe("#ffe5e5");
    expect(monzoToSuggestedColor([0, -21]).screenHex).toBe("#fef5be");
  });

  it("falls back to neutral white when no color family above 3 is active", () => {
    const result = monzoToSuggestedColor([0, 0]);
    expect(result.screenHex).toBe("#ffffff");
    expect(result.familyPrime).toBeNull();
  });

  it("can disable the structural fifths/black-key overlay", () => {
    expect(monzoToSuggestedColor([0, -2]).screenHex).toBe("#d0d0d7");
    expect(monzoToSuggestedColor([0, -2], undefined, { structuralOverlay: "none" }).screenHex).toBe("#ffffff");

    expect(monzoToSuggestedColor([-7, 3, 1]).screenHex).toBe("#e6e0cb");
    expect(monzoToSuggestedColor([-7, 3, 1], undefined, { structuralOverlay: "none" }).screenHex).toBe("#fffae5");
  });

  it("uses odd-branch exact colors for harmonic-series intervals when black-key overlay is disabled", () => {
    expect(monzoToSuggestedColor([-3, -1, 2], undefined, { structuralOverlay: "none" }).screenHex).toBe("#fef5be");
    expect(monzoToSuggestedColor([-1, -1, 0, 1], undefined, { structuralOverlay: "none" }).screenHex).toBe("#ffe5e5");
  });

  it("preserves exact positive odd-branch colors for mixed overtonal primes under structural overlay", () => {
    expect(
      monzoToSuggestedColor([-4, -1, 0, 1, 1], undefined, {
        structuralOverlay: "fifths",
        chromaticOverlayPrimes: { 7: false, 11: false },
      }).screenHex,
    ).toBe("#e9ecc1");
  });

  it("does not let a positive odd branch override undertonal prime families in subharmonic mode", () => {
    const u5a = monzoToSuggestedColor([1, 1, -1], undefined, { structuralOverlay: "none" }).screenHex;
    const u5b = monzoToSuggestedColor([3, 0, -1], undefined, { structuralOverlay: "none" }).screenHex;
    expect(u5a).toBe(u5b);
    expect(u5a).not.toBe("#ffffff");
  });

  it("can treat an explicitly spelled D natural monzo as the notation-relative center", () => {
    const centerMonzo = [-2, 0, 1];
    expect(
      monzoToSuggestedColor(centerMonzo, undefined, {
        structuralOverlay: "none",
        centerMonzo,
      }).screenHex,
    ).toBe("#ffffff");

    const u5a = monzoToSuggestedColor([1, 1, -1], undefined, {
      structuralOverlay: "none",
      centerMonzo,
    }).screenHex;
    const u5b = monzoToSuggestedColor([3, 0, -1], undefined, {
      structuralOverlay: "none",
      centerMonzo,
    }).screenHex;
    expect(u5a).toBe(u5b);
    expect(u5a).not.toBe("#ffffff");
  });

  it("uses notation role to distinguish Hamilton u5 chromatic and diatonic notes", () => {
    const centerMonzo = [-2, 0, 1];
    const chromaticU5a = monzoToSuggestedColor([0, 0, 0], undefined, {
      structuralOverlay: "fifths",
      centerMonzo,
      notationRole: "chromatic",
      chromaticOverlayPrimes: { 5: true },
    }).screenHex;
    const chromaticU5b = monzoToSuggestedColor([2, -1, 0], undefined, {
      structuralOverlay: "fifths",
      centerMonzo,
      notationRole: "chromatic",
      chromaticOverlayPrimes: { 5: true },
    }).screenHex;
    const diatonicU5 = monzoToSuggestedColor([-1, 1, 0], undefined, {
      structuralOverlay: "fifths",
      centerMonzo,
      notationRole: "diatonic",
      chromaticOverlayPrimes: { 5: true },
    }).screenHex;

    expect(chromaticU5a).toBe("#c7c1a1");
    expect(chromaticU5b).toBe("#c7c1a1");
    expect(diatonicU5).toBe("#e9e1b4");
  });

  it("keeps undertonal mixed-prime hues relatively stable for u11u5-style colors", () => {
    const color = monzoToSuggestedColor([4, 1, -1, 0, -1], undefined, {
      structuralOverlay: "fifths",
    }).screenHex;
    const { r, g, b } = hexToChannels(color);
    expect(g).toBeGreaterThanOrEqual(r - 8);
    expect(g).toBeGreaterThan(b);
  });

  it("separates overtonal 11 mixed with undertonal 5 or 7 from plain 11-family green", () => {
    const pureEleven = hexToChannels(
      monzoToSuggestedColor([0, 0, 0, 0, 1], undefined, {
        structuralOverlay: "fifths",
      }).screenHex,
    );
    const elevenUnderFive = hexToChannels(
      monzoToSuggestedColor([0, 0, -1, 0, 1], undefined, {
        structuralOverlay: "fifths",
      }).screenHex,
    );
    const elevenUnderSeven = hexToChannels(
      monzoToSuggestedColor([0, 0, 0, -1, 1], undefined, {
        structuralOverlay: "fifths",
      }).screenHex,
    );
    expect(elevenUnderFive.r).toBeGreaterThan(pureEleven.r);
    expect(elevenUnderFive.b).toBeLessThanOrEqual(pureEleven.b);
    expect(elevenUnderSeven.r).toBeGreaterThanOrEqual(pureEleven.r);
    expect(elevenUnderSeven.g).toBeLessThan(pureEleven.g);
  });

  it("lets the 5-component warm mixed septimal-quintal colors away from plain 7-family pink", () => {
    const pureSeven = hexToChannels(
      monzoToSuggestedColor([0, 0, 0, 1], undefined, {
        structuralOverlay: "fifths",
      }).screenHex,
    );
    const sevenOverFive = hexToChannels(
      monzoToSuggestedColor([0, 0, -1, 1], undefined, {
        structuralOverlay: "fifths",
      }).screenHex,
    );
    expect(sevenOverFive.b).toBeLessThan(pureSeven.b - 12);
    expect(sevenOverFive.g).toBeLessThanOrEqual(pureSeven.g);
  });

  it("makes undertonal 11-family notes noticeably darker than overtonal 11-family notes", () => {
    const over = monzoToSuggestedColor([0, 0, 0, 0, 1], undefined, {
      structuralOverlay: "none",
    }).screenHex;
    const under = monzoToSuggestedColor([0, 0, 0, 0, -1], undefined, {
      structuralOverlay: "none",
    }).screenHex;
    const [, , overL] = srgb_to_okhsl(...hexToRgb(over));
    const [, , underL] = srgb_to_okhsl(...hexToRgb(under));
    expect(underL).toBeLessThan(overL - 0.04);
  });

  it("uses preferred prime-family colors for exact prime overtones", () => {
    const customFive = "#aaccee";
    const suggestion = monzoToSuggestedColor([0, 0, 1], undefined, {
      primeFamilyColorMap: getPrimeFamilyColorMap([
        DEFAULT_PRIME_FAMILY_COLORS[1],
        DEFAULT_PRIME_FAMILY_COLORS[3],
        customFive,
      ]),
    });
    expect(suggestion.screenHex).toBe(customFive);
  });
});
