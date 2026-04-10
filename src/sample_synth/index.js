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
let iosPageShowHandler = null;

const createSharedAudioContext = () => {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  sharedAudioContext = new AudioContextClass();
  setupIOSAudioHandler();
  return sharedAudioContext;
};

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
  if (iosPageShowHandler) {
    window.removeEventListener('pageshow', iosPageShowHandler);
  }

  iosPageShowHandler = async () => {
    if (sharedAudioContext && sharedAudioContext.state !== 'running' && sharedAudioContext.state !== 'closed') {
      try {
        await sharedAudioContext.resume();
        console.log('iOS: AudioContext resumed on pageshow');
      } catch (e) {
        console.warn('iOS: Failed to resume AudioContext on pageshow:', e.message);
      }
    }
  };

  window.addEventListener('pageshow', iosPageShowHandler);
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
            velocity_floor = 0.15, velocity_exp = 0.75,
            aftertouch: aftertouch_amount = 0,
            filter_low, filter_mid, filter_high } = instrument;

    // Fit a quadratic through (0→low, 64→mid, 127→high) in log2-frequency space.
    // If the three-point spec is absent, fall back to fully open filter (no sweep).
    const filterCoeffs = (filter_low && filter_mid && filter_high) ? (() => {
      const n  = 64 / 127;
      const C  = Math.log2(filter_low);
      const lh = Math.log2(filter_high / filter_low);
      const lm = Math.log2(filter_mid  / filter_low);
      const A  = (lm - n * lh) / (n * n - n);
      const B  = lh - A;
      return { A, B, C };
    })() : null;
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
    // Last known mod wheel position (0–127). New notes initialize their filter
    // to this value so the first CC1 message never causes a discontinuous jump.
    let lastModWheel = 0;
    let controllerState = {
      ccValues: {},
      channelPressure: 0,
      pitchBend14: 8192,
    };

    let centsToReference = 0;
    if (reference_degree > 0) {
      centsToReference = scalaToCents(scale[reference_degree - 1]);
    }

    const activeHexes = new Set();

    return {
      family: "sample",
      // ── Call once after a user gesture (e.g. preset selection) ───────────────
      // Creates/resumes the AudioContext and decodes all samples so that noteOn
      // is fully synchronous and has no latency.
      prepare: async () => {
        if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
          sharedAudioContext = createSharedAudioContext();
          masterGain = null;
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
        
        // Master gain node — all voices connect here before destination.
        // Start at 0 and ramp to target volume over 15 ms so that any note
        // scheduled at the exact moment the AudioContext resumes doesn't
        // produce a click or blip before the graph has settled.
        if (!masterGain) {
          masterGain = sharedAudioContext.createGain();
          masterGain.gain.value = 0;
          masterGain.connect(sharedAudioContext.destination);
          masterGain.gain.setTargetAtTime(masterVolume, sharedAudioContext.currentTime, 0.015);
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

      rememberControllerState: (state = {}) => {
        controllerState = {
          ...controllerState,
          ...state,
          ccValues: {
            ...controllerState.ccValues,
            ...(state.ccValues || {}),
          },
        };
        lastModWheel = controllerState.ccValues[1] ?? 0;
      },

      applyControllerState: (state = {}) => {
        controllerState = {
          ...controllerState,
          ...state,
          ccValues: {
            ...controllerState.ccValues,
            ...(state.ccValues || {}),
          },
        };
        lastModWheel = controllerState.ccValues[1] ?? 0;
      },

      makeHex: (coords, cents, steps, equaves, equivSteps, cents_prev, cents_next,
        note_played, velocity_played, bend, degree0toRef_ratio) => {
        const hex = new ActiveHex(
          coords, cents, velocity_played, note_played, fundamental, centsToReference,
          sampleGain, sampleAttack, sampleRelease, sampleLoop, sampleLoopPoints,
          velocity_response, velocity_floor, velocity_exp, aftertouch_amount, filterCoeffs,
          decodedBuffers, sharedAudioContext, masterGain, lastModWheel,
          (v) => { lastModWheel = v; }
        );
        activeHexes.add(hex);
        const originalNoteOff = hex.noteOff.bind(hex);
        hex.noteOff = (release_velocity) => {
          originalNoteOff(release_velocity);
          activeHexes.delete(hex);
        };
        return hex;
      },

      releaseAll: () => {
        for (const hex of [...activeHexes]) hex.noteOff(0);
      },
    };
  } catch (e) {
    console.error(e);
  }
};

