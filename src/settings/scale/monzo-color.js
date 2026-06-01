import { EXTENDED_MONZO_BASIS } from "../../tuning/interval.js";
import { okhsl_to_srgb, srgb_to_okhsl } from "./okhsl.js";

const WHITE = "#ffffff";
const D_CENTER_FIFTH_STEPS = 2;
export const PRIME_COLOR_ORDER = [1, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47];
const FIFTHS_TIER_COLORS = {
  "-4": "#fef5be",
  "-3": "#ffe5e5",
  "-2": "#fffae5",
  "-1": "#d0d0d7",
  0: WHITE,
  1: "#dee2da",
  2: "#e2caca",
  3: "#e6d7fe",
  4: "#dfffd6",
};
const QUINTAL_DIATONIC_COLORS = {
  1: "#fffae5",
  2: "#fef5be",
  "-1": "#e9e1b4",
  "-2": "#dfd39a",
};
const SEPTIMAL_OVERTONAL_DIATONIC = "#ffe5e5";

export const MONZO_COLOR_FAMILIES = {
  5: { familyName: "yellow", screen: "#fffae5", dark: "#fbe57c" },
  7: { familyName: "red", screen: "#ffe5e5", dark: "#ff98aa" },
  11: { familyName: "green", screen: "#dfffd6", dark: "#7aff4f" },
  13: { familyName: "purple", screen: "#e6d7fe", dark: "#ad76ff" },
  17: { familyName: "dark grey", screen: "#cfcfcf", dark: "#5e5e5e" },
  19: { familyName: "pale blue", screen: "#d6f7ff", dark: "#9dbfef" },
  23: { familyName: "dark green", screen: "#95c69b", dark: "#003405" },
  29: { familyName: "dark blue", screen: "#8aafff", dark: "#0037b0" },
  31: { familyName: "turquoise", screen: "#68f3ec", dark: "#006c52" },
  37: { familyName: "silver", screen: "#cee3e2", dark: "#779a8b" },
  41: { familyName: "dark rose", screen: "#f89b87", dark: "#7b4e44" },
  43: { familyName: "dark orange", screen: "#c9a573", dark: "#6c3e00" },
  47: { familyName: "pink", screen: "#ffb8da", dark: "#ac2764" },
  59: { familyName: "green-purple", screen: "#d2eee9", dark: "#7fae9d" },
};

export const DEFAULT_PRIME_FAMILY_COLORS = {
  1: "#ff7a7a",
  3: "#ffffff",
  5: "#fffae5",
  7: "#ffe5e5",
  11: "#dfffd6",
  13: "#e6d7fe",
  17: "#cfcfcf",
  19: "#d6f7ff",
  23: "#95c69b",
  29: "#8aafff",
  31: "#68f3ec",
  37: "#cee3e2",
  41: "#f89b87",
  43: "#c9a573",
  47: "#ffb8da",
};

const EXACT_ODD_PARTIAL_OVERTONE_COLORS = {
  3: "#ffffff",
  5: "#fffae5",
  7: "#ffe5e5",
  9: "#ffffff",
  11: "#dfffd6",
  13: "#e6d7fe",
  15: "#fffae5",
  17: "#cfcfcf",
  19: "#d6f7ff",
  21: "#ffe5e5",
  23: "#95c69b",
  25: "#fef5be",
  27: "#ffffff",
  29: "#8aafff",
  31: "#68f3ec",
  33: "#dfffd6",
  35: "#ffcba8",
  37: "#cee3e2",
  39: "#e6d7fe",
  41: "#f89b87",
  43: "#c9a573",
  45: "#fffae5",
  47: "#ffb8da",
  49: "#f8c9c9",
  51: "#cfcfcf",
  55: "#ddfe95",
  57: "#d6f7ff",
  63: "#ffe5e5",
  65: "#e9d7d3",
  69: "#95c69b",
  75: "#fef5be",
  77: "#e9ecc1",
  81: "#ffffff",
  85: "#eceae4",
  87: "#8aafff",
  91: "#ebd0e0",
  93: "#68f3ec",
  95: "#e5fff9",
  99: "#dfffd6",
  105: "#ffcba8",
  111: "#cee3e2",
  115: "#90d597",
  117: "#e6d7fe",
  119: "#ded4d5",
  121: "#c3ffad",
  123: "#f89b87",
  125: "#ffef8a",
  129: "#c9a573",
  133: "#f4e6f2",
  135: "#fffae5",
  141: "#ffb8da",
  143: "#90f9cd",
  145: "#b4cbfe",
  147: "#f8c9c9",
  153: "#cfcfcf",
  155: "#0afff3",
  161: "#91b195",
  165: "#ddfe95",
  169: "#dbb3ff",
  171: "#d6f7ff",
  175: "#ffd270",
  185: "#dfebdb",
  187: "#ccdbce",
  189: "#ffe5e5",
  195: "#e9d7d3",
  203: "#b0a9fe",
  205: "#e0b49e",
  207: "#95c69b",
  209: "#caf7e3",
  215: "#e8c28c",
  217: "#0fd2c8",
  221: "#c3b4d5",
  225: "#fef5be",
  231: "#e9ecc1",
  235: "#f79cc5",
  243: "#ffffff",
  245: "#ffb59a",
  247: "#dbe6ff",
  253: "#69ec79",
  255: "#eceae4",
};

