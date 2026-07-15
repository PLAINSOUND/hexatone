// This module owns editable pitch-structure objects for notation entry.
// It keeps note letter, accidental counts, HEJI primes, and related flags in a
// mutable-friendly structured form before those choices are resolved to pitch.

import {
  BASE_BY_ID,
  BASE_SYMBOLS,
  EXTRA_BY_ID,
  HEJI_FAMILIES,
  hejiToMonzo,
  parseHejiPitchClassLabel,
  PRIME_COUNT,
} from "./heji.js";
import { monzoToCents, monzosEqual } from "xen-dev-utils";

const BASE_ID_BY_CHROMATIC_AND_SYNTONIC = Object.fromEntries(
  BASE_SYMBOLS.map((symbol) => [[symbol.chromatic, symbol.syntonic].join(":"), symbol.id]),
);

const ACCIDENTAL_COUNT_BY_CHROMATIC = {
  doubleflat: -2,
  flat: -1,
  natural: 0,
  sharp: 1,
  doublesharp: 2,
};

const DOUBLE_SEPTIMAL_GLYPHS = {
  positive: "",
  negative: "",
};

function makeBaseId(chromatic, syntonic) {
  return `${chromatic}:${syntonic}`;
}

function zeroMonzo() {
  return new Array(PRIME_COUNT).fill(0);
}

function subtractMonzo(left, right) {
  return left.map((value, index) => value - (right[index] ?? 0));
}

function normalizeSignedCents(value) {
  return ((value + 600) % 1200 + 1200) % 1200 - 600;
}

function normalizedPrimeExponents(primeExponents = {}) {
  return Object.fromEntries(
    Object.entries(primeExponents)
      .map(([prime, exponent]) => [String(prime), Number(exponent) || 0])
      .filter(([, exponent]) => exponent !== 0),
  );
}

export function createPitchStructure(overrides = {}) {
  return {
    letter: overrides.letter ?? "",
    accidentalCount: overrides.accidentalCount ?? 0,
    syntonic: overrides.syntonic ?? 0,
    primeExponents: normalizedPrimeExponents(overrides.primeExponents),
    cautionaryNatural: overrides.cautionaryNatural ?? false,
    useDoubles: overrides.useDoubles ?? true,
    useDoubleSeptimals: overrides.useDoubleSeptimals ?? true,
    useTemperedAccidentals: overrides.useTemperedAccidentals ?? false,
  };
}

export function pitchStructureToBaseId(structure) {
  const accidentalCount = structure.accidentalCount ?? 0;
  const chromatic =
    accidentalCount <= -2 ? "doubleflat" :
    accidentalCount === -1 ? "flat" :
    accidentalCount === 1 ? "sharp" :
    accidentalCount >= 2 ? "doublesharp" :
    "natural";
  return BASE_ID_BY_CHROMATIC_AND_SYNTONIC[makeBaseId(chromatic, Math.max(-3, Math.min(3, structure.syntonic ?? 0)))]
    ?? "natural:0";
}

export function pitchStructureToMonzo(structure, octave = 4) {
  const baseId = pitchStructureToBaseId(structure);
  const primeExponents = normalizedPrimeExponents(structure.primeExponents);
  const extraIds = Object.entries(primeExponents)
    .flatMap(([primeText, exponent]) => {
      const prime = Number(primeText);
      const family = HEJI_FAMILIES.find((candidate) => candidate.prime === prime);
      if (!family || !exponent) return [];
      return new Array(Math.abs(exponent)).fill(exponent > 0 ? family.upper.id : family.lower.id);
    });
  if (!structure.letter) return zeroMonzo();
  return hejiToMonzo({
    letter: structure.letter,
    octave,
    baseId,
    extraIds,
  });
}

export function pitchStructureToAutoDeviation(structure, options = {}) {
  const { forceZero = false } = options;
  if (!structure?.letter) return "";

  const baseStructure = createPitchStructure({
    letter: structure.letter,
    accidentalCount: structure.accidentalCount ?? 0,
    syntonic: 0,
    primeExponents: {},
    cautionaryNatural: structure.cautionaryNatural ?? false,
    useDoubles: structure.useDoubles ?? true,
    useDoubleSeptimals: structure.useDoubleSeptimals ?? true,
  });
  const targetMonzo = pitchStructureToMonzo(structure);
  const baseMonzo = pitchStructureToMonzo(baseStructure);
  if (monzosEqual(targetMonzo, baseMonzo)) return forceZero ? "+0" : "";

  const cents = normalizeSignedCents(Math.round(monzoToCents(subtractMonzo(targetMonzo, baseMonzo))));
  if (cents === 0) return forceZero ? "+0" : "";
  return cents > 0 ? `+${cents}` : `−${Math.abs(cents)}`;
}

