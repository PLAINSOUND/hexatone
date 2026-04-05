export const PRIME_COUNT = 15;

export const BASE_SYMBOLS = [
  { id: "flat:0", chromatic: "flat", syntonic: 0, label: "b", glyph: "♭" },
  { id: "natural:0", chromatic: "natural", syntonic: 0, label: "n", glyph: "♮" },
  { id: "sharp:0", chromatic: "sharp", syntonic: 0, label: "#", glyph: "♯" },
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
];

export const EXTRA_MODIFIERS = [
  { id: "septimal:-1", family: "septimal", amount: -1, label: "septimal down", glyph: "" },
  { id: "septimal:1", family: "septimal", amount: 1, label: "septimal up", glyph: "" },
  { id: "17_limit:-1", family: "17_limit", amount: -1, label: "17 down", glyph: "" },
  { id: "17_limit:1", family: "17_limit", amount: 1, label: "17 up", glyph: "" },
];

export const BASE_BY_ID = Object.fromEntries(BASE_SYMBOLS.map((item) => [item.id, item]));
export const BASE_BY_GLYPH = Object.fromEntries(BASE_SYMBOLS.map((item) => [item.glyph, item]));
export const EXTRA_BY_ID = Object.fromEntries(EXTRA_MODIFIERS.map((item) => [item.id, item]));
export const EXTRA_BY_GLYPH = Object.fromEntries(EXTRA_MODIFIERS.map((item) => [item.glyph, item]));

export const ZERO_MONZO = new Array(PRIME_COUNT).fill(0);

export const CHROMATIC_MONZOS = {
  flat: [11, -7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  natural: ZERO_MONZO,
  sharp: [-11, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

export const SYNTONIC_BY_AMOUNT = {
  [-2]: [8, -8, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [-1]: [4, -4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0]: ZERO_MONZO,
  [1]: [-4, 4, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [2]: [-8, 8, -2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

export const EXTRA_MONZOS = {
  "septimal:-1": [-6, 2, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "septimal:1": [6, -2, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "17_limit:-1": [7, -7, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  "17_limit:1": [-7, 7, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0],
};

export const HEJI_GLYPH_SEQUENCE = [
  ...BASE_SYMBOLS.map((item) => item.glyph),
  ...EXTRA_MODIFIERS.map((item) => item.glyph),
];

export function parseHejiGlyphInput(text, fallbackBaseId = "natural:0") {
  let baseId = fallbackBaseId;
  const extras = [];
  for (const char of text.replace(/\s+/g, "")) {
    if (BASE_BY_GLYPH[char]) {
      baseId = BASE_BY_GLYPH[char].id;
      continue;
    }
    if (EXTRA_BY_GLYPH[char]) {
      const id = EXTRA_BY_GLYPH[char].id;
      if (!extras.includes(id)) extras.push(id);
    }
  }
  return { baseId, extraIds: extras };
}

export function glyphStringForSelection(baseId, extraIds) {
  const base = BASE_BY_ID[baseId];
  return `${base ? base.glyph : ""}${extraIds.map((id) => EXTRA_BY_ID[id]?.glyph ?? "").join("")}`;
}
