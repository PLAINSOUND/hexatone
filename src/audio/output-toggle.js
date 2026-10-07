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
  let voiceTimer;
  let cancelVoiceClear;
  if (keepWarm) {
    synth.pauseOutput = () => {
      pauseRevision++;
      if (paused) return clearing;
      paused = true;
      stopped = true;
      warm.add(synth);
      mute(30);
      clearing = new Promise(resolve => {
        cancelVoiceClear = () => {
          clearTimeout(voiceTimer);
          cancelVoiceClear = null;
          resolve(false);
        };
        voiceTimer = setTimeout(() => {
          cancelVoiceClear = null;
          resolve(true);
        }, 5000);
      }).then(async shouldClear => {
        if (!shouldClear || !paused) return;
        // Clear the engine only under the silent gate, not at the toggle edge.
        synth.allSoundOff?.();
        await synth.clearRecoveryEvents?.();
      });
      return clearing;
    };
    synth.resumeOutput = async () => {
      if (!paused) return;
      const revision = pauseRevision;
      const retainedVoices = !!cancelVoiceClear;
      cancelVoiceClear?.();
      await clearing;
      if (!paused || revision !== pauseRevision) return;
      await synth.prepare?.();
      if (!paused || revision !== pauseRevision) return;
      paused = false;
      warm.delete(synth);
      stopped = false;
      started = retainedVoices;
      if (retainedVoices) fadeIn();
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
    if (options?.engineSwitch && paused) {
      cancelVoiceClear?.();
      warm.delete(synth);
      paused = false;
      pauseRevision++;
      stopped = false;
    }
    // Parking is separate from disposal: an actual shutdown must also close a
    // parked engine, rather than silently returning because attacks are blocked.
    if (options?.panic || paused) {
      const shutdownOptions = paused ? { ...options, panic: true } : options;
      cancelVoiceClear?.();
      warm.delete(synth);
      paused = false;
      pauseRevision++;
      stopped = true;
      mute();
      if (finish) finish();
      else shutdown(shutdownOptions);
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
        fadeIn(options?.engineSwitch ? { delayMs: 0 } : undefined);
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
