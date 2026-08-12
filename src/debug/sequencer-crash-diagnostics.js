// Sequencer crash diagnostics capture the last few bar-relative event commits
// plus any uncaught browser error/rejection that follows. Enable with
// `localStorage.hexatone_debug_sequencer_crash = "true"` or
// `?debugSequencerCrash=1`.

function roundMetric(value, digits = 6) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const scale = 10 ** digits;
  return Math.round(numeric * scale) / scale;
}

function readSequencerCrashDiagnosticsFlag() {
  if (typeof globalThis === "undefined") return false;
  try {
    if (globalThis.localStorage?.getItem?.("hexatone_debug_sequencer_crash") === "true") {
      return true;
    }
    const search = String(globalThis.location?.search ?? "");
    return new URLSearchParams(search).get("debugSequencerCrash") === "1";
  } catch {
    return false;
  }
}

export const SEQUENCER_CRASH_DIAGNOSTICS_STORAGE_KEY = "hexatone_sequencer_crash_diagnostics";
export const SEQUENCER_CRASH_LIFECYCLE_STORAGE_KEY = "hexatone_sequencer_crash_lifecycle";
export const SEQUENCER_CRASH_DIAGNOSTICS_PERSIST_INTERVAL_MS = 2000;
export const SEQUENCER_CRASH_HEARTBEAT_INTERVAL_MS = 5000;
let cachedPersistedSequencerCrashDiagnostics = null;
let hasLoadedPersistedSequencerCrashDiagnostics = false;
let bufferedDiagnosticsState = null;
let bufferedDiagnosticsStorage = null;
let pendingPersistenceTimer = null;
let nextTransactionId = 1;
let activeTransactionContext = null;

export function createSequencerDiagnosticTransactionId(kind = "edit") {
  const normalizedKind = String(kind || "edit").replace(/[^a-z0-9-]+/gi, "-");
  const id = nextTransactionId;
  nextTransactionId += 1;
  return `${normalizedKind}:${Date.now()}:${id}`;
}

export function getActiveSequencerDiagnosticTransaction() {
  return activeTransactionContext;
}

export function runWithSequencerDiagnosticTransaction(context, callback) {
  const previousContext = activeTransactionContext;
  activeTransactionContext = context ?? null;
  try {
    return callback?.();
  } finally {
    activeTransactionContext = previousContext;
  }
}

export function readSequencerDiagnosticMemory(performanceObject = globalThis?.performance) {
  const memory = performanceObject?.memory;
  if (!memory) return {};
  const metrics = {
    heapUsedBytes: Number(memory.usedJSHeapSize),
    heapTotalBytes: Number(memory.totalJSHeapSize),
    heapLimitBytes: Number(memory.jsHeapSizeLimit),
  };
  return Object.fromEntries(
    Object.entries(metrics).filter(([, value]) => Number.isFinite(value) && value >= 0),
  );
}

export function isSequencerCrashDiagnosticsEnabled() {
  return readSequencerCrashDiagnosticsFlag();
}

export function createSequencerCrashDiagnostics(limit = 100) {
  return {
    limit: Math.max(1, Math.round(Number(limit) || 100)),
    entries: [],
    nextId: 1,
    lastContext: null,
  };
}

export function resetSequencerCrashDiagnostics(state, limit = null) {
  const nextLimit =
    limit == null
      ? Math.max(1, Math.round(Number(state?.limit) || 100))
      : Math.max(1, Math.round(Number(limit) || 100));
  return createSequencerCrashDiagnostics(nextLimit);
}

