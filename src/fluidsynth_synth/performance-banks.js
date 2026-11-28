import { soundfontStorageKey } from "./soundfont-storage.js";

const LIBRARY_KEY = "hexatone_performance_soundfonts";

export function readPerformanceBanks() {
  try {
    const banks = JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? "[]");
    return Array.isArray(banks) ? banks.filter(bank => typeof bank?.name === "string" &&
      bank.name && typeof bank.url === "string") : [];
  } catch { return []; }
}

export function rememberPerformanceBanks(previous, sources, preload) {
  const banks = new Map(previous.map(bank => [soundfontStorageKey(bank), bank]));
  let changed = false;
  for (const { name, url = "" } of sources) {
    const key = soundfontStorageKey({ name, url });
    const existing = banks.get(key);
    if (existing && (preload === undefined || (existing.preload === preload && existing.url === url))) continue;
    banks.set(key, { name, url, preload: preload ?? false });
    changed = true;
  }
  if (!changed) return previous;
  const next = [...banks.values()];
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(next)); }
  catch { /* The library still works in this tab. */ }
  return next;
}

export function forgetPerformanceBank(previous, key) {
  const next = previous.filter(bank => soundfontStorageKey(bank) !== key);
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
  return next;
}

export function canLoadColdSoundfont(keys) {
  if (!keys) return true;
  const synth = keys.synth;
  const outputs = synth?.getRecoveryOutputs?.() ?? synth?.childSynths?.() ?? [];
  const otherAudio = outputs.filter(output =>
    output.audioBackend !== "fluidsynth" && (output.usesSharedAudioContext || output.audioBackend === "supersonic"));
  return !otherAudio.length || (keys.isSoundInteractionIdle?.() !== false &&
    ![...(keys._soundingSnapshotHexes ?? [])].some(note => !note.release) &&
    !otherAudio.some(output => output.hasVoices?.()));
}
