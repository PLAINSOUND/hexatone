// Reuse the Eagan/Max targets, independent pressure gates and ramp timings.
// In that MIDI path Y is CC74 (timbre), while Z is channel pressure (level).
import { AUTO_MPE_YZ_DEFAULTS as defaults, createAutoMpeYzRampEngine,
  velocityTarget, pressureTarget, velocityRampDuration, releaseRampDuration } from "../mpe_synth/auto-yz.js";

export function createDsfYzEnvelope(velocity, at) {
  const yBase = velocityTarget(velocity, defaults.yVelocityRange, defaults.yCenter);
  const zBase = velocityTarget(velocity, defaults.zVelocityRange, defaults.zCenter);
  const engine = createAutoMpeYzRampEngine(() => {});
  let yActive = false, zActive = false;
  const schedule = (y, z, duration, time) => engine.schedule(0, y, z, duration, time, 0, time, false);
  schedule(yBase, zBase, velocityRampDuration(velocity), at);
  return {
    pressure(value, time) {
      const pressure = Math.max(0, Math.min(127, Math.round(value * 127)));
      yActive ||= pressure > yBase;
      zActive ||= pressure > zBase;
      if (!yActive && !zActive) return;
      schedule(yActive ? pressureTarget(pressure, yBase, defaults.yAftertouchRange) : yBase,
        zActive ? pressureTarget(pressure, zBase, defaults.zAftertouchRange) : zBase,
        defaults.aftertouchRampMs, time);
    },
    release(value, time) { schedule(0, 0, releaseRampDuration(value), time); },
    sample(time) {
      const value = engine.sample(0, time);
      return { timbre: value.y / 127, pressure: value.z / 127 };
    },
  };
}
