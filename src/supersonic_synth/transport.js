/** Adapts the four external OSC layer ports to isolated local scsynth groups.
 * Keeps performance.now() scheduling on the audio clock, not animation frames.
 * This transport exclusively owns its engine; panic may clear its scheduler.
 */
import { warnLog } from "../debug/logging.js";

// Retiring engines no longer belong to the active output graph, but PANIC
// must still reach them. Bound overlap during repeated output toggles.
const retiring = new Set();
export function stopRetiredSuperSonicOutputs() {
  for (const stop of [...retiring]) stop();
}

export function createLocalOscTransport(sonic, encodeBundle, dispose) {
  const groups = new Map([57101, 57102, 57103, 57104].map((port, i) => [port, 9100 + i]));
  const nodes = new Map();
  let closed = false;
  let purging = false;
  let pending = [];
  let draining = false;
  let drainTimer;
  const finish = () => {
    if (closed) return;
    closed = true;
    pending = [];
    clearTimeout(drainTimer);
    retiring.delete(finish);
    sonic.node?.disconnect();
    if (!purging) dispose();
  };
  const dispatch = (address, args, timestamp) => {
    if (closed) return;
    if (purging) { pending.push([address, args, timestamp]); return; }
    const delay = Number.isFinite(timestamp) ? (timestamp - performance.now()) / 1000 : 0;
    if (delay > 0) sonic.sendOSC(encodeBundle(sonic.clock.now() + delay, [[address, ...args]]));
    else sonic.send(address, ...args);
  };
  for (const group of groups.values()) sonic.send("/g_new", group, 0, 0);
  sonic.on("in", message => {
    if (message[0] === "/n_end") {
      nodes.delete(message[1]);
      if (draining && !nodes.size) finish();
    }
  });
  return {
    getDiagnostics() {
      try {
        const metrics = sonic.getMetrics();
        const tree = sonic.getRawTree();
        return {
          metrics,
          nodes: { count: tree.nodeCount, droppedCount: tree.droppedCount, trackedLayerNodes: nodes.size },
          audioContext: {
            state: sonic.audioContext?.state ?? null,
            sampleRate: sonic.audioContext?.sampleRate ?? null,
            baseLatency: sonic.audioContext?.baseLatency ?? null,
            outputLatency: sonic.audioContext?.outputLatency ?? null,
          },
        };
      } catch (error) { return { metricsError: error.message, trackedLayerNodes: nodes.size }; }
    },
    prepare: () => sonic.audioContext.resume(),
    send(address, typedArgs, port, timestamp) {
      if (closed || draining || !groups.has(port)) return;
      const group = groups.get(port);
      const args = typedArgs.map(arg => arg.value);
      if (address === "/s_new") {
        args[0] = `hexlab_${args[0]}`;
        args[3] = group;
        nodes.set(args[1], port);
      } else if (address === "/g_freeAll") {
        args[0] = group;
      } else if (address === "/n_set" && args[0] === 1) {
        args[0] = group; // Broadcast controls only to this layer, never root.
      } else if ((address === "/n_set" || address === "/n_free") && nodes.get(args[0]) !== port) {
        return; // Naturally completed one-shots can still have logical key owners.
      }
      dispatch(address, args, timestamp);
      if (address === "/n_free") nodes.delete(args[0]);
    },
    cancelScheduled() {
      if (closed) return;
      pending = [];
      if (purging) return;
      purging = true;
      // /clearSched alone does not clear SuperSonic's upstream WASM scheduler.
      // Keep subsequent frees/new attacks behind the confirmed purge barrier.
      void sonic.purge().then(() => {
        purging = false;
        if (closed) { dispose(); return; }
        const messages = pending;
        pending = [];
        messages.forEach(message => dispatch(...message));
      }).catch(error => {
        closed = true;
        pending = [];
        dispose();
        warnLog("SuperSonic purge failed; closed output for safety", error);
      });
    },
    _flushBundles() {}, // Messages already handed to the audio-thread scheduler.
    release({ graceful = false } = {}) {
      if (closed) return;
      if (graceful && nodes.size) {
        if (draining) return;
        draining = true;
        // Cancel future attacks, then re-send gates: the purge may also have
        // removed the ordinary OSC gate releases sent just before shutdown.
        this.cancelScheduled();
        for (const group of groups.values()) dispatch("/n_set", [group, "gate", 0]);
        retiring.add(finish);
        while (retiring.size > 4) retiring.values().next().value();
        // Normally /n_end disposes sooner. Cover cancelled, never-created nodes
        // and suspended browsers without retaining an engine indefinitely.
        drainTimer = setTimeout(finish, 8000);
        return;
      }
      closed = true;
      clearTimeout(drainTimer);
      retiring.delete(finish);
      pending = [];
      sonic.send("/clearSched");
      for (const group of groups.values()) sonic.send("/g_freeAll", group);
      nodes.clear();
      // A purge has an in-flight worklet acknowledgement. Do not destroy its
      // port before that reply; disconnect now for silence, dispose after it.
      if (purging) sonic.node?.disconnect();
      else dispose();
    },
  };
}
