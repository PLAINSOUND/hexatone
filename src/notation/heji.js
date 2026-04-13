import { monzosEqual } from "xen-dev-utils";
import { CANONICAL_MONZO_BASIS } from "../tuning/interval.js";

export const HEJI_MONZO_BASIS = CANONICAL_MONZO_BASIS;
export const PRIME_COUNT = HEJI_MONZO_BASIS.length;

const zeroMonzo = () => new Array(PRIME_COUNT).fill(0);

function monzo(...pairs) {
  const out = zeroMonzo();
  for (const [index, value] of pairs) out[index] = value;
  return out;
}

function multiplyMonzo(vector, factor) {
  return vector.map((value) => value * factor);
}

function ratioStepFamily({
  family,
  prime,
  lowerGlyph,
  upperGlyph,
  lowerCodepoint,
  upperCodepoint,
  lowerMonzo,
}) {
  return {
    family,
    prime,
    lower: {
      id: `${family}:-1`,
      family,
      amount: -1,
      prime,
      glyph: lowerGlyph,
      codepoint: lowerCodepoint,
      monzo: lowerMonzo,
    },
    upper: {
      id: `${family}:1`,
      family,
      amount: 1,
      prime,
      glyph: upperGlyph,
      codepoint: upperCodepoint,
      monzo: multiplyMonzo(lowerMonzo, -1),
    },
  };
}

export const BASE_SYMBOLS = [
  { id: "flat:0", chromatic: "flat", syntonic: 0, label: "b", glyph: "", aliases: ["♭"] },
  { id: "natural:0", chromatic: "natural", syntonic: 0, label: "n", glyph: "", aliases: ["♮"] },
  { id: "sharp:0", chromatic: "sharp", syntonic: 0, label: "#", glyph: "", aliases: ["♯"] },
  { id: "flat:-1", chromatic: "flat", syntonic: -1, label: "b -1 synt", glyph: "" },
  { id: "natural:-1", chromatic: "natural", syntonic: -1, label: "n -1 synt", glyph: "" },
  { id: "sharp:-1", chromatic: "sharp", syntonic: -1, label: "# -1 synt", glyph: "" },
  { id: "flat:1", chromatic: "flat", syntonic: 1, label: "b +1 synt", glyph: "" },
  { id: "natural:1", chromatic: "natural", syntonic: 1, label: "n +1 synt", glyph: "" },
  { id: "sharp:1", chromatic: "sharp", syntonic: 1, label: "# +1 synt", glyph: "" },
  { id: "flat:-2", chromatic: "flat", syntonic: -2, label: "b -2 synt", glyph: "" },
  { id: "natural:-2", chromatic: "natural", syntonic: -2, label: "n -2 synt", glyph: "" },
  { id: "sharp:-2", chromatic: "sharp", syntonic: -2, label: "# -2 synt", glyph: "" },
  { id: "flat:2", chromatic: "flat", syntonic: 2, label: "b +2 synt", glyph: "" },
  { id: "natural:2", chromatic: "natural", syntonic: 2, label: "n +2 synt", glyph: "" },
  { id: "sharp:2", chromatic: "sharp", syntonic: 2, label: "# +2 synt", glyph: "" },
  { id: "flat:-3", chromatic: "flat", syntonic: -3, label: "b -3 synt", glyph: "" },
  { id: "natural:-3", chromatic: "natural", syntonic: -3, label: "n -3 synt", glyph: "" },
  { id: "sharp:-3", chromatic: "sharp", syntonic: -3, label: "# -3 synt", glyph: "" },
];

export const BASE_BY_ID = Object.fromEntries(BASE_SYMBOLS.map((item) => [item.id, item]));
export const BASE_BY_GLYPH = Object.fromEntries(
  BASE_SYMBOLS.flatMap((item) => [[item.glyph, item], ...(item.aliases ?? []).map((alias) => [alias, item])]),
);

const ZERO_MONZO = zeroMonzo();
const LETTER_ORDER = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const AUTO_OFFSET_TO_A = [4, -3, ...new Array(PRIME_COUNT - 2).fill(0)];
const NATURALS_FROM_C_REF = {
  F: [2, -1, ...new Array(PRIME_COUNT - 2).fill(0)],
  C: ZERO_MONZO,
  G: [-1, 1, ...new Array(PRIME_COUNT - 2).fill(0)],
  D: [-3, 2, ...new Array(PRIME_COUNT - 2).fill(0)],
  A: [-4, 3, ...new Array(PRIME_COUNT - 2).fill(0)],
  E: [-6, 4, ...new Array(PRIME_COUNT - 2).fill(0)],
  B: [-7, 5, ...new Array(PRIME_COUNT - 2).fill(0)],
};