function normalizeContext(context) {
  if (!context || typeof context !== "object") return null;
  const normalized = {
    source: context.source == null ? null : String(context.source),
    snapshotId: context.snapshotId == null ? null : String(context.snapshotId),
    selectedSnapshotId:
      context.selectedSnapshotId == null ? null : String(context.selectedSnapshotId),
    targetSnapshotId: context.targetSnapshotId == null ? null : String(context.targetSnapshotId),
    tempoId: context.tempoId == null ? null : String(context.tempoId),
    repeatId: context.repeatId == null ? null : String(context.repeatId),
    noteId: context.noteId == null ? null : String(context.noteId),
    resolvedNoteId: context.resolvedNoteId == null ? null : String(context.resolvedNoteId),
    noteKey: context.noteKey == null ? null : String(context.noteKey),
    kind: context.kind == null ? null : String(context.kind),
    transferKind: context.transferKind == null ? null : String(context.transferKind),
    transactionId: context.transactionId == null ? null : String(context.transactionId),
    commitKind: context.commitKind == null ? null : String(context.commitKind),
    draftKey: context.draftKey == null ? null : String(context.draftKey),
    captureStage: context.captureStage == null ? null : String(context.captureStage),
    navigationStage: context.navigationStage == null ? null : String(context.navigationStage),
    navigationDirection: Number.isFinite(Number(context.navigationDirection))
      ? Number(context.navigationDirection)
      : null,
    workspaceTab: context.workspaceTab == null ? null : String(context.workspaceTab),
    pageId: context.pageId == null ? null : String(context.pageId),
    previousPageId: context.previousPageId == null ? null : String(context.previousPageId),
    navigationType: context.navigationType == null ? null : String(context.navigationType),
    visibilityState: context.visibilityState == null ? null : String(context.visibilityState),
    barNumber: Number.isFinite(Number(context.barNumber)) ? Number(context.barNumber) : null,
    beat: Number.isFinite(Number(context.beat)) ? Number(context.beat) : null,
    numerator: Number.isFinite(Number(context.numerator)) ? Number(context.numerator) : null,
    denominator: Number.isFinite(Number(context.denominator)) ? Number(context.denominator) : null,
    captureNoteCount: Number.isFinite(Number(context.captureNoteCount))
      ? Number(context.captureNoteCount)
      : null,
    noteCountBefore: Number.isFinite(Number(context.noteCountBefore))
      ? Number(context.noteCountBefore)
      : null,
    noteCountAfter: Number.isFinite(Number(context.noteCountAfter))
      ? Number(context.noteCountAfter)
      : null,
    snapshotCountBefore: Number.isFinite(Number(context.snapshotCountBefore))
      ? Number(context.snapshotCountBefore)
      : null,
    snapshotCountAfter: Number.isFinite(Number(context.snapshotCountAfter))
      ? Number(context.snapshotCountAfter)
      : null,
    absoluteTime: roundMetric(context.absoluteTime),
    snapshotTime: roundMetric(context.snapshotTime),
    snapshotLength: roundMetric(context.snapshotLength),
    previousStart: roundMetric(context.previousStart),
    previousEnd: roundMetric(context.previousEnd),
    nextStart: roundMetric(context.nextStart),
    nextEnd: roundMetric(context.nextEnd),
    eventRelativeTime: roundMetric(context.eventRelativeTime),
    eventAbsoluteTime: roundMetric(context.eventAbsoluteTime),
    snapshotIndex: Number.isFinite(Number(context.snapshotIndex))
      ? Number(context.snapshotIndex)
      : null,
    fromPosition: Number.isFinite(Number(context.fromPosition))
      ? Number(context.fromPosition)
      : null,
    toPosition: Number.isFinite(Number(context.toPosition)) ? Number(context.toPosition) : null,
    cueIndex: Number.isFinite(Number(context.cueIndex)) ? Number(context.cueIndex) : null,
    currentCueIndex: Number.isFinite(Number(context.currentCueIndex))
      ? Number(context.currentCueIndex)
      : null,
    nextCueIndex: Number.isFinite(Number(context.nextCueIndex))
      ? Number(context.nextCueIndex)
      : null,
    activeCueIndex: Number.isFinite(Number(context.activeCueIndex))
      ? Number(context.activeCueIndex)
      : null,
    playheadStepIndex: Number.isFinite(Number(context.playheadStepIndex))
      ? Number(context.playheadStepIndex)
      : null,
    playheadBarIndex: Number.isFinite(Number(context.playheadBarIndex))
      ? Number(context.playheadBarIndex)
      : null,
    expandedCount: Number.isFinite(Number(context.expandedCount))
      ? Number(context.expandedCount)
      : null,
    sequenceEventCount: Number.isFinite(Number(context.sequenceEventCount))
      ? Number(context.sequenceEventCount)
      : null,
    cueGroupCount: Number.isFinite(Number(context.cueGroupCount))
      ? Number(context.cueGroupCount)
      : null,
    scrollTop: roundMetric(context.scrollTop),
    targetTop: roundMetric(context.targetTop),
    commitToEffectMs: roundMetric(context.commitToEffectMs, 3),
    commitToFrameMs: roundMetric(context.commitToFrameMs, 3),
    uptimeMs: roundMetric(context.uptimeMs, 3),
    timeSincePreviousHeartbeatMs: roundMetric(context.timeSincePreviousHeartbeatMs, 3),
    previousHeartbeatHeapUsedBytes: Number.isFinite(Number(context.previousHeartbeatHeapUsedBytes))
      ? Number(context.previousHeartbeatHeapUsedBytes)
      : null,
    previousHeartbeatHeapTotalBytes: Number.isFinite(
      Number(context.previousHeartbeatHeapTotalBytes),
    )
      ? Number(context.previousHeartbeatHeapTotalBytes)
      : null,
    previousPeakHeapUsedBytes: Number.isFinite(Number(context.previousPeakHeapUsedBytes))
      ? Number(context.previousPeakHeapUsedBytes)
      : null,
    heapUsedBytes: Number.isFinite(Number(context.heapUsedBytes))
      ? Number(context.heapUsedBytes)
      : null,
    heapTotalBytes: Number.isFinite(Number(context.heapTotalBytes))
      ? Number(context.heapTotalBytes)
      : null,
    heapLimitBytes: Number.isFinite(Number(context.heapLimitBytes))
      ? Number(context.heapLimitBytes)
      : null,
    updateKeys: Array.isArray(context.updateKeys)
      ? context.updateKeys.map((key) => String(key))
      : null,
    effectStage: context.effectStage == null ? null : String(context.effectStage),
    targetKind: context.targetKind == null ? null : String(context.targetKind),
    targetKey: context.targetKey == null ? null : String(context.targetKey),
    dragStage: context.dragStage == null ? null : String(context.dragStage),
    pointerY: roundMetric(context.pointerY),
    scrollVelocity: roundMetric(context.scrollVelocity),
    scrollDelta: roundMetric(context.scrollDelta),
    dragDurationMs: roundMetric(context.dragDurationMs, 3),
    cueDisplayLead: context.cueDisplayLead === true,
    courtesyStart: context.courtesyStart === true,
    duplicate: context.duplicate === true,
    autoScrollEnabled: context.autoScrollEnabled === true,
    showAllEvents: context.showAllEvents === true,
    cleanExit: context.cleanExit == null ? null : context.cleanExit === true,
    previousCleanExit:
      context.previousCleanExit == null ? null : context.previousCleanExit === true,
    previousLifecyclePresent:
      context.previousLifecyclePresent == null ? null : context.previousLifecyclePresent === true,
    wasDiscarded: context.wasDiscarded == null ? null : context.wasDiscarded === true,
    derivedBarNumber: Number.isFinite(Number(context.derivedBarNumber))
      ? Number(context.derivedBarNumber)
      : null,
    derivedBeat: Number.isFinite(Number(context.derivedBeat)) ? Number(context.derivedBeat) : null,
    derivedNumerator: Number.isFinite(Number(context.derivedNumerator))
      ? Number(context.derivedNumerator)
      : null,
    derivedDenominator: Number.isFinite(Number(context.derivedDenominator))
      ? Number(context.derivedDenominator)
      : null,
    timestamp: context.timestamp == null ? null : String(context.timestamp),
  };
  const meaningfulFalseFields = new Set([
    "cleanExit",
    "previousCleanExit",
    "previousLifecyclePresent",
    "wasDiscarded",
  ]);
  return Object.fromEntries(
    Object.entries(normalized).filter(
      ([key, value]) => value !== null && (value !== false || meaningfulFalseFields.has(key)),
    ),
  );
}

