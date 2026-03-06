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

    // decodedBuffers is populated by prepare() after a user gesture
    let decodedBuffers = null;

    let offset = 0;
    if (reference_degree > 0) {
      offset = scalaToCents(scale[reference_degree - 1]);
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
          await sharedAudioContext.resume();
        }
        // slice(0) copies the buffer — decodeAudioData consumes its argument
        decodedBuffers = await Promise.all(
          rawBuffers.map(buf => sharedAudioContext.decodeAudioData(buf.slice(0)))
        );
      },

      makeHex: (coords, cents, velocity_played, steps, equaves, equivSteps, cents_prev, cents_next, note_played) => {
        return new ActiveHex(
          coords, cents, velocity_played, note_played, fundamental, offset,
          sampleGain, sampleAttack, sampleRelease, sampleLoop, sampleLoopPoints,
          velocity_response, aftertouch_amount, decodedBuffers, sharedAudioContext
        );
      },
    };
  } catch (e) {
    console.error(e);
  }
};

function ActiveHex(coords, cents, velocity_played, note_played, fundamental, offset,
  sampleGain, sampleAttack, sampleRelease, sampleLoop, sampleLoopPoints,
  velocity_response, aftertouch_amount, sampleBuffer, audioContext) {

  this.coords = coords;
  this.release = false;
  this.cents = cents;
  this.velocity_played = velocity_played;
  this.note_played = note_played;
  this.fundamental = fundamental;
  this.offset = offset;
  this.sampleGain = sampleGain;
  this.sampleAttack = sampleAttack;
  this.sampleRelease = sampleRelease;
  this.sampleLoop = sampleLoop;
  this.sampleLoopPoints = sampleLoopPoints;
  this.velocity_response = velocity_response;
  this.aftertouch_amount = aftertouch_amount;
  this.sampleBuffer = sampleBuffer;
  this.audioContext = audioContext;
}

ActiveHex.prototype.noteOn = function() {
  // Guard: prepare() may not have completed yet if the user is very fast
  if (!this.sampleBuffer || !this.audioContext) return;

  const freq = this.fundamental * Math.pow(2, (this.cents - this.offset) / 1200);
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

  const gainNode = this.audioContext.createGain();
  source.connect(gainNode);
  gainNode.connect(this.audioContext.destination);
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

ActiveHex.prototype.aftertouch = function(value) {
  if (!this.gainNode || !this.audioContext) return;
  // value: 0-127. Scale to 0..aftertouch_amount extra gain on top of base_vol.
  const extra = (value / 127) * this.aftertouch_amount;
  const target = this.sampleGain * (this.base_vol + extra);
  const now = this.audioContext.currentTime;
  this.gainNode.gain.cancelScheduledValues(now);
  this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
  this.gainNode.gain.linearRampToValueAtTime(target, now + 0.03);
};

ActiveHex.prototype.noteOff = function() {
  if (!this.gainNode || !this.source) return;
  const now = this.audioContext.currentTime;
  const releaseEnd = now + this.sampleRelease * 4; // *4 gives a similar perceptual length to the old curve
  // Cancel any scheduled gain changes, then ramp linearly to exactly 0.
  // linearRampToValueAtTime reaches true zero, avoiding the click Firefox
  // produces when a node is stopped with residual signal still present.
  this.gainNode.gain.cancelScheduledValues(now);
  this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
  this.gainNode.gain.linearRampToValueAtTime(0, releaseEnd);
  this.source.stop(releaseEnd);
};

export default create_sample_synth;
