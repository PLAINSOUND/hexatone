import { instruments } from './instruments';
import { scalaToCents } from '../settings/scale/parse-scale';

// Three concepts:
// Coordinates -> Scale degree -> Pitch/midi

// ─── Single shared AudioContext ───────────────────────────────────────────────
// Created lazily inside prepare() which is only called after a user gesture,
// satisfying Chrome's autoplay policy. Reused across all synth instances to
// avoid hitting the browser's context limit (~6).
let sharedAudioContext = null;

// ─── Decoded buffer cache ──────────────────────────────────────────────────────
// Keyed by fileName. Decoded AudioBuffers are context-bound, so the cache is
// invalidated whenever sharedAudioContext is replaced (rare — only if the old
// context is closed and a new one is created).
// Without this cache, every port-connect or preset change that recreates the
// sample synth instance would leave decodedBuffers = null until prepare()
// resolves, causing the first note to be silent (the user would only hear the
// previous note's decaying release tail — a short "peep").
let decodedBufferCache = {};
let decodedBufferCacheContext = null; // the AudioContext the cache was built for

// ─── iOS Detection ─────────────────────────────────────────────────────────────
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ─── iOS Audio Context Resume Handler ──────────────────────────────────────────
// On iOS, AudioContext can become suspended when app goes to background.
// This handler resumes it when the page becomes visible again.
let iosVisibilityHandler = null;

const setupIOSAudioHandler = () => {
  if (!isIOS) return;
  
  // Remove existing handler if any
  if (iosVisibilityHandler) {
    document.removeEventListener('visibilitychange', iosVisibilityHandler);
  }
  
  iosVisibilityHandler = async () => {
    if (document.visibilityState === 'visible' && sharedAudioContext) {
      if (sharedAudioContext.state === 'suspended' || sharedAudioContext.state === 'interrupted') {
        try {
          await sharedAudioContext.resume();
          console.log('iOS: AudioContext resumed on visibility change');
        } catch (e) {
          console.warn('iOS: Failed to resume AudioContext:', e.message);
        }
      }
    }
  };
  
  document.addEventListener('visibilitychange', iosVisibilityHandler);
  
  // Also handle page show (for iOS Safari when returning from background)
  window.addEventListener('pageshow', async () => {
    if (sharedAudioContext && sharedAudioContext.state !== 'running') {
      try {
        await sharedAudioContext.resume();
        console.log('iOS: AudioContext resumed on pageshow');
      } catch (e) {
        console.warn('iOS: Failed to resume AudioContext on pageshow:', e.message);
      }
    }
  });
};

// ─── Single findInstrument replaces six identical loops ───────────────────────
const findInstrument = (fileName) => {
  for (const group of instruments) {
    for (const instrument of group.instruments) {
      if (instrument.fileName === fileName) {
        return instrument;
      }
    }
  }
  console.error("Unable to find configured instrument:", fileName);
  return null;
};