function serializeError(error) {
  if (!error) return null;
  if (typeof error === "string") return { message: error, name: null, stack: null };
  return {
    name: error.name == null ? null : String(error.name),
    message: error.message == null ? String(error) : String(error.message),
    stack: error.stack == null ? null : String(error.stack),
  };
}

export function pushSequencerCrashDiagnostic(state, entry = {}) {
  const diagnostics = state ?? createSequencerCrashDiagnostics();
  const normalizedEntry = {
    id: diagnostics.nextId,
    type: entry.type == null ? "event" : String(entry.type),
    timestamp: entry.timestamp == null ? new Date().toISOString() : String(entry.timestamp),
    detail: entry.detail == null ? null : String(entry.detail),
    context: normalizeContext(entry.context),
    error: serializeError(entry.error),
  };
  const entries =
    diagnostics.entries.length >= diagnostics.limit
      ? [...diagnostics.entries.slice(1), normalizedEntry]
      : [...diagnostics.entries, normalizedEntry];
  return {
    ...diagnostics,
    entries,
    nextId: diagnostics.nextId + 1,
    lastContext: normalizedEntry.context ?? diagnostics.lastContext ?? null,
  };
}

function writeSequencerCrashDiagnostics(state, storage) {
  if (!storage?.setItem) return;
  const persisted = { state };
  cachedPersistedSequencerCrashDiagnostics = persisted;
  hasLoadedPersistedSequencerCrashDiagnostics = true;
  storage.setItem(SEQUENCER_CRASH_DIAGNOSTICS_STORAGE_KEY, JSON.stringify(persisted));
}

