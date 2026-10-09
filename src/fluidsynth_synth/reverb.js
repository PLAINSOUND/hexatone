export const REVERB_KEY = "fluidsynth_internal_reverb";

export function readFluidSynthReverb() {
  try {
    const stored = localStorage.getItem(REVERB_KEY);
    const value = stored == null ? 20 : Number(stored);
    return Number.isFinite(value) ? Math.max(0, Math.min(127, Math.round(value))) : 20;
  } catch { return 20; }
}
