const DEBUG_STORAGE_KEY = "hexatone_debug";
// Enable categories by setting localStorage/sessionStorage, e.g.
//   localStorage.setItem("hexatone_debug", "MIDImonitoring,midi")
// or
//   localStorage.setItem("hexatone_debug", "all")

function parseDebugFlags(raw) {
  if (!raw) return new Set();
  return new Set(
    String(raw)
      .split(/[,\s]+/)
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function readStoredDebugFlags() {
  if (typeof window === "undefined") return new Set();
  try {
    const raw =
      window.localStorage?.getItem(DEBUG_STORAGE_KEY) ??
      window.sessionStorage?.getItem(DEBUG_STORAGE_KEY) ??
      "";
    return parseDebugFlags(raw);
  } catch {
    return new Set();
  }
}

export function debugEnabled(category) {
  const flags = readStoredDebugFlags();
  return flags.has("all") || flags.has(category);
}

export function debugLog(category, ...args) {
  if (!debugEnabled(category)) return;
  // eslint-disable-next-line no-console
  console.log(`[${category}]`, ...args);
}

export function warnLog(...args) {
  // eslint-disable-next-line no-console
  console.warn(...args);
}

export function errorLog(...args) {
  // eslint-disable-next-line no-console
  console.error(...args);
}
