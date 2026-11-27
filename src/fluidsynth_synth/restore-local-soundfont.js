import { readOfflineSoundfont, soundfontStorageKey } from "./soundfont-storage.js";
import { BANK_PRESETS_KEY, readRememberedSoundfont, legacyLocalSoundfontKey } from "./soundfont-catalog.js";
import { clearPreparedSoundfonts, loadFluidSynthSoundFont, peekFluidSynthEngine } from "./index.js";
import { readPerformanceBanks } from "./performance-banks.js";
import { restoreSoundOnReload } from "../persistence/io-reload-policy.js";
import { createSoundfontSource } from "./soundfont-source.js";

export { LAST_SOUNDFONT_KEY } from "./soundfont-catalog.js";

export async function restorePerformanceSoundfonts({ signal, canLoadColdBank, onProgress } = {}) {
  if (!restoreSoundOnReload()) return;
  const banks = readPerformanceBanks().filter(bank => bank.preload);
  if (!banks.length) return;
  const unavailable = [];
  let prepared = 0;
  for (const [index, bank] of banks.entries()) {
    if (signal?.aborted) return;
    const key = soundfontStorageKey(bank);
    const stillPinned = () => readPerformanceBanks().some(item => item.preload && soundfontStorageKey(item) === key);
    if (!stillPinned()) continue;
    const cache = peekFluidSynthEngine()?.soundfontCache;
    if (cache?.preparedKeys?.includes(key)) {
      prepared++;
      continue;
    }
    const progress = { name: bank.name, index: index + 1, total: banks.length };
    onProgress?.({ ...progress, phase: "preparing" });
    try {
      const resident = cache?.keys?.includes(key);
      const cached = resident ? undefined : await readOfflineSoundfont(key);
      if (signal?.aborted) return;
      if (!stillPinned()) continue;
      if (!resident && !cached?.blob) {
        unavailable.push({ name: bank.name, reason: "No saved browser copy" });
        continue;
      }
      await loadFluidSynthSoundFont(createSoundfontSource({ name: bank.name, url: key, cachedBank: cached, signal }), {
        signal, canLoadColdBank, prepareOnly: true,
        onWaitingForSilence: () => onProgress?.({ ...progress, phase: "waiting" }),
      });
      if (!stillPinned()) clearPreparedSoundfonts(key);
      else prepared++;
    } catch (error) {
      if (signal?.aborted) return;
      unavailable.push({ name: bank.name, reason: error.message });
    }
  }
  const report = { phase: "complete", prepared, unavailable };
  if (!signal?.aborted) onProgress?.(report);
  return report;
}

// No network fallback: a missing/denied browser copy remains a manual choice.
export async function restoreLocalSoundfont({ signal, preferredPreset, canLoadColdBank, readMixer } = {}) {
  if (!restoreSoundOnReload()) return null;
  if (peekFluidSynthEngine()?.soundfontId != null) return null;
  const source = readRememberedSoundfont();
  if (!source?.name) return null;
  const key = soundfontStorageKey(source);
  let bank;
  try { bank = await readOfflineSoundfont(key); }
  catch { return null; }
  signal?.throwIfAborted();
  if (!bank?.blob || peekFluidSynthEngine()?.soundfontId != null) return null;
  let savedPreset;
  try {
    const saved = JSON.parse(localStorage.getItem(BANK_PRESETS_KEY) || "{}");
    savedPreset = saved[key] ?? saved[legacyLocalSoundfontKey(key)];
  }
  catch { /* Use the current preset preference. */ }
  const result = await loadFluidSynthSoundFont({
    name: source.name, url: source.url || "", arrayBuffer: () => bank.blob.arrayBuffer(),
  }, { signal, canLoadColdBank, preferredPreset: savedPreset ?? preferredPreset });
  signal?.throwIfAborted();
  const engine = peekFluidSynthEngine();
  engine?.setVolume(readMixer?.("fluidsynth_internal_volume") ?? Number(localStorage.getItem("fluidsynth_internal_volume") ?? 100));
  const reverb = readMixer?.("fluidsynth_internal_reverb");
  if (reverb != null) engine?.setReverb?.(reverb);
  return { ...result, selectedPreset: engine?.selectedPreset };
}

export async function restoreSoundfontSession(options = {}) {
  const activeSignal = options.activeSignal ?? options.signal;
  let active;
  if (!activeSignal?.aborted) {
    try {
      active = await restoreLocalSoundfont({ ...options, signal: activeSignal });
    } catch (error) {
      if (!activeSignal?.aborted) options.onActiveError?.(error);
    }
  }
  if (options.signal?.aborted) return;
  await restorePerformanceSoundfonts(options);
  if (activeSignal?.aborted) return;
  return active && { ...active, selectedPreset: peekFluidSynthEngine()?.selectedPreset ?? active.selectedPreset };
}
