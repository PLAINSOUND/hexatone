const TWO_PI = 2 * Math.PI;

// Finite cosine DSF: sum(r^(n-1) cos(n*phase)), n=1..partials.
// The recurrence fallback avoids cancellation at the geometric singularity.
export function cosineDsf(phase, balance, partials) {
  const x = Math.cos(phase), y = Math.sin(phase);
  return cosineSum(x, y, Math.cos(partials * phase), Math.sin(partials * phase), balance, partials);
}
function cosineSum(x, y, u, v, r, partials, endWeight = r ** partials) {
  const denominator = 1 + r * r - 2 * r * x;
  if (denominator < 1e-8) {
    let sum = 0, weight = 1, real = x, imaginary = y;
    for (let n = 1; n <= partials; n++) {
      sum += weight * real;
      const next = real * x - imaginary * y;
      imaginary = imaginary * x + real * y;
      real = next;
      weight *= r;
    }
    return sum;
  }
  return (x - r - endWeight * (u * x - v * y - r * u)) / denominator;
}

// Port of Rysum's compensated trapezoidal integrator. Partial frequencies are
// capped below OUTPUT Nyquist; 4x internal sampling reduces integration error.
// Fixed-rate decimation is safe here: the source has no above-output-Nyquist
// partials. Spectral/pitch changes are crossfaded by the voice processor.
export class DsfOscillator {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.phase = 0;
    this.phaseStep = 0;
    this.frequency = 0;
    this.balance = 0;
    this.harmonics = 1;
    this.output = 0;
    this.previousInput = 0;
    this.counter = 0;
  }

  setFrequency(frequency) {
    return this.configure(frequency, this.timbre ?? 0, this.partials ?? 1024);
  }

  configure(frequency, timbre = 0, partials = 1024) {
    if (!Number.isFinite(frequency) || frequency <= 0 || frequency >= this.sampleRate / 2 ||
        !Number.isFinite(timbre) || timbre < 0 || timbre > 1 || !Number.isInteger(partials) || partials < 1 || partials > 1024)
      return false;
    if (this.frequency === frequency && this.timbre === timbre && this.partials === partials) return true;
    this.frequency = frequency;
    this.timbre = timbre;
    this.partials = partials;
    this.balance = 1 - (1 - timbre) ** 2;
    this.harmonics = Math.max(1, Math.min(partials, Math.floor(this.sampleRate * 0.45 / frequency)));
    this.factor = this.balance === 0 || this.harmonics === 1 ? 1 : 4;
    this.endWeight = this.balance ** this.harmonics;
    if (!this.pitchKernel || this.pitchKernel.frequency !== frequency ||
        this.pitchKernel.factor !== this.factor || this.pitchKernel.harmonics !== this.harmonics) {
      const step = TWO_PI * frequency / (this.sampleRate * this.factor);
      const gain = Math.tan(step / 2);
      const harmonicGains = new Float64Array(this.factor > 1 ? this.harmonics : 0);
      // Shared by crossfade copies. Pitch values stay fixed; harmonic gains
      // are filled lazily so a dark note need not prepare inaudible partials.
      this.pitchKernel = { frequency, factor: this.factor, harmonics: this.harmonics,
        step, gain, harmonicGains, cosStep: Math.cos(step), sinStep: Math.sin(step),
        cosEndStep: Math.cos(this.harmonics * step), sinEndStep: Math.sin(this.harmonics * step) };
    }
    const kernel = this.pitchKernel;
    this.phaseStep = kernel.step;
    this.gain = kernel.gain;
    this.cosStep = kernel.cosStep;
    this.sinStep = kernel.sinStep;
    this.cosEndStep = kernel.cosEndStep;
    this.sinEndStep = kernel.sinEndStep;
    // Reconstruct the integration constant at the existing phase, rather than
    // resetting the waveform or carrying a DC error into the new spectrum.
    this.output = 0;
    if (this.factor > 1) {
      let weight = 1;
      const phase = this.phase - this.phaseStep;
      const x = Math.cos(phase), y = Math.sin(phase);
      let real = x, imaginary = y;
      for (let n = 1; n <= this.harmonics && weight > 1e-14; n++) {
        const harmonicGain = kernel.harmonicGains[n - 1] ||
          (kernel.harmonicGains[n - 1] = this.gain / Math.tan(n * this.phaseStep / 2));
        this.output += weight * harmonicGain * imaginary;
        const next = real * x - imaginary * y;
        imaginary = imaginary * x + real * y;
        real = next;
        weight *= this.balance;
      }
    }
    this.previousInput = cosineDsf(this.phase - this.phaseStep, this.balance, this.harmonics);
    this.resetPhasors();
    return true;
  }

  resetPhasors() {
    this.x = Math.cos(this.phase);
    this.y = Math.sin(this.phase);
    this.u = Math.cos(this.harmonics * this.phase);
    this.v = Math.sin(this.harmonics * this.phase);
  }

  copyFrom(oscillator) { return Object.assign(this, oscillator); }

  clone() { return new DsfOscillator(this.sampleRate).copyFrom(this); }

  nextSample() {
    if (!this.frequency) return 0;
    if (this.factor === 1) {
      const sample = Math.sin(this.phase);
      this.phase = (this.phase + this.phaseStep) % TWO_PI;
      return sample;
    }
    let sample = 0;
    for (let step = 0; step < this.factor; step++) {
      const input = cosineSum(this.x, this.y, this.u, this.v, this.balance, this.harmonics, this.endWeight);
      this.output += this.gain * (this.previousInput + input);
      this.previousInput = input;
      if (step === 0) sample = this.output;
      const x = this.x * this.cosStep - this.y * this.sinStep;
      this.y = this.y * this.cosStep + this.x * this.sinStep;
      this.x = x;
      const u = this.u * this.cosEndStep - this.v * this.sinEndStep;
      this.v = this.v * this.cosEndStep + this.u * this.sinEndStep;
      this.u = u;
      this.phase = (this.phase + this.phaseStep) % TWO_PI;
      if (++this.counter % 512 === 0) this.resetPhasors();
    }
    return sample;
  }
}