function ActiveHex(coords, cents, velocity_played, note_played, fundamental, centsToReference,
  sampleGain, sampleAttack, sampleRelease, sampleLoop, sampleLoopPoints,
  velocity_response, velocity_floor, velocity_exp, aftertouch_amount, filterCoeffs,
  sampleBuffer, audioContext, masterGain, initialModWheel, setModWheel) {

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
  this.velocity_floor = velocity_floor;
  this.velocity_exp   = velocity_exp;
  this.aftertouch_amount = aftertouch_amount;
  this.filterCoeffs = filterCoeffs; // quadratic log2-freq coefficients {A,B,C}, or null
  this.sampleBuffer = sampleBuffer;
  this.audioContext = audioContext;
  this.masterGain = masterGain || null;
  this.initialModWheel = initialModWheel || 0;
  this._setModWheel = setModWheel || null;
  this._noteOffCalled = false; // Guard against double noteOff
}

ActiveHex.prototype.noteOn = function() {
  // Guard: prepare() may not have completed yet if the user is very fast
  if (!this.sampleBuffer || !this.audioContext) return;

  const freq = this.fundamental * Math.pow(2, (this.cents - this.centsToReference) / 1200);
  const vol = this.velocity_response
    ? this.velocity_floor + ((1 - this.velocity_floor) * ((this.velocity_played / 127) ** this.velocity_exp))
    : 1.0 - this.velocity_floor;
  //console.log("vol:",vol);
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

  // Lowpass filter — cc74 (slide/timbre) and mod wheel sweep the cutoff.
  // When filter_amount is 0 the filter sits fully open (20 kHz) and cc74 has no effect.
  // Initialize to the current mod wheel position so the first CC1 event is seamless.
  const filterNode = this.audioContext.createBiquadFilter();
  filterNode.type = 'lowpass';
  filterNode.Q.value = 1.0;
  if (this.filterCoeffs) {
    const n = this.initialModWheel / 127;
    const { A, B, C } = this.filterCoeffs;
    filterNode.frequency.value = Math.pow(2, A*n*n + B*n + C);
  } else {
    filterNode.frequency.value = 20000;
  }

  source.connect(gainNode);
  gainNode.connect(filterNode);
  filterNode.connect(this.masterGain || this.audioContext.destination);

  gainNode.gain.value = 0;
  source.start(0);
  gainNode.gain.setTargetAtTime(
    this.sampleGain * vol,
    this.audioContext.currentTime,
    this.sampleAttack
  );
  this.source = source;
  this.gainNode = gainNode;
  this.filterNode = filterNode;
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

// Standard wheel mode in Hexatone bends the internal sample engine directly in
// cents space. External MIDI/MPE outputs use raw pitch-bend passthrough instead.
ActiveHex.prototype.standardWheelRetune = function(newCents) {
  this.retune(newCents, true);
};

ActiveHex.prototype.aftertouch = function(value) {
  if (this.release || !this.gainNode) return;
  const pressure = Math.max(0, Math.min(127, value)) / 127;
  const targetGain = this.sampleGain * this.base_vol * (1 + this.aftertouch_amount * pressure);
  this.gainNode.gain.setTargetAtTime(targetGain, this.audioContext.currentTime, 0.04);
};

// pressure: same as aftertouch for the sample engine (gain modulation).
ActiveHex.prototype.pressure = function(value) {
  this.aftertouch(value);
};

// cc74 (slide / timbre): sweeps the lowpass filter cutoff.
// norm 0–1 maps logarithmically from filter_freq to filter_freq * 2^filter_amount.
// When filter_amount is 0 the filter is fully open and this is a no-op.
ActiveHex.prototype.cc74 = function(value) {
  if (this.release || !this.filterNode || !this.filterCoeffs) return;
  const n = Math.max(0, Math.min(127, value)) / 127;
  const { A, B, C } = this.filterCoeffs;
  const targetFreq = Math.pow(2, A*n*n + B*n + C);
  this.filterNode.frequency.setTargetAtTime(targetFreq, this.audioContext.currentTime, 0.04);
};

// modwheel (CC1): broadcast to all active voices — drives the same filter as cc74.
// Also updates the synth-level lastModWheel so notes played after a wheel move
// initialize their filter at the correct position (no discontinuity on first event).
ActiveHex.prototype.modwheel = function(value) {
  if (this._setModWheel) this._setModWheel(value);
  this.cc74(value);
};
ActiveHex.prototype.expression = function() {};

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
