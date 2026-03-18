import { instruments } from './instruments';
import { scalaToCents } from '../settings/scale/parse-scale';

// Three concepts:
// Coordinates -> Scale degree -> Pitch/midi

// ─── Single shared AudioContext ───────────────────────────────────────────────
// Created lazily inside prepare() which is only called after a user gesture,
// satisfying Chrome's autoplay policy. Reused across all synth instances to
// avoid hitting the browser's context limit (~6).
let sharedAudioContext = null;

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
          sharedAudioContext = new AudioContext();
        }
        if (sharedAudioContext.state === 'suspended') {
          try {
            await sharedAudioContext.resume();
          } catch (e) {
            console.warn('AudioContext autoplay blocked:', e.message);
          }
        }
        // Master gain node — all voices connect here before destination
        if (!masterGain) {
          masterGain = sharedAudioContext.createGain();
          masterGain.gain.value = masterVolume;
          masterGain.connect(sharedAudioContext.destination);
        }
        // slice(0) copies the buffer — decodeAudioData consumes its argument
        decodedBuffers = await Promise.all(
          rawBuffers.map(buf => sharedAudioContext.decodeAudioData(buf.slice(0)))
        );
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
 * Smoothly retune a held note to a new cents value.
 * Uses adaptive time constant: larger pitch changes get smoother glides.
 */
ActiveHex.prototype.retune = function(newCents) {
  const oldCents = this.cents;
  this.cents = newCents;
  
  const freq = this.fundamental * Math.pow(2, (newCents - this.centsToReference) / 1200);
  const targetPlaybackRate = freq / this.sampleFreq;
  
  // Adaptive time constant based on pitch change size
  const delta = Math.abs(newCents - oldCents);
  let timeConstant;
  if (delta < 5) {
    timeConstant = 0.005; // ~5ms - nearly instant for tiny adjustments
  } else if (delta < 20) {
    timeConstant = 0.015; // ~15ms - quick for small changes
  } else if (delta < 50) {
    timeConstant = 0.025; // ~25ms - smooth for medium changes
  } else {
    timeConstant = 0.04;  // ~40ms - noticeable glide for large changes
  }
  
  this.source.playbackRate.setTargetAtTime(targetPlaybackRate, this.audioContext.currentTime, timeConstant);
};

ActiveHex.prototype.noteOff = function(release_velocity) {
  const vel = release_velocity != null ? release_velocity : this.base_vol;
  if (this.gainNode) {
    this.gainNode.gain.setTargetAtTime(0, this.audioContext.currentTime, this.sampleRelease);
  }
  if (this.source) {
    this.source.stop(this.audioContext.currentTime + this.sampleRelease * 2);
  }
};

export default create_sample_synth;
