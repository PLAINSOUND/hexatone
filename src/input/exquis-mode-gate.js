// Lives across Keys/App Mode reconstruction; observes the selected input only.
export function createExquisModeGate(onPending = () => {}) {
  const held = new Set();
  const pending = new Map();
  let timer;
  let releasedAt = -Infinity;
  let lifecycleTask = null;
  const ready = () => !held.size && performance.now() - releasedAt >= 120;
  const notify = () => onPending(pending.size > 0 || lifecycleTask != null,
    Object.fromEntries([...pending].flatMap(([key, item]) => item.updates
      ? Object.entries(item.updates) : [[key, item.value]])));
  const schedule = () => {
    clearTimeout(timer);
    if (held.size || (!pending.size && !lifecycleTask)) return;
    timer = setTimeout(() => {
      if (!ready()) { schedule(); return; }
      const work = [...pending.values()];
      pending.clear();
      const transition = lifecycleTask;
      lifecycleTask = null;
      notify();
      for (const { commit } of work) commit();
      transition?.();
    }, Math.max(0, 120 - (performance.now() - releasedAt)));
  };
  return {
    message(event) {
      const data = event.data ?? event.message?.data;
      if (!data || data.length < 3) return;
      const status = data[0] & 0xf0;
      const key = `${data[0] & 15}.${data[1]}`;
      if (status === 0x90 && data[2] > 0) held.add(key);
      else if (status === 0x80 || (status === 0x90 && data[2] === 0)) {
        if (held.delete(key) && !held.size) releasedAt = performance.now();
      }
      else return;
      schedule();
    },
    defer(key, value, current, commit) {
      if (!["midi_passthrough", "midiin_mapping_target"].includes(key)) return false;
      if (ready()) {
        pending.delete(key);
        notify();
        return false;
      }
      if (value === current) pending.delete(key);
      else { pending.delete(key); pending.set(key, { value, commit }); }
      notify();
      schedule();
      return true;
    },
    deferBatch(updates, current, commit) {
      if (!["midi_passthrough", "midiin_mapping_target"].some(key => key in updates)) return false;
      const changesMode = ["midi_passthrough", "midiin_mapping_target"].some(key =>
        key in updates && updates[key] !== (current[key] ?? (key === "midi_passthrough" ? false : "hex_layout")));
      pending.delete("@atomic");
      if (!changesMode || ready()) { notify(); schedule(); return false; }
      pending.set("@atomic", { updates, commit });
      notify();
      schedule();
      return true;
    },
    whenReleased(commit) {
      lifecycleTask = null;
      if (ready()) commit();
      else lifecycleTask = commit;
      notify();
      schedule();
    },
    cancelTransition() { lifecycleTask = null; notify(); schedule(); },
    reset() {
      clearTimeout(timer);
      held.clear();
      pending.clear();
      releasedAt = -Infinity;
      lifecycleTask = null;
      notify();
    },
    heldPads: () => [...held],
  };
}
