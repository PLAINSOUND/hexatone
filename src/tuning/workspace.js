import { CANONICAL_MONZO_BASIS, intervalResidualToString, parseExactInterval } from "./interval.js";

function harmonicRadiusFromInterval(interval) {
  if (!Array.isArray(interval?.monzo)) return null;
  return (
    0.5 *
    interval.monzo.reduce((sum, exp, index) => {
      const prime = CANONICAL_MONZO_BASIS[index];
      if (prime === 2) return sum;
      return sum + Math.abs(exp) * Math.log2(prime);
    }, 0)
  );
}

function deriveExactRole(interval) {
  return {
    exact: !!interval?.exact,
    ratioText: interval?.ratio ? interval.ratio.toFraction() : null,
    monzo: Array.isArray(interval?.monzo) ? [...interval.monzo] : null,
    primeLimit: interval?.primeLimit ?? null,
    residualText: intervalResidualToString(interval),
  };
}

function deriveSlotAnalysis(interval) {
  return {
    harmonicRadius: harmonicRadiusFromInterval(interval),
    oddLimit: interval?.ratio ? Math.max(oddPart(interval.ratio.n), oddPart(interval.ratio.d)) : null,
    support: interval?.exact
      ? "exact"
      : interval?.kind === "cents"
        ? "cents"
        : interval?.kind === "edo"
          ? "edo"
          : "unknown",
  };
}

function oddPart(n) {
  let x = Math.abs(Number(n));
  if (!Number.isFinite(x) || x === 0) return 0;
  while (x % 2 === 0) x /= 2;
  return x;
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

function cloneWorkspaceSlot(slot) {
  return {
    ...slot,
    interval: cloneInterval(slot.interval),
    committedIdentity: cloneInterval(slot.committedIdentity),
    previewIdentity: cloneInterval(slot.previewIdentity),
    exactRole: {
      ...slot.exactRole,
      monzo: Array.isArray(slot.exactRole?.monzo) ? [...slot.exactRole.monzo] : null,
    },
    analysis: { ...slot.analysis },
  };
}

function buildLookup(slots) {
  return {
    byDegree: new Map(slots.map((slot) => [slot.degree, slot])),
    exactDegrees: slots.filter((slot) => slot.exactRole.exact).map((slot) => slot.degree),
    inexactDegrees: slots.filter((slot) => !slot.exactRole.exact).map((slot) => slot.degree),
  };
}

function rebuildWorkspace(workspace, slots) {
  return {
    ...workspace,
    slots,
    lookup: buildLookup(slots),
  };
}

function buildSlotFromScaleText(text, degree) {
  const sourceText = String(text ?? "").trim();
  const interval = parseExactInterval(sourceText);
  return {
    degree,
    sourceText,
    interval,
    committedIdentity: cloneInterval(interval),
    previewIdentity: null,
    cents: interval?.cents ?? null,
    previewCents: null,
    exactRole: deriveExactRole(interval),
    analysis: deriveSlotAnalysis(interval),
  };
}

function buildDegreeZeroSlot() {
  return buildSlotFromScaleText("1/1", 0);
}

function buildEquaveData(equaveText) {
  const sourceText = String(equaveText ?? "2/1").trim() || "2/1";
  const equaveInterval = parseExactInterval(sourceText);
  return {
    equaveText: sourceText,
    equaveInterval,
    equaveCents: equaveInterval?.cents ?? null,
  };
}

export function workspaceSlotFromText(text, degree, options = {}) {
  if (degree === 0 && options.allowNonUnisonDegreeZero !== true) return buildDegreeZeroSlot();
  return buildSlotFromScaleText(text, degree);
}

export function createScaleWorkspace(settings, options = {}) {
  const rawEntries = Array.isArray(settings?.scale) ? settings.scale.map((entry) => String(entry)) : [];
  const equaveText = rawEntries.length ? rawEntries[rawEntries.length - 1] : options.defaultEquave ?? "2/1";
  const scaleEntries = rawEntries.length ? rawEntries.slice(0, -1) : [];
  const slots = [buildDegreeZeroSlot(), ...scaleEntries.map((text, index) => buildSlotFromScaleText(text, index + 1))];

  return {
    version: 1,
    baseScale: {
      rawEntries,
      referenceDegree: settings?.reference_degree ?? 0,
      fundamentalHz: settings?.fundamental ?? 440,
      ...buildEquaveData(equaveText),
    },
    slots,
    lookup: buildLookup(slots),
    notation: {
      defaultFrame: null,
      cachedByFrameId: new Map(),
    },
    rationalisation: {
      options: options.rationalisationOptions ?? null,
      cachedCandidates: new Map(),
    },
  };
}

export function getWorkspaceSlot(workspace, degree) {
  return workspace?.lookup?.byDegree?.get(degree) ?? null;
}

export function getCommittedInterval(workspace, degree) {
  return getWorkspaceSlot(workspace, degree)?.committedIdentity ?? null;
}

export function getPreviewInterval(workspace, degree) {
  return getWorkspaceSlot(workspace, degree)?.previewIdentity ?? null;
}

export function setWorkspacePreview(workspace, degree, previewInterval, previewCents = null) {
  const slots = workspace.slots.map((slot) => {
    if (slot.degree !== degree) return cloneWorkspaceSlot(slot);
    const next = cloneWorkspaceSlot(slot);
    next.previewIdentity = cloneInterval(previewInterval);
    next.previewCents = previewCents ?? previewInterval?.cents ?? null;
    return next;
  });
  return rebuildWorkspace(workspace, slots);
}

export function clearWorkspacePreview(workspace, degree) {
  const slots = workspace.slots.map((slot) => {
    if (slot.degree !== degree) return cloneWorkspaceSlot(slot);
    const next = cloneWorkspaceSlot(slot);
    next.previewIdentity = null;
    next.previewCents = null;
    return next;
  });
  return rebuildWorkspace(workspace, slots);
}

export function commitWorkspacePreview(workspace, degree) {
  const slots = workspace.slots.map((slot) => {
    const next = cloneWorkspaceSlot(slot);
    if (slot.degree !== degree || !slot.previewIdentity) return next;
    next.interval = cloneInterval(slot.previewIdentity);
    next.committedIdentity = cloneInterval(slot.previewIdentity);
    next.sourceText = slot.previewIdentity?.ratio
      ? slot.previewIdentity.ratio.toFraction()
      : String(slot.previewCents ?? slot.previewIdentity?.cents ?? slot.sourceText);
    next.cents = slot.previewCents ?? slot.previewIdentity?.cents ?? slot.cents;
    next.previewIdentity = null;
    next.previewCents = null;
    next.exactRole = deriveExactRole(next.committedIdentity);
    next.analysis = deriveSlotAnalysis(next.committedIdentity);
    return next;
  });
  return rebuildWorkspace(workspace, slots);
}

export function normalizeWorkspaceForKeys(workspace) {
  const degreeCents = workspace.slots.map((slot) => slot.cents);
  return {
    degreeIntervals: workspace.slots.map((slot) => cloneInterval(slot.committedIdentity)),
    degreeCents,
    equaveInterval: cloneInterval(workspace.baseScale.equaveInterval),
    equaveCents: workspace.baseScale.equaveCents,
    // Back-compat shape for the current Keys/settings pipeline.
    scale: [...degreeCents],
    equivInterval: workspace.baseScale.equaveCents,
    equivSteps: degreeCents.length,
  };
}
