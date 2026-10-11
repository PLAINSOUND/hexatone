// Shared by sequencer and audio faders: engage near the default, release
// farther away, and remap the remaining travel so endpoints remain reachable.
export function deriveStickyCenterValue(rawValue, {
  lockRef, engageThreshold = 0, releaseThreshold = engageThreshold,
  maxAbs = 1, outputMaxAbs = maxAbs,
} = {}) {
  const raw = Number(rawValue) || 0;
  const distance = Math.abs(raw);
  const sign = Math.sign(raw);
  const engage = Math.max(0, Number(engageThreshold) || 0);
  const release = Math.max(engage, Number(releaseThreshold) || 0);
  const maximum = Math.max(release, Number(maxAbs) || 0);
  const outputMaximum = Math.max(0, Number(outputMaxAbs) || 0);
  if (lockRef?.current) {
    if (distance <= release) return { sliderValue: 0, outputValue: 0, locked: true };
    lockRef.current = false;
  }
  if (distance <= engage) {
    if (lockRef) lockRef.current = true;
    return { sliderValue: 0, outputValue: 0, locked: true };
  }
  if (maximum <= release) return {
    sliderValue: raw, outputValue: sign * Math.min(outputMaximum, distance), locked: false,
  };
  const normalized = Math.max(0, Math.min(1, (distance - release) / (maximum - release)));
  return { sliderValue: sign * normalized * maximum,
    outputValue: sign * normalized * outputMaximum, locked: false };
}