function clearPendingSequencerCrashPersistence() {
  if (pendingPersistenceTimer != null && typeof globalThis.clearTimeout === "function") {
    globalThis.clearTimeout(pendingPersistenceTimer);
  }
  pendingPersistenceTimer = null;
}

export function persistSequencerCrashDiagnostics(state, storage = globalThis?.sessionStorage) {
  if (bufferedDiagnosticsStorage === storage) {
    clearPendingSequencerCrashPersistence();
    bufferedDiagnosticsState = null;
    bufferedDiagnosticsStorage = null;
  }
  writeSequencerCrashDiagnostics(state, storage);
}

export function flushPersistedSequencerCrashDiagnostics() {
  clearPendingSequencerCrashPersistence();
  const state = bufferedDiagnosticsState;
  const storage = bufferedDiagnosticsStorage;
  bufferedDiagnosticsState = null;
  bufferedDiagnosticsStorage = null;
  if (state && storage) writeSequencerCrashDiagnostics(state, storage);
  return state;
}

export function bufferSequencerCrashDiagnostics(state, storage = globalThis?.sessionStorage) {
  if (!storage?.setItem) return state;
  if (bufferedDiagnosticsStorage && bufferedDiagnosticsStorage !== storage) {
    flushPersistedSequencerCrashDiagnostics();
  }
  bufferedDiagnosticsState = state;
  bufferedDiagnosticsStorage = storage;
  if (pendingPersistenceTimer == null && typeof globalThis.setTimeout === "function") {
    pendingPersistenceTimer = globalThis.setTimeout(() => {
      flushPersistedSequencerCrashDiagnostics();
    }, SEQUENCER_CRASH_DIAGNOSTICS_PERSIST_INTERVAL_MS);
  }
  return state;
}

export function loadPersistedSequencerCrashDiagnostics(storage = globalThis?.sessionStorage) {
  if (bufferedDiagnosticsStorage === storage && bufferedDiagnosticsState) {
    return { state: bufferedDiagnosticsState };
  }
  if (hasLoadedPersistedSequencerCrashDiagnostics) return cachedPersistedSequencerCrashDiagnostics;
  if (!storage?.getItem) return null;
  const raw = storage.getItem(SEQUENCER_CRASH_DIAGNOSTICS_STORAGE_KEY);
  if (!raw) {
    cachedPersistedSequencerCrashDiagnostics = null;
    hasLoadedPersistedSequencerCrashDiagnostics = true;
    return null;
  }
  try {
    cachedPersistedSequencerCrashDiagnostics = JSON.parse(raw);
    hasLoadedPersistedSequencerCrashDiagnostics = true;
    return cachedPersistedSequencerCrashDiagnostics;
  } catch {
    cachedPersistedSequencerCrashDiagnostics = null;
    hasLoadedPersistedSequencerCrashDiagnostics = true;
    return null;
  }
}