export const CHROMATIC_MONZOS = {
  flat: [11, -7, ...new Array(PRIME_COUNT - 2).fill(0)],
  natural: ZERO_MONZO,
  sharp: [-11, 7, ...new Array(PRIME_COUNT - 2).fill(0)],
};

export const SYNTONIC_BY_AMOUNT = {
  [-3]: [12, -12, 3, ...new Array(PRIME_COUNT - 3).fill(0)],
  [-2]: [8, -8, 2, ...new Array(PRIME_COUNT - 3).fill(0)],
  [-1]: [4, -4, 1, ...new Array(PRIME_COUNT - 3).fill(0)],
  [0]: ZERO_MONZO,
  [1]: [-4, 4, -1, ...new Array(PRIME_COUNT - 3).fill(0)],
  [2]: [-8, 8, -2, ...new Array(PRIME_COUNT - 3).fill(0)],
};
export const SCHISMA_BY_AMOUNT = {
  [-3]: [45, -24, -3, ...new Array(PRIME_COUNT - 3).fill(0)],
  [-2]: [30, -16, -2, ...new Array(PRIME_COUNT - 3).fill(0)],
  [-1]: [15, -8, -1, ...new Array(PRIME_COUNT - 3).fill(0)],
  [0]: ZERO_MONZO,
  [1]: [-15, 8, 1, ...new Array(PRIME_COUNT - 3).fill(0)],
  [2]: [-30, 16, 2, ...new Array(PRIME_COUNT - 3).fill(0)],
  [3]: [-45, 24, 3, ...new Array(PRIME_COUNT - 3).fill(0)],
};

export const HEJI_FAMILIES = [
  ratioStepFamily({
    family: "septimal",
    prime: 7,
    lowerGlyph: "",
    upperGlyph: "",
    lowerCodepoint: "U+E2DE",
    upperCodepoint: "U+E2DF",
    lowerMonzo: monzo([0, -6], [1, 2], [3, 1]),
  }),
  ratioStepFamily({
    family: "undecimal",
    prime: 11,
    lowerGlyph: "",
    upperGlyph: "",
    lowerCodepoint: "U+E2E2",
    upperCodepoint: "U+E2E3",
    lowerMonzo: monzo([0, 5], [1, -1], [4, -1]),
  }),
  ratioStepFamily({
    family: "tridecimal",
    prime: 13,
    lowerGlyph: "",
    upperGlyph: "",
    lowerCodepoint: "U+E2E4",
    upperCodepoint: "U+E2E5",
    lowerMonzo: monzo([0, 1], [1, -3], [5, 1]),
  }),
  ratioStepFamily({
    family: "17_limit",
    prime: 17,
    lowerGlyph: "",
    upperGlyph: "",
    lowerCodepoint: "U+E2E6",
    upperCodepoint: "U+E2E7",
    lowerMonzo: monzo([0, 7], [1, -7], [6, 1]),
  }),
  ratioStepFamily({
    family: "19_limit",
    prime: 19,
    lowerGlyph: "",
    upperGlyph: "",
    lowerCodepoint: "U+E2E8",
    upperCodepoint: "U+E2E9",
    lowerMonzo: monzo([0, 9], [1, -3], [7, -1]),
  }),
  ratioStepFamily({
    family: "23_limit",
    prime: 23,
    lowerGlyph: "",
    upperGlyph: "",
    lowerCodepoint: "U+E2EB",
    upperCodepoint: "U+E2EA",
    lowerMonzo: monzo([0, -5], [1, 6], [8, -1]),
  }),
  ratioStepFamily({
    family: "29_limit",
    prime: 29,
    lowerGlyph: "",
    upperGlyph: "",
    lowerCodepoint: "U+EE50",
    upperCodepoint: "U+EE51",
    lowerMonzo: monzo([0, 8], [1, -2], [9, -1]),
  }),
  ratioStepFamily({
    family: "31_limit",
    prime: 31,
    lowerGlyph: "",
    upperGlyph: "",
    lowerCodepoint: "U+E2EC",
    upperCodepoint: "U+E2ED",
    lowerMonzo: monzo([0, -5], [10, 1]),
  }),
  ratioStepFamily({
    family: "37_limit",
    prime: 37,
    lowerGlyph: "",
    upperGlyph: "",
    lowerCodepoint: "U+EE52",
    upperCodepoint: "U+EE53",
    lowerMonzo: monzo([0, 2], [1, 2], [11, -1]),
  }),
  ratioStepFamily({
    family: "41_limit",
    prime: 41,
    lowerGlyph: "",
    upperGlyph: "",
    lowerCodepoint: "U+EE54",
    upperCodepoint: "U+EE55",
    lowerMonzo: monzo([0, -1], [1, 4], [12, -1]),
  }),
  ratioStepFamily({
    family: "43_limit",
    prime: 43,
    lowerGlyph: "",
    upperGlyph: "",
    lowerCodepoint: "U+EE56",
    upperCodepoint: "U+EE57",
    lowerMonzo: monzo([0, 7], [1, -1], [13, -1]),
  }),
  ratioStepFamily({
    family: "47_limit",
    prime: 47,
    lowerGlyph: "",
    upperGlyph: "",
    lowerCodepoint: "U+EE58",
    upperCodepoint: "U+EE59",
    // Plainsound correction: 47-limit quartertone is 47/48, i.e. the perfect fifth tempered by 47/48.
    lowerMonzo: monzo([0, -4], [1, -1], [14, 1]),
  }),
];

