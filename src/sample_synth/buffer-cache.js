// The cache owns reusable references only. Active synths and notes keep their
// own buffers after eviction, so reclaiming cache space cannot interrupt audio.
export function createSampleBufferCache(budgetBytes, sizeOf) {
  const entries = new Map();
  let bytes = 0;
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.buffers;
    },
    set(key, buffers) {
      const size = sizeOf(buffers);
      if (entries.has(key)) {
        bytes -= entries.get(key).size;
        entries.delete(key);
      }
      if (!Number.isFinite(size) || size < 0 || size > budgetBytes) return;
      for (const [oldKey, entry] of entries) {
        if (bytes + size <= budgetBytes) break;
        entries.delete(oldKey);
        bytes -= entry.size;
      }
      entries.set(key, { buffers, size });
      bytes += size;
    },
    clear() { entries.clear(); bytes = 0; },
    diagnostics() { return { bytes, budgetBytes, instruments: entries.size }; },
  };
}
