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

function trimMonzo(monzo) {
  if (!Array.isArray(monzo)) return null;
  const out = [...monzo];
  while (out.length > 1 && out[out.length - 1] === 0) out.pop();
  return out;
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

export function snapshotModulationState(state) {
  if (!state) return null;
  return {
    mode: state.mode ?? "idle",
    sourceDegree: state.sourceDegree ?? null,
    targetDegree: state.targetDegree ?? null,
    strategy: state.strategy ?? "retune_surface_to_source",
    geometryMode: state.geometryMode ?? "moveable_surface",
    history: Array.isArray(state.history) ? state.history.map((entry) => ({ ...entry })) : [],
    currentRoute: state.currentRoute ? { ...state.currentRoute } : null,
    historyIndex: state.historyIndex ?? 0,
    lastDecision: state.lastDecision ? { ...state.lastDecision } : null,
  };
}

export function presetModulationSnapshot(history = []) {
  return snapshotModulationState({
    mode: "idle",
    history,
    currentRoute: null,
    historyIndex: 0,
    homeFrame: null,
    currentFrame: null,
    oldFrame: null,
    pendingFrame: null,
    sourceHex: null,
    sourceCoordsKey: null,
    sourceDegree: null,
    targetDegree: null,
    strategy: "retune_surface_to_source",
    geometryMode: "moveable_surface",
    takeoverConsumed: false,
    lastDecision: {
      type: "preset_modulation_library_loaded",
    },
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

export function deriveModulationIdentityForHistory(history = []) {
  const activeHistory = getActiveModulationHistory(history);
  if (activeHistory.length === 0) {
    return {
      cents: 0,
      ratioText: null,
      monzo: null,
    };
  }

  let cents = 0;
  let ratio = parseExactInterval("1/1").ratio;
  let monzo = [];
  let exact = true;

  for (const entry of activeHistory) {
    const count = Number.isFinite(entry?.count) ? Math.trunc(entry.count) : 0;
    if (count === 0) continue;
    const deltaCents = routeTranspositionDeltaCents(entry);
    if (Number.isFinite(deltaCents)) cents += count * deltaCents;

    const ratioText = routeTranspositionRatioText(entry, null);
    const parsed = ratioText ? parseExactInterval(ratioText) : null;
    if (!parsed?.ratio || !Array.isArray(parsed?.monzo)) {
      exact = false;
      continue;
    }

    const power = Math.abs(count);
    ratio = count > 0 ? ratio.mul(parsed.ratio.pow(power)) : ratio.div(parsed.ratio.pow(power));
    if (monzo.length < parsed.monzo.length) monzo.length = parsed.monzo.length;
    for (let index = 0; index < parsed.monzo.length; index += 1) {
      monzo[index] = (monzo[index] ?? 0) + count * (parsed.monzo[index] ?? 0);
    }
  }

  if (!exact) {
    return {
      cents,
      ratioText: null,
      monzo: null,
    };
  }

  const ratioText = ratio?.toFraction ? ratio.toFraction() : null;
  return {
    cents,
    ratioText: ratioText && !ratioText.includes("/") ? `${ratioText}/1` : ratioText,
    monzo: trimMonzo(monzo),
  };
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

export function deriveModulationSummaryText(modulationState, degreeLabel, tuningWorkspace) {
  if (!modulationState) return "";
  if (modulationState.mode === "idle") return "";
  if (modulationState.mode === "awaiting_target" && modulationState.sourceDegree == null) {
    return "";
  }
  const route =
    modulationState.mode === "awaiting_target"
      ? {
        sourceDegree: modulationState.sourceDegree,
        targetDegree: null,
      }
      : modulationState.currentRoute ?? null;
  if (!route) return "";
  const { sourceLabel: sourceText, targetLabel } = modulationRouteLabelPair(
    route,
    degreeLabel,
    tuningWorkspace,
  );
  if (route.targetDegree == null) return `${sourceText} →`;
  return `${sourceText} → ${targetLabel}`;
}

export function deriveModulationPaletteTitles(history = [], degreeLabel, tuningWorkspace) {
  if (!Array.isArray(history)) return [];
  return history.map((entry) => {
    const { sourceLabel, targetLabel } = modulationRouteLabelPair(
      entry,
      degreeLabel,
      tuningWorkspace,
    );
    return `${sourceLabel} ↔ ${targetLabel}`;
  });
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
