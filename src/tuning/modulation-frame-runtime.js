// Pure modulation/frame derivation entrypoint.
//
// This module centralizes the derived runtime helpers that sit between
// committed tuning (`ScaleWorkspace`) and live modulation consumers.
// It does not own gesture/history state transitions and it does not own
// keyboard/audio side effects; those remain in modulation-runtime and Keys.

import { parseExactInterval } from "./interval.js";
import {
  createHarmonicFrame,
  mutateHarmonicFrame,
  spellSlotForFrame,
  spellWorkspaceForFrame,
  spellDegreeForFrame,
  deriveDegreeColorsForFrame,
  deriveCurrentFundamentalForHistory,
  replayModulationHistoryForFrame,
} from "../notation/notation-frame-runtime.js";

export {
  createKeysFrame,
  deriveFrameForHistory,
  deriveFrameForHistoryIndex,
} from "../keyboard/keys-frame-runtime.js";

export {
  normalizeGeometryDelta,
  geometryDeltaFromCoords,
  deriveGeometryShiftForHistory,
  applyGeometryShiftToCoords,
} from "./modulation-geometry-runtime.js";

export {
  createHarmonicFrame,
  mutateHarmonicFrame,
  spellSlotForFrame,
  spellWorkspaceForFrame,
  spellDegreeForFrame,
  deriveDegreeColorsForFrame,
  deriveCurrentFundamentalForHistory,
  replayModulationHistoryForFrame,
};

