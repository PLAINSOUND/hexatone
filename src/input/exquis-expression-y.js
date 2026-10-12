// Keep the full expression range while moving the physical midpoint to the
// chosen brightness. Do not round: 20% is exactly 25.4 in MIDI-value units.
export function shapeExquisExpressionY(value, brightness = 0.2) {
  const y = Math.max(0, Math.min(127, Number(value) || 0));
  const centre = Math.max(0, Math.min(1, Number(brightness) || 0)) * 127;
  return y <= 64 ? y / 64 * centre : centre + (y - 64) / 63 * (127 - centre);
}
