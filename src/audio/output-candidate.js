/** Owns a newly constructed engine until the current build adopts it.
 * Never pass cached/reused engines here. Preparation is allowed to settle before
 * disposal so it cannot allocate resources after teardown. This is cancellation
 * of ownership, not an attempt to abort shared downloads or AudioContext work.
 */
import { releaseSynthInstance } from "./output-lifecycle.js";

/** Share only in-flight construction, never installed engines. A newer build
 * requesting the same key takes over adoption; the cancelled build still owns
 * its own graph/loading guards. Keys must include every construction/preparation
 * input (and actual port identity for MIDI). Settled requests are never reused.
 */
export function createOutputCandidateRequests() {
  const pending = new Map();
  function request(key, create, options) {
    const existing = pending.get(key);
    if (existing) {
      existing.options = options;
      return existing.promise;
    }
    const entry = { options, controller: new AbortController() };
    pending.set(key, entry);
    entry.promise = Promise.resolve().then(() => entry.options.isCurrent() && !entry.controller.signal.aborted ? create(entry.controller.signal) : null).then(candidate =>
      adoptOutputCandidate(candidate, {
        isCurrent: () => !entry.controller.signal.aborted && entry.options.isCurrent(),
        prepare: candidate => entry.options.prepare?.(candidate),
        adopt: candidate => entry.options.adopt(candidate),
      }),
    ).finally(() => {
      if (pending.get(key) === entry) pending.delete(key);
    });
    return entry.promise;
  }
  request.cancelAll = () => {
    for (const entry of pending.values()) entry.controller.abort();
    pending.clear();
  };
  return request;
}

export async function adoptOutputCandidate(candidate, { isCurrent, prepare, adopt }) {
  if (!candidate) return null;
  let adopted = false;
  try {
    if (!isCurrent()) return null;
    if (prepare) await prepare(candidate);
    if (!isCurrent()) return null;
    adopt(candidate);
    adopted = true;
    return candidate;
  } finally {
    if (!adopted) releaseSynthInstance(candidate);
  }
}
