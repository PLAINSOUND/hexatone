// Separate from musical volume: recovery must not overwrite a user's fader.
export function createRecoveryGate(context, muted = false) {
  const node = context.createGain();
  // Keep the worklet in a live rendering graph while removing its direct
  // speaker connection. The independent sink stays at a constant zero gain;
  // it does not depend on automation being applied by a frozen audio clock.
  const silentSink = context.createGain();
  silentSink.gain.value = 0;
  silentSink.connect(context.destination);
  let disconnected = muted;
  node.gain.value = muted ? 0 : 1;
  node.connect(muted ? silentSink : context.destination);
  let fadeTimer;
  let ramp = null;
  const levelAt = now => ramp
    ? ramp.from + (ramp.to - ramp.from) * Math.max(0, Math.min(1, (now - ramp.start) / ramp.duration))
    : node.gain.value;
  return {
    node,
    mute(durationMs = 0) {
      clearTimeout(fadeTimer);
      if (durationMs > 0 && context.state === "running" && !disconnected) {
        const now = context.currentTime;
        node.gain.cancelScheduledValues(now);
        const level = levelAt(now);
        node.gain.setValueAtTime(level, now);
        node.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
        ramp = { from: level, to: 0, start: now, duration: durationMs / 1000 };
        fadeTimer = setTimeout(() => this.mute(), durationMs);
        return { directOutputConnected: true, fadeOutMs: durationMs };
      }
      node.disconnect();
      node.connect(silentSink);
      disconnected = true;
      const now = context.currentTime;
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(0, now);
      ramp = null;
      return { directOutputConnected: false, silentDrainConnected: true };
    },
    fadeIn({ fromCurrent = false, durationMs = 80, delayMs = 0 } = {}) {
      clearTimeout(fadeTimer);
      const now = context.currentTime;
      node.gain.cancelScheduledValues(now);
      const level = fromCurrent && !disconnected ? levelAt(now) : 0;
      node.gain.setValueAtTime(level, now);
      node.gain.value = level;
      if (disconnected) {
        node.disconnect();
        node.connect(context.destination);
        disconnected = false;
      }
      const start = now + delayMs / 1000;
      // Hold silence while startup buffers drain, then ramp on the audio clock.
      // Cancelling/muting the gate also cancels this future automation.
      if (delayMs > 0) node.gain.setValueAtTime(level, start);
      node.gain.linearRampToValueAtTime(1, start + durationMs / 1000);
      ramp = { from: level, to: 1, start, duration: durationMs / 1000 };
      return { directOutputConnected: true, silentDrainConnected: false };
    },
    disconnect() {
      clearTimeout(fadeTimer);
      node.disconnect();
      silentSink.disconnect();
    },
  };
}
