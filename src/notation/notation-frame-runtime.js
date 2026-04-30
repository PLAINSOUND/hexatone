import { spelledHejiLabel } from "./key-label.js";
import { createReferenceFrame } from "./reference-frame.js";
import { getWorkspaceSlot } from "../tuning/workspace.js";
import { parseExactInterval } from "../tuning/interval.js";

// Bridge layer between ScaleWorkspace and live modulation display state.
// It reads committed workspace slots, derives a frame-relative interpretation,
// and returns labels/colors without changing the underlying tuning workspace.

function modulo(value, modulus) {
  if (!modulus) return value;
  return ((value % modulus) + modulus) % modulus;
}

function cloneInterval(interval) {
  if (!interval) return null;
  return {
    ...interval,
    basis: Array.isArray(interval.basis) ? [...interval.basis] : interval.basis,
    monzo: Array.isArray(interval.monzo) ? [...interval.monzo] : interval.monzo,
    residual: interval.residual ?? null,
    edo: interval.edo ? { ...interval.edo } : null,
  };
}

function anchorDataFromWorkspace(workspace, degree) {
  // Frames are anchored in the same degree-0 coordinate system used by
  // ScaleWorkspace slots. Avoid mixing this with reference-degree pitch offsets.
  const slot = getWorkspaceSlot(workspace, degree);
  return {
    slot,
    interval: cloneInterval(slot?.committedIdentity ?? null),
    ratioText: slot?.sourceText?.includes("/")
      ? slot.sourceText
      : slot?.exactRole?.ratioText ?? slot?.sourceText ?? null,
  };
}

function buildFrameId(frame) {
  return [
    frame.strategy,
    frame.anchorDegree,
    frame.anchorRatioText,
    frame.referenceDegree,
    frame.notationSystem,
    frame.notationPolicy ?? "",
    frame.heji.anchorLabel ?? "",
    frame.heji.anchorOctave ?? "",
    frame.generation,
  ].join("|");
}

function buildReferenceFrame(frame) {
  if (frame.notationSystem !== "letter_heji") return null;
  if (!frame.heji.anchorLabel || !frame.anchorRatioText) return null;
  try {
    return createReferenceFrame({
      anchorLabel: frame.heji.anchorLabel,
      anchorRatio: frame.anchorRatioText,
      anchorOctave: frame.heji.anchorOctave ?? 4,
    });
  } catch {
    return null;
  }
}

export function createHarmonicFrame(workspace, options = {}) {
  // A HarmonicFrame is runtime interpretation state. It can change during
  // modulation while the committed workspace and sounding-note substrate remain
  // stable.
  const anchorDegree = options.anchorDegree ?? workspace?.baseScale?.referenceDegree ?? 0;
  const anchorData = anchorDataFromWorkspace(workspace, anchorDegree);
  const frame = {
    id: "",
    generation: options.generation ?? 0,
    strategy: options.strategy ?? "anchor_substitution",
    anchorDegree,
    anchorRatioText: options.anchorRatioText ?? anchorData.ratioText ?? "1/1",
    anchorInterval: options.anchorInterval ?? anchorData.interval,
    referenceDegree: options.referenceDegree ?? workspace?.baseScale?.referenceDegree ?? 0,
    notationSystem: options.notationSystem ?? "letter_heji",
    notationPolicy: options.notationPolicy ?? null,
    equaveCents: options.equaveCents ?? workspace?.baseScale?.equaveCents ?? 1200,
    heji: {
      anchorLabel: options.anchorLabel ?? options.hejiAnchorLabel ?? "A",
      anchorOctave: options.anchorOctave ?? 4,
    },
  };
  frame.referenceFrame = buildReferenceFrame(frame);
  frame.id = buildFrameId(frame);
  return frame;
}

export function mutateHarmonicFrame(frame, mutation = {}) {
  // Re-anchor or adjust display policy without editing any scale slot. This is
  // the operation live modulation should eventually call after deriving a route.
  const workspace = mutation.workspace ?? null;
  const nextAnchorDegree = mutation.anchorDegree ?? frame.anchorDegree;
  const anchorData =
    workspace && (mutation.anchorDegree != null || mutation.rederiveAnchor === true)
      ? anchorDataFromWorkspace(workspace, nextAnchorDegree)
      : { interval: frame.anchorInterval, ratioText: frame.anchorRatioText };
  const next = {
    ...frame,
    generation: mutation.generation ?? frame.generation + 1,
    strategy: mutation.strategy ?? frame.strategy,
    anchorDegree: nextAnchorDegree,
    anchorRatioText: mutation.anchorRatioText ?? anchorData.ratioText ?? frame.anchorRatioText,
    anchorInterval: mutation.anchorInterval ?? anchorData.interval ?? frame.anchorInterval,
    referenceDegree: mutation.referenceDegree ?? frame.referenceDegree,
    notationSystem: mutation.notationSystem ?? frame.notationSystem,
    notationPolicy: mutation.notationPolicy ?? frame.notationPolicy,
    equaveCents: mutation.equaveCents ?? frame.equaveCents,
    heji: {
      anchorLabel: mutation.anchorLabel ?? mutation.hejiAnchorLabel ?? frame.heji.anchorLabel,
      anchorOctave: mutation.anchorOctave ?? frame.heji.anchorOctave,
    },
  };
  next.referenceFrame = buildReferenceFrame(next);
  next.id = buildFrameId(next);
  return next;
}

