import { readOfflineSoundfont, soundfontStorageKey } from "./soundfont-storage.js";
import { loadFluidSynthSoundFont, peekFluidSynthEngine } from "./index.js";

export const LAST_SOUNDFONT_KEY = "fluidsynth_last_soundfont_source";

// No network fallback: a missing/denied browser copy remains a manual choice.
export async function restoreLocalSoundfont({ signal, preferredPreset } = {}) {
  if (peekFluidSynthEngine()?.soundfontId != null) return null;
  let source;
  try {
    source = JSON.parse(localStorage.getItem(LAST_SOUNDFONT_KEY) || "null");
    if (!source) {
      const name = localStorage.getItem("fluidsynth_last_hosted_soundfont");
      if (name) source = { name, url: new URL(encodeURIComponent(name), "https://soundfonts.plainsound.org/").href };
    }
  } catch { return null; }
  if (!source?.name) return null;
  const key = soundfontStorageKey(source);
  let bank;
  try { bank = await readOfflineSoundfont(key); }
  catch { return null; }
  signal?.throwIfAborted();
  if (!bank?.blob || peekFluidSynthEngine()?.soundfontId != null) return null;
  let savedPreset;
  try { savedPreset = JSON.parse(localStorage.getItem("fluidsynth_bank_presets") || "{}")[key]; }
  catch { /* Use the current preset preference. */ }
  const result = await loadFluidSynthSoundFont({
    name: source.name, url: source.url || "", arrayBuffer: () => bank.blob.arrayBuffer(),
  }, { signal, preferredPreset: savedPreset ?? preferredPreset });
  const engine = peekFluidSynthEngine();
  engine?.setVolume(Number(localStorage.getItem("fluidsynth_internal_volume") ?? 75));
  return { ...result, selectedPreset: engine?.selectedPreset };
}
