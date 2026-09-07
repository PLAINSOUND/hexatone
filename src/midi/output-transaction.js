// Synchronous chord transactions share clocks and flush recovery state before returning.
let current = null;
export function getOutputTransaction() { return current; }
export function withOutputTransaction(callback) {
  if (current) return callback();
  const transaction = { data: new Map(), finalizers: new Map(), audioTimes: new Map(), timestamp: globalThis.performance?.now?.() };
  current = transaction;
  try { return callback(); }
  finally {
    current = null;
    for (const flush of transaction.finalizers.values()) flush();
  }
}
export function outputAudioTime(context) {
  if (!current) return context.currentTime;
  if (!current.audioTimes.has(context)) current.audioTimes.set(context, context.currentTime);
  return current.audioTimes.get(context);
}
export function outputTimestamp() { return current?.timestamp; }
