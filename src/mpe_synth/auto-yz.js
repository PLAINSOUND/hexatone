// A half-millisecond Web MIDI grid gives the EaganMatrix a denser onset and
// release trajectory. Web MIDI timestamps accept fractional milliseconds even
// when the worker timer used by longer pressure ramps is more coarsely clamped.
const SAMPLE_MS = 0.5;
const AFTERTOUCH_RAMP_MS = 40;

// Empirical calibration against the Max/Eagan Matrix reference stream.
// Centers and ranges are 7-bit MIDI values; lag factors convert velocity
// distance into milliseconds. Keep these together until they become exposed
// musical parameters so changes can be compared as one calibration set.
export const AUTO_MPE_YZ_DEFAULTS = Object.freeze({
  yVelocityRange: 0.5,
  yCenter: 38,
  yAftertouchRange: 1,
  zVelocityRange: 0.69,
  zCenter: 69,
  zAftertouchRange: 0.69,
  velocityLagFactor: 0.08,
  // Max's VelToZY patch applies the same `115 - velocity` lag basis to
  // release velocity as it does to attack velocity.
  releaseVelocityPivot: 115,
  releaseVelocityLagFactor: 0.08,
  releaseStateLookbackMs: 3,
  aftertouchRampMs: AFTERTOUCH_RAMP_MS,
});

const clamp7 = (value) => Math.max(0, Math.min(127, Math.round(Number(value) || 0)));
const clampContinuous7 = (value) => Math.max(0, Math.min(127, Number(value) || 0));

export function velocityTarget(velocity, range, center) {
  const normalizedRange = Math.max(0, Math.min(1, Number(range) || 0));
  return clamp7(clamp7(velocity) * normalizedRange + (1 - normalizedRange) * clamp7(center));
}

export function pressureTarget(pressure, velocityBase, range) {
  const normalizedRange = Math.max(0, Math.min(1, Number(range) || 0));
  const base = clamp7(velocityBase);
  return clamp7(base + (clamp7(pressure) - base) * normalizedRange);
}

export function velocityRampDuration(velocity, factor = AUTO_MPE_YZ_DEFAULTS.velocityLagFactor) {
  return Math.max(0, 115 - clamp7(velocity)) * Math.max(0, Number(factor) || 0);
}

export function releaseRampDuration(
  velocity,
  factor = AUTO_MPE_YZ_DEFAULTS.releaseVelocityLagFactor,
  pivot = AUTO_MPE_YZ_DEFAULTS.releaseVelocityPivot,
) {
  return Math.max(0, clamp7(pivot) - clamp7(velocity)) * Math.max(0, Number(factor) || 0);
}

function rampValue(ramp, at) {
  if (!ramp) return 0;
  if (ramp.duration <= 0 || at >= ramp.startAt + ramp.duration) return ramp.to;
  if (at <= ramp.startAt) return ramp.from;
  return clampContinuous7(
    ramp.from + ((ramp.to - ramp.from) * (at - ramp.startAt)) / ramp.duration,
  );
}

function midiNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/**
 * Cancellable ramp state shared by the worker and the timer fallback. There is
 * exactly one current generation per MPE member channel. Replacing it changes
 * the mathematical ramp instead of appending another stream.
 */
