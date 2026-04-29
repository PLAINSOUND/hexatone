// This module owns the modulation gesture/history state machine only.
// It does not derive tuning from settings.scale and does not mutate the
// committed ScaleWorkspace. Callers supply frame objects derived from the
// current workspace/tuning runtime, keeping modulation as an interpretation
// layer above committed tuning.

function coordKey(coords) {
  if (!coords) return null;
  return `${coords.x},${coords.y}`;
}

function geometryModeForStrategy(strategy) {
  return strategy === "reinterpret_surface_from_target"
    ? "stable_surface"
    : "moveable_surface";
}

function normalizeHistoryEntry(entry = {}) {
  // A history entry is a reusable modulation operator. count says how many
  // signed steps of this operator are currently active in the live frame.
  return {
    sourceDegree: entry.sourceDegree ?? null,
    targetDegree: entry.targetDegree ?? null,
    strategy: entry.strategy ?? "retune_surface_to_source",
    count: Number.isFinite(entry.count) ? Math.trunc(entry.count) : 0,
  };
}

export function normalizeModulationHistory(history = [], options = {}) {
  const zeroCounts = options.zeroCounts === true;
  if (!Array.isArray(history)) return [];
  return history.map((entry) => {
    const normalized = normalizeHistoryEntry(entry);
    return zeroCounts ? { ...normalized, count: 0 } : normalized;
  });
}

function selectCurrentRoute(history = []) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if ((history[index]?.count ?? 0) !== 0) return history[index];
  }
  return null;
}

export function createModulationState(options = {}) {
  const history = normalizeModulationHistory(options.history);
  const currentRoute = options.currentRoute
    ? normalizeHistoryEntry(options.currentRoute)
    : selectCurrentRoute(history);
  return {
    mode: "idle",
    homeFrame: options.homeFrame ?? options.currentFrame ?? null,
    currentFrame: options.currentFrame ?? null,
    oldFrame: null,
    pendingFrame: null,
    sourceHex: null,
    sourceCoordsKey: null,
    sourceDegree: null,
    targetDegree: null,
    strategy: options.strategy ?? "retune_surface_to_source",
    geometryMode:
      options.geometryMode ?? geometryModeForStrategy(options.strategy ?? "retune_surface_to_source"),
    takeoverConsumed: false,
    history,
    historyIndex: options.historyIndex ?? (currentRoute?.count ?? 0),
    currentRoute,
    lastDecision: null,
  };
}

export function beginModulation(state, options = {}) {
  const sourceHex = options.sourceHex ?? null;
  const sourceDegree = options.sourceDegree ?? sourceHex?.pressed_interval ?? null;
  if (sourceHex == null && sourceDegree == null) {
    return {
      ...state,
      lastDecision: {
        type: "begin_rejected",
        reason: "no_source_degree",
      },
    };
  }

  return {
    ...state,
    mode: "awaiting_target",
    oldFrame: options.currentFrame ?? state.currentFrame ?? null,
    pendingFrame: null,
    sourceHex,
    sourceCoordsKey: coordKey(sourceHex?.coords),
    sourceDegree,
    targetDegree: null,
    strategy: options.strategy ?? state.strategy,
    geometryMode:
      options.geometryMode ??
      geometryModeForStrategy(options.strategy ?? state.strategy ?? "retune_surface_to_source"),
    takeoverConsumed: false,
    lastDecision: {
      type: "begin_modulation",
      strategy: options.strategy ?? state.strategy,
      geometryMode:
        options.geometryMode ??
        geometryModeForStrategy(options.strategy ?? state.strategy ?? "retune_surface_to_source"),
      sourceDegree,
      sourceCoordsKey: coordKey(sourceHex?.coords),
    },
  };
}

export function cancelModulation(state, reason = "cancelled") {
  return {
    ...state,
    mode: "idle",
    oldFrame: null,
    pendingFrame: null,
    sourceHex: null,
    sourceCoordsKey: null,
    sourceDegree: null,
    targetDegree: null,
    takeoverConsumed: false,
    lastDecision: {
      type: "cancel_modulation",
      reason,
    },
  };
}

export function commitModulationTarget(state, options = {}) {
  if (state.mode !== "awaiting_target") {
    return {
      ...state,
      lastDecision: {
        type: "commit_rejected",
        reason: "not_awaiting_target",
      },
    };
  }

  const sourceStillSounding = options.sourceStillSounding !== false;
  const decisionType = sourceStillSounding ? "takeover" : "attack";
  // pendingFrame is already derived by the caller from the committed tuning
  // substrate plus the selected source/target. This state machine only records
  // when that frame becomes active and whether the target should attack or
  // take over an existing source voice.
  const strategy = options.strategy ?? state.strategy;
  const geometryMode =
    options.geometryMode ??
    geometryModeForStrategy(strategy ?? "retune_surface_to_source");
  const nextEntry = {
    sourceDegree: state.sourceDegree,
    targetDegree: options.targetDegree ?? null,
    strategy,
    count: 1,
  };
  const nextHistoryBase = Array.isArray(state.history) ? state.history.map(normalizeHistoryEntry) : [];
  const nextHistory = [...nextHistoryBase, nextEntry];

  return {
    ...state,
    mode: "pending_settlement",
    pendingFrame: options.pendingFrame ?? state.pendingFrame ?? null,
    targetDegree: options.targetDegree ?? null,
    strategy,
    geometryMode,
    takeoverConsumed: false,
    history: nextHistory,
    historyIndex: nextEntry.count,
    currentRoute: nextEntry,
    lastDecision: {
      type: "commit_target",
      articulation: decisionType,
      strategy,
      geometryMode,
      sourceStillSounding,
      sourceCoordsKey: state.sourceCoordsKey,
      sourceDegree: state.sourceDegree,
      targetDegree: options.targetDegree ?? null,
    },
  };
}

