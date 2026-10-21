// Lives across Keys/App Mode reconstruction; observes the selected input only.
export function createExquisModeGate(onPending = () => {}) {
  const held = new Set();
  const pending = new Map();
  let timer;
  const notify = () => onPending(pending.size > 0,
    Object.fromEntries([...pending].map(([key, item]) => [key, item.value])));
  return {
    message(event) {
      const data = event.data ?? event.message?.data;
      if (!data || data.length < 3) return;
      const status = data[0] & 0xf0;
      const key = `${data[0] & 15}.${data[1]}`;
      if (status === 0x90 && data[2] > 0) held.add(key);
      else if (status === 0x80 || (status === 0x90 && data[2] === 0)) held.delete(key);
      else return;
      clearTimeout(timer);
      if (!held.size && pending.size) timer = setTimeout(() => {
        // Let every listener process the final note-off with the old map.
        if (held.size) return;
        const work = [...pending.values()];
        pending.clear();
        notify();
        for (const { commit } of work) commit();
      }, 120);
    },
    defer(key, value, current, commit) {
      if (!["midi_passthrough", "midiin_mapping_target"].includes(key)) return false;
      if (!held.size) {
        pending.delete(key);
        notify();
        return false;
      }
      if (value === current) pending.delete(key);
      else pending.set(key, { value, commit });
      notify();
      return true;
    },
    reset() {
      clearTimeout(timer);
      held.clear();
      pending.clear();
      notify();
    },
    heldPads: () => [...held],
  };
}
