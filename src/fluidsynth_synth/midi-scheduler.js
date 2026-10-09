import { getOutputTransaction } from "../midi/output-transaction.js";

/** One clock snapshot per chord/batch, one frame per musical timestamp.
 * Re-reading performance.now() for every message can reverse setup/note order
 * while AudioContext.currentTime is unchanged between rendering blocks.
 */
export function createFluidMidiScheduler(getEngine, ensureAwake) {
  let pending = [];
  let flushScheduled = false;
  let node;
  let context;
  let batchClock;
  let timestampFrames = new Map();
  const clockKey = {};
  const resetClock = () => {
    pending = [];
    batchClock = null;
    timestampFrames = new Map();
  };
  const enqueue = (event, timestamp) => {
    const engine = getEngine();
    if (!engine?.node) return;
    if (node !== engine.node || context !== engine.context) {
      resetClock();
      node = engine.node;
      context = engine.context;
    }
    const transaction = getOutputTransaction();
    let clock = transaction?.data.get(clockKey) ?? batchClock;
    if (!clock || clock.node !== node || clock.context !== context) {
      clock = { node, context, now: performance.now(), time: context.currentTime };
      batchClock = clock;
      transaction?.data.set(clockKey, clock);
    }
    // Keep future timestamps stable across microtask batches, but bound storage
    // by dropping expired mappings. Context/worklet replacement drops all maps.
    for (const key of timestampFrames.keys()) if (key < clock.now) timestampFrames.delete(key);
    let frame = Number.isFinite(timestamp) ? timestampFrames.get(timestamp) : undefined;
    if (frame == null) {
      frame = Math.ceil((clock.time + (Number.isFinite(timestamp)
        ? Math.max(0, timestamp - clock.now) / 1000 : 0)) * context.sampleRate);
      if (Number.isFinite(timestamp)) timestampFrames.set(timestamp, frame);
    }
    pending.push({ ...event, frame });
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      const events = pending;
      pending = [];
      batchClock = null;
      const active = getEngine();
      if (events.length && active?.node === node && active.context === context)
        node.port.postMessage({ type: "midi-batch", events });
    });
  };
  const cancel = (owner, scope, generation, voice) => {
    const matches = event => event.owner === owner &&
      (scope == null || (event.scope === scope && event.generation === generation)) &&
      (voice == null || event.voice === voice) &&
      // A stopped generation may still own sounding notes whose releases
      // were already queued. Keep those releases and their channel fences.
      !(scope != null && event.command?.op === "off");
    pending = pending.filter(event => !matches(event));
    getEngine()?.node?.port.postMessage({ type: "cancel-owner-events", owner, scope, generation, voice });
  };
  return {
    id: "hexatone-internal-fluidsynth",
    name: "Hexatone FluidSynth",
    sendCommand(command, timestamp, owner, metadata) { enqueue({ ...metadata, command, owner }, timestamp); },
    send(data, timestamp, owner, metadata) {
      if (data?.length) enqueue({ ...metadata, data: Array.from(data), owner }, timestamp);
    },
    cancelEvents: cancel,
    panic() {
      resetClock();
      getEngine()?.node?.port.postMessage({ type: "clear-recovery-events" });
    },
    resetClock,
    ensureAwake,
  };
}
