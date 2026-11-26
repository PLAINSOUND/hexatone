// Saved sound controls, shared by the UI, adapter and worklet.
export const dsfEnvelopeStep = value => value <= 100 ? 1 : value <= 500 ? 5 : value <= 1000 ? 10 : 20;
export const DSF_DEFAULTS = Object.freeze({ partials: 1024, timbre: 0.25, attack: 10, decay: 0, sustain: 1, release: 120,
  volumeEnvelope: true, timbreEnvelope: true,
  timbreAmount: 0, timbreAttack: 10, timbreDecay: 100, timbreSustain: 0, timbreRelease: 120,
  volume: 0.25, velocity: true, velocityVolume: 1, velocityTimbre: 1, velocityAttack: 1, releaseVelocity: true, releaseVelocityRelease: 1, pressure: true, timbreResponse: true, iso226: 1, generateYZ: false });
const bounded = (value, fallback, low, high) => Number.isFinite(Number(value))
  ? Math.max(low, Math.min(high, Number(value))) : fallback;
export function normalizeDsfControls(values = {}) {
  const legacyRelease = values.releaseVelocity === false ? 0 : 1;
  const releaseVelocityRelease = bounded(values.releaseVelocityRelease ?? legacyRelease, legacyRelease, 0, 1);
  const legacyVelocity = values.velocity === false ? 0 : 1;
  values = { ...DSF_DEFAULTS, ...values,
    velocityVolume: values.velocityVolume ?? legacyVelocity,
    velocityTimbre: values.velocityTimbre ?? legacyVelocity,
    velocityAttack: values.velocityAttack ?? legacyVelocity };
  const velocityVolume = bounded(values.velocityVolume, legacyVelocity, 0, 1);
  const velocityTimbre = bounded(values.velocityTimbre, legacyVelocity, 0, 1);
  const velocityAttack = bounded(values.velocityAttack, legacyVelocity, 0, 1);
  const velocity = velocityVolume > 0 || velocityTimbre > 0 || velocityAttack > 0;
  return {
    partials: Math.round(bounded(values.partials, DSF_DEFAULTS.partials, 1, 1024)),
    timbre: bounded(values.timbre, DSF_DEFAULTS.timbre, 0, 1),
    attack: bounded(values.attack, DSF_DEFAULTS.attack, 0, 2000),
    decay: bounded(values.decay, DSF_DEFAULTS.decay, 0, 5000),
    sustain: bounded(values.sustain, DSF_DEFAULTS.sustain, 0, 2),
    release: bounded(values.release, DSF_DEFAULTS.release, 0, 4000),
    volumeEnvelope: values.volumeEnvelope !== false,
    timbreEnvelope: values.timbreEnvelope !== false,
    timbreAmount: bounded(values.timbreAmount, DSF_DEFAULTS.timbreAmount, -1, 1),
    timbreAttack: bounded(values.timbreAttack, DSF_DEFAULTS.timbreAttack, 0, 2000),
    timbreDecay: bounded(values.timbreDecay, DSF_DEFAULTS.timbreDecay, 0, 5000),
    timbreSustain: bounded(values.timbreSustain, DSF_DEFAULTS.timbreSustain, -1, 1),
    timbreRelease: bounded(values.timbreRelease, DSF_DEFAULTS.timbreRelease, 0, 4000),
    volume: bounded(values.volume, DSF_DEFAULTS.volume, 0, 1),
    // Aggregate flags serve legacy settings and Generate YZ eligibility only;
    // each sound destination uses its independent compiled route amount.
    velocity, velocityVolume, velocityTimbre, velocityAttack,
    releaseVelocity: releaseVelocityRelease > 0, releaseVelocityRelease,
    pressure: values.pressure === true,
    timbreResponse: values.timbreResponse === true,
    iso226: bounded(values.iso226 === "true" ? 1 : values.iso226 === "false" ? 0 : values.iso226, DSF_DEFAULTS.iso226, 0, 1),
    generateYZ: values.generateYZ === true && velocity && values.pressure === true,
  };
}
// Keep migration at the settings boundary; rendering only sees normalized amounts.
function savedControl(settings, key) {
  const saved = settings[`dsf_${key}`];
  if (saved != null) return saved;
  if (["velocityVolume", "velocityTimbre", "velocityAttack"].includes(key))
    return settings.dsf_velocity === false ? 0 : 1;
  if (key === "releaseVelocityRelease")
    return (settings.dsf_releaseVelocity ?? settings.dsf_velocity) === false ? 0 : 1;
  if (key === "releaseVelocity") return settings.dsf_velocity ?? DSF_DEFAULTS[key];
  return DSF_DEFAULTS[key];
}
export function dsfControlsFromSettings(settings = {}) {
  return normalizeDsfControls(Object.fromEntries(Object.keys(DSF_DEFAULTS)
    .map(key => [key, savedControl(settings, key)])));
}
