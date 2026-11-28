import { soundfontCacheBudget } from "./cache-budget.js";
import { readOfflineSoundfont, soundfontStorageKey } from "./soundfont-storage.js";
import { BANK_PRESETS_KEY, readRememberedSoundfont, legacyLocalSoundfontKey } from "./soundfont-catalog.js";
import { clearPreparedSoundfonts, loadFluidSynthSoundFont, peekFluidSynthEngine } from "./index.js";
import { readPerformanceBanks } from "./performance-banks.js";
import { restoreSoundOnReload } from "../persistence/io-reload-policy.js";
import { findSound, loadUserSounds, restoreSelection } from "../persistence/user-sounds.js";
import { createSoundfontSource, resolveSoundfontRecall } from "./soundfont-source.js";

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
      if (!resident && (cache?.estimatedBytes ?? 0) + 2 * cached.blob.size >
          (cache?.budgetBytes ?? soundfontCacheBudget())) {
        unavailable.push({ name: bank.name, reason: "SoundFont memory budget exceeded" });
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
      if (/out of memory|allocation failed/i.test(error.message)) break;
    }
  }
  const report = { phase: "complete", prepared, unavailable };
  if (!signal?.aborted) onProgress?.(report);
  return report;
}

// No network fallback: a missing/denied browser copy remains a manual choice.
export async function restoreLocalSoundfont({ signal, preferredPreset, canLoadColdBank, readMixer, restoreSelectedSound } = {}) {
  if (!restoreSoundOnReload()) return null;
  if (peekFluidSynthEngine()?.soundfontId != null) return null;
  const working = readRememberedSoundfont(sessionStorage);
  let source;
  let preset;
  if (restoreSelectedSound && !working) {
    const sounds = loadUserSounds();
    const reference = findSound(restoreSelection(sounds).selection, sounds)?.soundfont;
    if (!reference?.name) return null;
    const target = await resolveSoundfontRecall(reference, peekFluidSynthEngine, () => !signal?.aborted);
    if (!target?.source) return null;
    source = target.source;
    preset = target.candidate.preset;
  } else {
    const remembered = working ?? readRememberedSoundfont();
    if (!remembered?.name) return null;
    const key = soundfontStorageKey(remembered);
    let bank;
    try { bank = await readOfflineSoundfont(key); }
    catch { return null; }
    if (!bank?.blob) return null;
    source = createSoundfontSource({ name: remembered.name, url: key, cachedBank: bank, signal });
    try {
      const saved = JSON.parse(localStorage.getItem(BANK_PRESETS_KEY) || "{}");
      preset = saved[key] ?? saved[legacyLocalSoundfontKey(key)];
    } catch { /* Use the current preset preference. */ }
  }
  signal?.throwIfAborted();
  if (peekFluidSynthEngine()?.soundfontId != null) return null;
  const result = await loadFluidSynthSoundFont(source, { signal, canLoadColdBank, preferredPreset: preset ?? preferredPreset });
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
      if (!activeSignal?.aborted) options.onActiveReady?.(active);
    } catch (error) {
      if (!activeSignal?.aborted) options.onActiveError?.(error);
    }
  }
  if (options.signal?.aborted) return;
  await restorePerformanceSoundfonts(options);
  if (activeSignal?.aborted) return;
  return active && { ...active, selectedPreset: peekFluidSynthEngine()?.selectedPreset ?? active.selectedPreset };
}
