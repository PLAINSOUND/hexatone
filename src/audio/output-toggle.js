// Warm local toggles fade to mute in 40 ms, block new attacks and retain old
// voices for five seconds before their natural release. Rejoining releases
// retired voices naturally; it never uses a backend-wide clear to cut tails.
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
  let graceTimer;
  const voices = new Map();
  const releaseParkedVoices = () => {
    clearTimeout(graceTimer);
    for (const [hex, release] of [...voices]) {
      release(0);
      voices.delete(hex);
    }
  };
  const allSoundOff = synth.allSoundOff?.bind(synth);
  if (allSoundOff) synth.allSoundOff = (...args) => {
    clearTimeout(graceTimer);
    voices.clear();
    return allSoundOff(...args);
  };
  synth.isOutputPaused = () => paused;
  if (keepWarm) {
    synth.pauseOutput = () => {
      pauseRevision++;
      if (paused) return Promise.resolve();
      paused = true;
      stopped = true;
      warm.add(synth);
      mute(40);
      // The graph detaches immediately, but its old voices keep sounding
      // behind the gate until the grace window expires.
      graceTimer = setTimeout(releaseParkedVoices, 5000);
      return Promise.resolve();
    };
    synth.resumeOutput = async () => {
      if (!paused) return;
      const revision = pauseRevision;
      await synth.prepare?.();
      if (!paused || revision !== pauseRevision) return;
      // Release only the retired voice objects, never a backend-wide clear.
      // Their tails may overlap the fresh voices joined by reconciliation.
      releaseParkedVoices();
      paused = false;
      warm.delete(synth);
      stopped = false;
      started = true;
      fadeIn();
    };
  }
  synth.makeHex = (...args) => {
    const hex = makeHex(...args);
    const noteOn = hex.noteOn?.bind(hex);
    const noteOff = hex.noteOff?.bind(hex);
    hex.noteOn = (...values) => {
      if (stopped) return;
      if (!started && !paused) { started = true; fadeIn(); }
      for (const old of voices.keys()) if (old.release === true) voices.delete(old);
      if (noteOff) voices.set(hex, noteOff);
      return noteOn?.(...values);
    };
    if (noteOff) hex.noteOff = (...values) => {
      if (paused && voices.has(hex)) return;
      voices.delete(hex);
      return noteOff(...values);
    };
    if (hex._onSourceEnded) {
      const ended = hex._onSourceEnded;
      hex._onSourceEnded = (...values) => { voices.delete(hex); return ended(...values); };
    }
    return hex;
  };
  synth.shutdown = (options) => {
    clearTimeout(graceTimer);
    if (options?.engineSwitch && paused) {
      warm.delete(synth);
      paused = false;
      pauseRevision++;
      stopped = false;
    }
    // Parking is separate from disposal: an actual shutdown must also close a
    // parked engine, rather than silently returning because attacks are blocked.
    if (options?.panic || paused) {
      const shutdownOptions = paused ? { ...options, panic: true } : options;
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
