/** Output-only HSV value/saturation multipliers, applied after colour transfer.
 * Work from original RGB on every send; never accumulate rounded adjustments.
 */
export function normalizeLumatoneColourMultiplier(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(2, value)) : 1;
}

export function adjustLumatoneColour({ r, g, b }, brightness = 1, saturation = 1) {
  brightness = normalizeLumatoneColourMultiplier(brightness);
  saturation = normalizeLumatoneColourMultiplier(saturation);
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  if (maximum === 0) return { r: 0, g: 0, b: 0 };
  // HSV saturation scales distances from the brightest component. Limit it
  // before conversion so clipping does not change the hue.
  const saturationScale = maximum === minimum ? 0
    : Math.min(saturation, maximum / (maximum - minimum));
  const brightnessScale = Math.min(brightness, 255 / maximum);
  const channels = [r, g, b].map(channel => Math.round(
    (maximum + (channel - maximum) * saturationScale) * brightnessScale,
  ));
  return { r: channels[0], g: channels[1], b: channels[2] };
}
