/** Shared native/browser comparison messages. Owns only laboratory nodes;
 * never frees a server root or Hexatone's existing voices. No audio scheduler.
 */
import { formantPresetToOscArgs, pickRandomFormantPreset } from "../osc_synth/formant-table.js";

export const COMPARISON_GROUP = 193260926;
export const COMPARISON_INSTRUMENTS = ["string", "formant", "pluck", "tone"];

export function comparisonControls(values) {
  const bounded = (key, fallback, min, max) => {
    const number = Number(values[key]);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  };
  return [
    "freq", bounded("frequency", 220, 20, 16000),
    "on_vel", bounded("velocity", 80, 1, 127),
    "off_vel", 64, "vol", bounded("level", 0.06, 0, 0.3),
    "expressionY", bounded("mod", 1, 1, 2) - 1,
    "pressure", bounded("filter", 1, 1, 2) - 1,
    "sustain_mode", 0,
    "retrigger_mode", values.retrigger ? 1 : 0,
  ];
}

export function createComparisonVoice(send, allocateId, random = Math.random) {
  let current = null;
  const controls = comparisonControls;
  return {
    attack(instrument, values) {
      if (!COMPARISON_INSTRUMENTS.includes(instrument)) throw new Error("Unknown instrument");
      this.release();
      current = allocateId();
      const formants = instrument === "formant"
        ? formantPresetToOscArgs(pickRandomFormantPreset(random)).map(arg => arg.value) : [];
      send("/s_new", `hexlab_${instrument}`, current, 0, COMPARISON_GROUP,
        ...controls(values), ...formants, "gate", 1);
    },
    update(values) {
      if (current != null) send("/n_set", current, ...controls(values));
    },
    release() {
      if (current != null) send("/n_set", current, "gate", 0);
      current = null;
    },
    ended(id) { if (id === current) current = null; },
    panic() { current = null; send("/g_freeAll", COMPARISON_GROUP); },
  };
}

export function nativeComparisonMessage(port, address, args) {
  // Bridge plain numbers default to float; IDs/add actions must be OSC integers.
  const integerPositions = address === "/s_new" ? [1, 2, 3]
    : address === "/g_new" ? [0, 1, 2] : [0];
  return { port, address, args: args.map((value, index) => ({
    type: typeof value === "string" ? "s" : integerPositions.includes(index) ? "i" : "f",
    value,
  })) };
}
