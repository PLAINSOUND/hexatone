// Local output toggles use a separate gain envelope, not musical release or
// volume controls. Mark the old graph closed immediately, then tear it down
// after the short fade; queued logical attacks must not revive it meanwhile.
const fading = new Set();
const warm = new Set();
export function stopFadingOutputToggles() {
  for (const synth of [...fading]) synth.shutdown({ panic: true });
  for (const synth of warm) synth.allSoundOff?.();
}
export function smoothOutputToggle(synth, { mute, fadeIn, cutOnShutdown = false, reuseWindowMs = 40, keepWarm = false }) {
  const makeHex = synth.makeHex.bind(synth);
  const shutdown = synth.shutdown.bind(synth);
  let stopped = false;
  let started = false;
  let pending = null;
  let timer;
  let finish;
  let cancel;
  let paused = false;
  let pauseRevision = 0;
  let clearing = Promise.resolve();
  if (keepWarm) {
    synth.pauseOutput = () => {
      if (paused) return clearing;
      paused = true;
      pauseRevision++;
      stopped = true;
      warm.add(synth);
      mute(30);
      clearing = new Promise(resolve => setTimeout(resolve, 40)).then(async () => {
        // Clear the engine only under the silent gate, not at the toggle edge.
        synth.allSoundOff?.();
        await synth.clearRecoveryEvents?.();
      });
      return clearing;
    };
    synth.resumeOutput = async () => {
      if (!paused) return;
      const revision = pauseRevision;
      await clearing;
      if (!paused || revision !== pauseRevision) return;
      await synth.prepare?.();
      if (!paused || revision !== pauseRevision) return;
      paused = false;
      warm.delete(synth);
      stopped = false;
      started = false; // Fade when current held notes actually join again.
    };
  }
  synth.makeHex = (...args) => {
    const hex = makeHex(...args);
    const noteOn = hex.noteOn?.bind(hex);
    hex.noteOn = (...values) => {
      if (stopped) return;
      if (!started) { started = true; fadeIn(); }
      return noteOn?.(...values);
    };
    return hex;
  };
  synth.shutdown = (options) => {
    if (options?.panic) {
      warm.delete(synth);
      paused = false;
      pauseRevision++;
      stopped = true;
      mute();
      if (finish) finish();
      else shutdown(options);
      return pending;
    }
    if (stopped) return pending;
    stopped = true;
    mute(30);
    fading.add(synth);
    pending = new Promise(resolve => {
      cancel = () => {
        clearTimeout(timer);
        fading.delete(synth);
        finish = null;
        cancel = null;
        stopped = false;
        started = true;
        // The off graph may never have been published: existing voices can
        // still be held, so reverse now rather than waiting for a new attack.
        fadeIn();
        resolve();
      };
      finish = () => {
        clearTimeout(timer);
        finish = null;
        cancel = null;
        fading.delete(synth);
        try { shutdown(cutOnShutdown ? { panic: true } : options); }
        finally { resolve(); }
      };
      timer = setTimeout(finish, reuseWindowMs);
    });
    return pending;
  };
  synth.cancelShutdown = () => {
    if (!cancel) return false;
    cancel();
    return true;
  };
  return synth;
}
