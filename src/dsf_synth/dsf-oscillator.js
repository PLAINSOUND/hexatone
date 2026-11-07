export class DsfOscillator {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.phase = 0;
        this.phaseStep = 0;
    }

    setFrequency(frequency) {
        if (!Number.isFinite(frequency) || frequency <= 0 || frequency >= this.sampleRate / 2) {
            return;
        }

        this.phaseStep = 2 * Math.PI * frequency / this.sampleRate;
    }

    nextSample() {
        const sample = Math.sin(this.phase);

        this.phase += this.phaseStep;
        if (this.phase >= 2 * Math.PI) {
            this.phase -= 2 * Math.PI;
        }

        return sample;
    }
}