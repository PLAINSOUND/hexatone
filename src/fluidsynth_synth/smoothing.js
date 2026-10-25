export const SMOOTHING_KEY = "fluidsynth_internal_smoothing";

export function normalizeFluidSynthSmoothing(value = {}) {
  const time = (input) => Number.isFinite(Number(input))
    ? Math.max(0, Math.min(500, Math.round(Number(input)))) : 0;
  const pressureMs = time(value?.pressureMs), expressionMs = time(value?.expressionMs);
  const enabled = [pressureMs, expressionMs].filter(ms => ms > 0);
  return { pressureMs, expressionMs,
    minimumMs: Math.min(time(value?.minimumMs), enabled.length ? Math.min(...enabled) : 0) };
}

export function readFluidSynthSmoothing() {
  try { return normalizeFluidSynthSmoothing(JSON.parse(localStorage.getItem(SMOOTHING_KEY) || "{}")); }
  catch { return normalizeFluidSynthSmoothing(); }
}
