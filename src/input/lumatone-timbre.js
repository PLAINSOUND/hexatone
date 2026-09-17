// Temporary Lumatone pedal calibration; MIDI CC output must remain 0–127.
export function calibrateLumatoneFoot(value) {
  return Math.round(Math.max(0, Math.min(1, (value - 18) / (125 - 18))) * 127);
}

// Values supplied here are already calibrated, so pickup uses output space.
// Return the effective CC, or null while a timbre source awaits pickup.
export function routeLumatoneTimbre(runtime, cc, value) {
  const wheel = runtime.settings.lumatone_modwheel_timbre !== false;
  const foot = runtime.settings.lumatone_foot_timbre === true;
  const signature = `${runtime.settings.midiin_device}:${wheel}:${foot}`;
  if (runtime._lumatoneTimbre?.signature !== signature) {
    runtime._lumatoneTimbre = {
      signature,
      target: runtime._controllerCCValues?.get(1),
      owner: null,
      previous: new Map(),
    };
  }
  if (cc !== 1 && cc !== 4) return cc;
  if (cc === 1 && !wheel) return null;
  if (cc === 4 && !foot) return cc;
  const state = runtime._lumatoneTimbre;
  const previous = state.previous.get(cc);
  state.previous.set(cc, value);
  if (wheel && foot && state.owner !== cc && Number.isFinite(state.target)) {
    const near = Math.abs(value - state.target) <= 2;
    const crossed = previous != null && (previous - state.target) * (value - state.target) <= 0;
    if (!near && !crossed) return null;
  }
  state.owner = cc;
  state.target = value;
  return 1;
}
