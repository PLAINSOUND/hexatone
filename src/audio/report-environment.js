// Read-only diagnostics: never update, activate or unregister a service worker.
export function buildDiagnostics() {
  return {
    version: import.meta.env.VITE_APP_VERSION ?? null,
    revision: import.meta.env.VITE_BUILD_REVISION ?? null,
    trackedChangesAtBuild: import.meta.env.VITE_BUILD_TRACKED_CHANGES ?? null,
    builtAt: import.meta.env.VITE_BUILD_TIME ?? null,
    mode: import.meta.env.MODE,
    dev: import.meta.env.DEV,
    basePath: import.meta.env.BASE_URL,
    origin: globalThis.location?.origin ?? null,
    pathname: globalThis.location?.pathname ?? null,
  };
}

const worker = value => value ? { scriptURL: value.scriptURL, state: value.state } : null;

export async function serviceWorkerDiagnostics(container = navigator.serviceWorker, timeoutMs = 1000) {
  if (!container) return { supported: false, controller: null, registrations: null };
  const result = { supported: true, controller: worker(container.controller), registrations: null };
  let timer;
  try {
    const registrations = await Promise.race([
      container.getRegistrations(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Service-worker inspection timed out")), timeoutMs); }),
    ]);
    result.registrations = registrations.map(reg => ({
      scope: reg.scope, updateViaCache: reg.updateViaCache,
      active: worker(reg.active), waiting: worker(reg.waiting), installing: worker(reg.installing),
    }));
  } catch (error) {
    result.error = String(error.message ?? error);
  } finally { clearTimeout(timer); }
  return result;
}

export function playbackClockDiagnostics(context) {
  const result = {
    supported: typeof context?.getOutputTimestamp === "function",
    meaning: "Browser playback-clock estimate, not measured speaker onset. Render-ahead includes normal buffering; stale or stopped timestamps are not a reliable latency measurement.",
  };
  if (!result.supported) return result;
  try {
    const timestamp = context.getOutputTimestamp();
    const observedAtMs = performance.now();
    const currentTime = context.currentTime;
    const valid = context.state === "running" && Number.isFinite(currentTime) &&
      Number.isFinite(timestamp.contextTime) && timestamp.contextTime > 0 &&
      Number.isFinite(timestamp.performanceTime) && timestamp.performanceTime > 0 &&
      observedAtMs >= timestamp.performanceTime && observedAtMs - timestamp.performanceTime <= 1000;
    Object.assign(result, {
      observedAtMs, currentTime, contextTime: timestamp.contextTime,
      performanceTime: timestamp.performanceTime,
      timestampAgeMs: Number.isFinite(timestamp.performanceTime) ? observedAtMs - timestamp.performanceTime : null,
      usable: valid,
      renderPlaybackDifferenceMs: valid ? (currentTime - timestamp.contextTime) * 1000 : null,
      playbackTimestampMatchesRenderClock: valid ? currentTime === timestamp.contextTime : null,
      renderAheadMs: valid ? (currentTime - timestamp.contextTime) * 1000 - (observedAtMs - timestamp.performanceTime) : null,
    });
  } catch (error) { result.error = String(error.message ?? error); }
  return result;
}
