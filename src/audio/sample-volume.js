// Shared by the sample controls and graph installation; zero is a saved mute.
export function readSampleVolume() {
  const value = Number(localStorage.getItem("synth_volume") ?? 0.5);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}
