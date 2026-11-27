import { DsfOscillator } from "./dsf-oscillator.js";
import { dsfLoudnessGain } from "./equal-loudness.js";
import { normalizeDsfControls } from "./controls.js";
import { compileDsfModulation, velocityCurve, gentleVelocityCurve, velocityMultiplier,
  relativeTimbreOffset, expressionYTimbre, pressureGain, pressureBite, unitValue } from "./modulation.js";

const MAX_VOICES = 64;
const MAX_QUEUE = 4096;
const TRANSITION_SECONDS = 0.01;
const NOTE_GAIN = 0.125;
// Keep the ISO contour intact, with a gentler overall listening level.
const ISO_OUTPUT_GAIN = 0.85;
// Subtract the exponential's endpoint tangent so falling segments arrive with
// zero slope, rather than cutting off a residual tail at their time limit.
const fallingCurve = curvature => {
  const end = Math.exp(-curvature);
  return Object.freeze({ curvature, end, normalization: 1 - end * (1 + curvature) });
};
const RELEASE_CURVE = fallingCurve(3);
// More immediate peak-to-sustain contrast without shortening the segment.
const DECAY_CURVE = fallingCurve(5);

export class DsfProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.controls = normalizeDsfControls();
    this.prepareControls();
    this.volume = this.controls.volume;
    this.volumeStep = 0;
    this.volumeRemaining = 0;
    this.voices = new Map();
    this.stolenTails = [];
    this.queue = [];
    this.frame = typeof currentFrame === "number" ? currentFrame : 0;
    this.epoch = 0;
    this.blocks = 0;
    this.lateEvents = 0;
    this.droppedEvents = 0;
    this.stolenVoices = 0;
    this.peak = 0;
    this.port.onmessage = ({ data }) => this.message(data);
  }

  message(data) {
    if (!data || typeof data.command !== "string") return;
    if (data.command === "clear") {
      this.epoch = Math.max(this.epoch, data.epoch ?? this.epoch);
      this.queue.length = 0;
      this.voices.clear();
      this.stolenTails.length = 0;
      this.port.postMessage({ type: "cleared", ack: data.ack });
      return;
    }
    if (data.epoch != null && data.epoch !== this.epoch) return;
    if (data.command === "controls") {
      const controls = normalizeDsfControls(data.controls);
      const sustainChanged = this.controls.sustain !== controls.sustain;
      const velocityChanged = this.controls.velocityVolume !== controls.velocityVolume;
      const volumeEnvelopeChanged = this.controls.volumeEnvelope !== controls.volumeEnvelope;
      const timbreAmountChanged = this.controls.timbreAmount !== controls.timbreAmount ||
        this.controls.timbreEnvelope !== controls.timbreEnvelope;
      const timbreSustainChanged = this.controls.timbreSustain !== controls.timbreSustain;
      const spectrumChanged = this.controls.velocityTimbre !== controls.velocityTimbre || timbreAmountChanged || timbreSustainChanged ||
        this.controls.timbre !== controls.timbre || this.controls.partials !== controls.partials ||
        this.controls.pressure !== controls.pressure || this.controls.timbreResponse !== controls.timbreResponse;
      const pressureChanged = this.controls.pressure !== controls.pressure;
      const compensationChanged = this.controls.iso226 !== controls.iso226;
      const volumeChanged = this.controls.volume !== controls.volume;
      this.controls = controls;
      this.prepareControls();
      if (volumeChanged) {
        this.volumeRemaining = Math.max(1, Math.round(sampleRate * TRANSITION_SECONDS));
        this.volumeStep = (this.controls.volume - this.volume) / this.volumeRemaining;
      }
      if (!spectrumChanged && !pressureChanged && !compensationChanged && !sustainChanged && !volumeEnvelopeChanged && !velocityChanged) return;
      for (const voice of this.voices.values()) {
        if (timbreAmountChanged || timbreSustainChanged) {
          if (!controls.timbreEnvelope || (controls.timbreAmount === 0 && controls.timbreSustain === 0)) voice.timbreEnvelope = null;
          else if (!voice.timbreEnvelope && !voice.released) this.initTimbreEnvelope(voice);
        }
        const timbreEnvelope = voice.timbreEnvelope;
        if (timbreAmountChanged && timbreEnvelope && !voice.released && timbreEnvelope.stage === "attack")
          this.envelope(timbreEnvelope, controls.timbreAmount,
            timbreEnvelope.remaining * 1000 / sampleRate);
        if (timbreSustainChanged && timbreEnvelope && !voice.released && timbreEnvelope.stage !== "attack")
          this.envelope(timbreEnvelope, controls.timbreSustain,
            timbreEnvelope.remaining > 0 ? timbreEnvelope.remaining * 1000 / sampleRate : TRANSITION_SECONDS * 1000);
        if (spectrumChanged) this.transition(voice, voice.frequency);
        if (pressureChanged) this.expressiveGain(voice);
        if (compensationChanged) this.compensate(voice);
        if (!voice.released && volumeEnvelopeChanged) {
          voice.stage = controls.volumeEnvelope ? "attack" : "sustain";
          this.envelope(voice, this.attackLevel(voice), controls.volumeEnvelope
            ? this.envelopeTime(controls.attack, voice.velocity, voice.velocityCurve) : TRANSITION_SECONDS * 1000);
          this.advanceEnvelopeStage(voice);
        } else if (!voice.released && (velocityChanged || (controls.volumeEnvelope && sustainChanged && voice.stage !== "attack"))) {
          const target = this.attackLevel(voice) * (!controls.volumeEnvelope || voice.stage === "attack" ? 1 : this.controls.sustain);
          this.envelope(voice, target,
            voice.remaining > 0 ? voice.remaining * 1000 / sampleRate : TRANSITION_SECONDS * 1000);
        }
      }
      return;
    }
    if (data.command === "cancel") {
      this.queue = this.queue.filter(event => event.id !== data.id);
      if (!this.voices.has(data.id)) this.port.postMessage({ type: "ended", id: data.id });
      return;
    }
    if (!["start", "stop", "frequency", "expression"].includes(data.command)) return;
    if (["start", "frequency"].includes(data.command) && (!Number.isFinite(data.frequency) ||
        data.frequency <= 0 || data.frequency >= sampleRate / 2)) return;
    const event = { ...data, id: data.id ?? 0,
      frame: Number.isFinite(data.frame) ? Math.max(0, Math.round(data.frame)) : this.frame };
    if (this.queue.length >= MAX_QUEUE) {
      this.droppedEvents++;
      if (event.command !== "stop") return;
      // A full queue may reject attacks, but must not strand an existing voice.
      this.apply(event);
      return;
    }
    let index = this.queue.length;
    while (index > 0 && this.queue[index - 1].frame > event.frame) index--;
    this.queue.splice(index, 0, event);
  }

  attackLevel(voice) {
    return velocityMultiplier(this.modulation.volume, voice.velocityCurve ?? velocityCurve(voice.velocity));
  }

  timbreFor(voice) {
    const base = this.controls.timbreResponse > 0
      ? this.controls.timbre + relativeTimbreOffset(this.controls.timbre, expressionYTimbre(this.modulation, voice.timbre))
      : this.controls.timbre;
    const envelopeTimbre = this.controls.timbreEnvelope && voice.timbreEnvelope
      ? voice.timbreEnvelope.gain : 0;
    // Expression shifts the base first; the envelope then spans the available
    // room on either side of that base and releases back to it.
    const envelopeOffset = relativeTimbreOffset(base, envelopeTimbre);
    return Math.max(0, Math.min(1, base +
      envelopeOffset +
      (this.controls.pressure > 0 ? pressureBite(this.modulation, voice.pressure) : 0) +
      (this.modulation.timbreDepth ? this.modulation.timbreDepth *
        gentleVelocityCurve(voice.velocity, this.modulation.timbreLinearWeight) : 0)));
  }

  prepareControls() {
    const c = this.controls;
    this.modulation = compileDsfModulation(c);
    this.timbreEnvelopeControls = { attack: c.timbreAttack, decay: c.timbreDecay,
      sustainTarget: c.timbreSustain, release: c.timbreRelease };
  }

  initTimbreEnvelope(voice) {
    if (!this.controls.timbreEnvelope || (!this.controls.timbreAmount && !this.controls.timbreSustain)) return;
    // Here gain is a signed relative offset, not an amplitude multiplier.
    const state = { gain: 0, stage: "attack" };
    this.envelope(state, this.controls.timbreAmount, this.envelopeTime(this.controls.timbreAttack, voice.velocity, voice.velocityCurve));
    this.advanceEnvelopeStage(state, this.timbreEnvelopeControls, this.controls.timbreAmount);
    voice.timbreEnvelope = state;
    voice.nextTimbreFrame = this.frame + Math.max(1, Math.round(sampleRate * 0.002));
  }

  expressiveGain(voice) {
    const target = pressureGain(this.modulation, voice.pressure);
    if (target === voice.expressionTarget) return;
    voice.expressionTarget = target;
    voice.expressionRemaining = Math.max(1, Math.round(sampleRate * TRANSITION_SECONDS));
    voice.expressionStep = (voice.expressionTarget - voice.expressionGain) / voice.expressionRemaining;
  }

  envelope(voice, target, durationMs) {
    voice.targetGain = target;
    voice.remaining = Math.max(0, Math.round(durationMs * sampleRate / 1000));
    if (voice.remaining === 0) { voice.gain = target; return; }
    voice.envelopeLength = voice.remaining;
    voice.envelopeStart = voice.gain;
    voice.envelopeCurve = voice.stage === "attack" ? "attack" : target < voice.gain ? "fall" : "swell";
    voice.envelopeFall = voice.stage === "decay" ? DECAY_CURVE : RELEASE_CURVE;
    voice.envelopeExponential = 1;
    // One exponential per segment; the per-sample path uses multiplication.
    voice.envelopeMultiplier = Math.exp(-voice.envelopeFall.curvature / voice.remaining);
  }

  advanceEnvelope(voice, controls, peak) {
    if (voice.remaining === 0) return;
    if (--voice.remaining === 0) {
      voice.gain = voice.targetGain;
      this.advanceEnvelopeStage(voice, controls, peak);
      return;
    }
    const t = 1 - voice.remaining / voice.envelopeLength;
    let progress;
    if (voice.envelopeCurve === "attack") {
      // Prompt onset, gently flattening into the peak: no added onset delay.
      progress = t * (2 - t);
    } else if (voice.envelopeCurve === "swell") {
      progress = t * t * (3 - 2 * t);
    } else {
      voice.envelopeExponential *= voice.envelopeMultiplier;
      const { curvature, end, normalization } = voice.envelopeFall;
      const remaining = (voice.envelopeExponential - end *
        (1 + curvature * (1 - t))) / normalization;
      progress = 1 - Math.max(0, Math.min(1, remaining));
      // Ease out of the peak with zero initial slope, retaining a little more
      // tone before the brisk decay. Keep release's existing shape intact.
      if (voice.envelopeFall === DECAY_CURVE) progress = progress * progress * (2 - progress);
    }
    voice.gain = voice.envelopeStart + (voice.targetGain - voice.envelopeStart) * progress;
  }

  // Resolve zero-length stages immediately; timed stages advance on the audio clock.
  advanceEnvelopeStage(voice, controls = this.controls, peak = this.attackLevel(voice)) {
    while (voice.remaining === 0) {
      if (voice.stage === "attack") {
        voice.stage = "decay";
        this.envelope(voice, controls.sustainTarget ?? peak * controls.sustain, controls.decay);
      } else if (voice.stage === "decay") {
        voice.stage = "sustain";
      } else break;
    }
  }

  compensate(voice) {
    const target = this.compensationFor(voice.frequency);
    if (target === voice.compensationTarget) return;
    voice.compensationTarget = target;
    voice.compensationRemaining = Math.max(1, Math.round(sampleRate * TRANSITION_SECONDS));
    voice.compensationStep = (voice.compensationTarget - voice.compensation) / voice.compensationRemaining;
  }

  compensationFor(frequency) {
    // Interpolate in decibels: 0 is neutral, 1 retains the existing contour
    // and its overall level trim. Half amount applies half the dB adjustment.
    return this.controls.iso226 > 0
      ? (ISO_OUTPUT_GAIN * dsfLoudnessGain(frequency)) ** this.controls.iso226 : 1;
  }

  transition(voice, frequency) {
    if (voice.frequency !== frequency) {
      voice.frequency = frequency;
      this.compensate(voice);
    }
    const timbre = this.timbreFor(voice);
    if (voice.osc.frequency === frequency && voice.osc.timbre === timbre &&
        voice.osc.partials === this.controls.partials) {
      voice.pendingTransition = false;
      return;
    }
    if (voice.transitionRemaining) { voice.pendingTransition = true; return; }
    // Reuse the crossfade renderer instead of allocating an oscillator for
    // every expression update. It is copied only after the prior fade ends.
    voice.spareOscillator ??= new DsfOscillator(sampleRate);
    voice.previous = voice.spareOscillator.copyFrom(voice.osc);
    voice.osc.configure(frequency, timbre, this.controls.partials);
    voice.transitionLength = Math.max(1, Math.round(sampleRate * TRANSITION_SECONDS));
    voice.transitionRemaining = voice.transitionLength;
  }

  apply(event) {
    if (event.frame < this.frame) this.lateEvents++;
    if (event.command === "start") {
      if (this.voices.has(event.id)) return;
      if (this.voices.size >= MAX_VOICES) {
        const old = [...this.voices.values()].find(voice => voice.released) ?? this.voices.values().next().value;
        this.voices.delete(old.id);
        old.released = true;
        old.stage = "release";
        this.envelope(old, 0, 5);
        if (this.stolenTails.length >= 8) this.stolenTails.shift();
        this.stolenTails.push(old);
        this.port.postMessage({ type: "ended", id: old.id, stolen: true });
        this.stolenVoices++;
      }
      const osc = new DsfOscillator(sampleRate);
      const voice = { id: event.id, osc, frequency: event.frequency,
        pressure: this.normalized(event.pressure), timbre: this.normalized(event.timbre),
        velocity: Math.max(0, Math.min(127, event.velocity ?? 72)), gain: 0, released: false,
        stage: this.controls.volumeEnvelope === false ? "sustain" : "attack" };
      voice.velocityCurve = velocityCurve(voice.velocity);
      this.initTimbreEnvelope(voice);
      osc.configure(event.frequency, this.timbreFor(voice), this.controls.partials);
      voice.expressionGain = pressureGain(this.modulation, voice.pressure);
      voice.expressionTarget = voice.expressionGain;
      voice.compensation = this.compensationFor(event.frequency);
      voice.compensationTarget = voice.compensation;
      this.envelope(voice, this.attackLevel(voice), this.controls.volumeEnvelope === false
        ? 1 : this.envelopeTime(this.controls.attack, voice.velocity, voice.velocityCurve));
      this.advanceEnvelopeStage(voice);
      this.voices.set(event.id, voice);
    } else {
      const voice = this.voices.get(event.id);
      if (!voice) return;
      if (event.command === "frequency" && !voice.released) this.transition(voice, event.frequency);
      if (event.command === "expression" && !voice.released) {
        const pressure = Number.isFinite(event.pressure) ? this.normalized(event.pressure) : voice.pressure;
        const timbre = Number.isFinite(event.timbre) ? this.normalized(event.timbre) : voice.timbre;
        const pressureChanged = pressure !== voice.pressure;
        const timbreChanged = timbre !== voice.timbre;
        if (!pressureChanged && !timbreChanged) return;
        // Retain controller positions for live enabling, but do no modulation
        // or oscillator work for sources whose amount is zero.
        voice.pressure = pressure;
        voice.timbre = timbre;
        if (pressureChanged && this.controls.pressure > 0) this.expressiveGain(voice);
        if ((pressureChanged && this.controls.pressure > 0) ||
            (timbreChanged && this.controls.timbreResponse > 0)) this.transition(voice, voice.frequency);
      }
      if (event.command === "stop" && !voice.released) {
        voice.released = true;
        voice.stage = "release";
        const releaseScale = velocityMultiplier(this.modulation.release, velocityCurve(event.velocity));
        this.envelope(voice, 0, this.controls.volumeEnvelope === false
          ? 4 : this.controls.release * releaseScale);
        if (voice.timbreEnvelope) {
          voice.timbreEnvelope.stage = "release";
          this.envelope(voice.timbreEnvelope, 0, this.controls.timbreRelease * releaseScale);
          this.transition(voice, voice.frequency);
        }
      }
    }
  }

  normalized(value) { return unitValue(value); }

  envelopeTime(milliseconds, velocity, curve = velocityCurve(velocity)) {
    return milliseconds * velocityMultiplier(this.modulation.attack, curve);
  }

  voiceSample(voice) {
    // The envelope advances per sample; spectral targets are sampled every
    // 2 ms and at stage boundaries, then use the existing smooth crossfade.
    const timbreEnvelope = voice.timbreEnvelope;
    if (timbreEnvelope) {
      const stage = timbreEnvelope.stage;
      const moving = timbreEnvelope.remaining > 0;
      this.advanceEnvelope(timbreEnvelope, this.timbreEnvelopeControls, this.controls.timbreAmount);
      if (moving && (this.frame >= voice.nextTimbreFrame || stage !== timbreEnvelope.stage || timbreEnvelope.remaining === 0)) {
        voice.nextTimbreFrame = this.frame + Math.max(1, Math.round(sampleRate * 0.002));
        this.transition(voice, voice.frequency);
      }
    }
    this.advanceEnvelope(voice);
    let value = voice.osc.nextSample();
    if (voice.transitionRemaining > 0) {
      const blend = 1 - voice.transitionRemaining / voice.transitionLength;
      value = voice.previous.nextSample() * (1 - blend) + value * blend;
      if (--voice.transitionRemaining === 0) {
        voice.previous = null;
        if (voice.pendingTransition) {
          voice.pendingTransition = false;
          this.transition(voice, voice.frequency);
        }
      }
    }
    if (voice.compensationRemaining > 0) {
      voice.compensation += voice.compensationStep;
      if (--voice.compensationRemaining === 0) voice.compensation = voice.compensationTarget;
    }
    if (voice.expressionRemaining > 0) {
      voice.expressionGain += voice.expressionStep;
      if (--voice.expressionRemaining === 0) voice.expressionGain = voice.expressionTarget;
    }
    return value * voice.gain * voice.compensation * voice.expressionGain;
  }

  report() {
    this.port.postMessage({ type: "stats", blocks: this.blocks, frame: this.frame,
      voices: this.voices.size, releaseTails: this.stolenTails.length,
      queued: this.queue.length, lateEvents: this.lateEvents,
      droppedEvents: this.droppedEvents, stolenVoices: this.stolenVoices, peak: this.peak });
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    if (!channels?.length) return true;
    let peak = 0;
    for (let i = 0; i < channels[0].length; i++, this.frame++) {
      while (this.queue.length && this.queue[0].frame <= this.frame) this.apply(this.queue.shift());
      if (this.volumeRemaining > 0) {
        this.volume += this.volumeStep;
        if (--this.volumeRemaining === 0) this.volume = this.controls.volume;
      }
      let value = 0;
      for (const voice of this.voices.values()) {
        value += this.voiceSample(voice);
        if (voice.remaining === 0 && (voice.released || (voice.stage === "sustain" && voice.gain === 0))) {
          this.voices.delete(voice.id);
          this.port.postMessage({ type: "ended", id: voice.id });
        }
      }
      for (let tail = this.stolenTails.length - 1; tail >= 0; tail--) {
        const voice = this.stolenTails[tail];
        value += this.voiceSample(voice);
        if (voice.remaining === 0) this.stolenTails.splice(tail, 1);
      }
      value *= NOTE_GAIN * this.volume;
      if (!Number.isFinite(value)) value = 0;
      peak = Math.max(peak, Math.abs(value));
      for (const channel of channels) channel[i] = value;
    }
    this.peak = peak;
    if (++this.blocks % 32 === 0) this.report();
    return true;
  }
}
registerProcessor("hexatone-dsf", DsfProcessor);