export function createAutoMpeYzRampEngine(emit) {
  const channels = new Map();

  const output = (state, at) => {
    if (state.muted) return;
    const y = clamp7(rampValue(state.yRamp, at));
    const z = clamp7(rampValue(state.zRamp, at));
    if (state.lastY === y && state.lastZ === z) return;
    state.lastY = y;
    state.lastZ = z;
    emit({
      channel: state.channel,
      generation: state.generation,
      y,
      z,
    });
  };

  return {
    schedule(
      channel,
      yTarget,
      zTarget,
      duration,
      at,
      generation,
      observedAt = at,
      emitInitial = true,
      muted = false,
    ) {
      const previous = channels.get(channel);
      const yFrom = previous ? rampValue(previous.yRamp, at) : 0;
      const zFrom = previous ? rampValue(previous.zRamp, at) : 0;
      const safeDuration = Math.max(0, Number(duration) || 0);
      const state = {
        channel,
        generation,
        yRamp: { from: yFrom, to: clamp7(yTarget), startAt: at, duration: safeDuration },
        zRamp: { from: zFrom, to: clamp7(zTarget), startAt: at, duration: safeDuration },
        lastY: previous?.lastY,
        lastZ: previous?.lastZ,
        endsAt: at + safeDuration,
        muted,
      };
      channels.set(channel, state);
      if (emitInitial) output(state, safeDuration <= 0 ? state.endsAt : observedAt);
      return safeDuration > 0;
    },

    tick(at) {
      let active = false;
      for (const state of channels.values()) {
        output(state, at);
        if (!state.muted && at < state.endsAt) active = true;
      }
      return active;
    },

    sample(channel, at) {
      const state = channels.get(channel);
      if (!state) return { y: 0, z: 0 };
      return {
        y: rampValue(state.yRamp, at),
        z: rampValue(state.zRamp, at),
      };
    },

    remove(channel) {
      channels.delete(channel);
    },

    clear() {
      channels.clear();
    },
  };
}

/**
 * A dedicated worker advances the ramps. It never pre-schedules a complete
 * 40 ms stream into Web MIDI, because those messages cannot be cancelled.
 * Generation checks on the main thread discard worker messages belonging to a
 * superseded pressure or release command.
 */
