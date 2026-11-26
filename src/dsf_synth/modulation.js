// Musical response policy lives here, independently of voices, envelopes and UI.
// A future expert mode can supply a validated profile to compileDsfModulation;
// saved amount controls and the audio rendering path need not change.
export const DSF_RESPONSE_PROFILE = Object.freeze({
  velocityVolume: Object.freeze({ low: 0.25, high: 4 }),
  velocityTimbre: Object.freeze({ depth: 0.25, linearWeight: 0.5 }),
  velocityAttack: Object.freeze({ low: 4, high: 0.25 }),
  releaseVelocityRelease: Object.freeze({ low: 4, high: 0.25 }),
  pressureVolume: Object.freeze({ boost: 3, exponent: 3 }),
  pressureTimbre: Object.freeze({ depth: 0.06, peak: 0.04, end: 0.3 }),
  expressionYTimbre: Object.freeze({ center: 0.5, low: -0.05, high: 0.1 }),
});

const route = (control, label, source, destinations, operation, curve, timing) => Object.freeze({
  control, label, source, destinations: Object.freeze(destinations), operation, curve, timing,
});

// Source/destination vocabulary for future matrix editing. Only the first four
// routes expose amount faders today; Y/Z retain their existing shared switches.
export const DSF_MODULATION_ROUTES = Object.freeze([
  route("velocityVolume", "Velocity → Volume", "velocity", ["volume"], "multiply", "cubic", "note-on/live"),
  route("velocityTimbre", "Velocity → Timbre", "velocity", ["timbre"], "add", "gentle", "note-on/live"),
  route("velocityAttack", "Velocity → Attack", "velocity", ["volumeAttack", "timbreAttack"], "multiply", "cubic", "note-on"),
  route("releaseVelocityRelease", "Release Velocity → Release", "releaseVelocity", ["volumeRelease", "timbreRelease"], "multiply", "cubic", "note-off"),
  route("pressure", "Pressure (Z)", "pressure", ["volume"], "multiply", "power", "control"),
  route("pressure", "Pressure bite", "pressure", ["timbre"], "add", "bite", "control"),
  route("timbreResponse", "Expression (Y)", "expressionY", ["timbre"], "add", "split-linear", "control"),
]);
export const DSF_AMOUNT_ROUTES = Object.freeze(DSF_MODULATION_ROUTES.slice(0, 4));

export const unitValue = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
export function centeredVelocity(velocity) {
  const value = unitValue((velocity ?? 64) / 127) * 127;
  return (value - 64) / (value < 64 ? 64 : 63);
}
export const velocityCurve = velocity => centeredVelocity(velocity) ** 3;
export function gentleVelocityCurve(velocity, linearWeight = DSF_RESPONSE_PROFILE.velocityTimbre.linearWeight) {
  const offset = centeredVelocity(velocity);
  return offset * (linearWeight + (1 - linearWeight) * Math.abs(offset));
}

const amount = (controls, key, legacy) => controls[key] ?? (controls[legacy] === false ? 0 : 1);
const multiplier = (range, depth) => ({ low: depth * (1 - range.low), high: depth * (range.high - 1) });

// Compile once per controls update. No route lookup, temporary arrays or profile
// construction happens in the sample loop. Off routes compile to neutral values.
export function compileDsfModulation(controls, profile = DSF_RESPONSE_PROFILE) {
  return {
    volume: multiplier(profile.velocityVolume, amount(controls, "velocityVolume", "velocity")),
    timbreDepth: profile.velocityTimbre.depth * amount(controls, "velocityTimbre", "velocity"),
    timbreLinearWeight: profile.velocityTimbre.linearWeight,
    attack: multiplier(profile.velocityAttack, amount(controls, "velocityAttack", "velocity")),
    release: multiplier(profile.releaseVelocityRelease, amount(controls, "releaseVelocityRelease", "releaseVelocity")),
    pressureBoost: controls.pressure ? profile.pressureVolume.boost : 0,
    pressureExponent: profile.pressureVolume.exponent,
    biteDepth: controls.pressure ? profile.pressureTimbre.depth : 0,
    bitePeak: profile.pressureTimbre.peak,
    biteEnd: profile.pressureTimbre.end,
    yLowSlope: controls.timbreResponse ? -profile.expressionYTimbre.low / profile.expressionYTimbre.center : 0,
    yHighSlope: controls.timbreResponse ? profile.expressionYTimbre.high / (1 - profile.expressionYTimbre.center) : 0,
    yCenter: profile.expressionYTimbre.center,
  };
}

export const velocityMultiplier = (coefficients, curve) => 1 + curve * (curve < 0 ? coefficients.low : coefficients.high);
export const relativeTimbreOffset = (base, offset) => offset * (offset < 0 ? base : 1 - base);
export function expressionYTimbre(compiled, value) {
  if (!compiled.yLowSlope && !compiled.yHighSlope) return 0;
  return (value - compiled.yCenter) * (value < compiled.yCenter ? compiled.yLowSlope : compiled.yHighSlope);
}
export const pressureGain = (compiled, pressure) => compiled.pressureBoost
  ? 1 + compiled.pressureBoost * pressure ** compiled.pressureExponent : 1;
const smooth = value => value * value * (3 - 2 * value);
export function pressureBite(compiled, pressure) {
  if (!compiled.biteDepth || pressure <= 0 || pressure >= compiled.biteEnd) return 0;
  if (pressure < compiled.bitePeak) return compiled.biteDepth * smooth(pressure / compiled.bitePeak);
  return compiled.biteDepth * (1 - smooth((pressure - compiled.bitePeak) / (compiled.biteEnd - compiled.bitePeak)));
}

export function modulationRouteDescription(control, profile = DSF_RESPONSE_PROFILE) {
  if (control === "pressure") {
    const boostDb = (20 * Math.log10(1 + profile.pressureVolume.boost)).toFixed(0);
    const bite = profile.pressureTimbre;
    return `Pressure adds up to ${boostDb} dB, mostly toward full pressure. Light pressure adds up to ${bite.depth * 100} percentage points of timbre bite, fading along an S-curve by ${bite.end * 100}% pressure.`;
  }
  if (control === "timbreResponse") {
    const range = profile.expressionYTimbre;
    return `Expression Y shifts timbre by ${range.low * 100} percentage points at minimum, 0 at ${range.center * 100}% and +${range.high * 100} at maximum. The total is limited to 0–1.`;
  }
  if (control === "velocityTimbre") {
    const depth = profile.velocityTimbre.depth * 100;
    return `At 100%, velocity shifts timbre from −${depth} to +${depth} percentage points, with MIDI 64 neutral and a gentle curve toward the extremes. At 0%, velocity does not change timbre.`;
  }
  const range = profile[control];
  const destination = control === "velocityVolume" ? "volume" : control === "velocityAttack" ? "both ADSR attack times" : "both ADSR release times";
  return `At 100%, velocity scales ${destination} from ×${range.low} at minimum to ×${range.high} at maximum, with MIDI 64 unchanged. At 0%, this route has no effect.${control === "velocityVolume" ? "" : " Zero-time stages stay immediate; changes apply to new stages."}`;
}
