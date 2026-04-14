import {
  BASE_BY_ID,
  CHROMATIC_MONZOS,
  EXTRA_MONZOS,
  PRIME_COUNT,
  SYNTONIC_BY_AMOUNT,
} from "./heji-subset.js";

const AUTO_OFFSET_TO_A = [4, -3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const NATURALS_FROM_C_REF = {
  F: [2, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  C: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  G: [-1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  D: [-3, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  A: [-4, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  E: [-6, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  B: [-7, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

const DEFAULT_SPELLINGS_G_MINOR = {
  0: { letter: "C", chromatic: "natural" },
  1: { letter: "C", chromatic: "sharp" },
  2: { letter: "D", chromatic: "natural" },
  3: { letter: "E", chromatic: "flat" },
  4: { letter: "E", chromatic: "natural" },
  5: { letter: "F", chromatic: "natural" },
  6: { letter: "F", chromatic: "sharp" },
  7: { letter: "G", chromatic: "natural" },
  8: { letter: "A", chromatic: "flat" },
  9: { letter: "A", chromatic: "natural" },
  10: { letter: "B", chromatic: "flat" },
  11: { letter: "B", chromatic: "natural" },
};

export function addMonzos(...vectors) {
  const result = new Array(PRIME_COUNT).fill(0);
  for (const vector of vectors) {
    if (!vector) continue;
    for (let i = 0; i < PRIME_COUNT; i += 1) {
      result[i] += vector[i] ?? 0;
    }
  }
  return result;
}

export function ratioFromMonzo(monzo) {
  let numerator = 1n;
  let denominator = 1n;
  const primes = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n];
  monzo.forEach((power, index) => {
    const prime = primes[index];
    if (!prime || power === 0) return;
    const amount = BigInt(Math.abs(power));
    const factor = prime ** amount;
    if (power > 0) numerator *= factor;
    else denominator *= factor;
  });
  return [numerator.toString(), denominator.toString()];
}

export function centsFromMonzo(monzo) {
  const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47];
  return monzo.reduce((sum, power, index) => sum + power * 1200 * Math.log2(primes[index]), 0);
}

export function naturalBaseMonzo(letter, octave) {
  const natural = NATURALS_FROM_C_REF[letter];
  if (!natural) return null;
  const octaveShift = [octave - 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  return addMonzos(natural, AUTO_OFFSET_TO_A, octaveShift);
}

export function pythagoreanMonzoForSpelling(letter, octave, baseId) {
  const base = BASE_BY_ID[baseId] ?? BASE_BY_ID["natural:0"];
  return addMonzos(naturalBaseMonzo(letter, octave), CHROMATIC_MONZOS[base.chromatic]);
}

export function hejiDeltaMonzoForSelection(baseId, extraIds = []) {
  const base = BASE_BY_ID[baseId] ?? BASE_BY_ID["natural:0"];
  const extras = extraIds.map((id) => EXTRA_MONZOS[id]).filter(Boolean);
  return addMonzos(SYNTONIC_BY_AMOUNT[base.syntonic] ?? SYNTONIC_BY_AMOUNT[0], ...extras);
}

export function fullMonzoForSelection(letter, octave, baseId, extraIds = []) {
  const pyth = pythagoreanMonzoForSpelling(letter, octave, baseId);
  const heji = hejiDeltaMonzoForSelection(baseId, extraIds);
  return {
    pythagoreanMonzo: pyth,
    hejiDeltaMonzo: heji,
    fullMonzo: addMonzos(pyth, heji),
  };
}

export function midiToScientificOctave(midiNote) {
  return Math.floor(midiNote / 12) - 1;
}

export function guessSpellingFromMidi(midiNote) {
  const pitchClass = midiNote % 12;
  const octave = midiToScientificOctave(midiNote);
  const guess = DEFAULT_SPELLINGS_G_MINOR[pitchClass];
  const baseId = `${guess.chromatic}:0`;
  return {
    letter: guess.letter,
    octave,
    baseId,
    guessSource: "g_minor_default_map",
  };
}

export function spellingLabel(letter, octave, baseId, extraIds = []) {
  const base = BASE_BY_ID[baseId] ?? BASE_BY_ID["natural:0"];
  const accidental = base.chromatic === "flat" ? "b" : base.chromatic === "sharp" ? "#" : "";
  const extras = extraIds.join(",");
  return `${letter}${accidental}${octave}${extras ? ` [${extras}]` : ""}`;
}

export function staffStepIndex(letter, octave) {
  const order = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  return octave * 7 + order[letter];
}
