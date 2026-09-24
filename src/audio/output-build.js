/** Complete one asynchronous output build at a single publication boundary.
 * Engines remain owned by wiring's caches; this function must not dispose them
 * because a newer build may already be reusing them. Installation is synchronous
 * and loading is balanced even when construction or reconciliation throws.
 * This is not rollback of MIDI/OSC messages already sent during reconciliation.
 */
export async function completeOutputBuild({ pending, isCurrent, install, onError, finish }) {
  try {
    const results = await Promise.allSettled(pending);
    if (!isCurrent()) return false;
    for (const result of results) {
      if (result.status === "rejected") onError(result.reason, "construction");
    }
    const outputs = [...new Set(results
      .filter(result => result.status === "fulfilled" && result.value != null)
      .map(result => result.value))];
    if (!isCurrent()) return false;
    install(outputs);
    return true;
  } catch (error) {
    if (isCurrent()) onError(error, "installation");
    return false;
  } finally {
    finish();
  }
}
