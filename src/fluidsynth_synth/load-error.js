// Emscripten can wrap the same RangeError repeatedly when its runtime aborts.
export function soundfontErrorDetail(reason) {
  const text = String(reason?.message ?? reason);
  if (/aborted\s*\(\s*(?:runtimeerror:\s*aborted\s*\(\s*)?range\s*error/i.test(text)) {
    return "FluidSynth stopped while loading the bank. Reload the page before trying again.";
  }
  return text;
}
