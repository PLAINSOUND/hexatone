import { createScaleWorkspace } from "../../tuning/workspace.js";
import {
  DEFAULT_PRIME_FAMILY_COLORS,
  getPrimeFamilyColorMap,
  monzoToSuggestedColor,
} from "./monzo-color.js";
import { srgb_to_okhsl } from "./okhsl.js";

export const AUTO_TONIC_COLOR_SOFT = "#ffdbdb";
export const AUTO_TONIC_COLOR_STRONG = "#ff7a7a";
export const AUTO_TONIC_COLOR_ROSE_HEAVY = "#ffa3a3";

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
  const normalized = String(hex ?? "").trim().replace(/^#/, "");
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

function mixHex(a, b, t) {
  const ar = hexToRgb(a);
  const br = hexToRgb(b);
  if (!ar || !br) return a;
  const x = clamp01(t);
  return rgbToHex(ar.map((channel, index) => channel * (1 - x) + br[index] * x));
}

export function deriveAutoTonicColorFromPalette(colors = []) {
  return deriveAutoTonicColorFromPaletteWithPrime(colors, DEFAULT_PRIME_FAMILY_COLORS[1]);
}

export function deriveAutoTonicColorFromPaletteWithPrime(colors = [], intenseTonicColor = DEFAULT_PRIME_FAMILY_COLORS[1]) {
  const strongTonic = intenseTonicColor || DEFAULT_PRIME_FAMILY_COLORS[1];
  const useDefaultTonicPoles = strongTonic.toLowerCase() === DEFAULT_PRIME_FAMILY_COLORS[1];
  const softTonic = useDefaultTonicPoles ? AUTO_TONIC_COLOR_SOFT : mixHex("#ffffff", strongTonic, 0.28);
  const roseHeavyTonic = useDefaultTonicPoles ? AUTO_TONIC_COLOR_ROSE_HEAVY : mixHex(strongTonic, "#ffffff", 0.34);
  const samples = colors
    .map((color) => hexToRgb(color))
    .filter(Boolean)
    .map(([r, g, b]) => {
      const [h, s, l] = srgb_to_okhsl(r, g, b);
      return {
        hue: h,
        vividness: s * Math.max(0, 1 - l),
        vivid: s > 0.35 && l < 0.9 ? 1 : 0,
        rose: (h < 0.18 || h > 0.9) && s > 0.2 ? 1 : 0,
        paleRose: (h < 0.18 || h > 0.9) && s > 0.2 && l > 0.84 ? 1 : 0,
      };
    });

  if (!samples.length) return softTonic;

  const averageVividness = samples.reduce((sum, sample) => sum + sample.vividness, 0) / samples.length;
  const vividRatio = samples.reduce((sum, sample) => sum + sample.vivid, 0) / samples.length;
  const roseRatio = samples.reduce((sum, sample) => sum + sample.rose, 0) / samples.length;
  const paleRoseRatio = samples.reduce((sum, sample) => sum + sample.paleRose, 0) / samples.length;
  const vividSamples = samples.filter((sample) => sample.vivid);
  const vividHueDiversity = vividSamples.length
    ? new Set(vividSamples.map((sample) => Math.floor(sample.hue * 6) % 6)).size / 6
    : 0;
  const intensity = clamp01(
    ((averageVividness - 0.03) / 0.12) * 0.45
      + (vividRatio * 0.35)
      + (vividHueDiversity * 0.28),
  );
  let base = mixHex(softTonic, strongTonic, intensity);
  const paleRoseBoost = clamp01((paleRoseRatio - 0.05) / 0.12);
  base = mixHex(base, strongTonic, paleRoseBoost * 0.52);
  const roseBoost = clamp01((roseRatio - 0.3) / 0.45);
  return mixHex(base, roseHeavyTonic, roseBoost);
}

export function getAutoColorOptions(settings) {
  const short = String(settings?.short_description ?? "");
  const text = [settings?.name, settings?.short_description]
    .filter(Boolean)
    .join(" ");
  if (/Hamilton/i.test(text)) return { structuralOverlay: "fifths" };
  if (/(Odd Partial|OddPartials|OddPart)/i.test(text)) return { structuralOverlay: "none" };
  if (/^(\d+-)?HS([_-]|$)|^(\d+-)?HSS([_-]|$)|^(\d+-)?SHS([_-]|$)|Partials|partial row/i.test(short)
    || /Partials|partial row/i.test(String(settings?.name ?? ""))) {
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

export function inferNotationRole(label) {
  const source = String(label ?? "").trim();
  if (!source) return null;
  if (/\*n|||/.test(source)) return "diatonic";
  if (/[]/.test(source)) return "chromatic";
  return null;
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
  const colorMonzoOffset = Array.isArray(options.colorMonzoOffset) ? options.colorMonzoOffset : null;
  if (!centerMonzo && !colorMonzoOffset) return monzo;
  return basis.map(
    (_, index) => (monzo[index] ?? 0) - (centerMonzo?.[index] ?? 0) - (colorMonzoOffset?.[index] ?? 0),
  );
}

function getChainThreeExponent(monzo, options = {}) {
  const absoluteThree = monzo?.[1] ?? 0;
  if (Array.isArray(options.centerMonzo)) return absoluteThree - (options.centerMonzo[1] ?? 0);
  if (
    Number.isFinite(options.centerAbsoluteFifthSteps)
    && options.centerAbsoluteFifthSteps !== 2
  ) {
    return absoluteThree - options.centerAbsoluteFifthSteps;
  }
  return absoluteThree;
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
        const candidateMonzo = getAnalysisMonzo(candidate?.committedIdentity?.monzo, candidateBasis, autoColorOptions);
        if (!isPurePrimeLimitMonzo(candidateMonzo, candidateBasis, prime)) return null;
        if ((candidateMonzo[primeIndex] ?? 0) !== targetExponent) return null;
        return {
          degree: candidateDegree,
          threeExponent: getChainThreeExponent(candidateMonzo, autoColorOptions),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.threeExponent - b.threeExponent || a.degree - b.degree);

    const chainIndex = entries.findIndex((entry) => entry.degree === degreeIndex);
    if (chainIndex < 0) return null;

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

export function inferCenterMonzoCandidate(workspace, labels = []) {
  const candidates = [];
  for (let degree = 0; degree < workspace.slots.length; degree += 1) {
    const pitchInfo = extractPitchClassInfo(labels[degree]);
    if (pitchInfo.pitchClass !== "D") continue;
    const monzo = workspace.slots[degree]?.exactRole?.monzo;
    if (!Array.isArray(monzo)) continue;
    const absoluteFifthSteps = monzo[1] ?? 0;
    const nonThreeComplexity = monzo.reduce((sum, exp, index) => {
      if (index === 0 || index === 1) return sum;
      return sum + Math.abs(exp ?? 0);
    }, 0);
    const accidentalWeight = pitchInfo.modifierWeight;
    const plainnessWeight = accidentalWeight === 0 ? 0 : 1;
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
  const naturalCandidates = candidates.filter((candidate) => candidate.plainnessWeight === 0);
  if (!naturalCandidates.length) return null;
  naturalCandidates.sort((a, b) =>
    a.pureThreeWeight - b.pureThreeWeight
    || a.plainnessWeight - b.plainnessWeight
    || a.distanceFromDefault - b.distanceFromDefault
    || a.nonThreeComplexity - b.nonThreeComplexity
    || a.accidentalWeight - b.accidentalWeight
    || a.absoluteFifthSteps - b.absoluteFifthSteps);
  return naturalCandidates[0] ?? null;
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
      if (!stats[prime]) stats[prime] = { hasPositive: false, hasNegative: false };
      if (exponent > 0) stats[prime].hasPositive = true;
      if (exponent < 0) stats[prime].hasNegative = true;
    }
  }
  const byPrime = {};
  for (const [primeText, primeStats] of Object.entries(stats)) {
    const prime = Number(primeText);
    byPrime[prime] = prime === 5 ? true : (primeStats.hasPositive && primeStats.hasNegative);
  }
  return byPrime;
}

export function inferColorMonzoOffset(workspace) {
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

export function buildResolvedAutoColorOptions(settings, workspace, labelSourcesConfig) {
  const base = getAutoColorOptions(settings);
  const chromaticOverlayPrimes = inferChromaticOverlayPrimes(workspace);
  const colorMonzoOffset = inferColorMonzoOffset(workspace);
  const primeFamilyColorMap = getPrimeFamilyColorMap(settings?.prime_family_colors);
  for (const labels of getCenterLabelSources(labelSourcesConfig)) {
    if (!labels?.length) continue;
    const centerCandidate = inferCenterMonzoCandidate(workspace, labels);
    if (centerCandidate?.monzo) {
      return {
        ...base,
        centerMonzo: centerCandidate.nonThreeComplexity > 0 ? centerCandidate.monzo : undefined,
        centerAbsoluteFifthSteps: centerCandidate.absoluteFifthSteps,
        chromaticOverlayPrimes,
        colorMonzoOffset,
        primeFamilyColorMap,
      };
    }
  }
  return { ...base, chromaticOverlayPrimes, colorMonzoOffset, primeFamilyColorMap };
}

export function deriveAutoNoteColors(settings, extra = {}) {
  const workspace = extra.workspace ?? createScaleWorkspace(settings);
  const autoColorOptions = buildResolvedAutoColorOptions(settings, workspace, {
    keyLabels: settings?.key_labels,
    noteNames: settings?.note_names,
    hejiTableNames: extra.heji_names_table ?? extra.hejiNamesTable ?? settings?.heji_names_table,
    hejiNames: extra.heji_names ?? extra.hejiNames ?? settings?.heji_names,
  });
  const noteNames = Array.isArray(settings?.note_names) ? settings.note_names : [];
  const hejiNames = Array.isArray(extra.heji_names_table ?? extra.heji_names ?? settings?.heji_names_table ?? settings?.heji_names)
    ? (extra.heji_names_table ?? extra.heji_names ?? settings?.heji_names_table ?? settings?.heji_names)
    : [];
  const storedColors = Array.isArray(settings?.note_colors) ? settings.note_colors : [];
  const primeFamilyColorMap = autoColorOptions.primeFamilyColorMap ?? getPrimeFamilyColorMap(settings?.prime_family_colors);
  const useHeji = settings?.key_labels === "heji";
  const derivedColors = workspace.slots.map((slot, degreeIndex) => {
    if (degreeIndex === 0) return null;
    const interval = slot?.committedIdentity;
    const fallbackColor = storedColors[degreeIndex] ?? "#ffffff";
    if (!Array.isArray(interval?.monzo)) return fallbackColor;
    const label = (useHeji ? hejiNames[degreeIndex] : noteNames[degreeIndex]) ?? "";
    return monzoToSuggestedColor(interval.monzo, undefined, {
      ...autoColorOptions,
      notationRole: inferNotationRole(label),
      chainRole: inferPrimeChainRole(workspace, degreeIndex, autoColorOptions),
    })?.screenHex ?? fallbackColor;
  });
  derivedColors[0] = deriveAutoTonicColorFromPaletteWithPrime(derivedColors.slice(1), primeFamilyColorMap[1]);
  return derivedColors;
}