export function clearPersistedSequencerCrashDiagnostics(storage = globalThis?.sessionStorage) {
  if (!storage?.removeItem) return;
  if (bufferedDiagnosticsStorage === storage) {
    clearPendingSequencerCrashPersistence();
    bufferedDiagnosticsState = null;
    bufferedDiagnosticsStorage = null;
  }
  cachedPersistedSequencerCrashDiagnostics = null;
  hasLoadedPersistedSequencerCrashDiagnostics = true;
  storage.removeItem(SEQUENCER_CRASH_DIAGNOSTICS_STORAGE_KEY);
}

export function appendPersistedSequencerCrashDiagnostic(
  entry,
  storage = globalThis?.sessionStorage,
  { immediate = false } = {},
) {
  if (!isSequencerCrashDiagnosticsEnabled()) return null;
  const currentState =
    bufferedDiagnosticsStorage === storage && bufferedDiagnosticsState
      ? bufferedDiagnosticsState
      : loadPersistedSequencerCrashDiagnostics(storage)?.state;
  const nextState = pushSequencerCrashDiagnostic(currentState, entry);
  if (immediate) {
    persistSequencerCrashDiagnostics(nextState, storage);
  } else {
    bufferSequencerCrashDiagnostics(nextState, storage);
  }
  return nextState;
}

let listenersInstalled = false;
let errorListener = null;
let rejectionListener = null;
let pageHideListener = null;
let lifecycleHeartbeatTimer = null;

