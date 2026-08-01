// This module owns the non-JI and JI auto-colour inference engine.
// It inspects spelling, monzo clues, and tuning context to derive attractive
// suggested key colours when the user selects Auto Colours.

import { createScaleWorkspace } from "../../tuning/workspace.js";
import { buildHejiNotationFrame } from "../../notation/heji-frame.js";
import {
  isWhiteKeyPitchStructure,
  parseHejiToStructure,
  pitchStructureToMonzo,
} from "../../notation/pitch-structure.js";
import {
  DEFAULT_PRIME_FAMILY_COLORS,
  getPrimeFamilyColorMap,
  monzoToSuggestedColor,
} from "./monzo-color.js";
import { srgb_to_okhsl } from "./okhsl.js";

export const AUTO_TONIC_COLOR_SOFT = "#ffdbdb";
export const AUTO_TONIC_COLOR_STRONG = "#ff7070";
export const AUTO_TONIC_COLOR_ROSE_HEAVY = "#ff9b9b";
const TEMPERED_DIATONIC_AUTO_COLOR = "#ededf7";
const TEMPERED_CHROMATIC_AUTO_COLOR = "#c3c3d5";
const TEMPERED_TONIC_AUTO_COLOR = "#ff9d9d";
const TRADITIONAL_TEMPERED_DIATONIC_AUTO_COLOR = "#ffffff";
const TRADITIONAL_TEMPERED_SHARP_TINT = "#cfe7d2";
const TRADITIONAL_TEMPERED_FLAT_TINT = "#d6d0e6";
const EDO_HEJI_SYNTONIC_NATURAL_AUTO_COLOR = "#fffae5";