export function spellSlotForFrame(slot, frame, options = {}) {
  const anchorCents = frame.anchorInterval?.cents ?? 0;
  const centsFromAnchor = modulo((slot?.cents ?? 0) - anchorCents, frame.equaveCents ?? 1200);
  const ratioText = slot?.sourceText?.includes("/")
    ? slot.sourceText
    : slot?.exactRole?.ratioText ?? null;
  let label = null;

  if (frame.notationSystem === "letter_heji" && frame.referenceFrame) {
    label = spelledHejiLabel(frame.referenceFrame, ratioText, centsFromAnchor, {
      notationPolicy: frame.notationPolicy,
      suppressDeviation: options.suppressDeviation ?? true,
      temperedOnly: options.temperedOnly ?? false,
      forceShowZeroDeviation: options.forceShowZeroDeviation ?? false,
    });
  } else if (frame.notationSystem === "none") {
    label = null;
  } else {
    label = slot?.sourceText ?? null;
  }

  return {
    degree: slot?.degree ?? null,
    label,
    ratioText,
    exact: !!slot?.exactRole?.exact,
    centsFromAnchor,
  };
}

export function spellWorkspaceForFrame(workspace, frame, options = {}) {
  // Derive a complete display snapshot from committed workspace + current frame.
  // Keys can consume this as interpreted label state without being reconstructed.
  const entries = (workspace?.slots ?? []).map((slot) => spellSlotForFrame(slot, frame, options));
  return {
    frame,
    entries,
    labelsByDegree: entries.map((entry) => entry.label),
  };
}

function trimRenderedLabelToPitchClass(label) {
  const source = String(label ?? "").trim();
  if (!source) return null;
  const match = source.match(/^(.+?[A-Ga-g])(?:[+\-\u2212]\d+)?$/);
  return match?.[1] ?? source;
}

function normalizeDegree(value) {
  return Number.isFinite(value) ? Math.trunc(value) : Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : null;
}

function formatRatioFraction(ratio) {
  if (!ratio?.toFraction) return null;
  const text = ratio.toFraction();
  return text.includes("/") ? text : `${text}/1`;
}

export function deriveCurrentFundamentalForHistory(workspace, history = [], options = {}) {
  const entries = Array.isArray(history) ? history : [];
  let cents = 0;
  let ratio = parseExactInterval("1/1").ratio;
  let ratioSupported = true;

  for (const entry of entries) {
    const count = Number.isFinite(entry?.count) ? Math.trunc(entry.count) : 0;
    if (count === 0) continue;

    const sourceDegree = normalizeDegree(entry?.sourceDegree);
    const targetDegree = normalizeDegree(entry?.targetDegree);
    const sourceSlot = getWorkspaceSlot(workspace, sourceDegree);
    const targetSlot = getWorkspaceSlot(workspace, targetDegree);
    const sourceCents = sourceSlot?.cents ?? 0;
    const targetCents = targetSlot?.cents ?? 0;
    cents += count * (sourceCents - targetCents);

    if (!ratioSupported) continue;
    const sourceRatio = sourceSlot?.committedIdentity?.ratio ?? null;
    const targetRatio = targetSlot?.committedIdentity?.ratio ?? null;
    if (!sourceRatio || !targetRatio) {
      ratioSupported = false;
      ratio = null;
      continue;
    }

    const forward = sourceRatio.div(targetRatio);
    const magnitude = Math.abs(count);
    const factor = forward.pow(magnitude);
    ratio = count > 0 ? ratio.mul(factor) : ratio.div(factor);
  }

  const baseFundamental = Number(options.fundamental ?? workspace?.baseScale?.fundamentalHz ?? 0);
  const fundamentalHz = Number.isFinite(baseFundamental)
    ? baseFundamental * Math.pow(2, cents / 1200)
    : null;

  return {
    cents,
    ratio,
    ratioText: ratioSupported ? formatRatioFraction(ratio) : null,
    exact: ratioSupported,
    fundamentalHz,
  };
}

export function replayModulationHistoryForFrame(workspace, baseFrame, history = [], options = {}) {
  let frame = baseFrame;
  const entries = Array.isArray(history) ? history : [];

  for (const entry of entries) {
    const count = Number.isFinite(entry?.count) ? Math.trunc(entry.count) : 0;
    if (count === 0) continue;
    const stepCount = Math.abs(count);

    for (let step = 0; step < stepCount; step += 1) {
      const spelled = spellWorkspaceForFrame(workspace, frame, options);
      const sourceDegree = normalizeDegree(count > 0 ? entry?.sourceDegree : entry?.targetDegree);
      const targetDegree = normalizeDegree(count > 0 ? entry?.targetDegree : entry?.sourceDegree);
      if (sourceDegree == null || targetDegree == null) continue;
      const targetSlot = getWorkspaceSlot(workspace, targetDegree);
      const sourceLabel = spelled.entries.find((item) => item.degree === sourceDegree)?.label;
      const movedLabel =
        trimRenderedLabelToPitchClass(sourceLabel) ??
        frame.heji.anchorLabel;
      const targetRatioText =
        targetSlot?.sourceText?.includes("/")
          ? targetSlot.sourceText
          : targetSlot?.exactRole?.ratioText ?? targetSlot?.sourceText ?? frame.anchorRatioText;

      frame = mutateHarmonicFrame(frame, {
        workspace,
        anchorDegree: targetDegree,
        anchorLabel: movedLabel,
        anchorRatioText: targetRatioText,
        anchorInterval: parseExactInterval(String(targetRatioText)),
        rederiveAnchor: false,
      });
    }
  }

  return frame;
}

export function deriveDegreeColorsForFrame(workspace, frame, options = {}) {
  const degreeCount = workspace?.slots?.length ?? 0;
  const baseColors = Array.isArray(options.baseColors) ? options.baseColors : [];
  if (!baseColors.length) return Array.from({ length: degreeCount }, () => null);
  return Array.from({ length: degreeCount }, (_, degree) => {
    const sourceIndex = modulo(degree - frame.anchorDegree, baseColors.length);
    return baseColors[sourceIndex] ?? null;
  });
}