export const create_sample_synth = async (fileName, fundamental, reference_degree, scale) => {
  try {
    const instrument = findInstrument(fileName);
    if (!instrument) throw new Error(`Instrument not found: ${fileName}`);

    const { gain: sampleGain, attack: sampleAttack, release: sampleRelease,
            loop: sampleLoop, velocity: velocity_response,
            aftertouch: aftertouch_amount = 0 } = instrument;
    const sampleLoopPoints = instrument.loopPoints || [0, 0, 0, 0, 0, 0, 0, 0];

    // ── Fetch raw ArrayBuffers now — no AudioContext needed, no gesture required
    const [b110, b220, b440, b880] = await Promise.all([
      fetch(`sounds/${fileName}110.mp3`).then(r => r.arrayBuffer()),
      fetch(`sounds/${fileName}220.mp3`).then(r => r.arrayBuffer()),
      fetch(`sounds/${fileName}440.mp3`).then(r => r.arrayBuffer()),
      fetch(`sounds/${fileName}880.mp3`).then(r => r.arrayBuffer()),
    ]);
    const rawBuffers = [b110, b220, b440, b880];

    let decodedBuffers = null;
    let masterGain = null;
    let masterVolume = 1.0;

    let centsToReference = 0;
    if (reference_degree > 0) {
      centsToReference = scalaToCents(scale[reference_degree - 1]);
    }

    return {
      // ── Call once after a user gesture (e.g. preset selection) ───────────────
      // Creates/resumes the AudioContext and decodes all samples so that noteOn
      // is fully synchronous and has no latency.
      prepare: async () => {
        if (!sharedAudioContext) {
          // iOS 17+ prefers webkitAudioContext for some edge cases
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          sharedAudioContext = new AudioContextClass();
          
          // Setup iOS-specific handlers
          setupIOSAudioHandler();
        }
        
        // iOS: Always try to resume on prepare (might be suspended after backgrounding)
        if (sharedAudioContext.state === 'suspended' || sharedAudioContext.state === 'interrupted') {
          try {
            await sharedAudioContext.resume();
            console.log('AudioContext resumed, state:', sharedAudioContext.state);
          } catch (e) {
            console.warn('AudioContext autoplay blocked:', e.message);
            // On iOS, we may need user to tap again - signal this somehow
            if (isIOS) {
              console.warn('iOS: Please tap somewhere to enable audio');
            }
          }
        }
        
        // Master gain node — all voices connect here before destination
        if (!masterGain) {
          masterGain = sharedAudioContext.createGain();
          masterGain.gain.value = masterVolume;
          masterGain.connect(sharedAudioContext.destination);
        }
        // Invalidate the decoded-buffer cache if the AudioContext has been replaced
        // (e.g. closed and recreated). AudioBuffers are context-bound and cannot
        // be shared across context instances.
        if (decodedBufferCacheContext !== sharedAudioContext) {
          decodedBufferCache = {};
          decodedBufferCacheContext = sharedAudioContext;
        }
        // Use cached buffers if available — avoids the async decode gap that
        // would leave decodedBuffers = null on the first note after a synth
        // rebuild (e.g. when a MIDI port is connected), which would otherwise
        // cause the user to hear only the old note's decaying release tail.
        if (decodedBufferCache[fileName]) {
          decodedBuffers = decodedBufferCache[fileName];
        } else {
          // slice(0) copies the buffer — decodeAudioData consumes its argument
          decodedBuffers = await Promise.all(
            rawBuffers.map(buf => sharedAudioContext.decodeAudioData(buf.slice(0)))
          );
          decodedBufferCache[fileName] = decodedBuffers;
        }
      },

      setVolume: (value) => {
        masterVolume = Math.max(0, Math.min(1, value));
        if (masterGain) {
          masterGain.gain.setTargetAtTime(masterVolume, sharedAudioContext.currentTime, 0.02);
        }
      },

      makeHex: (coords, cents, steps, equaves, equivSteps, cents_prev, cents_next, 
        note_played, velocity_played, bend, degree0toRef_ratio) => {
        return new ActiveHex(
          coords, cents, velocity_played, note_played, fundamental, centsToReference,
          sampleGain, sampleAttack, sampleRelease, sampleLoop, sampleLoopPoints,
          velocity_response, aftertouch_amount, decodedBuffers, sharedAudioContext, masterGain
        );
      },
    };
  } catch (e) {
    console.error(e);
  }
};

function ActiveHex(coords, cents, velocity_played, note_played, fundamental, centsToReference,
  sampleGain, sampleAttack, sampleRelease, sampleLoop, sampleLoopPoints,
  velocity_response, aftertouch_amount, sampleBuffer, audioContext, masterGain) {

  this.coords = coords;
  this.release = false;
  this.cents = cents;
  this.velocity_played = velocity_played;
  this.note_played = note_played;
  this.fundamental = fundamental;
  this.centsToReference = centsToReference;
  this.sampleGain = sampleGain;
  this.sampleAttack = sampleAttack;
  this.sampleRelease = sampleRelease;
  this.sampleLoop = sampleLoop;
  this.sampleLoopPoints = sampleLoopPoints;
  this.velocity_response = velocity_response;
  this.aftertouch_amount = aftertouch_amount;
  this.sampleBuffer = sampleBuffer;
  this.audioContext = audioContext;
  this.masterGain = masterGain || null;
  this._noteOffCalled = false; // Guard against double noteOff
}

