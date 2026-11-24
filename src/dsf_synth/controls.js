// Saved sound controls, shared by the UI, adapter and worklet.
export const dsfEnvelopeStep = value => value <= 100 ? 1 : value <= 500 ? 5 : value <= 1000 ? 10 : 20;
export const DSF_DEFAULTS = Object.freeze({ partials: 1024, timbre: 0.25, attack: 10, decay: 0, sustain: 1, release: 120,
  volumeEnvelope: true, timbreEnvelope: true,
  timbreAmount: 0, timbreAttack: 10, timbreDecay: 100, timbreSustain: 0, timbreRelease: 120,
  volume: 0.25, velocity: true, releaseVelocity: true, pressure: true, timbreResponse: true, iso226: 1, generateYZ: false });
const bounded = (value, fallback, low, high) => Number.isFinite(Number(value))
  ? Math.max(low, Math.min(high, Number(value))) : fallback;
export function normalizeDsfControls(values = {}) {
  values = { ...DSF_DEFAULTS, ...values };
  return {
    partials: Math.round(bounded(values.partials, DSF_DEFAULTS.partials, 1, 1024)),
    timbre: bounded(values.timbre, DSF_DEFAULTS.timbre, 0, 1),
    attack: bounded(values.attack, DSF_DEFAULTS.attack, 0, 2000),
    decay: bounded(values.decay, DSF_DEFAULTS.decay, 0, 4000),
    sustain: bounded(values.sustain, DSF_DEFAULTS.sustain, 0, 2),
    release: bounded(values.release, DSF_DEFAULTS.release, 0, 4000),
    volumeEnvelope: values.volumeEnvelope !== false,
    timbreEnvelope: values.timbreEnvelope !== false,
    timbreAmount: bounded(values.timbreAmount, DSF_DEFAULTS.timbreAmount, -1, 1),
    timbreAttack: bounded(values.timbreAttack, DSF_DEFAULTS.timbreAttack, 0, 2000),
    timbreDecay: bounded(values.timbreDecay, DSF_DEFAULTS.timbreDecay, 0, 4000),
    timbreSustain: bounded(values.timbreSustain, DSF_DEFAULTS.timbreSustain, 0, 2),
    timbreRelease: bounded(values.timbreRelease, DSF_DEFAULTS.timbreRelease, 0, 4000),
    volume: bounded(values.volume, DSF_DEFAULTS.volume, 0, 1),
    velocity: values.velocity === true,
    releaseVelocity: values.releaseVelocity === true,
    pressure: values.pressure === true,
    timbreResponse: values.timbreResponse === true,
    iso226: bounded(values.iso226 === "true" ? 1 : values.iso226 === "false" ? 0 : values.iso226, DSF_DEFAULTS.iso226, 0, 1),
    generateYZ: values.generateYZ === true && values.velocity === true && values.pressure === true,
  };
}
export function dsfControlsFromSettings(settings = {}) {
  return normalizeDsfControls(Object.fromEntries(Object.keys(DSF_DEFAULTS)
    .map(key => [key, settings[`dsf_${key}`] ?? (key === "releaseVelocity" ? settings.dsf_velocity ?? DSF_DEFAULTS[key] : DSF_DEFAULTS[key])])));
}
