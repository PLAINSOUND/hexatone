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
  return {
    node,
    mute(durationMs = 0) {
      clearTimeout(fadeTimer);
      if (durationMs > 0 && context.state === "running" && !disconnected) {
        const now = context.currentTime;
        node.gain.cancelScheduledValues(now);
        node.gain.setValueAtTime(node.gain.value, now);
        node.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
        fadeTimer = setTimeout(() => this.mute(), durationMs);
        return { directOutputConnected: true, fadeOutMs: durationMs };
      }
      node.disconnect();
      node.connect(silentSink);
      disconnected = true;
      const now = context.currentTime;
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(0, now);
      return { directOutputConnected: false, silentDrainConnected: true };
    },
    fadeIn() {
      clearTimeout(fadeTimer);
      const now = context.currentTime;
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(0, now);
      node.gain.value = 0;
      if (disconnected) {
        node.disconnect();
        node.connect(context.destination);
        disconnected = false;
      }
      node.gain.linearRampToValueAtTime(1, now + 0.08);
      return { directOutputConnected: true, silentDrainConnected: false };
    },
    disconnect() {
      clearTimeout(fadeTimer);
      node.disconnect();
      silentSink.disconnect();
    },
  };
}