export function frameForNewNotes(state) {
  // During settlement, newly played notes use the new interpreted frame while
  // legacy held notes are allowed to finish in their onset frame.
  if (state.mode === "pending_settlement" && state.pendingFrame) return state.pendingFrame;
  return state.currentFrame;
}

export function settleModulationIfPossible(state, options = {}) {
  if (state.mode !== "pending_settlement") return state;
  if (options.hasLegacyNotes) {
    return {
      ...state,
      lastDecision: {
        type: "settlement_deferred",
        reason: "legacy_notes_active",
      },
    };
  }

  return {
    ...state,
    mode: "idle",
    homeFrame: state.homeFrame ?? state.currentFrame ?? null,
    currentFrame: state.pendingFrame ?? state.currentFrame,
    oldFrame: null,
    pendingFrame: null,
    sourceHex: null,
    sourceCoordsKey: null,
    sourceDegree: null,
    targetDegree: null,
    takeoverConsumed: false,
    history: Array.isArray(state.history) ? state.history.map(normalizeHistoryEntry) : [],
    historyIndex: state.currentRoute?.count ?? state.historyIndex ?? 0,
    currentRoute: state.currentRoute ? normalizeHistoryEntry(state.currentRoute) : selectCurrentRoute(state.history),
    lastDecision: {
      type: "settlement_complete",
      strategy: state.strategy,
      geometryMode: state.geometryMode,
    },
  };
}

export function noteBelongsToLegacyFrame(state, noteContext = {}) {
  if (state.mode !== "pending_settlement" || !state.oldFrame) return false;
  return noteContext.onsetFrameId === state.oldFrame.id;
}

export function describeSurfaceStrategy(state) {
  return {
    strategy: state.strategy,
    geometryMode: state.geometryMode,
    moveableSurface: state.geometryMode === "moveable_surface",
    stableSurface: state.geometryMode === "stable_surface",
  };
}

export function setModulationHistoryIndex(state, historyIndex, currentFrame = state.currentFrame) {
  const routeIndex = Array.isArray(state.history) ? state.history.length - 1 : -1;
  if (routeIndex < 0) {
    return {
      ...state,
      currentFrame,
      historyIndex: 0,
      currentRoute: null,
      lastDecision: {
        type: "set_history_index",
        historyIndex: 0,
      },
    };
  }
  return setModulationRouteCount(state, routeIndex, historyIndex, currentFrame);
}

export function setModulationRouteCount(state, routeIndex, count, currentFrame = state.currentFrame) {
  // currentFrame is supplied by the caller because deriving a frame from route
  // counts depends on the active tuning/workspace runtime, not just this state.
  const history = Array.isArray(state.history) ? state.history.map(normalizeHistoryEntry) : [];
  if (routeIndex < 0 || routeIndex >= history.length) return state;
  const nextCount = Number.isFinite(count) ? Math.trunc(count) : 0;
  history[routeIndex] = {
    ...history[routeIndex],
    count: nextCount,
  };
  const currentRoute = selectCurrentRoute(history);
  return {
    ...state,
    mode: "idle",
    oldFrame: null,
    pendingFrame: null,
    sourceHex: null,
    sourceCoordsKey: null,
    sourceDegree: null,
    targetDegree: null,
    takeoverConsumed: false,
    currentFrame,
    history,
    historyIndex: currentRoute?.count ?? 0,
    currentRoute,
    lastDecision: {
      type: "set_route_count",
      routeIndex,
      historyIndex: currentRoute?.count ?? 0,
    },
  };
}

export function clearModulationHistory(state, currentFrame = state.homeFrame ?? state.currentFrame) {
  return {
    ...state,
    mode: "idle",
    oldFrame: null,
    pendingFrame: null,
    sourceHex: null,
    sourceCoordsKey: null,
    sourceDegree: null,
    targetDegree: null,
    takeoverConsumed: false,
    currentFrame,
    history: [],
    historyIndex: 0,
    currentRoute: null,
    lastDecision: {
      type: "clear_history",
    },
  };
}

export function clearModulationRoute(state, routeIndex, currentFrame = state.currentFrame) {
  const history = Array.isArray(state.history) ? state.history.map(normalizeHistoryEntry) : [];
  if (routeIndex < 0 || routeIndex >= history.length) return state;
  history.splice(routeIndex, 1);
  const currentRoute = selectCurrentRoute(history);
  return {
    ...state,
    mode: "idle",
    oldFrame: null,
    pendingFrame: null,
    sourceHex: null,
    sourceCoordsKey: null,
    sourceDegree: null,
    targetDegree: null,
    takeoverConsumed: false,
    currentFrame,
    history,
    historyIndex: currentRoute?.count ?? 0,
    currentRoute,
    lastDecision: {
      type: "clear_route",
      routeIndex,
    },
  };
}