function buildBaseGlyph(structure) {
  const accidentalCount = structure.accidentalCount ?? 0;
  const syntonic = structure.syntonic ?? 0;
  const clampedSyntonic = Math.max(-3, Math.min(3, syntonic));
  const spillCount = Math.max(0, Math.abs(syntonic) - 3);
  const spillGlyph = spillCount
    ? (BASE_BY_ID[makeBaseId("natural", syntonic < 0 ? -1 : 1)]?.glyph ?? "").repeat(spillCount)
    : "";
  const hasHigherPrimeInflection = Object.values(normalizedPrimeExponents(structure.primeExponents)).some(Boolean);
  const useTemperedAccidentals = structure.useTemperedAccidentals === true;

  if (useTemperedAccidentals && syntonic === 0) {
    const temperedGlyph =
      accidentalCount < 0 ? "" :
      accidentalCount > 0 ? "" :
      "";
    return temperedGlyph;
  }

  if (accidentalCount === 0) {
    if (syntonic === 0 && !structure.cautionaryNatural && hasHigherPrimeInflection) return "";
    return `${BASE_BY_ID[makeBaseId("natural", clampedSyntonic)]?.glyph ?? ""}${spillGlyph}`;
  }

  const isSharpSide = accidentalCount > 0;
  const magnitude = Math.abs(accidentalCount);
  const singleGlyph = BASE_BY_ID[makeBaseId(isSharpSide ? "sharp" : "flat", clampedSyntonic)]?.glyph ?? "";
  const doubleGlyph = BASE_BY_ID[makeBaseId(isSharpSide ? "doublesharp" : "doubleflat", clampedSyntonic)]?.glyph ?? "";
  const singleCount = structure.useDoubles ? magnitude % 2 : magnitude;
  const doubleCount = structure.useDoubles ? Math.floor(magnitude / 2) : 0;

  return `${new Array(singleCount).fill(singleGlyph).join("")}${new Array(doubleCount).fill(doubleGlyph).join("")}${spillGlyph}`;
}

function buildPrimeGlyphs(structure) {
  return Object.entries(normalizedPrimeExponents(structure.primeExponents))
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .flatMap(([primeText, exponent]) => {
      const prime = Number(primeText);
      const family = HEJI_FAMILIES.find((candidate) => candidate.prime === prime);
      if (!family || !exponent) return [];
      if (prime === 7 && structure.useDoubleSeptimals) {
        const magnitude = Math.abs(exponent);
        const singleGlyph = exponent > 0 ? family.upper.glyph : family.lower.glyph;
        const doubleGlyph = exponent > 0 ? DOUBLE_SEPTIMAL_GLYPHS.positive : DOUBLE_SEPTIMAL_GLYPHS.negative;
        return [
          ...new Array(magnitude % 2).fill(singleGlyph),
          ...new Array(Math.floor(magnitude / 2)).fill(doubleGlyph),
        ];
      }
      const glyph = exponent > 0 ? family.upper.glyph : family.lower.glyph;
      return new Array(Math.abs(exponent)).fill(glyph);
    })
    .join("");
}

export function pitchStructureToHeji(structure, options = {}) {
  const includeLetter = options.includeLetter !== false;
  const extras = buildPrimeGlyphs(structure);
  const base = buildBaseGlyph(structure);
  return `${extras}${base}${includeLetter ? structure.letter ?? "" : ""}`;
}

export function withPitchStructureLetter(structure, letter) {
  return createPitchStructure({ ...structure, letter });
}

export function withPitchStructureAccidentalDelta(structure, delta) {
  return createPitchStructure({
    ...structure,
    accidentalCount: (structure.accidentalCount ?? 0) + delta,
    useTemperedAccidentals: false,
  });
}

export function withPitchStructureAccidentalCount(structure, accidentalCount) {
  return createPitchStructure({ ...structure, accidentalCount, useTemperedAccidentals: false });
}

export function withPitchStructureTemperedAccidentalCount(structure, accidentalCount) {
  return createPitchStructure({
    ...structure,
    accidentalCount,
    syntonic: 0,
    useTemperedAccidentals: true,
  });
}

export function withPitchStructureSyntonicDelta(structure, delta) {
  return createPitchStructure({
    ...structure,
    syntonic: (structure.syntonic ?? 0) + delta,
    useTemperedAccidentals: false,
  });
}

export function withPitchStructurePrimeDelta(structure, prime, delta) {
  return createPitchStructure({
    ...structure,
    primeExponents: {
      ...structure.primeExponents,
      [prime]: (structure.primeExponents?.[prime] ?? 0) + delta,
    },
    useTemperedAccidentals: false,
  });
}

export function withPitchStructureFlag(structure, flag, value) {
  return createPitchStructure({ ...structure, [flag]: value });
}

export function clearPitchStructure() {
  return createPitchStructure();
}

export function parseHejiToStructure(text) {
  const parsed = parseHejiPitchClassLabel(text);
  if (!parsed) return null;
  const base = BASE_BY_ID[parsed.baseId] ?? BASE_BY_ID["natural:0"];
  const primeExponents = {};
  for (const id of parsed.extraIds ?? []) {
    const modifier = EXTRA_BY_ID[id];
    if (!modifier) continue;
    primeExponents[modifier.prime] = (primeExponents[modifier.prime] ?? 0) + modifier.amount;
  }
  return createPitchStructure({
    letter: parsed.letter,
    accidentalCount: ACCIDENTAL_COUNT_BY_CHROMATIC[base.chromatic] ?? 0,
    syntonic: base.syntonic ?? 0,
    primeExponents,
    useDoubles: base.chromatic === "doubleflat" || base.chromatic === "doublesharp",
    useDoubleSeptimals:
      Math.abs(primeExponents[7] ?? 0) >= 2,
    useTemperedAccidentals: /[\uE2F1\uE2F2\uE2F3]/u.test(String(text ?? "")),
  });
}