export function normaliseColorForCompare(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/^#/, "")
    .toLowerCase();
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function hexToRgb(hex) {
  const normalized = String(hex ?? "")
    .trim()
    .replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function rgbToHex([r, g, b]) {
  return `#${[r, g, b]
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function mixHex(a, b, t) {
  const ar = hexToRgb(a);
  const br = hexToRgb(b);
  if (!ar || !br) return a;
  const x = clamp01(t);
  return rgbToHex(ar.map((channel, index) => channel * (1 - x) + br[index] * x));
}

function averageHexColors(colors = []) {
  const samples = colors.map((color) => hexToRgb(color)).filter(Boolean);
  if (!samples.length) return null;
  const totals = samples.reduce(
    (sum, sample) => sum.map((value, index) => value + sample[index]),
    [0, 0, 0],
  );
  return rgbToHex(totals.map((value) => value / samples.length));
}

function deriveTraditionalTemperedChromaticPalette() {
  const baseChromatic = mixHex(
    TRADITIONAL_TEMPERED_DIATONIC_AUTO_COLOR,
    TEMPERED_CHROMATIC_AUTO_COLOR,
    0.8,
  );
  const sharp = mixHex(baseChromatic, TRADITIONAL_TEMPERED_SHARP_TINT, 0.45);
  const flat = mixHex(baseChromatic, TRADITIONAL_TEMPERED_FLAT_TINT, 0.45);
  const mixed = mixHex(sharp, flat, 0.5);
  return { sharp, flat, mixed };
}

export function deriveAutoTonicColorFromPalette(colors = []) {
  return deriveAutoTonicColorFromPaletteWithPrime(colors, DEFAULT_PRIME_FAMILY_COLORS[1]);
}

export function deriveAutoTonicColorFromPaletteWithPrime(
  colors = [],
  intenseTonicColor = DEFAULT_PRIME_FAMILY_COLORS[1],
) {
  const strongTonic = intenseTonicColor || DEFAULT_PRIME_FAMILY_COLORS[1];
  const useDefaultTonicPoles = strongTonic.toLowerCase() === DEFAULT_PRIME_FAMILY_COLORS[1];
  const softTonic = useDefaultTonicPoles
    ? AUTO_TONIC_COLOR_SOFT
    : mixHex("#ffffff", strongTonic, 0.28);
  const roseHeavyTonic = useDefaultTonicPoles
    ? AUTO_TONIC_COLOR_ROSE_HEAVY
    : mixHex(strongTonic, "#ffffff", 0.34);
  const samples = colors
    .map((color) => hexToRgb(color))
    .filter(Boolean)
    .map(([r, g, b]) => {
      const [h, s, l] = srgb_to_okhsl(r, g, b);
      return {
        hue: h,
        vividness: s * Math.max(0, 1 - l),
        vivid: s > 0.35 && l < 0.9 ? 1 : 0,
        neutral: s < 0.18 ? 1 : 0,
        rose: (h < 0.18 || h > 0.9) && s > 0.2 ? 1 : 0,
        paleRose: (h < 0.18 || h > 0.9) && s > 0.2 && l > 0.84 ? 1 : 0,
        vividRose: (h < 0.18 || h > 0.9) && s > 0.32 && l < 0.84 ? 1 : 0,
      };
    });

  if (!samples.length) return softTonic;

  const averageVividness =
    samples.reduce((sum, sample) => sum + sample.vividness, 0) / samples.length;
  const vividRatio = samples.reduce((sum, sample) => sum + sample.vivid, 0) / samples.length;
  const neutralRatio = samples.reduce((sum, sample) => sum + sample.neutral, 0) / samples.length;
  const roseRatio = samples.reduce((sum, sample) => sum + sample.rose, 0) / samples.length;
  const paleRoseRatio = samples.reduce((sum, sample) => sum + sample.paleRose, 0) / samples.length;
  const vividRoseRatio =
    samples.reduce((sum, sample) => sum + sample.vividRose, 0) / samples.length;
  const vividSamples = samples.filter((sample) => sample.vivid);
  const vividHueDiversity = vividSamples.length
    ? new Set(vividSamples.map((sample) => Math.floor(sample.hue * 6) % 6)).size / 6
    : 0;
  const intensity =
    clamp01(
      ((averageVividness - 0.03) / 0.12) * 0.45 + vividRatio * 0.35 + vividHueDiversity * 0.28,
    ) *
    (1 - neutralRatio * 0.8);
  let base = mixHex(softTonic, strongTonic, intensity);
  const subduedPalette =
    clamp01((0.22 - averageVividness) / 0.18) *
    (1 - clamp01(roseRatio / 0.18)) *
    (1 - vividHueDiversity);
  base = mixHex(base, softTonic, subduedPalette * 0.45);
  const paleRoseBoost = clamp01((paleRoseRatio - 0.05) / 0.12);
  base = mixHex(base, strongTonic, paleRoseBoost * 0.52);
  const roseBoost = clamp01((roseRatio - 0.3) / 0.45);
  base = mixHex(base, roseHeavyTonic, roseBoost);
  const competitiveRoseBoost =
    clamp01((vividRoseRatio - 0.08) / 0.2) * clamp01((vividHueDiversity - 0.18) / 0.45);
  return mixHex(base, strongTonic, competitiveRoseBoost * 0.42);
}

export function getAutoColorOptions(settings) {
  const short = String(settings?.short_description ?? "");
  const text = [settings?.name, settings?.short_description].filter(Boolean).join(" ");
  if (/Hamilton/i.test(text)) return { structuralOverlay: "fifths" };
  if (/(Odd Partial|OddPartials|OddPart)/i.test(text)) return { structuralOverlay: "none" };
  if (
    /^(\d+-)?HS([_-]|$)|^(\d+-)?HSS([_-]|$)|^(\d+-)?SHS([_-]|$)|Partials|partial row/i.test(
      short,
    ) ||
    /Partials|partial row/i.test(String(settings?.name ?? ""))
  ) {
    return { structuralOverlay: "none" };
  }
  return { structuralOverlay: "fifths" };
}

export function getCenterLabelSources({ keyLabels, noteNames, hejiTableNames, hejiNames }) {
  const normalizedNoteNames = Array.isArray(noteNames) ? noteNames : [];
  const normalizedHejiTableNames = Array.isArray(hejiTableNames) ? hejiTableNames : [];
  const normalizedHejiNames = Array.isArray(hejiNames) ? hejiNames : [];
  const preferHeji = keyLabels === "heji";
  return preferHeji
    ? [normalizedHejiTableNames, normalizedHejiNames, normalizedNoteNames]
    : [normalizedNoteNames, normalizedHejiTableNames, normalizedHejiNames];
}

function alignLabelsToWorkspaceSlots(labels, workspace) {
  const normalized = Array.isArray(labels) ? labels : [];
  const slotCount = workspace?.slots?.length ?? 0;
  if (!slotCount || !normalized.length) return normalized;
  if (normalized.length === slotCount - 1) return ["", ...normalized];
  return normalized;
}

function isEqualDivisionScale(settings, workspace) {
  const stepCount = Number(settings?.equivSteps);
  const slots = workspace?.slots;
  const equaveCents = workspace?.baseScale?.equaveCents;
  if (
    !Number.isInteger(stepCount) ||
    stepCount <= 0 ||
    !Array.isArray(slots) ||
    slots.length !== stepCount ||
    !Number.isFinite(equaveCents)
  ) {
    return false;
  }

  // `equivSteps` is also the ordinary scale-size field, so matching it to the
  // number of degrees does not prove that a tuning is an equal division.  In
  // particular, rationalising an EDO preserves the scale size.  Validate the
  // actual pitch positions before enabling EDO-specific label palettes.
  const centsTolerance = 0.11;
  return slots.every((slot, degree) => {
    const cents = slot?.cents;
    const expectedCents = (degree * equaveCents) / stepCount;
    return Number.isFinite(cents) && Math.abs(cents - expectedCents) <= centsTolerance;
  });
}

export function extractPitchClassInfo(label) {
  const source = String(label ?? "").trim();
  if (!source) return { pitchClass: null, modifierWeight: Number.POSITIVE_INFINITY };
  const naturalMarkers = ["*n", ""];
  const solfegeMatch = source.match(/(Dha|Sa|Re|Ga|Ma|Pa|Ni)/i);
  if (solfegeMatch) {
    const syllable = solfegeMatch[1].toLowerCase();
    const map = { sa: "C", re: "D", ga: "E", ma: "F", pa: "G", dha: "A", ni: "B" };
    let modifierText = source.replace(new RegExp(solfegeMatch[1], "i"), "").trim();
    for (const marker of naturalMarkers) modifierText = modifierText.replaceAll(marker, "");
    return { pitchClass: map[syllable] ?? null, modifierWeight: modifierText.length };
  }
  const letters = [...source.matchAll(/[A-G]/gi)].map((match) => match[0].toUpperCase());
  if (letters.length !== 1) return { pitchClass: null, modifierWeight: Number.POSITIVE_INFINITY };
  const pitchClass = letters[0];
  let modifierText = source.replace(/[A-G]/gi, "").trim();
  for (const marker of naturalMarkers) modifierText = modifierText.replaceAll(marker, "");
  return { pitchClass, modifierWeight: modifierText.length };
}

function parseExplicitHejiClassificationLabel(label, { allowImplicitNatural = false } = {}) {
  const source = String(label ?? "").trim();
  if (!source) return null;
  const parsed = parseHejiToStructure(source);
  if (parsed) return parsed;
  const bareLetterMatch = source.match(/^[A-Ga-g]$/);
  if (!bareLetterMatch || !allowImplicitNatural) return null;
  return parseHejiToStructure(`*n${source.toUpperCase()}`);
}

function parseTraditionalNotationLabel(label) {
  const source = String(label ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!source) return null;
  const match = source.match(/^([♭b#♯]*)([A-Ga-g])([♭b#♯]*)$/u);
  if (!match) return null;
  const [, leftMods, letterText, rightMods] = match;
  const modifiers = `${leftMods}${rightMods}`;
  const isLowercaseNatural = letterText === letterText.toLowerCase() && modifiers.length === 0;
  if (!isLowercaseNatural && modifiers.length === 0) return null;
  const flatCount = (modifiers.match(/[♭b]/gu) ?? []).length;
  const sharpCount = (modifiers.match(/[♯#]/gu) ?? []).length;
  const accidentalCount = sharpCount - flatCount;
  return {
    letter: letterText.toUpperCase(),
    accidentalCount,
    isNatural: accidentalCount === 0,
  };
}

function parseTraditionalNotationTokens(label) {
  return String(label ?? "")
    .trim()
    .split(/\s+/)
    .map((token) => parseTraditionalNotationLabel(token))
    .filter(Boolean);
}

function classifyTraditionalNotationFamilyToken(token) {
  if (!token) return null;
  if (token.isNatural) return "traditional:natural";
  if (token.accidentalCount < 0) return `traditional:flat:${Math.abs(token.accidentalCount)}`;
  if (token.accidentalCount > 0) return `traditional:sharp:${Math.abs(token.accidentalCount)}`;
  return null;
}

function classifyVicentinoNotationToken(token) {
  const source = String(token ?? "").trim();
  if (!source) return null;
  if (source.includes("")) return "vicentino:dotted-flat";
  if (source.includes("")) return "vicentino:dotted-natural";
  if (source.includes("")) return "vicentino:flat";
  if (source.includes("")) return "vicentino:sharp";
  if (source.includes("")) return "vicentino:natural";
  return null;
}

function classifyQuartertoneNotationToken(token) {
  const source = String(token ?? "").trim();
  if (!source) return null;
  if (source.includes("")) return "quartertone:flat-quarter";
  if (source.includes("")) return "quartertone:sharp-quarter";
  const traditional = parseTraditionalNotationLabel(source);
  if (!traditional) return null;
  return classifyTraditionalNotationFamilyToken(traditional);
}

function buildFamilyKey(tokens = []) {
  if (!tokens.length) return null;
  const normalized = [...tokens].sort();
  return normalized.length === 1 ? normalized[0] : `hybrid:${normalized.join("+")}`;
}

function inferNotationFamilyKey(label) {
  const source = String(label ?? "").trim();
  if (!source) return null;

  const vicentinoTokens = source
    .split(/\s+/)
    .map((token) => classifyVicentinoNotationToken(token))
    .filter(Boolean);
  if (vicentinoTokens.length) return buildFamilyKey(vicentinoTokens);

  const quartertoneTokens = source
    .split(/\s+/)
    .map((token) => classifyQuartertoneNotationToken(token))
    .filter(Boolean);
  if (quartertoneTokens.length) return buildFamilyKey(quartertoneTokens);

  const traditionalTokens = parseTraditionalNotationTokens(source)
    .map((token) => classifyTraditionalNotationFamilyToken(token))
    .filter(Boolean);
  if (traditionalTokens.length) return buildFamilyKey(traditionalTokens);

  return null;
}

function buildInheritedNotationPaletteMap(noteNames = [], storedColors = []) {
  const families = new Map();
  noteNames.forEach((label, index) => {
    if (index === 0) return;
    const familyKey = inferNotationFamilyKey(label);
    const color = storedColors[index];
    if (!familyKey || !color) return;
    if (!families.has(familyKey)) families.set(familyKey, []);
    families.get(familyKey).push(color);
  });
  const paletteMap = new Map();
  for (const [familyKey, colors] of families.entries()) {
    const average = averageHexColors(colors);
    if (average) paletteMap.set(familyKey, average);
  }
  return paletteMap;
}

function inferInheritedNotationPaletteColor(label, paletteMap) {
  if (!(paletteMap instanceof Map) || paletteMap.size === 0) return null;
  const familyKey = inferNotationFamilyKey(label);
  if (!familyKey) return null;
  const direct = paletteMap.get(familyKey);
  if (direct) return direct;
  if (!familyKey.startsWith("hybrid:")) return null;
  const components = familyKey
    .slice("hybrid:".length)
    .split("+")
    .map((part) => paletteMap.get(part))
    .filter(Boolean);
  return components.length >= 2 ? averageHexColors(components) : null;
}

function parseExplicitHejiClassificationTokens(label, options = {}) {
  return String(label ?? "")
    .trim()
    .split(/\s+/)
    .map((token) => parseExplicitHejiClassificationLabel(token, options))
    .filter(Boolean);
}

function inferEnharmonicHejiSide(tokens) {
  if (!tokens.length) return null;
  const accidentalCounts = tokens.map((token) => token.accidentalCount ?? 0);
  const hasFlat = accidentalCounts.some((count) => count < 0);
  const hasSharp = accidentalCounts.some((count) => count > 0);
  if (hasFlat && hasSharp) return "mixed";
  if (tokens.length >= 2) {
    const [first, second] = tokens;
    const firstAccidental = first?.accidentalCount ?? 0;
    const secondAccidental = second?.accidentalCount ?? 0;
    if (firstAccidental === 0 && secondAccidental < 0) return "sharp";
    if (firstAccidental > 0 && secondAccidental === 0) return "flat";
    if (firstAccidental === 0 && secondAccidental === 0) return "mixed";
  }
  if (hasFlat) return "flat";
  if (hasSharp) return "sharp";
  return null;
}

export function inferNotationSide(label, options = {}) {
  const parsedTokens = parseExplicitHejiClassificationTokens(label, options);
  if (parsedTokens.length > 1) {
    const enharmonicSide = inferEnharmonicHejiSide(parsedTokens);
    if (enharmonicSide) return enharmonicSide;
  }
  const parsed = parseExplicitHejiClassificationLabel(label, options);
  if (parsed?.letter) {
    if ((parsed.accidentalCount ?? 0) < 0) return "flat";
    if ((parsed.accidentalCount ?? 0) > 0) return "sharp";
    if (parsed.letter === "D") return "core";
    if (parsed.letter === "F" || parsed.letter === "C" || parsed.letter === "G") return "flat";
    if (parsed.letter === "A" || parsed.letter === "E" || parsed.letter === "B") return "sharp";
    return null;
  }
  const traditional = parseTraditionalNotationLabel(label);
  if (traditional?.letter) {
    if (traditional.accidentalCount < 0) return "flat";
    if (traditional.accidentalCount > 0) return "sharp";
    if (traditional.letter === "D") return "core";
    if (traditional.letter === "F" || traditional.letter === "C" || traditional.letter === "G")
      return "flat";
    if (traditional.letter === "A" || traditional.letter === "E" || traditional.letter === "B")
      return "sharp";
  }
  return null;
}

export function inferNotationRole(label, options = {}) {
  const parsedTokens = parseExplicitHejiClassificationTokens(label, options);
  if (parsedTokens.length > 1) {
    return "chromatic";
  }
  const parsed = parseExplicitHejiClassificationLabel(label, options);
  if (parsed) {
    const hasHigherPrimeInflection = Object.values(parsed.primeExponents ?? {}).some(
      (value) => value !== 0,
    );
    if (hasHigherPrimeInflection) return "chromatic";
    if ((parsed.accidentalCount ?? 0) !== 0) {
      return isWhiteKeyPitchStructure(parsed) ? "diatonic" : "chromatic";
    }
    if ((parsed.syntonic ?? 0) === 0) return "diatonic";
    return null;
  }
  const traditional = parseTraditionalNotationLabel(label);
  if (!traditional) return null;
  return traditional.isNatural || isWhiteKeyPitchStructure(traditional)
    ? "diatonic"
    : "chromatic";
}

function inferTemperedAutoColor(label) {
  const source = String(label ?? "").trim();
  if (!source) return null;
  const normalized = source.replace(/\s+/g, "");
  if (/[+\-\u2212]\d/.test(normalized)) return null;
  if (!/[\uE2F1\uE2F2\uE2F3]/u.test(normalized)) return null;
  if (/[\uE260-\uE2F0]/u.test(normalized.replace(/[\uE2F1\uE2F2\uE2F3]/gu, ""))) return null;
  if (/[\uE2F1\uE2F3]/u.test(normalized)) return TEMPERED_CHROMATIC_AUTO_COLOR;
  if (/[\uE2F2]/u.test(normalized)) return TEMPERED_DIATONIC_AUTO_COLOR;
  return null;
}

function inferTraditionalTemperedAutoColor(label) {
  const tokens = parseTraditionalNotationTokens(label);
  if (!tokens.length) return null;
  if (tokens.every((token) => token.isNatural)) return TRADITIONAL_TEMPERED_DIATONIC_AUTO_COLOR;
  const palette = deriveTraditionalTemperedChromaticPalette();
  const chromaticSides = new Set(
    tokens
      .filter((token) => !token.isNatural)
      .map((token) => (token.accidentalCount < 0 ? "flat" : "sharp")),
  );
  if (chromaticSides.size > 1) return palette.mixed;
  if (chromaticSides.has("flat")) return palette.flat;
  if (chromaticSides.has("sharp")) return palette.sharp;
  return null;
}

function inferEnharmonicHejiTemperedAutoColor(label, options = {}) {
  const tokens = parseExplicitHejiClassificationTokens(label, options);
  if (tokens.length <= 1) return null;
  const allTemperedEnharmonicTokens = tokens.every((token) => {
    const primeEntries = Object.entries(token.primeExponents ?? {});
    return primeEntries.every(
      ([primeText, value]) => Number(primeText) === 7 && Number(value) !== 0,
    );
  });
  if (!allTemperedEnharmonicTokens) return null;
  const palette = deriveTraditionalTemperedChromaticPalette();
  const side = inferEnharmonicHejiSide(tokens);
  if (side === "mixed") return palette.mixed;
  if (side === "flat") return palette.flat;
  if (side === "sharp") return palette.sharp;
  return null;
}

function inferEqualDivisionHejiTemperedAutoColor(label, { isEqualDivision = false } = {}) {
  if (!isEqualDivision) return null;
  const tokens = parseExplicitHejiClassificationTokens(label);
  if (tokens.length !== 1) return null;
  const [token] = tokens;
  const hasHigherPrimeInflection = Object.values(token.primeExponents ?? {}).some(
    (value) => value !== 0,
  );
  if (hasHigherPrimeInflection) return null;
  if ((token.accidentalCount ?? 0) === 0 && (token.syntonic ?? 0) < 0) {
    return EDO_HEJI_SYNTONIC_NATURAL_AUTO_COLOR;
  }
  return null;
}

function inferEqualDivisionHejiHybridAutoColor(label, { isEqualDivision = false } = {}) {
  if (!isEqualDivision) return null;
  const tokens = parseExplicitHejiClassificationTokens(label);
  if (tokens.length <= 1) return null;
  const hasHigherPrimeInflection = tokens.some((token) =>
    Object.values(token.primeExponents ?? {}).some((value) => value !== 0),
  );
  if (hasHigherPrimeInflection) return null;
  const accidentalToken = tokens.find(
    (token) => (token.accidentalCount ?? 0) !== 0 && (token.syntonic ?? 0) === 0,
  );
  const syntonicNaturalToken = tokens.find(
    (token) => (token.accidentalCount ?? 0) === 0 && (token.syntonic ?? 0) < 0,
  );
  if (!accidentalToken || !syntonicNaturalToken) return null;
  const palette = deriveTraditionalTemperedChromaticPalette();
  const accidentalColor = (accidentalToken.accidentalCount ?? 0) > 0 ? palette.sharp : palette.flat;
  return mixHex(accidentalColor, EDO_HEJI_SYNTONIC_NATURAL_AUTO_COLOR, 0.5);
}

function inferTemperedAutoColorFromStructure(structure) {
  if (!structure?.useTemperedAccidentals) return null;
  if ((structure.syntonic ?? 0) !== 0) return null;
  if (Object.values(structure.primeExponents ?? {}).some((value) => value !== 0)) return null;
  return (structure.accidentalCount ?? 0) === 0
    ? TEMPERED_DIATONIC_AUTO_COLOR
    : TEMPERED_CHROMATIC_AUTO_COLOR;
}

function hasExplicitHejiOrTemperedSpelling(label) {
  const source = String(label ?? "").trim();
  if (!source) return false;
  return /[\uE260-\uE2FF\uEE50-\uEE59]|\*[nfs]|^(?:n|b|#|bb|##)[A-Ga-g]$|^[A-Ga-g](?:n|b|#|bb|##)$/.test(
    source,
  );
}

function isPurePrimeLimitMonzo(monzo, basis, targetPrime) {
  if (!Array.isArray(monzo) || !Array.isArray(basis)) return false;
  const targetIndex = basis.indexOf(targetPrime);
  if (targetIndex < 0 || (monzo[targetIndex] ?? 0) === 0) return false;
  for (let index = 0; index < basis.length; index += 1) {
    const prime = basis[index];
    if (prime === 2 || prime === 3 || prime === targetPrime) continue;
    if ((monzo[index] ?? 0) !== 0) return false;
  }
  return true;
}

function getAnalysisMonzo(monzo, basis, options = {}) {
  if (!Array.isArray(monzo)) return null;
  const centerMonzo = Array.isArray(options.centerMonzo) ? options.centerMonzo : null;
  const colorMonzoOffset = Array.isArray(options.colorMonzoOffset)
    ? options.colorMonzoOffset
    : null;
  if (!centerMonzo && !colorMonzoOffset) return monzo;
  return basis.map(
    (_, index) =>
      (monzo[index] ?? 0) - (centerMonzo?.[index] ?? 0) - (colorMonzoOffset?.[index] ?? 0),
  );
}

function getChainThreeExponent(monzo, options = {}) {
  const absoluteThree = monzo?.[1] ?? 0;
  if (Array.isArray(options.centerMonzo)) return absoluteThree - (options.centerMonzo[1] ?? 0);
  if (Number.isFinite(options.centerAbsoluteFifthSteps) && options.centerAbsoluteFifthSteps !== 2) {
    return absoluteThree - options.centerAbsoluteFifthSteps;
  }
  return absoluteThree;
}

function inferExplicitPrimeChainRole(prime, degreeMetadata, fallbackLabel) {
  const parsed = degreeMetadata?.parsed ?? null;
  if (prime === 7 && parsed) {
    if ((parsed.accidentalCount ?? 0) !== 0) {
      return isWhiteKeyPitchStructure(parsed) ? "diatonic" : "chromatic";
    }
    if ((parsed.syntonic ?? 0) === 0) {
      return "diatonic";
    }
  }
  return degreeMetadata?.notationRole ?? inferNotationRole(fallbackLabel);
}

export function inferPrimeChainRole(workspace, degreeIndex, autoColorOptions = {}) {
  const slot = workspace?.slots?.[degreeIndex];
  const basis = slot?.committedIdentity?.basis;
  const monzo = getAnalysisMonzo(slot?.committedIdentity?.monzo, basis, autoColorOptions);
  if (!Array.isArray(monzo) || !Array.isArray(basis)) return null;

  for (const prime of [5, 7]) {
    if (!isPurePrimeLimitMonzo(monzo, basis, prime)) continue;
    const primeIndex = basis.indexOf(prime);
    const targetExponent = monzo[primeIndex] ?? 0;
    const entries = (workspace.slots || [])
      .map((candidate, candidateDegree) => {
        const candidateBasis = candidate?.committedIdentity?.basis;
        const candidateMonzo = getAnalysisMonzo(
          candidate?.committedIdentity?.monzo,
          candidateBasis,
          autoColorOptions,
        );
        if (!isPurePrimeLimitMonzo(candidateMonzo, candidateBasis, prime)) return null;
        if ((candidateMonzo[primeIndex] ?? 0) !== targetExponent) return null;
        const fallbackLabel =
          autoColorOptions?.noteRoleLabels?.[candidateDegree] ??
          candidate?.committedIdentity?.displayName ??
          candidate?.exactRole?.displayName ??
          candidate?.displayName;
        const explicitRole = inferExplicitPrimeChainRole(
          prime,
          autoColorOptions?.degreeMetadata?.[candidateDegree] ?? null,
          fallbackLabel,
        );
        return {
          degree: candidateDegree,
          threeExponent: getChainThreeExponent(candidateMonzo, autoColorOptions),
          explicitRole,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.threeExponent - b.threeExponent || a.degree - b.degree);

    const chainIndex = entries.findIndex((entry) => entry.degree === degreeIndex);
    if (chainIndex < 0) return null;
    const currentEntry = entries[chainIndex];
    const explicitRoles = entries.map((entry) => entry.explicitRole).filter(Boolean);
    const allEntriesExplicit = explicitRoles.length === entries.length;
    const hasExplicitDiatonic = explicitRoles.includes("diatonic");
    const hasExplicitChromatic = explicitRoles.includes("chromatic");

    if (currentEntry.explicitRole) {
      return currentEntry.explicitRole;
    }

    if (allEntriesExplicit && hasExplicitDiatonic && hasExplicitChromatic) {
      return currentEntry.explicitRole;
    }

    if (prime === 5 && entries.length <= 7) return null;
    if (prime >= 7 && entries.length <= 7) return "diatonic";
    if (prime === 5) {
      if (targetExponent > 0) return chainIndex < 7 ? "diatonic" : "chromatic";
      return chainIndex < 5 ? "chromatic" : "diatonic";
    }
    if (targetExponent > 0) return chainIndex < entries.length - 7 ? "chromatic" : "diatonic";
    return chainIndex < 7 ? "diatonic" : "chromatic";
  }

  return null;
}

export function inferCenterMonzoCandidate(workspace, labels = [], degreeMetadata = null) {
  const candidates = [];
  for (let degree = 0; degree < workspace.slots.length; degree += 1) {
    const metadata = degreeMetadata?.[degree] ?? null;
    const parsed = metadata?.parsed ?? null;
    const monzo =
      workspace.slots[degree]?.exactRole?.monzo ?? (parsed ? pitchStructureToMonzo(parsed) : null);
    if (!Array.isArray(monzo)) continue;
    const pitchInfo = extractPitchClassInfo(labels[degree]);
    const isStructuralD = parsed?.letter === "D";
    const isLabelD = pitchInfo.pitchClass === "D";
    if (!isStructuralD && !isLabelD) continue;
    const absoluteFifthSteps = metadata?.absoluteFifthSteps ?? monzo[1] ?? 0;
    const nonThreeComplexity = monzo.reduce((sum, exp, index) => {
      if (index === 0 || index === 1) return sum;
      return sum + Math.abs(exp ?? 0);
    }, 0);
    const accidentalWeight = metadata?.pitchClassLabel
      ? String(metadata.pitchClassLabel).replace(/[A-Ga-g]/g, "").length
      : pitchInfo.modifierWeight;
    const plainnessWeight = parsed
      ? (parsed.accidentalCount ?? 0) === 0 &&
        (parsed.syntonic ?? 0) === 0 &&
        Object.values(parsed.primeExponents ?? {}).every((value) => value === 0)
        ? 0
        : 1
      : accidentalWeight === 0
        ? 0
        : 1;
    const pureThreeWeight = nonThreeComplexity === 0 ? 0 : 1;
    candidates.push({
      monzo,
      absoluteFifthSteps,
      plainnessWeight,
      pureThreeWeight,
      nonThreeComplexity,
      accidentalWeight,
      distanceFromDefault: Math.abs(absoluteFifthSteps - 2),
    });
  }
  if (!candidates.length) return null;
  const pureThreeCandidates = candidates.filter((candidate) => candidate.pureThreeWeight === 0);
  const naturalCandidates = candidates.filter((candidate) => candidate.plainnessWeight === 0);
  let pool = candidates;
  if (!pureThreeCandidates.length && naturalCandidates.length) {
    pool = naturalCandidates;
  }
  const finalPool = pureThreeCandidates.length ? pureThreeCandidates : pool;
  finalPool.sort(
    (a, b) =>
      a.pureThreeWeight - b.pureThreeWeight ||
      a.plainnessWeight - b.plainnessWeight ||
      a.distanceFromDefault - b.distanceFromDefault ||
      a.nonThreeComplexity - b.nonThreeComplexity ||
      a.accidentalWeight - b.accidentalWeight ||
      a.absoluteFifthSteps - b.absoluteFifthSteps,
  );
  return finalPool[0] ?? null;
}

export function inferChromaticOverlayPrimes(workspace) {
  const stats = {};
  for (const slot of workspace.slots || []) {
    const monzo = slot?.exactRole?.monzo;
    const basis = slot?.committedIdentity?.basis;
    if (!Array.isArray(monzo) || !Array.isArray(basis)) continue;
    for (let index = 0; index < basis.length; index += 1) {
      const prime = basis[index];
      if (prime < 5) continue;
      const exponent = monzo[index] ?? 0;
      if (!stats[prime])
        stats[prime] = { hasPositive: false, hasNegative: false, hasPureNegative: false };
      if (exponent > 0) stats[prime].hasPositive = true;
      if (exponent < 0) {
        stats[prime].hasNegative = true;
        if (isPurePrimeLimitMonzo(monzo, basis, prime)) {
          stats[prime].hasPureNegative = true;
        }
      }
    }
  }
  const byPrime = {};
  for (const [primeText, primeStats] of Object.entries(stats)) {
    const prime = Number(primeText);
    byPrime[prime] = prime === 5 ? true : primeStats.hasPositive && primeStats.hasPureNegative;
  }
  return byPrime;
}

function mergeColorOffsets(primary, secondary) {
  if (!primary && !secondary) return null;
  if (!primary) return secondary;
  if (!secondary) return primary;
  const length = Math.max(primary.length, secondary.length);
  const merged = new Array(length).fill(0).map((_, index) => {
    const first = primary[index] ?? 0;
    return first !== 0 ? first : (secondary[index] ?? 0);
  });
  return merged.some((value) => value !== 0) ? merged : null;
}

function pickNotationCenter(explicitHejiCenter, centerCandidate) {
  const explicitNonThreeComplexity = Array.isArray(explicitHejiCenter)
    ? explicitHejiCenter.reduce((sum, exp, index) => {
        if (index === 0 || index === 1) return sum;
        return sum + Math.abs(exp ?? 0);
      }, 0)
    : null;
  const candidateNonThreeComplexity = centerCandidate?.nonThreeComplexity ?? null;

  if (centerCandidate?.monzo && candidateNonThreeComplexity === 0) {
    return {
      centerMonzo: undefined,
      centerAbsoluteFifthSteps: centerCandidate.absoluteFifthSteps,
    };
  }
  if (Array.isArray(explicitHejiCenter)) {
    return explicitNonThreeComplexity > 0
      ? { centerMonzo: explicitHejiCenter, centerAbsoluteFifthSteps: undefined }
      : { centerMonzo: undefined, centerAbsoluteFifthSteps: explicitHejiCenter[1] ?? 2 };
  }
  if (centerCandidate?.monzo) {
    return candidateNonThreeComplexity > 0
      ? { centerMonzo: centerCandidate.monzo, centerAbsoluteFifthSteps: undefined }
      : { centerMonzo: undefined, centerAbsoluteFifthSteps: centerCandidate.absoluteFifthSteps };
  }
  return {};
}

function inferSharedExactMonzoOffset(workspace) {
  const exactMonzos = (workspace?.slots || [])
    .filter((slot) => slot.degree !== 0 && Array.isArray(slot?.exactRole?.monzo))
    .map((slot) => slot.exactRole.monzo);
  if (exactMonzos.length < 2) return null;
  const basisLength = exactMonzos[0].length;
  const offset = new Array(basisLength).fill(0);
  for (let index = 0; index < basisLength; index += 1) {
    const sharedExponent = exactMonzos[0][index] ?? 0;
    if (sharedExponent === 0) continue;
    if (exactMonzos.every((monzo) => (monzo[index] ?? 0) === sharedExponent)) {
      offset[index] = sharedExponent;
    }
  }
  return offset.some((value) => value !== 0) ? offset : null;
}

function bigintGcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function parseRawRatioDenominator(text) {
  const match = String(text ?? "")
    .trim()
    .match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  try {
    return BigInt(match[2]);
  } catch {
    return null;
  }
}

function inferSharedRawDenominatorOffset(workspace, settings) {
  const scale = Array.isArray(settings?.scale) ? settings.scale : [];
  const basis = workspace?.slots?.find((slot) => Array.isArray(slot?.committedIdentity?.basis))
    ?.committedIdentity?.basis;
  if (!Array.isArray(basis) || basis.length === 0 || scale.length < 2) return null;
  const denominators = scale
    .map(parseRawRatioDenominator)
    .filter((value) => typeof value === "bigint" && value > 1n);
  if (denominators.length < 2) return null;
  let common = denominators[0];
  for (const denominator of denominators.slice(1)) {
    common = bigintGcd(common, denominator);
    if (common <= 1n) return null;
  }
  if (common <= 1n) return null;
  const offset = basis.map(() => 0);
  let remainder = common;
  for (let index = 0; index < basis.length; index += 1) {
    const prime = basis[index];
    if (!Number.isInteger(prime) || prime <= 1) continue;
    const primeBig = BigInt(prime);
    while (remainder % primeBig === 0n) {
      offset[index] -= 1;
      remainder /= primeBig;
    }
  }
  return offset.some((value) => value !== 0) ? offset : null;
}

export function inferColorMonzoOffset(workspace, settings) {
  const exactSharedOffset = inferSharedExactMonzoOffset(workspace);
  const rawDenominatorOffset = inferSharedRawDenominatorOffset(workspace, settings);
  return mergeColorOffsets(exactSharedOffset, rawDenominatorOffset);
}

export function buildResolvedAutoColorOptions(settings, workspace, labelSourcesConfig, extra = {}) {
  const base = getAutoColorOptions(settings);
  const equaveCents = workspace?.baseScale?.equaveCents;
  const octaveEquave = Number.isFinite(equaveCents) ? Math.abs(equaveCents - 1200) < 0.001 : true;
  const resolvedBase = octaveEquave ? base : { ...base, structuralOverlay: "none" };
  const chromaticOverlayPrimes = inferChromaticOverlayPrimes(workspace);
  const fallbackColorMonzoOffset = inferColorMonzoOffset(workspace, settings);
  const primeFamilyColorMap = getPrimeFamilyColorMap(settings?.prime_family_colors);
  const centerLabelSources = getCenterLabelSources(labelSourcesConfig).map((labels) =>
    alignLabelsToWorkspaceSlots(labels, workspace),
  );
  const noteRoleLabels = centerLabelSources.find((labels) => labels?.length) ?? [];
  const degreeTexts = [
    "1/1",
    ...(Array.isArray(settings?.scale) ? settings.scale.slice(0, -1) : []),
  ];
  const workspaceMonzos = (workspace?.slots ?? []).map((slot) => slot?.exactRole?.monzo ?? null);
  let hejiFrame = extra.hejiFrame ?? settings?.heji_frame ?? null;
  if (!hejiFrame) {
    try {
      if (Array.isArray(workspace?.slots) && workspace.slots.length) {
        hejiFrame = buildHejiNotationFrame({
          referenceDegree: settings?.reference_degree,
          noteNames: settings?.note_names,
          degreeTexts,
          fundamental: settings?.fundamental,
          scaleCents: (workspace?.slots ?? []).map((slot) => slot?.cents ?? 0),
          explicitAnchorLabel: settings?.heji_anchor_label || "",
          explicitAnchorRatio: settings?.heji_anchor_ratio || "",
          temperedOnly: settings?.heji_tempered_only === true,
          showCents: settings?.heji_show_cents !== false,
          workspaceMonzos,
        });
      }
    } catch {
      hejiFrame = null;
    }
  }
  // Keep the historical hue/offset basis stable. The HEJI frame should only
  // supply a structural notation center, not globally rebase every color.
  const colorMonzoOffset = fallbackColorMonzoOffset;
  const explicitHejiCenter = hejiFrame?.dReferenceMonzo;
  const effectiveNoteRoleLabels =
    Array.isArray(hejiFrame?.hejiNamesKeys) && hejiFrame.hejiNamesKeys.length
      ? hejiFrame.hejiNamesKeys
      : noteRoleLabels;
  const structuralCenterCandidate = hejiFrame?.degreeMetadata?.length
    ? inferCenterMonzoCandidate(workspace, effectiveNoteRoleLabels, hejiFrame.degreeMetadata)
    : null;
  if (structuralCenterCandidate?.monzo) {
    const notationCentering =
      resolvedBase.structuralOverlay === "none"
        ? {}
        : pickNotationCenter(explicitHejiCenter, structuralCenterCandidate);
    return {
      ...resolvedBase,
      ...notationCentering,
      chromaticOverlayPrimes,
      colorMonzoOffset,
      primeFamilyColorMap,
      degreeMetadata: hejiFrame?.degreeMetadata ?? null,
      noteRoleLabels: effectiveNoteRoleLabels,
    };
  }
  for (const labels of centerLabelSources) {
    if (!labels?.length) continue;
    const centerCandidate = inferCenterMonzoCandidate(
      workspace,
      labels,
      hejiFrame?.degreeMetadata ?? null,
    );
    if (centerCandidate?.monzo) {
      const notationCentering =
        resolvedBase.structuralOverlay === "none"
          ? {}
          : pickNotationCenter(explicitHejiCenter, centerCandidate);
      return {
        ...resolvedBase,
        ...notationCentering,
        chromaticOverlayPrimes,
        colorMonzoOffset,
        primeFamilyColorMap,
        degreeMetadata: hejiFrame?.degreeMetadata ?? null,
        noteRoleLabels: effectiveNoteRoleLabels,
      };
    }
  }
  return {
    ...resolvedBase,
    ...(resolvedBase.structuralOverlay === "none"
      ? {}
      : pickNotationCenter(explicitHejiCenter, null)),
    chromaticOverlayPrimes,
    colorMonzoOffset,
    primeFamilyColorMap,
    degreeMetadata: hejiFrame?.degreeMetadata ?? null,
    noteRoleLabels: effectiveNoteRoleLabels,
  };
}

export function deriveAutoNoteColors(settings, extra = {}) {
  const workspace = extra.workspace ?? createScaleWorkspace(settings);
  const autoColorOptions = buildResolvedAutoColorOptions(
    settings,
    workspace,
    {
      keyLabels: settings?.key_labels,
      noteNames: settings?.note_names,
      hejiTableNames: extra.heji_names_table ?? extra.hejiNamesTable ?? settings?.heji_names_table,
      hejiNames: extra.heji_names ?? extra.hejiNames ?? settings?.heji_names,
    },
    {
      hejiFrame: extra.hejiFrame ?? settings?.heji_frame ?? null,
    },
  );
  const noteNames = alignLabelsToWorkspaceSlots(
    Array.isArray(settings?.note_names) ? settings.note_names : [],
    workspace,
  );
  const hejiNames = alignLabelsToWorkspaceSlots(
    Array.isArray(
      extra.heji_names_table ??
        extra.heji_names ??
        settings?.heji_names_table ??
        settings?.heji_names,
    )
      ? (extra.heji_names_table ??
          extra.heji_names ??
          settings?.heji_names_table ??
          settings?.heji_names)
      : [],
    workspace,
  );
  const storedColors = Array.isArray(settings?.note_colors) ? settings.note_colors : [];
  const primeFamilyColorMap =
    autoColorOptions.primeFamilyColorMap ?? getPrimeFamilyColorMap(settings?.prime_family_colors);
  const useHeji = settings?.key_labels === "heji";
  const isEqualDivision = isEqualDivisionScale(settings, workspace);
  const isTonalPlexus205 =
    /205ed2/i.test(String(settings?.name ?? "")) ||
    /205ed2/i.test(String(settings?.short_description ?? ""));
  if (isTonalPlexus205 && storedColors.length === workspace.slots.length) {
    return storedColors.slice();
  }
  const inheritedNotationPaletteMap = isEqualDivision
    ? buildInheritedNotationPaletteMap(noteNames, storedColors)
    : new Map();
  const derivedColors = workspace.slots.map((slot, degreeIndex) => {
    if (degreeIndex === 0) return null;
    const interval = slot?.committedIdentity;
    const fallbackColor = storedColors[degreeIndex] ?? "#ffffff";
    const label = (useHeji ? hejiNames[degreeIndex] : noteNames[degreeIndex]) ?? "";
    const degreeMetadata = autoColorOptions.degreeMetadata?.[degreeIndex] ?? null;
    const inheritedNotationColor = inferInheritedNotationPaletteColor(
      label,
      inheritedNotationPaletteMap,
    );
    const equalDivisionHejiAutoColor = inferEqualDivisionHejiTemperedAutoColor(label, {
      isEqualDivision,
    });
    const equalDivisionHejiHybridAutoColor = inferEqualDivisionHejiHybridAutoColor(label, {
      isEqualDivision,
    });
    const temperedAutoColor =
      inheritedNotationColor ??
      equalDivisionHejiAutoColor ??
      equalDivisionHejiHybridAutoColor ??
      inferTemperedAutoColor(label) ??
      inferTraditionalTemperedAutoColor(label) ??
      inferEnharmonicHejiTemperedAutoColor(label) ??
      inferTemperedAutoColorFromStructure(degreeMetadata?.parsed);
    if (temperedAutoColor) return temperedAutoColor;
    const syntheticMonzo =
      !Array.isArray(interval?.monzo) &&
      degreeMetadata?.parsed &&
      hasExplicitHejiOrTemperedSpelling(label) &&
      Object.values(degreeMetadata.parsed.primeExponents ?? {}).every((value) => value === 0)
        ? pitchStructureToMonzo(degreeMetadata.parsed)
        : null;
    const analysisMonzo = interval?.monzo ?? syntheticMonzo;
    if (!Array.isArray(analysisMonzo)) return fallbackColor;
    const notationRoleOverride =
      !Array.isArray(interval?.monzo) &&
      isEqualDivision &&
      degreeMetadata?.parsed &&
      (degreeMetadata.parsed.syntonic ?? 0) !== 0 &&
      Object.values(degreeMetadata.parsed.primeExponents ?? {}).every((value) => value === 0)
        ? "chromatic"
        : undefined;
    return (
      monzoToSuggestedColor(analysisMonzo, undefined, {
        ...autoColorOptions,
        notationSide: degreeMetadata?.notationSide ?? inferNotationSide(label),
        notationRole:
          notationRoleOverride ?? degreeMetadata?.notationRole ?? inferNotationRole(label),
        chainRole: inferPrimeChainRole(workspace, degreeIndex, autoColorOptions),
      })?.screenHex ?? fallbackColor
    );
  });
  const nonTonicColors = derivedColors.slice(1).filter(Boolean);
  const isPureTemperedPalette =
    nonTonicColors.length > 0 &&
    nonTonicColors.every(
      (color) =>
        color === TEMPERED_DIATONIC_AUTO_COLOR ||
        color === TEMPERED_CHROMATIC_AUTO_COLOR ||
        color === TRADITIONAL_TEMPERED_DIATONIC_AUTO_COLOR ||
        color === deriveTraditionalTemperedChromaticPalette().sharp ||
        color === deriveTraditionalTemperedChromaticPalette().flat ||
        color === deriveTraditionalTemperedChromaticPalette().mixed,
    ) &&
    nonTonicColors.some(
      (color) =>
        color === TEMPERED_CHROMATIC_AUTO_COLOR ||
        color === deriveTraditionalTemperedChromaticPalette().sharp ||
        color === deriveTraditionalTemperedChromaticPalette().flat ||
        color === deriveTraditionalTemperedChromaticPalette().mixed,
    );
  derivedColors[0] = isPureTemperedPalette
    ? TEMPERED_TONIC_AUTO_COLOR
    : deriveAutoTonicColorFromPaletteWithPrime(nonTonicColors, primeFamilyColorMap[1]);
  return derivedColors;
}