export const EXTRA_MODIFIERS = HEJI_FAMILIES.flatMap((family) => [family.lower, family.upper]);
export const EXTRA_BY_ID = Object.fromEntries(EXTRA_MODIFIERS.map((item) => [item.id, item]));
export const EXTRA_BY_GLYPH = Object.fromEntries(EXTRA_MODIFIERS.map((item) => [item.glyph, item]));
export const EXTRA_MONZOS = Object.fromEntries(EXTRA_MODIFIERS.map((item) => [item.id, item.monzo]));
export const SPECIAL_GLYPH_SEQUENCES = {
  "": ["septimal:-1", "septimal:-1"],
  "": ["septimal:1", "septimal:1"],
};
export const SCHISMA_GLYPHS = {
  [-3]: "",
  [-2]: "",
  [-1]: "",
  [0]: "",
  [1]: "",
  [2]: "",
  [3]: "",
};
export const SCHISMA_BY_GLYPH = Object.fromEntries(
  Object.entries(SCHISMA_GLYPHS)
    .filter(([, glyph]) => glyph)
    .map(([amount, glyph]) => [glyph, Number(amount)]),
);

const FAMILY_BY_ID = Object.fromEntries(HEJI_FAMILIES.map((item) => [item.family, item]));
const D_CENTER_MONZO = NATURALS_FROM_C_REF.D;

