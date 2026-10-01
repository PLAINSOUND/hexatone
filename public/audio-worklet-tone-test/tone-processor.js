class ToneProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.step = (2 * Math.PI * 440) / sampleRate;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output) return true;

    for (let i = 0; i < output[0].length; i += 1) {
      const value = Math.sin(this.phase) * 0.08;
      this.phase += this.step;
      if (this.phase >= 2 * Math.PI) this.phase -= 2 * Math.PI;

      for (const channel of output) channel[i] = value;
    }

    return true;
  }
}

registerProcessor("tone-processor", ToneProcessor);

