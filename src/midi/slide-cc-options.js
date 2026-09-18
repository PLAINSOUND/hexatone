// Standard names: https://midi.org/midi-1-0-control-change-messages
const names = {
  1: "Modulation Wheel",
  2: "Breath Controller",
  4: "Foot Controller",
  5: "Portamento Time",
  7: "Channel Volume",
  8: "Balance",
  10: "Pan",
  11: "Expression",
  12: "Effect Control 1",
  13: "Effect Control 2",
  16: "General Purpose 1",
  17: "General Purpose 2",
  18: "General Purpose 3",
  19: "General Purpose 4",
  64: "Sustain Pedal",
  65: "Portamento On/Off",
  66: "Sostenuto",
  67: "Soft Pedal",
  68: "Legato Footswitch",
  69: "Hold 2",
  70: "Sound Variation",
  71: "Timbre / Harmonic Intensity",
  72: "Release Time",
  73: "Attack Time",
  74: "Brightness",
  75: "Decay Time",
  76: "Vibrato Rate",
  77: "Vibrato Depth",
  78: "Vibrato Delay",
  79: "Sound Controller 10",
  80: "General Purpose 5",
  81: "General Purpose 6",
  82: "General Purpose 7",
  83: "General Purpose 8",
  91: "Effects 1 Depth (Reverb)",
  92: "Effects 2 Depth",
  93: "Effects 3 Depth (Chorus)",
  94: "Effects 4 Depth",
  95: "Effects 5 Depth",
};

// Bank select, parameter editing, note-number portamento control, velocity
// prefix and channel-mode messages are not ordinary slide destinations.
const excluded = new Set([0, 6, 32, 38, 84, 88, 96, 97, 98, 99, 100, 101]);
export const SLIDE_CC_OPTIONS = Array.from({ length: 120 }, (_, cc) => cc)
  .filter((cc) => !excluded.has(cc))
  .map((cc) => ({
    cc,
    label: `${cc} — ${cc >= 32 && cc <= 63 ? `${names[cc - 32] || `CC${cc - 32}`} (LSB)` : names[cc] || "Undefined"}`,
  }));

export function normaliseSlideCc(value) {
  const cc = Number(value);
  return value != null && Number.isInteger(cc) && cc >= 0 && cc < 120 && !excluded.has(cc)
    ? cc
    : 74;
}
