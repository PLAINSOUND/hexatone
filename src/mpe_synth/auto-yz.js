// The Max reference samples its line~ ramps every millisecond. Sending both a
// three-byte CC74 and a two-byte channel-pressure message at that cadence can
// outrun a MIDI receiver, especially while an old voice releases as a new one
// attacks. A two-millisecond output cadence preserves the ramp shape and
// endpoints while leaving room for the higher-priority note and pitch traffic.
export const AUTO_MPE_YZ_SAMPLE_MS = 2;
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
  const sampleMs = Math.max(0.25, Number(options.sampleMs) || AUTO_MPE_YZ_SAMPLE_MS);
  const timerSampleMs = Math.max(1, sampleMs);
  const now = typeof options.now === "function" ? options.now : midiNow;
  const generations = new Map();
  const lastValues = new Map();
  // Max gates Y and Z independently. Each dimension retains its velocity-
  // derived value until pressure strictly crosses that dimension's base, then
  // follows pressure for the rest of the note (including a return to zero).
  const pressureActiveYChannels = new Set();
  const pressureActiveZChannels = new Set();
  const stateEngine = createAutoMpeYzRampEngine(() => {});
  let worker = null;
  let fallbackTimer = null;

  const sendValues = ({ channel, generation, y, z }) => {
    if (generations.get(channel) !== generation) return;
    const previous = lastValues.get(channel);
    if (previous?.y === y && previous?.z === z) return;
    lastValues.set(channel, { y, z });
    const channel0 = channel - 1;
    midiOutput.send([0xb0 + channel0, 74, y]);
    midiOutput.send([0xd0 + channel0, z]);
  };

  const send = (values) => sendValues(values);

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

  const schedule = (channel, y, z, duration, requestedAt = now(), emitInitial = true) => {
    if (!Number.isFinite(channel) || channel < 1 || channel > 16) return;
    const generation = (generations.get(channel) ?? 0) + 1;
    generations.set(channel, generation);
    stateEngine.schedule(channel, y, z, duration, requestedAt, generation);
    const safeDuration = Math.max(0, Number(duration) || 0);
    const target = { channel, generation, y: clamp7(y), z: clamp7(z) };

    // Zero-duration changes are safe to send immediately: there is no future
    // packet to become stale, and reset/maximum-velocity endpoints must not
    // wait for worker delivery.
    if (safeDuration <= 0) {
      send(target);
      if (worker) {
        worker.postMessage({
          type: "schedule",
          channel,
          y: target.y,
          z: target.z,
          duration: 0,
          startedAtEpoch: performance.timeOrigin + requestedAt,
          generation,
          silent: true,
        });
      } else {
        fallbackEngine.schedule(
          channel,
          target.y,
          target.z,
          0,
          requestedAt,
          generation,
          requestedAt,
          false,
          true,
        );
      }
      return;
    }

    if (worker) {
      worker.postMessage({
        type: "schedule",
        channel,
        y,
        z,
        duration,
        startedAtEpoch: performance.timeOrigin + requestedAt,
        generation,
        emitInitial,
      });
      return;
    }
    const active = fallbackEngine.schedule(
      channel,
      y,
      z,
      duration,
      requestedAt,
      generation,
      requestedAt,
      emitInitial,
    );
    if (active) startFallbackTimer();
  };

  return {
    onset(channel, velocity, at) {
      const start = Number.isFinite(at) ? at : now();
      pressureActiveYChannels.delete(channel);
      pressureActiveZChannels.delete(channel);
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
      // Do not pre-queue the short attack. A release can now supersede this
      // generation before any remaining attack samples reach the MIDI port.
      schedule(channel, y, z, duration, start, false);
    },

    pressure(channel, pressure, velocity, at) {
      const pressure7 = clamp7(pressure);
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
      if (!pressureActiveYChannels.has(channel) && pressure7 > yBase) {
        pressureActiveYChannels.add(channel);
      }
      if (!pressureActiveZChannels.has(channel) && pressure7 > zBase) {
        pressureActiveZChannels.add(channel);
      }
      const yActive = pressureActiveYChannels.has(channel);
      const zActive = pressureActiveZChannels.has(channel);
      if (!yActive && !zActive) return;
      schedule(
        channel,
        yActive ? pressureTarget(pressure7, yBase, AUTO_MPE_YZ_DEFAULTS.yAftertouchRange) : yBase,
        zActive ? pressureTarget(pressure7, zBase, AUTO_MPE_YZ_DEFAULTS.zAftertouchRange) : zBase,
        AUTO_MPE_YZ_DEFAULTS.aftertouchRampMs,
        at,
      );
    },

    release(channel, releaseVelocity, at) {
      if (!Number.isFinite(channel) || channel < 1 || channel > 16) return;
      pressureActiveYChannels.delete(channel);
      pressureActiveZChannels.delete(channel);
      const start = Number.isFinite(at) ? at : now();
      // Max's VelToZY patch uses the same 115-based lag calculation for attack
      // and release velocity. Values at or above that pivot snap to zero, while
      // softer releases keep a short timbral fall sampled every two milliseconds.
      const duration = releaseRampDuration(releaseVelocity);
      schedule(channel, 0, 0, duration, start);
    },

    reset(channel, at) {
      pressureActiveYChannels.delete(channel);
      pressureActiveZChannels.delete(channel);
      schedule(channel, 0, 0, 0, at);
    },

    clear() {
      generations.clear();
      lastValues.clear();
      pressureActiveYChannels.clear();
      pressureActiveZChannels.clear();
      stateEngine.clear();
      fallbackEngine.clear();
      stopFallbackTimer();
      worker?.postMessage({ type: "clear" });
    },

    shutdown() {
      generations.clear();
      lastValues.clear();
      pressureActiveYChannels.clear();
      pressureActiveZChannels.clear();
      stateEngine.clear();
      fallbackEngine.clear();
      stopFallbackTimer();
      worker?.terminate();
      worker = null;
    },
  };
}
