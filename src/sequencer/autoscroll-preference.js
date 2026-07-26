const AUTO_SCROLL_STORAGE_KEY = "hexatone_sequencer_auto_scroll_enabled";

export function loadSequencerAutoScrollPreference(storage = globalThis.localStorage) {
  try {
    const stored = storage?.getItem?.(AUTO_SCROLL_STORAGE_KEY);
    return stored == null ? true : stored !== "false";
  } catch {
    return true;
  }
}

export function saveSequencerAutoScrollPreference(enabled, storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(AUTO_SCROLL_STORAGE_KEY, enabled === false ? "false" : "true");
  } catch {
    // Storage can be unavailable in private or embedded browsing contexts.
  }
}

export { AUTO_SCROLL_STORAGE_KEY };