function getAnalysisMonzo(monzo, basis = EXTENDED_MONZO_BASIS, options = {}) {
  if (!Array.isArray(monzo)) return null;
  const centerMonzo = Array.isArray(options.centerMonzo) ? options.centerMonzo : null;
  const colorMonzoOffset = Array.isArray(options.colorMonzoOffset) ? options.colorMonzoOffset : null;
  if (!centerMonzo && !colorMonzoOffset) return monzo;
  return basis.map(
    (_, index) => (monzo[index] ?? 0) - (centerMonzo?.[index] ?? 0) - (colorMonzoOffset?.[index] ?? 0),
  );
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function normalizePrimeFamilyColors(rawColors) {
  const source = Array.isArray(rawColors) ? rawColors : [];
  return PRIME_COLOR_ORDER.map((prime, index) => {
    const raw = source[index];
    if (typeof raw !== "string") return DEFAULT_PRIME_FAMILY_COLORS[prime];
    const normalized = raw.trim().replace(/^#/, "");
    return /^[0-9a-fA-F]{6}$/.test(normalized)
      ? `#${normalized.toLowerCase()}`
      : DEFAULT_PRIME_FAMILY_COLORS[prime];
  });
}

export function getPrimeFamilyColorMap(rawColors) {
  const normalized = normalizePrimeFamilyColors(rawColors);
  return Object.fromEntries(PRIME_COLOR_ORDER.map((prime, index) => [prime, normalized[index]]));
}

function hexToRgb(hex) {
  const normalized = String(hex).trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function rgbToHex([r, g, b]) {
  return `#${[r, g, b]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function getAscendingChainOffset(threeExponent, chainStart, chainLength = 12) {
  const offset = threeExponent - chainStart;
  return offset >= 0 && offset < chainLength ? offset : null;
}

function isInAscendingChainRun(threeExponent, chainStart, runStart, runLength, chainLength = 12) {
  const offset = getAscendingChainOffset(threeExponent, chainStart, chainLength);
  return offset !== null && offset >= runStart && offset < runStart + runLength;
}

function isChromaticOverlayEnabled(prime, options = {}) {
  const byPrime = options.chromaticOverlayPrimes;
  if (!byPrime || typeof byPrime !== "object") return true;
  return byPrime[prime] !== false;
}

function mixHex(a, b, t) {
  const ar = hexToRgb(a);
  const br = hexToRgb(b);
  if (!ar || !br) return a;
  const x = clamp01(t);
  return rgbToHex(ar.map((channel, index) => channel * (1 - x) + br[index] * x));
}

function blendHexesWeighted(entries) {
  const weighted = entries
    .map(({ hex, weight }) => ({ rgb: hexToRgb(hex), weight: Math.max(0, weight || 0) }))
    .filter(({ rgb, weight }) => rgb && weight > 0);
  if (!weighted.length) return null;
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight) return null;
  const channels = [0, 1, 2].map((index) =>
    weighted.reduce((sum, entry) => sum + entry.rgb[index] * entry.weight, 0) / totalWeight);
  return rgbToHex(channels);
}

function adjustHexOkhsl(hex, { hOffset = 0, sOffset = 0, lOffset = 0 } = {}) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [h, s, l] = srgb_to_okhsl(...rgb);
  const [r, g, b] = okhsl_to_srgb(
    ((h + hOffset) % 1 + 1) % 1,
    clamp01(s + sOffset),
    clamp01(l + lOffset),
  );
  return rgbToHex([r, g, b]);
}

function getHueDistance(a, b) {
  const raw = Math.abs(a - b);
  return Math.min(raw, 1 - raw);
}

function pushSaturationPreservingHue(baseHex, startHex, maxSOffset, hueTolerance = 0.025) {
  const baseRgb = hexToRgb(baseHex);
  const startRgb = hexToRgb(startHex);
  if (!baseRgb || !startRgb || maxSOffset <= 0) return startHex;
  const [baseH] = srgb_to_okhsl(...baseRgb);
  let bestHex = startHex;
  for (let step = 1; step <= 8; step += 1) {
    const candidate = adjustHexOkhsl(startHex, { sOffset: (maxSOffset * step) / 8 });
    const candidateRgb = hexToRgb(candidate);
    if (!candidateRgb) break;
    const [candidateH] = srgb_to_okhsl(...candidateRgb);
    if (getHueDistance(candidateH, baseH) > hueTolerance) break;
    bestHex = candidate;
  }
  return bestHex;
}

function getPurePrimePower(partial) {
  if (!Number.isInteger(partial) || partial <= 1) return null;
  for (const prime of PRIME_COLOR_ORDER) {
    if (prime <= 2) continue;
    let value = partial;
    let exponent = 0;
    while (value % prime === 0) {
      value /= prime;
      exponent += 1;
    }
    if (value === 1 && exponent > 0) {
      return { prime, exponent };
    }
  }
  return null;
}

function getRaisedPrimeFamilyColor(prime, exponent, options = {}) {
  const base = getScreenColorForPrime(prime, options);
  if (exponent <= 1) return base;
  if (prime === 3 && hasPrimeFamilyOverride(3, options)) return base;
  if (hasPrimeFamilyOverride(prime, options)) {
    const family = MONZO_COLOR_FAMILIES[prime];
    if (family?.dark) {
      const deepened = mixHex(base, family.dark, Math.min(0.4, 0.18 * (exponent - 1)));
      const saturated = pushSaturationPreservingHue(base, deepened, Math.min(0.05, 0.02 * (exponent - 1)));
      return adjustHexOkhsl(saturated, {
        lOffset: -Math.min(0.12, 0.04 * (exponent - 1)),
      });
    }
    return adjustHexOkhsl(base, {
      sOffset: Math.min(0.04, 0.015 * (exponent - 1)),
      lOffset: -Math.min(0.08, 0.03 * (exponent - 1)),
    });
  }

  const defaultBase = DEFAULT_PRIME_FAMILY_COLORS[prime];
  const exactTemplate = EXACT_ODD_PARTIAL_OVERTONE_COLORS[prime ** exponent];
  if (defaultBase && exactTemplate) {
    const baseRgb = hexToRgb(defaultBase);
    const templateRgb = hexToRgb(exactTemplate);
    if (baseRgb && templateRgb) {
      const [, baseS, baseL] = srgb_to_okhsl(...baseRgb);
      const [, templateS, templateL] = srgb_to_okhsl(...templateRgb);
      return adjustHexOkhsl(base, {
        sOffset: templateS - baseS,
        lOffset: templateL - baseL,
      });
    }
  }

  return adjustHexOkhsl(base, {
    sOffset: Math.min(0.2, 0.08 * (exponent - 1)),
    lOffset: -Math.min(0.1, 0.035 * (exponent - 1)),
  });
}

function getOvertonalPrimeComponentColor(prime, exponent, options = {}) {
  return exponent > 1
    ? getRaisedPrimeFamilyColor(prime, exponent, options)
    : getScreenColorForPrime(prime, options);
}

function hasOvertonalPrimeAboveThree(monzo, basis = EXTENDED_MONZO_BASIS) {
  return basis.some((prime, index) => prime > 3 && (monzo[index] ?? 0) > 0);
}

function getActiveOvertonalOddPrimeEntries(monzo, basis = EXTENDED_MONZO_BASIS) {
  const hasPrimeAboveThree = hasOvertonalPrimeAboveThree(monzo, basis);
  return basis
    .map((prime, index) => ({ prime, exponent: monzo[index] ?? 0 }))
    .filter(({ prime, exponent }) =>
      exponent > 0
      && (prime > 3 || (!hasPrimeAboveThree && prime === 3)));
}

function getExactOvertonalTemplateColor(monzo, basis = EXTENDED_MONZO_BASIS, options = {}) {
  const exactOddPartial = getExactOvertoneOddPartial(monzo, basis);
  if (!exactOddPartial) return null;
  const exactTemplate = EXACT_ODD_PARTIAL_OVERTONE_COLORS[exactOddPartial];
  if (!exactTemplate) return null;
  const activeOvertonal = getActiveOvertonalOddPrimeEntries(monzo, basis);
  if (!activeOvertonal.length) return exactTemplate;
  if (activeOvertonal.length === 1) {
    const [{ prime, exponent }] = activeOvertonal;
    if (hasPrimeFamilyOverride(prime, options)) {
      return getRaisedPrimeFamilyColor(prime, exponent, options);
    }
  }

  const defaultBaseBlend = blendHexesWeighted(
    activeOvertonal.map(({ prime, exponent }) => ({
      hex: getOvertonalPrimeComponentColor(prime, exponent, {}),
      weight: exponent,
    })),
  );
  const currentBaseBlend = blendHexesWeighted(
    activeOvertonal.map(({ prime, exponent }) => ({
      hex: getOvertonalPrimeComponentColor(prime, exponent, options),
      weight: exponent,
    })),
  );
  if (!defaultBaseBlend || !currentBaseBlend) return exactTemplate;

  const defaultBaseRgb = hexToRgb(defaultBaseBlend);
  const currentBaseRgb = hexToRgb(currentBaseBlend);
  const templateRgb = hexToRgb(exactTemplate);
  if (!defaultBaseRgb || !currentBaseRgb || !templateRgb) return exactTemplate;

  const [, baseS, baseL] = srgb_to_okhsl(...defaultBaseRgb);
  const [, templateS, templateL] = srgb_to_okhsl(...templateRgb);

  return adjustHexOkhsl(currentBaseBlend, {
    sOffset: Math.min(0, templateS - baseS) - Math.max(0, activeOvertonal.length - 1) * 0.05,
    lOffset: templateL - baseL,
  });
}

function getUndertonalFamilyColor(family, magnitude = 1) {
  let color = family.screen;
  let neutralMix = Math.min(0.18, 0.06 * magnitude);
  let familyMix = Math.min(0.10, 0.03 * magnitude);
  if (family.familyName === "green") {
    neutralMix = Math.min(0.22, neutralMix + 0.02);
    familyMix = Math.min(0.10, familyMix);
  }
  if (family.familyName === "red") {
    neutralMix = Math.min(0.2, neutralMix + 0.03);
    familyMix = Math.min(0.14, familyMix + 0.03);
  }
  color = mixHex(color, "#6f6f6f", neutralMix);
  color = mixHex(color, family.dark, familyMix);
  if (family.familyName === "green") {
    color = adjustHexOkhsl(color, {
      sOffset: -0.2,
      lOffset: -0.09,
    });
  } else if (family.familyName === "red") {
    color = adjustHexOkhsl(color, {
      sOffset: -0.04,
      lOffset: -0.05,
    });
  }
  return color;
}

function getScreenColorForPrime(prime, options = {}) {
  const overrideMap = options.primeFamilyColorMap;
  return overrideMap?.[prime] ?? DEFAULT_PRIME_FAMILY_COLORS[prime] ?? MONZO_COLOR_FAMILIES[prime]?.screen ?? WHITE;
}

function getFamilyForPrime(prime, options = {}) {
  const family = MONZO_COLOR_FAMILIES[prime];
  if (!family) return null;
  return {
    ...family,
    screen: getScreenColorForPrime(prime, options),
  };
}

function hasPrimeFamilyOverride(prime, options = {}) {
  return !!options.primeFamilyColorMap
    && !!DEFAULT_PRIME_FAMILY_COLORS[prime]
    && options.primeFamilyColorMap[prime] != null
    && options.primeFamilyColorMap[prime].toLowerCase() !== DEFAULT_PRIME_FAMILY_COLORS[prime];
}

function hasAnyActivePrimeOverride(monzo, basis = EXTENDED_MONZO_BASIS, options = {}) {
  return getActiveOvertonalOddPrimeEntries(monzo, basis).some(({ prime }) => hasPrimeFamilyOverride(prime, options));
}

function getExactOddPartialColor(partial, options = {}) {
  if (!EXACT_ODD_PARTIAL_OVERTONE_COLORS[partial]) return null;
  const primePower = getPurePrimePower(partial);
  if (primePower && DEFAULT_PRIME_FAMILY_COLORS[primePower.prime]) {
    if (primePower.exponent === 1) return getScreenColorForPrime(primePower.prime, options);
    if (hasPrimeFamilyOverride(primePower.prime, options)) {
      return getRaisedPrimeFamilyColor(primePower.prime, primePower.exponent, options);
    }
  }
  if (DEFAULT_PRIME_FAMILY_COLORS[partial]) return getScreenColorForPrime(partial, options);
  return EXACT_ODD_PARTIAL_OVERTONE_COLORS[partial];
}

function getActivePrimeEntries(monzo, basis = EXTENDED_MONZO_BASIS) {
  return basis
    .map((prime, index) => ({ prime, exponent: monzo[index] ?? 0 }))
    .filter(({ prime, exponent }) => prime > 3 && exponent !== 0 && getFamilyForPrime(prime, {}));
}

function getExactOvertoneOddPartial(monzo, basis = EXTENDED_MONZO_BASIS) {
  if (!Array.isArray(monzo)) return null;
  let oddPartial = 1;
  for (let index = 0; index < basis.length; index += 1) {
    const prime = basis[index];
    if (prime === 2) continue;
    const exponent = monzo[index] ?? 0;
    if (exponent < 0) return null;
    if (exponent > 0) oddPartial *= prime ** exponent;
  }
  return Number.isSafeInteger(oddPartial) ? oddPartial : null;
}

function getOddBranchProducts(monzo, basis = EXTENDED_MONZO_BASIS) {
  if (!Array.isArray(monzo)) return null;
  let positive = 1;
  let negative = 1;
  for (let index = 0; index < basis.length; index += 1) {
    const prime = basis[index];
    if (prime === 2) continue;
    const exponent = monzo[index] ?? 0;
    if (exponent > 0) positive *= prime ** exponent;
    if (exponent < 0) negative *= prime ** Math.abs(exponent);
  }
  return {
    positive: Number.isSafeInteger(positive) ? positive : null,
    negative: Number.isSafeInteger(negative) ? negative : null,
  };
}

function isPure3LimitMonzo(monzo, basis = EXTENDED_MONZO_BASIS) {
  if (!Array.isArray(monzo)) return false;
  for (let index = 0; index < basis.length; index += 1) {
    const prime = basis[index];
    if (prime === 2 || prime === 3) continue;
    if ((monzo[index] ?? 0) !== 0) return false;
  }
  return true;
}

function isPure5LimitMonzo(monzo, basis = EXTENDED_MONZO_BASIS) {
  if (!Array.isArray(monzo)) return false;
  for (let index = 0; index < basis.length; index += 1) {
    const prime = basis[index];
    if (prime === 2 || prime === 3 || prime === 5) continue;
    if ((monzo[index] ?? 0) !== 0) return false;
  }
  const fiveIndex = basis.indexOf(5);
  return fiveIndex >= 0 && (monzo[fiveIndex] ?? 0) !== 0;
}

function isPure7LimitMonzo(monzo, basis = EXTENDED_MONZO_BASIS) {
  if (!Array.isArray(monzo)) return false;
  for (let index = 0; index < basis.length; index += 1) {
    const prime = basis[index];
    if (prime === 2 || prime === 3 || prime === 7) continue;
    if ((monzo[index] ?? 0) !== 0) return false;
  }
  const sevenIndex = basis.indexOf(7);
  return sevenIndex >= 0 && (monzo[sevenIndex] ?? 0) !== 0;
}

function classifyFifthsBand(fifthSteps) {
  if (fifthSteps >= -3 && fifthSteps <= 3) {
    return { rank: 0, rankMagnitude: 0, sign: 0, band: "core" };
  }
  if (fifthSteps >= 4 && fifthSteps <= 8) {
    return { rank: 1, rankMagnitude: 1, sign: 1, band: "contrast" };
  }
  if (fifthSteps <= -4 && fifthSteps >= -8) {
    return { rank: -1, rankMagnitude: 1, sign: -1, band: "contrast" };
  }
  if (fifthSteps >= 9 && fifthSteps <= 15) {
    return { rank: 2, rankMagnitude: 2, sign: 1, band: "secondary" };
  }
  if (fifthSteps <= -9 && fifthSteps >= -15) {
    return { rank: -2, rankMagnitude: 2, sign: -1, band: "secondary" };
  }
  if (fifthSteps >= 16 && fifthSteps <= 20) {
    return { rank: 3, rankMagnitude: 3, sign: 1, band: "tertiary" };
  }
  if (fifthSteps <= -16 && fifthSteps >= -20) {
    return { rank: -3, rankMagnitude: 3, sign: -1, band: "tertiary" };
  }
  return {
    rank: fifthSteps >= 0 ? 4 : -4,
    rankMagnitude: 4,
    sign: Math.sign(fifthSteps) || 0,
    band: "seam",
  };
}

export function getFifthsFrameFromMonzo(monzo, basis = EXTENDED_MONZO_BASIS, options = {}) {
  const analysisMonzo = getAnalysisMonzo(monzo, basis, options);
  if (!Array.isArray(analysisMonzo)) return null;
  const threeIndex = basis.indexOf(3);
  if (threeIndex < 0) return null;
  if (Array.isArray(options.centerMonzo)) {
    const absoluteFifthSteps = analysisMonzo[threeIndex] ?? 0;
    return {
      absoluteFifthSteps,
      centerAbsoluteFifthSteps: 0,
      fifthSteps: absoluteFifthSteps,
      pure3Limit: isPure3LimitMonzo(analysisMonzo, basis),
      ...classifyFifthsBand(absoluteFifthSteps),
    };
  }
  const centerAbsoluteFifthSteps = Number.isFinite(options.centerAbsoluteFifthSteps)
    ? options.centerAbsoluteFifthSteps
    : D_CENTER_FIFTH_STEPS;
  const absoluteFifthSteps = analysisMonzo[threeIndex] ?? 0;
  const fifthSteps = absoluteFifthSteps - centerAbsoluteFifthSteps;
  return {
    absoluteFifthSteps,
    centerAbsoluteFifthSteps,
    fifthSteps,
    pure3Limit: isPure3LimitMonzo(analysisMonzo, basis),
    ...classifyFifthsBand(fifthSteps),
  };
}

function getPythagoreanPitchClassColor(monzo, basis = EXTENDED_MONZO_BASIS, options = {}) {
  if (!isPure3LimitMonzo(monzo, basis)) return null;
  if (hasPrimeFamilyOverride(3, options)) {
    const frame = getFifthsFrameFromMonzo(monzo, basis, options);
    if (!frame) return null;
    const customBase = getScreenColorForPrime(3, options);
    if (frame.rank === 0) {
      return {
        screenHex: customBase,
        familyPrime: 3,
        familyName: "pythagorean custom family",
        confidence: 1,
        explanation: "Pure 3-limit custom family override",
        fifthsFrame: frame,
      };
    }
    const foldedRank = Math.max(-4, Math.min(4, frame.rank));
    const template = FIFTHS_TIER_COLORS[foldedRank] ?? WHITE;
    const baseRgb = hexToRgb(customBase);
    const coreRgb = hexToRgb(WHITE);
    const templateRgb = hexToRgb(template);
    if (baseRgb && coreRgb && templateRgb) {
      const [, coreS, coreL] = srgb_to_okhsl(...coreRgb);
      const [, templateS, templateL] = srgb_to_okhsl(...templateRgb);
      const rankMagnitude = Math.abs(foldedRank);
      const saturationScaleByMagnitude = {
        1: 0.22,
        2: 0.3,
        3: 0.36,
        4: 0.42,
      };
      const lightnessScaleByMagnitude = {
        1: 0.82,
        2: 0.88,
        3: 0.92,
        4: 0.96,
      };
      return {
        screenHex: adjustHexOkhsl(customBase, {
          sOffset: (templateS - coreS) * (saturationScaleByMagnitude[rankMagnitude] ?? 0.22),
          lOffset: (templateL - coreL) * (lightnessScaleByMagnitude[rankMagnitude] ?? 0.82),
        }),
        familyPrime: 3,
        familyName: "pythagorean custom family",
        confidence: 0.95,
        explanation: `Pure 3-limit custom family override rank ${frame.rank}`,
        fifthsFrame: frame,
      };
    }
    return {
      screenHex: template,
      familyPrime: 3,
      familyName: "pythagorean custom family",
      confidence: 0.95,
      explanation: `Pure 3-limit custom family override rank ${frame.rank}`,
      fifthsFrame: frame,
    };
  }
  const frame = getFifthsFrameFromMonzo(monzo, basis, options);
  if (!frame) return null;
  const foldedRank = Math.max(-4, Math.min(4, frame.rank));
  const screenHex = FIFTHS_TIER_COLORS[foldedRank] ?? WHITE;
  let familyName = "pythagorean core";
  if (frame.rank === -1) familyName = "pythagorean flat-side contrast";
  else if (frame.rank === 1) familyName = "pythagorean sharp-side contrast";
  else if (frame.rank === -2) familyName = "pythagorean flat-side 5-family";
  else if (frame.rank === 2) familyName = "pythagorean sharp-side u7-family";
  else if (frame.rank === -3) familyName = "pythagorean flat-side 7-family";
  else if (frame.rank === 3) familyName = "pythagorean sharp-side 13-family";
  else if (frame.rank < -3) familyName = "pythagorean flat-side 25-family seam";
  else if (frame.rank > 3) familyName = "pythagorean sharp-side 11-family seam";
  return {
    screenHex,
    familyPrime: null,
    familyName,
    confidence: 1,
    explanation: `Pure 3-limit ${frame.band} rank ${frame.rank > 0 ? `+${frame.rank}` : frame.rank}`,
    fifthsFrame: frame,
  };
}

function getChainThreeExponent(frame, options = {}) {
  if (Array.isArray(options.centerMonzo)) return frame.fifthSteps;
  if (
    Number.isFinite(options.centerAbsoluteFifthSteps)
    && options.centerAbsoluteFifthSteps !== D_CENTER_FIFTH_STEPS
  ) {
    return frame.fifthSteps;
  }
  return frame.absoluteFifthSteps;
}

function getQuintalProfileColor(monzo, basis = EXTENDED_MONZO_BASIS, options = {}) {
  if (!isPure5LimitMonzo(monzo, basis)) return null;
  const frame = getFifthsFrameFromMonzo(monzo, basis, options);
  if (!frame) return null;
  const fiveIndex = basis.indexOf(5);
  const fiveExp = monzo[fiveIndex] ?? 0;

  const makeUndertonalDiatonic = (base) =>
    adjustHexOkhsl(mixHex(base, "#8c8574", 0.14), {
      sOffset: -0.05,
      lOffset: -0.04,
    });
  const makeOvertonalChromatic = (base, magnitude = 1) =>
    adjustHexOkhsl(mixHex(base, "#8c8574", magnitude === 1 ? 0.16 : 0.19), {
      sOffset: magnitude === 1 ? -0.06 : -0.07,
      lOffset: magnitude === 1 ? -0.025 : -0.04,
    });
  const makeUndertonalChromatic = (base) =>
    adjustHexOkhsl(mixHex(base, "#8c8574", 0.2), {
      sOffset: -0.1,
      lOffset: -0.05,
    });
  const threeExp = getChainThreeExponent(frame, options);
  const role = options.chainRole ?? options.notationRole;
  const roleIsDiatonic = role === "diatonic";
  const roleIsChromatic = role === "chromatic";

  if (fiveExp > 0 && fiveExp <= 2) {
    const chainStart = -1 - 4 * fiveExp;
    const diatonicColor = hasPrimeFamilyOverride(5, options)
      ? getRaisedPrimeFamilyColor(5, fiveExp, options)
      : QUINTAL_DIATONIC_COLORS[fiveExp];
    const isDiatonic = roleIsDiatonic || (!roleIsChromatic && isInAscendingChainRun(threeExp, chainStart, 0, 7));
    const isChromatic = roleIsChromatic || (!roleIsDiatonic && isInAscendingChainRun(threeExp, chainStart, 7, 5));
    if (isDiatonic) {
      return {
        screenHex: diatonicColor,
        familyPrime: 5,
        familyName: fiveExp === 1 ? "quintal diatonic" : "quintal two-comma diatonic",
        confidence: 0.95,
        explanation: fiveExp === 1 ? "5-limit overtonal diatonic" : "25-limit overtonal diatonic",
        fifthsFrame: frame,
      };
    }
    if (isChromatic) {
      const overlayEnabled = isChromaticOverlayEnabled(5, options);
      return {
        screenHex: overlayEnabled ? makeOvertonalChromatic(diatonicColor, fiveExp) : diatonicColor,
        familyPrime: 5,
        familyName: overlayEnabled
          ? (fiveExp === 1 ? "quintal chromatic sharp" : "quintal two-comma sharp")
          : (fiveExp === 1 ? "quintal diatonic" : "quintal two-comma diatonic"),
        confidence: overlayEnabled ? 0.9 : 0.95,
        explanation: overlayEnabled
          ? (fiveExp === 1 ? "5-limit overtonal sharp-side chromatic" : "25-limit overtonal sharp-side chromatic")
          : (fiveExp === 1 ? "5-limit overtonal diatonic" : "25-limit overtonal diatonic"),
        fifthsFrame: frame,
      };
    }
  }

  if (fiveExp < 0 && fiveExp >= -2) {
    const absFive = Math.abs(fiveExp);
    const chainStart = -2 + 4 * (absFive - 1);
    const base = hasPrimeFamilyOverride(5, options)
      ? makeUndertonalDiatonic(getRaisedPrimeFamilyColor(5, absFive, options))
      : QUINTAL_DIATONIC_COLORS[String(fiveExp)];
    const isChromatic = roleIsChromatic || (!roleIsDiatonic && isInAscendingChainRun(threeExp, chainStart, 0, 5));
    const isDiatonic = roleIsDiatonic || (!roleIsChromatic && isInAscendingChainRun(threeExp, chainStart, 5, 7));
    if (isChromatic) {
      return {
        screenHex: makeUndertonalChromatic(base),
        familyPrime: 5,
        familyName: absFive === 1 ? "quintal undertonal flat" : "quintal undertonal two-comma flat",
        confidence: 0.9,
        explanation: absFive === 1 ? "u5 flat-side chromatic" : "u25 flat-side chromatic",
        fifthsFrame: frame,
      };
    }
    if (isDiatonic) {
      return {
        screenHex: base,
        familyPrime: 5,
        familyName: absFive === 1 ? "quintal undertonal diatonic" : "quintal undertonal two-comma diatonic",
        confidence: 0.95,
        explanation: absFive === 1 ? "u5 diatonic" : "u25 diatonic",
        fifthsFrame: frame,
      };
    }
  }

  return null;
}

function getSeptimalProfileColor(monzo, basis = EXTENDED_MONZO_BASIS, options = {}) {
  if (!isPure7LimitMonzo(monzo, basis)) return null;
  const frame = getFifthsFrameFromMonzo(monzo, basis, options);
  if (!frame) return null;
  const sevenIndex = basis.indexOf(7);
  const sevenExp = monzo[sevenIndex] ?? 0;
  if (sevenExp === 0) return null;
  if (sevenExp < 0 && Math.abs(sevenExp) !== 1) return null;
  const role = options.chainRole ?? options.notationRole;
  const exactOddPartial = getExactOvertoneOddPartial(monzo, basis);
  const branch = getOddBranchProducts(monzo, basis);
  const preferredBranchIdentity = branch?.positive ?? exactOddPartial;
  const preferredOvertonalColor = hasPrimeFamilyOverride(7, options)
    ? getRaisedPrimeFamilyColor(7, Math.abs(sevenExp), options)
    : (
      preferredBranchIdentity && getExactOddPartialColor(preferredBranchIdentity, options)
        ? getExactOddPartialColor(preferredBranchIdentity, options)
        : SEPTIMAL_OVERTONAL_DIATONIC
    );

  const threeExp = getChainThreeExponent(frame, options);
  const makeOvertonalChromatic = (base) =>
    adjustHexOkhsl(mixHex(base, "#8f817e", 0.31), {
      sOffset: -0.1,
      lOffset: -0.01,
    });
  const makeUndertonalDiatonic = (base) =>
    adjustHexOkhsl(mixHex(base, "#9b6a72", 0.14), {
      sOffset: -0.03,
      lOffset: -0.08,
    });
  const makeUndertonalChromatic = (base) =>
    adjustHexOkhsl(mixHex(base, "#8f817e", 0.24), {
      sOffset: -0.13,
      lOffset: -0.13,
    });

  if (sevenExp > 0) {
    const chainStart = -5;
    const overlayEnabled = isChromaticOverlayEnabled(7, options);
    const isChromatic = role === "chromatic" || (role == null && isInAscendingChainRun(threeExp, chainStart, 0, 5));
    const isDiatonic = role === "diatonic" || (role == null && isInAscendingChainRun(threeExp, chainStart, 5, 7));
    if (isChromatic) {
      return {
        screenHex: overlayEnabled
          ? makeOvertonalChromatic(preferredOvertonalColor)
          : preferredOvertonalColor,
        familyPrime: 7,
        familyName: overlayEnabled ? "septimal chromatic" : "septimal diatonic",
        confidence: overlayEnabled ? 0.9 : 0.95,
        explanation: overlayEnabled ? "7-limit overtonal chromatic" : "7-limit overtonal diatonic",
        fifthsFrame: frame,
      };
    }
    if (isDiatonic) {
      return {
        screenHex: preferredOvertonalColor,
        familyPrime: 7,
        familyName: "septimal diatonic",
        confidence: 0.95,
        explanation: "7-limit overtonal diatonic",
        fifthsFrame: frame,
      };
    }
  }

  if (sevenExp < 0) {
    const chainStart = -3;
    const isDiatonic = role === "diatonic" || (role == null && isInAscendingChainRun(threeExp, chainStart, 0, 7));
    const isChromatic = role === "chromatic" || (role == null && isInAscendingChainRun(threeExp, chainStart, 7, 5));
    if (isDiatonic) {
      return {
        screenHex: makeUndertonalDiatonic(preferredOvertonalColor),
        familyPrime: 7,
        familyName: "septimal undertonal diatonic",
        confidence: 0.95,
        explanation: "u7 diatonic",
        fifthsFrame: frame,
      };
    }
    if (isChromatic) {
      return {
        screenHex: makeUndertonalChromatic(preferredOvertonalColor),
        familyPrime: 7,
        familyName: "septimal undertonal chromatic",
        confidence: 0.9,
        explanation: "u7 flat-side chromatic",
        fifthsFrame: frame,
      };
    }
  }

  return null;
}

function getLowerPrimeWeights(count) {
  if (count <= 0) return [];
  const weights = [0.15, 0.07, 0.03, 0.02, 0.01];
  if (count <= weights.length) return weights.slice(0, count);
  return [...weights, ...Array(count - weights.length).fill(0.005)];
}

export function dominantPrimeFromMonzo(monzo, basis = EXTENDED_MONZO_BASIS) {
  const active = getActivePrimeEntries(monzo, basis).sort((a, b) => b.prime - a.prime);
  return active[0] ?? null;
}

export function monzoToSuggestedColor(monzo, basis = EXTENDED_MONZO_BASIS, options = {}) {
  const analysisMonzo = getAnalysisMonzo(monzo, basis, options);
  if (!Array.isArray(analysisMonzo)) return null;
  const fifthsFrame = getFifthsFrameFromMonzo(monzo, basis, options);
  const structuralOverlay = options.structuralOverlay ?? "fifths";
  const activePrimeEntries = getActivePrimeEntries(analysisMonzo, basis);
  const branch = getOddBranchProducts(analysisMonzo, basis);
  const hasUndertonalPrime = activePrimeEntries.some(({ exponent }) => exponent < 0);
  const hasActivePrimeOverride = hasAnyActivePrimeOverride(analysisMonzo, basis, options);

  if (structuralOverlay !== "none") {
    const pythagorean = getPythagoreanPitchClassColor(analysisMonzo, basis, options);
    if (pythagorean) return pythagorean;

    const quintal = getQuintalProfileColor(analysisMonzo, basis, options);
    if (quintal) return quintal;

    const septimal = getSeptimalProfileColor(analysisMonzo, basis, options);
    if (septimal) return septimal;
  }

  const exactOddPartial = getExactOvertoneOddPartial(analysisMonzo, basis);
  const dominant = dominantPrimeFromMonzo(analysisMonzo, basis);
  if (hasActivePrimeOverride && exactOddPartial) {
    const templateColor = getExactOvertonalTemplateColor(analysisMonzo, basis, options);
    if (templateColor) {
      return {
        screenHex: templateColor,
        familyPrime: dominant?.prime ?? null,
        familyName: dominant ? getFamilyForPrime(dominant.prime, options)?.familyName ?? "neutral" : "neutral",
        confidence: 1,
        explanation: `Exact odd partial ${exactOddPartial}° (template-adjusted)`,
        fifthsFrame,
      };
    }
  }
  if (!hasActivePrimeOverride && exactOddPartial && getExactOddPartialColor(exactOddPartial, options)) {
    return {
      screenHex: getExactOddPartialColor(exactOddPartial, options),
      familyPrime: dominant?.prime ?? null,
      familyName: dominant ? getFamilyForPrime(dominant.prime, options)?.familyName ?? "neutral" : "neutral",
      confidence: 1,
      explanation: `Exact odd partial ${exactOddPartial}°`,
      fifthsFrame,
    };
  }

  if (!hasActivePrimeOverride && !hasUndertonalPrime && branch?.positive && getExactOddPartialColor(branch.positive, options)) {
    return {
      screenHex: getExactOddPartialColor(branch.positive, options),
      familyPrime: dominant?.prime ?? null,
      familyName: dominant ? getFamilyForPrime(dominant.prime, options)?.familyName ?? "neutral" : "neutral",
      confidence: 0.98,
      explanation: `Odd branch ${branch.positive}°`,
      fifthsFrame,
    };
  }

  if (!dominant) {
    return {
      screenHex: WHITE,
      familyPrime: null,
      familyName: "neutral",
      confidence: 0,
      explanation: "No prime family above 3",
      fifthsFrame,
    };
  }

  const family = getFamilyForPrime(dominant.prime, options);

  if (
    hasActivePrimeOverride
    && !hasUndertonalPrime
    && activePrimeEntries.length > 1
    && activePrimeEntries.every(({ exponent }) => exponent > 0)
  ) {
    const blendedColor = blendHexesWeighted(
      activePrimeEntries.map(({ prime, exponent }) => ({
        hex: exponent > 1
          ? getRaisedPrimeFamilyColor(prime, exponent, options)
          : getScreenColorForPrime(prime, options),
        weight: exponent,
      })),
    );
    if (blendedColor) {
      return {
        screenHex: blendedColor,
        familyPrime: dominant.prime,
        familyName: `${family.familyName} composite`,
        confidence: 0.96,
        explanation: "Overtonal prime-family blend",
        fifthsFrame,
      };
    }
  }
  let color = family.screen;

  if (dominant.exponent < 0) {
    const magnitude = Math.abs(dominant.exponent);
    color = getUndertonalFamilyColor(family, magnitude);
  } else if (dominant.exponent > 1) {
    const magnitude = dominant.exponent;
    color = adjustHexOkhsl(color, {
      sOffset: Math.min(0.16, 0.05 * (magnitude - 1)),
      lOffset: Math.min(0.06, 0.015 * (magnitude - 1)),
    });
  }

  const lowerActive = getActivePrimeEntries(analysisMonzo, basis)
    .filter(({ prime }) => prime < dominant.prime)
    .sort((a, b) => b.prime - a.prime);
  const hasSeptimalUndertonalQuintalMix = dominant.prime === 7
    && dominant.exponent > 0
    && lowerActive.some(({ prime, exponent }) => prime === 5 && exponent < 0);
  const hasElevenUndertonalLowerPrimeMix = dominant.prime === 11
    && dominant.exponent > 0
    && lowerActive.some(({ prime, exponent }) => (prime === 5 || prime === 7) && exponent < 0);
  const hasUndertonalElevenOvertonalSeptimalMix = dominant.prime === 11
    && dominant.exponent < 0
    && lowerActive.some(({ prime, exponent }) => prime === 7 && exponent > 0);

  const weights = getLowerPrimeWeights(lowerActive.length);
  lowerActive.forEach((entry, index) => {
    const lowerFamily = getFamilyForPrime(entry.prime, options);
    let lowerColor =
      entry.exponent < 0
        ? getUndertonalFamilyColor(lowerFamily, Math.abs(entry.exponent))
        : lowerFamily.screen;
    let weight = weights[index] ?? 0;
    let maxWeight = 0.28;
    if (dominant.exponent < 0 && entry.exponent > 0) {
      weight *= 1.6;
    } else if (dominant.exponent > 0 && entry.exponent < 0) {
      weight *= 1.15;
    }
    // Septimal-quintal mixtures need the 5-family to speak more clearly;
    // otherwise 7/5 stays too close to plain 7 and 10/7 too close to pure u7.
    if (dominant.prime === 7 && entry.prime === 5) {
      if (entry.exponent < 0) {
        lowerColor = mixHex(QUINTAL_DIATONIC_COLORS["-1"], QUINTAL_DIATONIC_COLORS[1], 0.6);
      } else {
        lowerColor = QUINTAL_DIATONIC_COLORS[1];
      }
      if (dominant.exponent > 0 && entry.exponent < 0) weight *= 2.0;
      if (dominant.exponent < 0 && entry.exponent > 0) weight *= 1.35;
      maxWeight = 0.6;
    }
    if (dominant.prime === 11 && entry.exponent < 0 && (entry.prime === 5 || entry.prime === 7)) {
      weight *= entry.prime === 5 ? 1.8 : 1.6;
      maxWeight = 0.46;
    }
    if (dominant.prime === 11 && dominant.exponent < 0 && entry.prime === 7 && entry.exponent > 0) {
      weight *= 1.9;
      maxWeight = 0.42;
    }
    color = mixHex(color, lowerColor, Math.min(maxWeight, weight));
  });

  if (hasSeptimalUndertonalQuintalMix) {
    color = mixHex(color, "#ffdbbd", 0.34);
  }
  if (hasElevenUndertonalLowerPrimeMix) {
    color = mixHex(color, "#d7e1b2", 0.22);
  }
  if (hasUndertonalElevenOvertonalSeptimalMix) {
    color = mixHex(color, SEPTIMAL_OVERTONAL_DIATONIC, 0.16);
  }

  return {
    screenHex: color,
    familyPrime: dominant.prime,
    familyName: family.familyName,
    confidence: lowerActive.length === 0 ? 1 : Math.max(0.65, 1 - lowerActive.length * 0.08),
    explanation:
      dominant.exponent < 0
        ? `${dominant.prime}-limit ${family.familyName} undertonal family`
        : `${dominant.prime}-limit ${family.familyName} family`,
    fifthsFrame,
  };
}