function readLifecycleMarker(storage = globalThis?.sessionStorage) {
  try {
    const raw = storage?.getItem?.(SEQUENCER_CRASH_LIFECYCLE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLifecycleMarker(marker, storage = globalThis?.sessionStorage) {
  try {
    storage?.setItem?.(SEQUENCER_CRASH_LIFECYCLE_STORAGE_KEY, JSON.stringify(marker));
  } catch {
    // Diagnostics must never interfere with the sequencer itself.
  }
}

function navigationType(performanceObject = globalThis?.performance) {
  try {
    return performanceObject?.getEntriesByType?.("navigation")?.[0]?.type ?? null;
  } catch {
    return null;
  }
}

export function buildSequencerLifecycleStartContext({
  previousMarker = null,
  pageId,
  now = Date.now(),
  performanceObject = globalThis?.performance,
  documentObject = globalThis?.document,
} = {}) {
  const previousHeartbeatAt = Number(previousMarker?.lastHeartbeatAt);
  return {
    source: "lifecycle",
    pageId,
    previousPageId: previousMarker?.pageId ?? null,
    previousLifecyclePresent: previousMarker != null,
    previousCleanExit: previousMarker == null ? null : previousMarker.cleanExit === true,
    navigationType: navigationType(performanceObject),
    wasDiscarded: documentObject?.wasDiscarded === true,
    visibilityState: documentObject?.visibilityState ?? null,
    uptimeMs: Number(performanceObject?.now?.()),
    timeSincePreviousHeartbeatMs: Number.isFinite(previousHeartbeatAt)
      ? Math.max(0, now - previousHeartbeatAt)
      : null,
    previousHeartbeatHeapUsedBytes: Number(previousMarker?.lastMemory?.heapUsedBytes),
    previousHeartbeatHeapTotalBytes: Number(previousMarker?.lastMemory?.heapTotalBytes),
    previousPeakHeapUsedBytes: Number(previousMarker?.peakHeapUsedBytes),
    ...readSequencerDiagnosticMemory(performanceObject),
  };
}

function stopLifecycleHeartbeat() {
  if (lifecycleHeartbeatTimer != null) globalThis.clearInterval?.(lifecycleHeartbeatTimer);
  lifecycleHeartbeatTimer = null;
}

function startSequencerCrashLifecycleDiagnostics() {
  const storage = globalThis?.sessionStorage;
  if (!storage?.setItem) return;
  const now = Date.now();
  const previousMarker = readLifecycleMarker(storage);
  const pageId = `page:${now}:${Math.random().toString(36).slice(2, 10)}`;
  const marker = {
    pageId,
    startedAt: now,
    lastHeartbeatAt: now,
    cleanExit: false,
    lastMemory: readSequencerDiagnosticMemory(),
    peakHeapUsedBytes: null,
  };
  marker.peakHeapUsedBytes = marker.lastMemory.heapUsedBytes ?? null;
  writeLifecycleMarker(marker, storage);
  appendPersistedSequencerCrashDiagnostic(
    {
      type:
        previousMarker && previousMarker.cleanExit !== true
          ? "lifecycle-unclean-restart"
          : "lifecycle-start",
      detail:
        previousMarker && previousMarker.cleanExit !== true
          ? "Started after a page that did not report a clean exit"
          : "Started sequencer crash lifecycle diagnostics",
      context: buildSequencerLifecycleStartContext({
        previousMarker,
        pageId,
        now,
      }),
    },
    storage,
    { immediate: true },
  );
  stopLifecycleHeartbeat();
  lifecycleHeartbeatTimer = globalThis.setInterval?.(() => {
    marker.lastHeartbeatAt = Date.now();
    marker.lastMemory = readSequencerDiagnosticMemory();
    const heapUsedBytes = Number(marker.lastMemory.heapUsedBytes);
    if (Number.isFinite(heapUsedBytes)) {
      marker.peakHeapUsedBytes = Math.max(Number(marker.peakHeapUsedBytes) || 0, heapUsedBytes);
    }
    writeLifecycleMarker(marker, storage);
  }, SEQUENCER_CRASH_HEARTBEAT_INTERVAL_MS);
  pageHideListener = () => {
    marker.lastHeartbeatAt = Date.now();
    marker.cleanExit = true;
    writeLifecycleMarker(marker, storage);
    appendPersistedSequencerCrashDiagnostic(
      {
        type: "lifecycle-clean-exit",
        detail: "Page emitted pagehide",
        context: {
          source: "lifecycle",
          pageId,
          cleanExit: true,
          visibilityState: globalThis.document?.visibilityState ?? null,
          uptimeMs: globalThis.performance?.now?.(),
          ...readSequencerDiagnosticMemory(),
        },
      },
      storage,
      { immediate: true },
    );
    stopLifecycleHeartbeat();
  };
  globalThis.addEventListener?.("pagehide", pageHideListener, { once: true });
}

function installSequencerCrashDiagnosticsGlobal() {
  if (typeof globalThis === "undefined") return;
  if (!isSequencerCrashDiagnosticsEnabled()) {
    clearPersistedSequencerCrashDiagnostics();
    delete globalThis.__hexatoneSequencerCrashDiagnostics;
    if (listenersInstalled && globalThis.removeEventListener) {
      globalThis.removeEventListener("error", errorListener);
      globalThis.removeEventListener("unhandledrejection", rejectionListener);
    }
    listenersInstalled = false;
    errorListener = null;
    rejectionListener = null;
    stopLifecycleHeartbeat();
    return;
  }

  if (!listenersInstalled && globalThis.addEventListener) {
    errorListener = (event) => {
      appendPersistedSequencerCrashDiagnostic(
        {
          type: "error",
          detail: event?.message ?? "uncaught error",
          error: event?.error ?? { message: event?.message, stack: null },
        },
        globalThis.sessionStorage,
        { immediate: true },
      );
    };
    rejectionListener = (event) => {
      appendPersistedSequencerCrashDiagnostic(
        {
          type: "unhandledrejection",
          detail: "unhandled rejection",
          error: event?.reason,
        },
        globalThis.sessionStorage,
        { immediate: true },
      );
    };
    globalThis.addEventListener("error", errorListener);
    globalThis.addEventListener("unhandledrejection", rejectionListener);
    listenersInstalled = true;
    startSequencerCrashLifecycleDiagnostics();
  }

  globalThis.__hexatoneSequencerCrashDiagnostics = {
    enabled: true,
    record: (entry) => appendPersistedSequencerCrashDiagnostic(entry),
    getPersisted: () => {
      flushPersistedSequencerCrashDiagnostics();
      return loadPersistedSequencerCrashDiagnostics();
    },
    reset: () => {
      clearPersistedSequencerCrashDiagnostics();
      return null;
    },
  };
}

installSequencerCrashDiagnosticsGlobal();
