import { DsfOscillator } from "./dsf-oscillator.js";

const ATTACK_TIME = 0.012;
const RELEASE_TIME = 0.08;
const NOTE_GAIN = 0.05;

class DsfProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.oscillator = new DsfOscillator(sampleRate);
    this.oscillator.setFrequency(440);
    this.gain = 0;
    this.targetGain = 0;
    this.gainStep = 0;
    this.gainStepsRemaining = 0;

    this.port.onmessage = ({ data }) => {
      if (data?.command === "stop") {
        this.ramp(RELEASE_TIME, 0);
        return;
      }

      if (data?.command !== "start" && data?.command !== "frequency") {
        return;
      }

      const frequency = data.frequency;

      if (
        !Number.isFinite(frequency) ||
        frequency <= 0 ||
        frequency >= sampleRate / 2
      ) {
        return;
      }

      this.oscillator.setFrequency(frequency);

      if (data.command === "start") {
        this.ramp(ATTACK_TIME, NOTE_GAIN);
      }
    };
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    if (!channels?.length) return true;

    for (let i = 0; i < channels[0].length; i++) {
      if (this.gainStepsRemaining > 0) {
        this.gain += this.gainStep;
        this.gainStepsRemaining--;

        if (this.gainStepsRemaining === 0) {
          this.gain = this.targetGain;
          this.gainStep = 0;
        }
      }

      const sample = this.oscillator.nextSample() * this.gain;

      for (const channel of channels) {
        channel[i] = sample;
      }
    }

    return true;
  }

  ramp(time, target) {
    if (!Number.isFinite(time) || time < 0 || !Number.isFinite(target) || target < 0 ) return;

    this.targetGain = Math.min(target, 1);
    this.gainStepsRemaining = Math.round(time * sampleRate);

    if (this.gainStepsRemaining === 0) {
      this.gain = this.targetGain;
      this.gainStep = 0;
      return;
    }

    this.gainStep = (this.targetGain - this.gain) / this.gainStepsRemaining;
  }
}

registerProcessor("hexatone-dsf", DsfProcessor);
