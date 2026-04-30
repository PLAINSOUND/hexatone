export function createKeysFrame(options = {}) {
  return {
    id: options.id ?? "",
    anchorDegree: options.degree ?? 0,
    referenceDegree: options.referenceDegree ?? 0,
    strategy: options.strategy ?? "retune_surface_to_source",
    sourceDegree: options.sourceDegree ?? null,
    targetDegree: options.targetDegree ?? null,
    transpositionSteps: options.transpositionSteps ?? 0,
    transpositionCents: options.transpositionCents ?? 0,
    effectiveFundamental: options.effectiveFundamental ?? options.fundamental ?? 440,
  };
}

function routeTranspositionDeltaCents(route, scale = []) {
  const storedDelta = Number(route?.transpositionDeltaCents);
  if (Number.isFinite(storedDelta)) return storedDelta;
  return (scale?.[route?.sourceDegree] ?? 0) - (scale?.[route?.targetDegree] ?? 0);
}

export function deriveFrameForHistory(options = {}) {
  const history = Array.isArray(options.history) ? options.history : [];
  const referenceDegree = options.referenceDegree ?? 0;
  const strategy = options.strategy ?? "retune_surface_to_source";
  const fundamental = options.fundamental ?? 440;
  const scale = Array.isArray(options.scale) ? options.scale : [];
  const makeFrame = options.makeFrame ?? ((degree, extra = {}) => createKeysFrame({
    degree,
    referenceDegree,
    fundamental,
    strategy,
    ...extra,
  }));

  if (!history.length) {
    return makeFrame(referenceDegree, {
      strategy,
      sourceDegree: null,
      targetDegree: null,
      transpositionSteps: 0,
      transpositionCents: 0,
      effectiveFundamental: fundamental,
    });
  }

  const activeRoutes = history.filter((route) => {
    const count = Number.isFinite(route?.count) ? Math.trunc(route.count) : 0;
    return count !== 0;
  });
  const transpositionCents = activeRoutes.reduce((sum, route) => {
    const count = Number.isFinite(route?.count) ? Math.trunc(route.count) : 0;
    return sum + count * routeTranspositionDeltaCents(route, scale);
  }, 0);
  const effectiveFundamental = fundamental * Math.pow(2, transpositionCents / 1200);
  const route = activeRoutes[activeRoutes.length - 1] ?? null;

  return makeFrame(route?.targetDegree ?? referenceDegree, {
    strategy,
    sourceDegree: route?.sourceDegree ?? null,
    targetDegree: route?.targetDegree ?? null,
    transpositionSteps: 0,
    transpositionCents,
    effectiveFundamental,
  });
}

export function deriveFrameForHistoryIndex(options = {}) {
  const history = Array.isArray(options.history)
    ? options.history.map((entry) => ({ ...entry }))
    : [];
  if (history.length > 0) {
    history[history.length - 1].count = Number.isFinite(options.historyIndex)
      ? Math.trunc(options.historyIndex)
      : 0;
  }
  return deriveFrameForHistory({
    ...options,
    history,
  });
}