export function createAutoMpeYzScheduler(midiOutput, options = {}) {
  const sampleMs = Math.max(0.25, Number(options.sampleMs) || SAMPLE_MS);
  const timerSampleMs = Math.max(1, sampleMs);
  const now = typeof options.now === "function" ? options.now : midiNow;
  const generations = new Map();
  const lastValues = new Map();
  const onsetTimes = new Map();
  const stateEngine = createAutoMpeYzRampEngine(() => {});
  let worker = null;
  let fallbackTimer = null;

  const sendValues = ({ channel, generation, y, z }, timestamp = null) => {
    if (generations.get(channel) !== generation) return;
    const previous = lastValues.get(channel);
    if (previous?.y === y && previous?.z === z) return;
    lastValues.set(channel, { y, z });
    const channel0 = channel - 1;
    if (timestamp == null) {
      midiOutput.send([0xb0 + channel0, 74, y]);
      midiOutput.send([0xd0 + channel0, z]);
    } else {
      midiOutput.send([0xb0 + channel0, 74, y], timestamp);
      midiOutput.send([0xd0 + channel0, z], timestamp);
    }
  };

  const send = (values) => sendValues(values);
  const sendTimestamped = (values, timestamp) => sendValues(values, timestamp);

  const fallbackEngine = createAutoMpeYzRampEngine(send);
  const stopFallbackTimer = () => {
    if (fallbackTimer == null) return;
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  };
  const startFallbackTimer = () => {
    if (fallbackTimer != null) return;
    fallbackTimer = setInterval(() => {
      if (!fallbackEngine.tick(now())) stopFallbackTimer();
    }, timerSampleMs);
  };

  if (options.worker !== false && typeof Worker !== "undefined") {
    try {
      worker = new Worker(new URL("./auto-yz-worker.js", import.meta.url), {
        type: "module",
      });
      worker.onmessage = ({ data }) => send(data);
    } catch {
      worker = null;
    }
  }

  const schedule = (
    channel,
    y,
    z,
    duration,
    requestedAt = now(),
    immediateWorkerValues = null,
    timestampFirstSample = false,
  ) => {
    if (!Number.isFinite(channel) || channel < 1 || channel > 16) return;
    const generation = (generations.get(channel) ?? 0) + 1;
    generations.set(channel, generation);
    const from = stateEngine.sample(channel, requestedAt);
    stateEngine.schedule(channel, y, z, duration, requestedAt, generation);
    if (worker) {
      if (immediateWorkerValues) {
        send({
          channel,
          generation,
          y: immediateWorkerValues.y,
          z: immediateWorkerValues.z,
        });
      }
      worker.postMessage({
        type: "schedule",
        channel,
        y,
        z,
        duration,
        startedAtEpoch: performance.timeOrigin + requestedAt,
        generation,
      });
      const safeDuration = Math.max(0, Number(duration) || 0);
      const firstSampleAt = Math.floor(requestedAt / sampleMs) * sampleMs + sampleMs;
      if (timestampFirstSample && safeDuration > 0 && firstSampleAt < requestedAt + safeDuration) {
        const progress = (firstSampleAt - requestedAt) / safeDuration;
        sendTimestamped(
          {
            channel,
            generation,
            y: clamp7(from.y + (clamp7(y) - from.y) * progress),
            z: clamp7(from.z + (clamp7(z) - from.z) * progress),
          },
          firstSampleAt,
        );
      }
      return;
    }
    const active = fallbackEngine.schedule(channel, y, z, duration, requestedAt, generation);
    if (active) startFallbackTimer();
  };

  /**
   * Pre-schedule only the short velocity/release envelopes directly into Web
   * MIDI to preserve their dense sub-millisecond shape. Timestamped packets
   * already accepted by Web MIDI cannot be cancelled, so longer pressure ramps
   * use schedule() and its generation-safe worker/fallback path instead.
   */
  const scheduleDirect = (
    channel,
    y,
    z,
    duration,
    requestedAt = now(),
    { preserveFirstSample = false, fromAt = null } = {},
  ) => {
    if (!Number.isFinite(channel) || channel < 1 || channel > 16) return;
    const generation = (generations.get(channel) ?? 0) + 1;
    generations.set(channel, generation);
    const start = Number.isFinite(requestedAt) ? requestedAt : now();
    const sampleAt = Number.isFinite(fromAt) ? Math.min(start, fromAt) : start;
    const from = stateEngine.sample(channel, sampleAt);
    const firstSampleAt = Math.floor(start / sampleMs) * sampleMs + sampleMs;
    const rampStart = preserveFirstSample ? firstSampleAt : start;
    const safeDuration = Math.max(0, Number(duration) || 0);
    const end = rampStart + safeDuration;
    const target = { y: clamp7(y), z: clamp7(z) };
    const channel0 = channel - 1;

    stateEngine.schedule(channel, target.y, target.z, safeDuration, rampStart, generation);
    lastValues.set(channel, target);

    // Keep the worker/fallback mathematical state synchronized, but do not let
    // it emit this short envelope after its message-delivery delay.
    if (worker) {
      worker.postMessage({
        type: "schedule",
        channel,
        y: target.y,
        z: target.z,
        duration: safeDuration,
        startedAtEpoch: performance.timeOrigin + rampStart,
        generation,
        silent: true,
      });
    } else {
      fallbackEngine.schedule(
        channel,
        target.y,
        target.z,
        safeDuration,
        rampStart,
        generation,
        rampStart,
        false,
        true,
      );
    }

    if (safeDuration <= 0) {
      midiOutput.send([0xb0 + channel0, 74, target.y]);
      midiOutput.send([0xd0 + channel0, target.z]);
      return;
    }

    let previousY = clamp7(from.y);
    let previousZ = clamp7(from.z);
    let timestamp = firstSampleAt;
    if (preserveFirstSample) {
      midiOutput.send([0xb0 + channel0, 74, previousY], timestamp);
      midiOutput.send([0xd0 + channel0, previousZ], timestamp);
      timestamp += sampleMs;
    }
    for (; timestamp < end; timestamp += sampleMs) {
      const progress = (timestamp - rampStart) / safeDuration;
      const nextY = clamp7(from.y + (target.y - from.y) * progress);
      const nextZ = clamp7(from.z + (target.z - from.z) * progress);
      if (nextY === previousY && nextZ === previousZ) continue;
      previousY = nextY;
      previousZ = nextZ;
      midiOutput.send([0xb0 + channel0, 74, nextY], timestamp);
      midiOutput.send([0xd0 + channel0, nextZ], timestamp);
    }
    if (previousY !== target.y || previousZ !== target.z) {
      midiOutput.send([0xb0 + channel0, 74, target.y], end);
      midiOutput.send([0xd0 + channel0, target.z], end);
    }
  };

  return {
    onset(channel, velocity, at) {
      const start = Number.isFinite(at) ? at : now();
      onsetTimes.set(channel, start);
      const y = velocityTarget(
        velocity,
        AUTO_MPE_YZ_DEFAULTS.yVelocityRange,
        AUTO_MPE_YZ_DEFAULTS.yCenter,
      );
      const z = velocityTarget(
        velocity,
        AUTO_MPE_YZ_DEFAULTS.zVelocityRange,
        AUTO_MPE_YZ_DEFAULTS.zCenter,
      );
      const duration = velocityRampDuration(velocity);
      scheduleDirect(channel, y, z, duration, start);
    },

    pressure(channel, pressure, velocity, at) {
      const yBase = velocityTarget(
        velocity,
        AUTO_MPE_YZ_DEFAULTS.yVelocityRange,
        AUTO_MPE_YZ_DEFAULTS.yCenter,
      );
      const zBase = velocityTarget(
        velocity,
        AUTO_MPE_YZ_DEFAULTS.zVelocityRange,
        AUTO_MPE_YZ_DEFAULTS.zCenter,
      );
      schedule(
        channel,
        pressureTarget(pressure, yBase, AUTO_MPE_YZ_DEFAULTS.yAftertouchRange),
        pressureTarget(pressure, zBase, AUTO_MPE_YZ_DEFAULTS.zAftertouchRange),
        AUTO_MPE_YZ_DEFAULTS.aftertouchRampMs,
        at,
        null,
        true,
      );
    },

    release(channel, releaseVelocity, at) {
      if (!Number.isFinite(channel) || channel < 1 || channel > 16) return;
      const start = Number.isFinite(at) ? at : now();
      const onsetAt = onsetTimes.get(channel);
      const lookbackMs = Math.max(
        0,
        Number(options.releaseStateLookbackMs ?? AUTO_MPE_YZ_DEFAULTS.releaseStateLookbackMs) || 0,
      );
      const canLookBack = Number.isFinite(onsetAt) && start - onsetAt >= lookbackMs;
      // Max's VelToZY patch uses the same 115-based lag calculation for attack
      // and release velocity. Values at or above that pivot snap to zero, while
      // softer releases keep a short, densely sampled timbral fall. Sampling a
      // few milliseconds behind the current state preserves the brighter edge
      // that Max's signal ramp still carries into Note Off.
      const duration = releaseRampDuration(releaseVelocity);
      // line~ begins at the next snapshot~ sample and preserves the current
      // signal value there when it has a nonzero duration. A zero-duration Max
      // command snaps directly to zero; adding a sampled hold softens high-
      // velocity releases and is observably different in the MIDI trace.
      scheduleDirect(channel, 0, 0, duration, start, {
        preserveFirstSample: duration > 0,
        fromAt: canLookBack ? start - lookbackMs : start,
      });
    },

    reset(channel, at) {
      onsetTimes.delete(channel);
      schedule(channel, 0, 0, 0, at, { y: 0, z: 0 });
    },

    clear() {
      generations.clear();
      lastValues.clear();
      onsetTimes.clear();
      stateEngine.clear();
      fallbackEngine.clear();
      stopFallbackTimer();
      worker?.postMessage({ type: "clear" });
    },

    shutdown() {
      generations.clear();
      lastValues.clear();
      onsetTimes.clear();
      stateEngine.clear();
      fallbackEngine.clear();
      stopFallbackTimer();
      worker?.terminate();
      worker = null;
    },
  };
}
