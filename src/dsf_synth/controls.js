// Saved sound controls, shared by the UI, adapter and worklet.
export const dsfEnvelopeStep = value => value <= 100 ? 1 : value <= 500 ? 5 : value <= 1000 ? 10 : 20;
export const DSF_DEFAULTS = Object.freeze({ partials: 1024, timbre: 0.25, attack: 12, decay: 1500, sustain: 1.5, release: 120,
  volumeEnvelope: true, timbreEnvelope: true,
  timbreAmount: -0.5, timbreAttack: 750, timbreDecay: 5000, timbreSustain: -0.75, timbreRelease: 2,
  volume: 0.25, velocity: true, velocityVolume: 0.5, velocityTimbre: 0.5, velocityAttack: 0.5, releaseVelocity: true, releaseVelocityRelease: 0.5, pressure: 0.5, timbreResponse: 0.5, iso226: 0 });
const bounded = (value, fallback, low, high) => Number.isFinite(Number(value))
  ? Math.max(low, Math.min(high, Number(value))) : fallback;
const legacyAmount = (value, fallback) => value === false ? 0 : value === true ? 1 : fallback;
export function normalizeDsfControls(values = {}) {
  const legacyRelease = legacyAmount(values.releaseVelocity, DSF_DEFAULTS.releaseVelocityRelease);
  const releaseVelocityRelease = bounded(values.releaseVelocityRelease ?? legacyRelease, legacyRelease, 0, 1);
  const legacyVelocity = values.velocity;
  values = { ...DSF_DEFAULTS, ...values,
    velocityVolume: values.velocityVolume ?? legacyAmount(legacyVelocity, DSF_DEFAULTS.velocityVolume),
    velocityTimbre: values.velocityTimbre ?? legacyAmount(legacyVelocity, DSF_DEFAULTS.velocityTimbre),
    velocityAttack: values.velocityAttack ?? legacyAmount(legacyVelocity, DSF_DEFAULTS.velocityAttack) };
  const velocityVolume = bounded(values.velocityVolume, legacyAmount(legacyVelocity, DSF_DEFAULTS.velocityVolume), 0, 1);
  const velocityTimbre = bounded(values.velocityTimbre, legacyAmount(legacyVelocity, DSF_DEFAULTS.velocityTimbre), 0, 1);
  const velocityAttack = bounded(values.velocityAttack, legacyAmount(legacyVelocity, DSF_DEFAULTS.velocityAttack), 0, 1);
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
    // Aggregate flags serve legacy settings only;
    // each sound destination uses its independent compiled route amount.
    velocity, velocityVolume, velocityTimbre, velocityAttack,
    releaseVelocity: releaseVelocityRelease > 0, releaseVelocityRelease,
    pressure: bounded(values.pressure === "true" ? 1 : values.pressure === "false" ? 0 : values.pressure, DSF_DEFAULTS.pressure, 0, 1),
    timbreResponse: bounded(values.timbreResponse === "true" ? 1 : values.timbreResponse === "false" ? 0 : values.timbreResponse, DSF_DEFAULTS.timbreResponse, 0, 1),
    iso226: bounded(values.iso226 === "true" ? 1 : values.iso226 === "false" ? 0 : values.iso226, DSF_DEFAULTS.iso226, 0, 1),
  };
}
// Keep migration at the settings boundary; rendering only sees normalized amounts.
function savedControl(settings, key) {
  const saved = settings[`dsf_${key}`];
  if (saved != null) return saved;
  if (["velocityVolume", "velocityTimbre", "velocityAttack"].includes(key))
    return legacyAmount(settings.dsf_velocity, DSF_DEFAULTS[key]);
  if (key === "releaseVelocityRelease")
    return legacyAmount(settings.dsf_releaseVelocity ?? settings.dsf_velocity, DSF_DEFAULTS[key]);
  if (key === "releaseVelocity") return settings.dsf_velocity ?? DSF_DEFAULTS[key];
  return DSF_DEFAULTS[key];
}
export function dsfControlsFromSettings(settings = {}) {
  return normalizeDsfControls(Object.fromEntries(Object.keys(DSF_DEFAULTS)
    .map(key => [key, savedControl(settings, key)])));
}
