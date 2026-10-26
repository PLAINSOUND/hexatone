// Fixed defaults until controller bindings are exposed in the Keybindings tab.
export const EXQUIS_BEND_BYPASS_CC = 32;

export function exquisBendBypassControl(cc, value) {
  return cc === EXQUIS_BEND_BYPASS_CC ? value >= 64 : null;
}

// One colour per equave; saturate at the spectral endpoints rather than wrap.
const OCTAVE_DOWN_RGB = [[60, 56, 0], [60, 34, 0], [60, 15, 0], [60, 0, 0]];
const OCTAVE_UP_RGB = [[32, 60, 0], [0, 60, 0], [0, 60, 38], [0, 10, 60], [40, 0, 60]];
export function exquisOctaveButtonRgb(offset, direction, flash = false) {
  const step = Number.isFinite(offset) ? Math.trunc(offset) : 0;
  let rgb = step === 0 ? [40, 40, 40] : [20, 20, 20];
  if (Math.sign(step) === direction) {
    const palette = direction < 0 ? OCTAVE_DOWN_RGB : OCTAVE_UP_RGB;
    rgb = palette[Math.min(Math.abs(step) - 1, palette.length - 1)];
  }
  // Raise brightness without clipping channels independently and changing hue.
  const gain = flash ? 127 / Math.max(...rgb) : 1;
  return rgb.map(value => Math.round(value * gain));
}
