import { DsfOscillator } from "./dsf-oscillator.js";
import { dsfLoudnessGain } from "./equal-loudness.js";
import { normalizeDsfControls } from "./controls.js";
import { createDsfYzEnvelope } from "./generated-yz.js";

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
    this.setTimbreEnvelopeControls();
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
      const velocityChanged = this.controls.velocity !== controls.velocity;
      const generationChanged = this.controls.generateYZ !== controls.generateYZ;
      const volumeEnvelopeChanged = this.controls.volumeEnvelope !== controls.volumeEnvelope;
      const timbreAmountChanged = this.controls.timbreAmount !== controls.timbreAmount ||
        this.controls.timbreEnvelope !== controls.timbreEnvelope;
      const timbreSustainChanged = this.controls.timbreSustain !== controls.timbreSustain;
      const spectrumChanged = generationChanged || velocityChanged || timbreAmountChanged || timbreSustainChanged ||
        this.controls.timbre !== controls.timbre || this.controls.partials !== controls.partials ||
        this.controls.pressure !== controls.pressure || this.controls.timbreResponse !== controls.timbreResponse;
      const pressureChanged = generationChanged || this.controls.pressure !== controls.pressure;
      const compensationChanged = this.controls.iso226 !== controls.iso226;
      const volumeChanged = this.controls.volume !== controls.volume;
      this.controls = controls;
      this.setTimbreEnvelopeControls();
      if (volumeChanged) {
        this.volumeRemaining = Math.max(1, Math.round(sampleRate * TRANSITION_SECONDS));
        this.volumeStep = (this.controls.volume - this.volume) / this.volumeRemaining;
      }
      if (!spectrumChanged && !pressureChanged && !compensationChanged && !sustainChanged && !volumeEnvelopeChanged) return;
      for (const voice of this.voices.values()) {
        if (timbreAmountChanged) {
          if (!controls.timbreEnvelope || controls.timbreAmount === 0) voice.timbreEnvelope = null;
          else if (!voice.timbreEnvelope && !voice.released) this.initTimbreEnvelope(voice);
        }
        const timbreEnvelope = voice.timbreEnvelope;
        if (timbreSustainChanged && timbreEnvelope && !voice.released && timbreEnvelope.stage !== "attack")
          this.envelope(timbreEnvelope, controls.timbreSustain,
            timbreEnvelope.remaining > 0 ? timbreEnvelope.remaining * 1000 / sampleRate : TRANSITION_SECONDS * 1000);
        if (generationChanged && (!this.controls.generateYZ || !voice.released)) this.initGenerated(voice);
        if (spectrumChanged) this.transition(voice, voice.frequency);
        if (pressureChanged) this.expressiveGain(voice);
        if (compensationChanged) this.compensate(voice);
        if (!voice.released && volumeEnvelopeChanged) {
          voice.stage = controls.volumeEnvelope ? "attack" : "sustain";
          this.envelope(voice, this.attackLevel(voice), controls.volumeEnvelope
            ? this.envelopeTime(controls.attack, voice.velocity) : TRANSITION_SECONDS * 1000);
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

  // Cubic departure from MIDI 64 keeps the middle gentle and emphasizes extremes.
  velocityCurve(velocity) {
    const v = this.normalized((velocity ?? 64) / 127) * 127;
    return ((v - 64) / (v < 64 ? 64 : 63)) ** 3;
  }

  attackLevel(voice) {
    if (!this.controls.velocity) return 1;
    const curve = this.velocityCurve(voice.velocity);
    return 1 + curve * (curve < 0 ? 0.75 : 1);
  }

  timbreFor(voice) {
    const expression = voice.generatedValues ?? voice;
    const envelopeTimbre = this.controls.timbreEnvelope && voice.timbreEnvelope
      ? this.controls.timbreAmount * voice.timbreEnvelope.gain : 0;
    return Math.max(0, Math.min(1, this.controls.timbre +
      envelopeTimbre +
      (this.controls.timbreResponse ? this.expressionYTimbre(expression.timbre) : 0) +
      (this.controls.pressure ? this.pressureBite(expression.pressure) : 0) +
      (this.controls.velocity ? 0.1 * voice.velocity / 127 : 0)));
  }

  expressionYTimbre(value) {
    // Neutral halfway; a gentler darkening range below than brightening above.
    return (value - 0.5) * (value < 0.5 ? 0.1 : 0.2);
  }

  setTimbreEnvelopeControls() {
    const c = this.controls;
    this.timbreEnvelopeControls = { attack: c.timbreAttack, decay: c.timbreDecay,
      sustain: c.timbreSustain, release: c.timbreRelease };
  }

  initTimbreEnvelope(voice) {
    if (!this.controls.timbreEnvelope || !this.controls.timbreAmount) return;
    const state = { gain: 0, stage: "attack" };
    this.envelope(state, 1, this.controls.timbreAttack);
    this.advanceEnvelopeStage(state, this.timbreEnvelopeControls, 1);
    voice.timbreEnvelope = state;
    voice.nextTimbreFrame = this.frame + Math.max(1, Math.round(sampleRate * 0.002));
  }

  pressureBite(pressure) {
    // A light touch briefly brightens the spectrum; smooth shoulders avoid a
    // hard threshold as pressure crosses this region in either direction.
    const smooth = t => t * t * (3 - 2 * t);
    if (pressure <= 0 || pressure >= 0.3) return 0;
    if (pressure < 0.04) return 0.06 * smooth(pressure / 0.04);
    return 0.06 * (1 - smooth((pressure - 0.04) / 0.26));
  }

  expressiveGain(voice) {
    const target = this.pressureGain((voice.generatedValues ?? voice).pressure);
    if (target === voice.expressionTarget) return;
    voice.expressionTarget = target;
    voice.expressionRemaining = Math.max(1, Math.round(sampleRate * TRANSITION_SECONDS));
    voice.expressionStep = (voice.expressionTarget - voice.expressionGain) / voice.expressionRemaining;
  }

  initGenerated(voice) {
    const time = this.frame * 1000 / sampleRate;
    voice.generated = this.controls.generateYZ ? createDsfYzEnvelope(voice.velocity, time) : null;
    if (voice.generated && voice.pressure > 0) voice.generated.pressure(voice.pressure, time);
    voice.generatedValues = voice.generated?.sample(time) ?? null;
    voice.nextGeneratedFrame = this.frame;
  }

  pressureGain(pressure) {
    // Reserve most of the boost for the upper part of the pressure gesture.
    return this.controls.pressure ? 1 + 3 * pressure ** 3 : 1;
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
        this.envelope(voice, peak * controls.sustain, controls.decay);
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
      this.initGenerated(voice);
      this.initTimbreEnvelope(voice);
      osc.configure(event.frequency, this.timbreFor(voice), this.controls.partials);
      voice.expressionGain = this.pressureGain((voice.generatedValues ?? voice).pressure);
      voice.expressionTarget = voice.expressionGain;
      voice.compensation = this.compensationFor(event.frequency);
      voice.compensationTarget = voice.compensation;
      this.envelope(voice, this.attackLevel(voice), this.controls.volumeEnvelope === false
        ? 1 : this.envelopeTime(this.controls.attack, voice.velocity));
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
        if (!pressureChanged && timbre === voice.timbre) return;
        voice.pressure = pressure;
        voice.timbre = timbre;
        if (voice.generated && pressureChanged)
          voice.generated.pressure(voice.pressure, this.frame * 1000 / sampleRate);
        this.expressiveGain(voice);
        this.transition(voice, voice.frequency);
      }
      if (event.command === "stop" && !voice.released) {
        voice.generated?.release(event.velocity ?? 0, this.frame * 1000 / sampleRate);
        voice.released = true;
        voice.stage = "release";
        this.envelope(voice, 0, this.controls.volumeEnvelope === false
          ? 4 : this.volumeReleaseTime(event.velocity));
        if (voice.timbreEnvelope) {
          voice.timbreEnvelope.stage = "release";
          this.envelope(voice.timbreEnvelope, 0, this.timbreReleaseTime(event.velocity));
          this.transition(voice, voice.frequency);
        }
      }
    }
  }

  normalized(value) { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }

  envelopeTime(milliseconds, velocity) {
    if (!this.controls.velocity) return milliseconds;
    const curve = this.velocityCurve(velocity);
    return milliseconds * (1 - curve * (curve < 0 ? 1 : 0.75));
  }

  volumeReleaseTime(velocity) {
    if (!this.controls.releaseVelocity) return this.controls.release;
    const curve = this.velocityCurve(velocity);
    return this.controls.release * (1 - curve * (curve < 0 ? 3 : 0.75));
  }

  timbreReleaseTime(velocity) {
    if (!this.controls.releaseVelocity) return this.controls.timbreRelease;
    const curve = this.velocityCurve(velocity);
    return this.controls.timbreRelease * (1 - curve * (curve < 0 ? 1 : 0.975));
  }

  voiceSample(voice) {
    // The envelope advances per sample; spectral targets are sampled every
    // 2 ms and at stage boundaries, then use the existing smooth crossfade.
    const timbreEnvelope = voice.timbreEnvelope;
    if (timbreEnvelope) {
      const stage = timbreEnvelope.stage;
      const moving = timbreEnvelope.remaining > 0;
      this.advanceEnvelope(timbreEnvelope, this.timbreEnvelopeControls, 1);
      if (moving && (this.frame >= voice.nextTimbreFrame || stage !== timbreEnvelope.stage || timbreEnvelope.remaining === 0)) {
        voice.nextTimbreFrame = this.frame + Math.max(1, Math.round(sampleRate * 0.002));
        this.transition(voice, voice.frequency);
      }
    }
    // Sample the shared expression ramps on the audio clock, without MIDI,
    // browser timers, channel limits or main-thread heartbeat dependencies.
    if (voice.generated && this.frame >= voice.nextGeneratedFrame) {
      voice.nextGeneratedFrame = this.frame + Math.max(1, Math.round(sampleRate * 0.002));
      const values = voice.generated.sample(this.frame * 1000 / sampleRate);
      if (values.pressure !== voice.generatedValues.pressure || values.timbre !== voice.generatedValues.timbre) {
        voice.generatedValues = values;
        this.expressiveGain(voice);
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
