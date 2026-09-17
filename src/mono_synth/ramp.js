// Rolling MIDI look-ahead, like the Eagan YZ scheduler. Never clear the shared
// port queue: other outputs may use it. Replacement starts after queued samples.
export function createMonoRamp(emit, { now = () => performance.now(), worker = true } = {}) {
  let current = [8192, 64, 0];
  let ramp = null;
  let queuedUntil = 0;
  let clock;
  let timer;
  const valueAt = (at) => {
    if (!ramp) return current;
    const t = Math.max(0, Math.min(1, (at - ramp.at) / (ramp.duration || 1)));
    return ramp.from.map((v, i) => v + (ramp.to[i] - v) * t);
  };
  const stop = () => {
    clock?.postMessage("stop");
    clearInterval(timer);
    timer = null;
  };
  const tick = () => {
    if (!ramp) return;
    const end = ramp.at + ramp.duration;
    const at = Math.min(end, Math.max(now(), queuedUntil + 8));
    if (at > now() + 12 || at <= queuedUntil) return;
    current = valueAt(at);
    emit(current.map(Math.round), at);
    queuedUntil = at;
    if (at >= end) {
      ramp = null;
      stop();
    }
  };
  if (worker && typeof Worker !== "undefined") {
    try {
      clock = new Worker(new URL("./ramp-worker.js", import.meta.url), { type: "module" });
      clock.onmessage = tick;
    } catch {
      clock = null;
    }
  }
  return {
    boundary(at = now()) {
      return Math.max(now(), at, queuedUntil);
    },
    move(to, duration, at = now()) {
      at = Math.max(now(), at, queuedUntil);
      const from = valueAt(at);
      stop();
      if (duration > 0) {
        ramp = { from, to, duration, at };
        if (clock) clock.postMessage("start");
        else timer = setInterval(tick, 8);
      } else {
        ramp = null;
        current = to;
        emit(to.map(Math.round), at);
        queuedUntil = at;
      }
    },
    cancel() {
      stop();
      ramp = null;
    },
    dispose() {
      stop();
      ramp = null;
      clock?.terminate();
    },
  };
}