function compareArraysDescending(a = [], b = []) {
  const max = Math.max(a.length, b.length);
  for (let index = 0; index < max; index += 1) {
    const delta = (b[index] ?? 0) - (a[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function addMonzos(...vectors) {
  const out = zeroMonzo();
  for (const vector of vectors) {
    if (!vector) continue;
    for (let index = 0; index < PRIME_COUNT; index += 1) {
      out[index] += vector[index] ?? 0;
    }
  }
  return out;
}

export function subtractMonzos(a, b) {
  const out = zeroMonzo();
  for (let index = 0; index < PRIME_COUNT; index += 1) {
    out[index] = (a[index] ?? 0) - (b[index] ?? 0);
  }
  return out;
}

export function naturalBaseMonzo(letter, octave) {
  const natural = NATURALS_FROM_C_REF[letter];
  if (!natural) return null;
  const octaveShift = [octave - 4, ...new Array(PRIME_COUNT - 1).fill(0)];
  return addMonzos(natural, AUTO_OFFSET_TO_A, octaveShift);
}

export function sortExtraIds(extraIds = []) {
  return [...extraIds].sort((a, b) => {
    const itemA = EXTRA_BY_ID[a];
    const itemB = EXTRA_BY_ID[b];
    const primeA = itemA?.prime ?? 0;
    const primeB = itemB?.prime ?? 0;
    if (primeA !== primeB) return primeB - primeA;
    if ((itemA?.amount ?? 0) !== (itemB?.amount ?? 0)) return (itemA?.amount ?? 0) - (itemB?.amount ?? 0);
    return a.localeCompare(b);
  });
}

export function hejiDeltaMonzoForSelection(baseId = "natural:0", extraIds = [], schismaAmount = 0) {
  const base = BASE_BY_ID[baseId] ?? BASE_BY_ID["natural:0"];
  const extras = extraIds.map((id) => EXTRA_MONZOS[id]).filter(Boolean);
  return addMonzos(
    SYNTONIC_BY_AMOUNT[base.syntonic] ?? ZERO_MONZO,
    SCHISMA_BY_AMOUNT[schismaAmount] ?? ZERO_MONZO,
    ...extras,
  );
}

export function hejiToMonzo({ letter, octave, baseId = "natural:0", schismaAmount = 0, extraIds = [] }) {
  return addMonzos(
    naturalBaseMonzo(letter, octave),
    CHROMATIC_MONZOS[(BASE_BY_ID[baseId] ?? BASE_BY_ID["natural:0"]).chromatic],
    hejiDeltaMonzoForSelection(baseId, extraIds, schismaAmount),
  );
}

export function parseHejiGlyphInput(text, fallbackBaseId = "natural:0") {
  let baseId = fallbackBaseId;
  let schismaAmount = 0;
  const extras = [];
  for (const char of String(text || "").replace(/\s+/g, "")) {
    if (SPECIAL_GLYPH_SEQUENCES[char]) {
      extras.push(...SPECIAL_GLYPH_SEQUENCES[char]);
      continue;
    }
    if (Object.hasOwn(SCHISMA_BY_GLYPH, char)) {
      schismaAmount += SCHISMA_BY_GLYPH[char];
      continue;
    }
    if (BASE_BY_GLYPH[char]) {
      baseId = BASE_BY_GLYPH[char].id;
      continue;
    }
    if (EXTRA_BY_GLYPH[char]) {
      extras.push(EXTRA_BY_GLYPH[char].id);
    }
  }
  return { baseId, schismaAmount, extraIds: sortExtraIds(extras) };
}

export function parseHejiPitchClassLabel(text, fallbackBaseId = "natural:0") {
  const source = String(text || "").trim();
  const match = source.match(/^(.+?)([A-Ga-g])$/);
  if (!match) return null;
  const [, accidentalText, letterText] = match;
  const { baseId, schismaAmount, extraIds } = parseHejiGlyphInput(accidentalText, fallbackBaseId);
  return {
    letter: letterText.toUpperCase(),
    baseId,
    schismaAmount,
    extraIds,
  };
}

function renderFamilyGlyphs(ids = []) {
  if (!ids.length) return "";
  const [firstId] = ids;
  const first = EXTRA_BY_ID[firstId];
  if (!first) return "";
  if (first.family !== "septimal") {
    return ids.map((id) => EXTRA_BY_ID[id]?.glyph ?? "").join("");
  }

  const isLower = first.amount === -1;
  const singleGlyph = isLower ? "" : "";
  const doubleGlyph = isLower ? "" : "";
  const doubles = Math.floor(ids.length / 2);
  const singles = ids.length % 2;
  return `${singleGlyph.repeat(singles)}${doubleGlyph.repeat(doubles)}`;
}

export function glyphStringForSelection(baseId = "natural:0", extraIds = [], schismaAmount = 0) {
  const base = BASE_BY_ID[baseId] ?? BASE_BY_ID["natural:0"];
  const extras = sortExtraIds(extraIds);
  const grouped = [];
  for (const id of extras) {
    const item = EXTRA_BY_ID[id];
    const last = grouped[grouped.length - 1];
    if (last && last.family === item?.family && last.amount === item?.amount) {
      last.ids.push(id);
    } else {
      grouped.push({ family: item?.family, amount: item?.amount, ids: [id] });
    }
  }
  const glyphs = grouped.map((group) => renderFamilyGlyphs(group.ids)).join("");
  const showBaseGlyph = !(base.chromatic === "natural" && base.syntonic === 0 && extras.length > 0);
  return `${glyphs}${SCHISMA_GLYPHS[schismaAmount] ?? ""}${showBaseGlyph ? base.glyph : ""}`;
}

export function formatHejiLabel({ letter, octave, baseId = "natural:0", schismaAmount = 0, extraIds = [] }) {
  const base = BASE_BY_ID[baseId] ?? BASE_BY_ID["natural:0"];
  const chromatic =
    base.chromatic === "flat" ? "b" :
      base.chromatic === "sharp" ? "#" :
        "";
  const glyphs = glyphStringForSelection(baseId, extraIds, schismaAmount);
  return {
    ascii: `${letter}${chromatic}${octave}`,
    glyphs: `${glyphs}${letter}${octave}`,
  };
}

function decomposeHejiDeltaMonzo(deltaMonzo) {
  const residual = [...deltaMonzo];
  const extraIds = [];

  for (const family of HEJI_FAMILIES) {
    const primeIndex = HEJI_MONZO_BASIS.indexOf(family.prime);
    const step = family.lower.monzo[primeIndex];
    const coordinate = residual[primeIndex] ?? 0;
    if (!step || coordinate % step !== 0) return null;
    const count = coordinate / step;
    if (count > 0) {
      for (let repeat = 0; repeat < count; repeat += 1) extraIds.push(family.lower.id);
    } else if (count < 0) {
      for (let repeat = 0; repeat < -count; repeat += 1) extraIds.push(family.upper.id);
    }
    if (count !== 0) {
      const contribution = multiplyMonzo(family.lower.monzo, count);
      for (let index = 0; index < PRIME_COUNT; index += 1) {
        residual[index] -= contribution[index] ?? 0;
      }
    }
  }

  if (residual.some((value) => value !== 0)) return null;
  return sortExtraIds(extraIds);
}

const SEARCH_BASE_IDS = BASE_SYMBOLS.map((item) => item.id);
const SEARCH_LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const SEARCH_SCHISMA_AMOUNTS = [-3, -2, -1, 0, 1, 2, 3];

export function monzoToHeji(monzo, options = {}) {
  const octaveMin = options.octaveMin ?? 0;
  const octaveMax = options.octaveMax ?? 8;
  const schismaAmounts = options.allowSchismaConventional ? SEARCH_SCHISMA_AMOUNTS : [0];
  let best = null;

  for (let octave = octaveMin; octave <= octaveMax; octave += 1) {
    for (const letter of SEARCH_LETTERS) {
      for (const baseId of SEARCH_BASE_IDS) {
        for (const schismaAmount of schismaAmounts) {
          const baseMonzo = addMonzos(
            naturalBaseMonzo(letter, octave),
            CHROMATIC_MONZOS[(BASE_BY_ID[baseId] ?? BASE_BY_ID["natural:0"]).chromatic],
            SYNTONIC_BY_AMOUNT[(BASE_BY_ID[baseId] ?? BASE_BY_ID["natural:0"]).syntonic] ?? ZERO_MONZO,
            SCHISMA_BY_AMOUNT[schismaAmount] ?? ZERO_MONZO,
          );
          const delta = subtractMonzos(monzo, baseMonzo);
          const extraIds = decomposeHejiDeltaMonzo(delta);
          if (!extraIds) continue;
          const candidate = hejiToMonzo({ letter, octave, baseId, schismaAmount, extraIds });
          if (!monzosEqual(candidate, monzo)) continue;
          const spelling = {
            supported: true,
            letter,
            octave,
            baseId,
            schismaAmount,
            extraIds,
            label: formatHejiLabel({ letter, octave, baseId, schismaAmount, extraIds }),
          };
          if (!best || compareHejiSpellings(spelling, best, options) < 0) {
            best = spelling;
          }
        }
      }
    }
  }

  if (best) return best;

  return {
    supported: false,
    unsupported: [...monzo],
  };
}

function compareTuples(a, b) {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function candidateScore(candidate, options = {}) {
  const center = options.notationalCenterMonzo ?? D_CENTER_MONZO;
  const base = BASE_BY_ID[candidate.baseId] ?? BASE_BY_ID["natural:0"];
  const pythagorean = addMonzos(
    NATURALS_FROM_C_REF[candidate.letter],
    CHROMATIC_MONZOS[base.chromatic] ?? ZERO_MONZO,
  );
  return [
    Math.abs((pythagorean[1] ?? 0) - (center[1] ?? 0)),
    Math.abs(candidate.schismaAmount ?? 0),
    Math.abs(base.syntonic ?? 0),
    base.chromatic === "natural" ? 0 : 1,
    Math.abs(candidate.octave - 4),
    LETTER_ORDER[candidate.letter] ?? 99,
  ];
}

export function compareHejiSpellings(a, b, options = {}) {
  const byScore = compareTuples(candidateScore(a, options), candidateScore(b, options));
  if (byScore !== 0) return byScore;
  if (a.letter !== b.letter) return LETTER_ORDER[a.letter] - LETTER_ORDER[b.letter];
  if (a.octave !== b.octave) return a.octave - b.octave;
  if (a.baseId !== b.baseId) return a.baseId.localeCompare(b.baseId);
  if ((a.schismaAmount ?? 0) !== (b.schismaAmount ?? 0)) return (a.schismaAmount ?? 0) - (b.schismaAmount ?? 0);
  return compareArraysDescending(a.extraIds, b.extraIds);
}

export function hejiModifierMetadata(id) {
  const modifier = EXTRA_BY_ID[id];
  if (!modifier) return null;
  return {
    ...modifier,
    familyInfo: FAMILY_BY_ID[modifier.family],
  };
}