ActiveHex.prototype.noteOn = function() {
  // Guard: prepare() may not have completed yet if the user is very fast
  if (!this.sampleBuffer || !this.audioContext) return;

  const freq = this.fundamental * Math.pow(2, (this.cents - this.centsToReference) / 1200);
  const vol = this.velocity_response
    ? 0.15 + (0.85 * ((this.velocity_played / 127) ** 0.75))
    : 0.85;
  this.base_vol = vol;

  const source = this.audioContext.createBufferSource();

  // Choose the sample closest to the target frequency
  let sampleFreq = 110;
  let sampleNumber = 0;
  if (freq > 155) {
    if (freq > 311) {
      if (freq > 622) {
        sampleFreq = 880; sampleNumber = 3;
      } else {
        sampleFreq = 440; sampleNumber = 2;
      }
    } else {
      sampleFreq = 220; sampleNumber = 1;
    }
  }

  if (!this.sampleBuffer[sampleNumber]) return;

  source.buffer = this.sampleBuffer[sampleNumber];
  source.loop = this.sampleLoop;
  source.loopStart = this.sampleLoopPoints[sampleNumber * 2] > 0
    ? this.sampleLoopPoints[sampleNumber * 2] : 0;
  source.loopEnd = this.sampleLoopPoints[(sampleNumber * 2) + 1] > 0
    ? this.sampleLoopPoints[(sampleNumber * 2) + 1] : 0;

  source.playbackRate.value = freq / sampleFreq;
  this.sampleFreq = sampleFreq; // stored so retune() can ramp playbackRate

  const gainNode = this.audioContext.createGain();
  source.connect(gainNode);
  gainNode.connect(this.masterGain || this.audioContext.destination);
  gainNode.gain.value = 0;
  source.start(0);
  gainNode.gain.setTargetAtTime(
    this.sampleGain * vol,
    this.audioContext.currentTime,
    this.sampleAttack
  );
  this.source = source;
  this.gainNode = gainNode;
};

/**
 * Retune a held note to a new cents value.
 *
 * Small jumps (TuneCell / FundamentalTuneCell drags): a brief anti-zipper time
 * constant (~5 ms) smooths the ~60 fps pointer-event stream without adding
 * perceptible glide — the pointer stream itself is the glide.
 *
 * Large jumps (octave shift, ≥ 400 ¢): instant setValueAtTime, matching the
 * MTS and MPE synths which also removed interpolation for octave-shift retunes.
 */
ActiveHex.prototype.retune = function(newCents) {
  if (this.release || !this.source) return;
  const delta = Math.abs(newCents - this.cents);
  this.cents = newCents;

  const freq = this.fundamental * Math.pow(2, (newCents - this.centsToReference) / 1200);
  const targetPlaybackRate = freq / this.sampleFreq;
  const now = this.audioContext.currentTime;

  if (delta >= 400) {
    // Large jump (octave shift): instant — no audible glide artefact.
    this.source.playbackRate.setValueAtTime(targetPlaybackRate, now);
  } else {
    // Small change: ~5 ms anti-zipper smoothing.
    this.source.playbackRate.setTargetAtTime(targetPlaybackRate, now, 0.005);
  }
};

ActiveHex.prototype.aftertouch = function(value) {
  if (this.release || !this.gainNode) return;
  const pressure = Math.max(0, Math.min(127, value)) / 127;
  const targetGain = this.sampleGain * this.base_vol * (1 + this.aftertouch_amount * pressure);
  this.gainNode.gain.setTargetAtTime(targetGain, this.audioContext.currentTime, 0.02);
};

ActiveHex.prototype.noteOff = function(release_velocity) {
  // Guard against double noteOff - prevents clicks from duplicate release calls
  if (this._noteOffCalled) return;
  this._noteOffCalled = true;
  this.release = true;
  
  if (this.gainNode && this.audioContext) {
    const now = this.audioContext.currentTime;
    const releaseTime = this.sampleRelease || 4.0;
    
    // Cancel any scheduled values
    this.gainNode.gain.cancelScheduledValues(now);
    
    // CRITICAL: Must set current value explicitly with setValueAtTime
    // exponentialRampToValueAtTime requires a definite starting point
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
    
    // Use exponentialRampToValueAtTime for smooth fade to silence
    // Must use a value > 0 (0.0001) because exponential ramp can't reach 0
    this.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);
    
    // Stop the source slightly after the fade completes
    if (this.source) {
      this.source.stop(now + releaseTime + 0.05);
    }
  }
};

// ─── iOS Audio Helper Exports ──────────────────────────────────────────────────

/**
 * Check if AudioContext is running (for UI indicators)
 */
export const isAudioContextRunning = () => {
  return sharedAudioContext?.state === 'running';
};

/**
 * Get current AudioContext state (for debugging)
 */
export const getAudioContextState = () => {
  return sharedAudioContext?.state || 'not created';
};

/**
 * Force resume AudioContext (call on user interaction if audio is muted)
 */
export const forceResumeAudioContext = async () => {
  if (sharedAudioContext && sharedAudioContext.state !== 'running') {
    try {
      await sharedAudioContext.resume();
      console.log('AudioContext force-resumed, state:', sharedAudioContext.state);
      return true;
    } catch (e) {
      console.warn('Failed to force-resume AudioContext:', e.message);
      return false;
    }
  }
  return sharedAudioContext?.state === 'running';
};

/**
 * Check if running on iOS (for UI conditional rendering)
 */
export const isRunningOnIOS = () => isIOS;

export default create_sample_synth;