function formatSignedWholeCents(value) {
  if (!Number.isFinite(value)) return "0¢";
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${Math.abs(rounded)}¢`;
}

export function routeTranspositionDeltaCents(entry) {
  const storedDelta = Number(entry?.transpositionDeltaCents);
  if (Number.isFinite(storedDelta)) return storedDelta;
  if (typeof entry?.transpositionRatioText !== "string") return null;
  const parsed = parseExactInterval(entry.transpositionRatioText.trim());
  return Number.isFinite(parsed?.cents) ? parsed.cents : null;
}

function ratioAdjustedToCentsText(ratio, ratioCents, deltaCents, tuningWorkspace) {
  const equaveRatio = tuningWorkspace?.baseScale?.equaveInterval?.ratio ?? null;
  const equaveCents = tuningWorkspace?.baseScale?.equaveCents ?? 1200;
  if (
    !ratio ||
    !equaveRatio ||
    !Number.isFinite(ratioCents) ||
    !Number.isFinite(deltaCents) ||
    !Number.isFinite(equaveCents) ||
    Math.abs(equaveCents) < 0.000001
  ) {
    return ratio?.toFraction ? ratio.toFraction() : null;
  }
  const equavePower = Math.round((deltaCents - ratioCents) / equaveCents);
  const displaced = equavePower > 0
    ? ratio.mul(equaveRatio.pow(equavePower))
    : equavePower < 0
      ? ratio.div(equaveRatio.pow(Math.abs(equavePower)))
      : ratio;
  const text = displaced?.toFraction ? displaced.toFraction() : null;
  return text && !text.includes("/") ? `${text}/1` : text;
}

export function routeTranspositionRatioText(entry, tuningWorkspace) {
  if (typeof entry?.transpositionRatioText === "string" && entry.transpositionRatioText.trim()) {
    return entry.transpositionRatioText.trim();
  }
  const deltaCents = routeTranspositionDeltaCents(entry);
  const sourceSlot = tuningWorkspace?.lookup?.byDegree?.get(entry?.sourceDegree);
  const targetSlot = tuningWorkspace?.lookup?.byDegree?.get(entry?.targetDegree);
  const sourceRatio = sourceSlot?.committedIdentity?.ratio ?? null;
  const targetRatio = targetSlot?.committedIdentity?.ratio ?? null;
  const sourceCents = sourceSlot?.committedIdentity?.cents ?? sourceSlot?.cents ?? null;
  const targetCents = targetSlot?.committedIdentity?.cents ?? targetSlot?.cents ?? null;
  if (!sourceRatio || !targetRatio) return null;
  const ratio = sourceRatio.div(targetRatio);
  const ratioCents =
    Number.isFinite(sourceCents) && Number.isFinite(targetCents)
      ? sourceCents - targetCents
      : null;
  return ratioAdjustedToCentsText(ratio, ratioCents, deltaCents, tuningWorkspace);
}

function formatMonzoTextFromRatioText(ratioText) {
  if (typeof ratioText !== "string" || !ratioText.trim()) return null;
  const parsed = parseExactInterval(ratioText.trim());
  if (!Array.isArray(parsed?.monzo)) return null;
  const monzo = [...parsed.monzo];
  while (monzo.length > 1 && monzo[monzo.length - 1] === 0) monzo.pop();
  return `[${monzo.join(" ")}>`;
}

function formatEquaveOffset(offset) {
  if (!Number.isFinite(offset) || offset === 0) return "";
  return `[${offset > 0 ? "+" : ""}${offset}eq]`;
}

export function modulationRouteEquaveOffset(entry, tuningWorkspace) {
  const transpositionDeltaCents = routeTranspositionDeltaCents(entry);
  const sourceSlot = tuningWorkspace?.lookup?.byDegree?.get(entry?.sourceDegree);
  const targetSlot = tuningWorkspace?.lookup?.byDegree?.get(entry?.targetDegree);
  const equaveCents = tuningWorkspace?.baseScale?.equaveCents ?? 1200;
  if (
    !Number.isFinite(transpositionDeltaCents) ||
    !Number.isFinite(sourceSlot?.cents) ||
    !Number.isFinite(targetSlot?.cents) ||
    !Number.isFinite(equaveCents) ||
    Math.abs(equaveCents) < 0.000001
  ) {
    return 0;
  }

  const reducedDeltaCents = sourceSlot.cents - targetSlot.cents;
  return Math.round((reducedDeltaCents - transpositionDeltaCents) / equaveCents);
}

export function modulationCurrentSummaryDisplay(summary) {
  if (!summary) return "";
  const centsText = formatSignedWholeCents(summary.cents);
  const monzoText = formatMonzoTextFromRatioText(summary.ratioText);
  if (!monzoText) return centsText;
  return `${monzoText} (${centsText})`;
}

export function modulationEntryDisplayText(entry, tuningWorkspace) {
  return modulationCurrentSummaryDisplay({
    ratioText: routeTranspositionRatioText(entry, tuningWorkspace),
    cents: routeTranspositionDeltaCents(entry),
  });
}

export function getActiveModulationHistory(history = []) {
  if (!Array.isArray(history)) return [];
  return history.filter((entry) => {
    const count = Number.isFinite(entry?.count) ? Math.trunc(entry.count) : 0;
    return count !== 0;
  });
}

export function hasActiveModulationHistory(history = []) {
  return getActiveModulationHistory(history).length > 0;
}

export function modulationHistoryKey(history = []) {
  if (!Array.isArray(history) || history.length === 0) return "";
  return history
    .map((entry) => [
      entry?.sourceDegree ?? "",
      entry?.targetDegree ?? "",
      entry?.strategy ?? "",
      Number.isFinite(entry?.count) ? Math.trunc(entry.count) : 0,
      Number.isFinite(Number(entry?.transpositionDeltaCents))
        ? Number(entry.transpositionDeltaCents)
        : "",
      entry?.transpositionRatioText ?? "",
      Number.isFinite(Number(entry?.deltaRSteps)) ? Math.trunc(entry.deltaRSteps) : "",
      Number.isFinite(Number(entry?.deltaDrSteps)) ? Math.trunc(entry.deltaDrSteps) : "",
    ].join(":"))
    .join("|");
}

export function deriveCurrentFundamentalSummary(workspace, history = [], options = {}) {
  if (!workspace) return null;
  const summary = deriveCurrentFundamentalForHistory(workspace, history, options);
  return {
    ...summary,
    display: modulationCurrentSummaryDisplay(summary),
  };
}

export function deriveActiveHejiFrame(workspace, history = [], options = {}) {
  if (
    !workspace ||
    !hasActiveModulationHistory(history) ||
    !options.hejiEnabled ||
    options.hejiSupported === false ||
    !options.anchorLabel
  ) {
    return null;
  }

  const baseFrame = createHarmonicFrame(workspace, {
    anchorDegree: options.referenceDegree ?? workspace?.baseScale?.referenceDegree ?? 0,
    anchorLabel: options.anchorLabel,
    anchorRatioText: options.anchorRatioText,
    anchorInterval: parseExactInterval(String(options.anchorRatioText || "1/1")),
    referenceDegree: options.referenceDegree ?? workspace?.baseScale?.referenceDegree ?? 0,
    strategy: "anchor_substitution",
    generation: 0,
  });

  return replayModulationHistoryForFrame(workspace, baseFrame, history, {
    suppressDeviation: true,
    temperedOnly: options.temperedOnly === true,
    forceShowZeroDeviation: false,
  });
}

export function deriveHejiLabelsForFrame(workspace, frame, options = {}) {
  if (!workspace || !frame) return null;
  return spellWorkspaceForFrame(workspace, frame, {
    suppressDeviation: options.suppressDeviation ?? true,
    temperedOnly: options.temperedOnly === true,
    forceShowZeroDeviation: options.forceShowZeroDeviation === true,
  }).labelsByDegree;
}

export function modulationRouteLabelPair(entry, degreeLabel, tuningWorkspace) {
  const sourceLabel = degreeLabel(entry?.sourceDegree);
  const fallbackTargetLabel = degreeLabel(entry?.targetDegree);
  const equaveOffset = modulationRouteEquaveOffset(entry, tuningWorkspace);

  return {
    sourceLabel,
    targetLabel: `${fallbackTargetLabel}${formatEquaveOffset(equaveOffset)}`,
  };
}
