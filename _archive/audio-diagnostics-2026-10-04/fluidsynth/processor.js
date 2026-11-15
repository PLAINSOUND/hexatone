import createFluidSynth from "./fluidsynth.js";

class FluidSynthProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.module = null;
    this.synth = null;
    this.blockSize = 128;
    this.diagnostics = false;
    this.midiQueue = [];
    this.midiSequence = 0;
    this.stats = { blocks: 0, messages: 0, renderErrors: 0, renderMs: 0, maxRenderMs: 0,
      overBudgetBlocks: 0, peak: 0, nonFiniteSamples: 0 };
    this.port.onmessage = ({ data }) => this.handleMessage(data);
    this.initialize(options.processorOptions.wasmBytes);
  }

  async initialize(wasmBytes) {
    try {
      this.module = await createFluidSynth({ wasmBinary: wasmBytes, locateFile: () => "" });
      this.synth = this.module._ps_create(sampleRate);
      if (!this.synth) throw new Error("FluidSynth instance creation failed");
      this.initializeChannelTunings();

      this.leftPointer = this.module._malloc(this.blockSize * Float32Array.BYTES_PER_ELEMENT);
      this.rightPointer = this.module._malloc(this.blockSize * Float32Array.BYTES_PER_ELEMENT);
      this.sysexPointer = this.module._malloc(8192);
      this.handledPointer = this.module._malloc(Int32Array.BYTES_PER_ELEMENT);
      if (!this.leftPointer || !this.rightPointer || !this.sysexPointer || !this.handledPointer) {
        throw new Error("Could not allocate FluidSynth render/message buffers");
      }
      this.port.postMessage({ type: "ready" });
    } catch (error) {
      this.port.postMessage({ type: "error", message: String(error), stack: error?.stack });
    }
  }

  initializeChannelTunings() {
    // First internal layer: channel N owns tuning bank 0, program N.
    // Reserve channels 128–255 for a possible second layer.
    for (let channel = 0; channel < 128; channel++) {
      const result = this.module._ps_activate_tuning(this.synth, channel, 0, channel, 0);
      if (result !== 0) throw new Error(`Activating MTS tuning map ${channel} failed: ${result}`);
    }
  }

  handleMessage(message) {
    if (message?.type === "diagnostics") {
      this.diagnostics = message.enabled;
      if (message.enabled) {
        this.audioRing = [new Float32Array(sampleRate * 5), new Float32Array(sampleRate * 5)];
        this.audioWrite = 0;
        this.audioFrames = 0;
      } else this.audioRing = null;
      this.nextReportFrame = currentFrame + sampleRate;
      return;
    }
    if (message?.type === "audio-mark") {
      if (!this.audioRing || !this.audioFrames) return;
      const count = this.audioFrames;
      const length = this.audioRing[0].length;
      const start = (this.audioWrite - count + length) % length;
      const channels = this.audioRing.map(ring => {
        const result = new Float32Array(count);
        const first = Math.min(count, length - start);
        result.set(ring.subarray(start, start + first));
        if (first < count) result.set(ring.subarray(0, count - first), first);
        return result;
      });
      this.port.postMessage({ type: "audio-clip", detail: message.detail,
        sampleRate, startAudioTime: currentTime - count / sampleRate,
        endAudioTime: currentTime, left: channels[0], right: channels[1] },
        channels.map(channel => channel.buffer));
      return;
    }
    if (!this.module || !this.synth || !message) return;
    if (this.diagnostics) this.stats.messages++;
    try {
      if (message.type === "load-soundfont" || message.type === "replace-soundfont") {
        const replacing = message.type === "replace-soundfont";
        if (this.soundfontId != null && !replacing) {
          throw new Error("Use replace-soundfont to change the loaded SoundFont");
        }
        if (replacing) {
          // The adapter has no sfunload export, so recreate FluidSynth to release
          // the old bank and its voices before loading the replacement.
          this.module._ps_destroy(this.synth);
          this.synth = this.module._ps_create(sampleRate);
          if (!this.synth) throw new Error("FluidSynth recreation failed during SoundFont replacement");
          this.initializeChannelTunings();
          this.soundfontId = null;
        }
        const path = "/hexatone-soundfont.sf2";
        try {
          this.module.FS.unlink(path);
        } catch {
          // No virtual file exists on the first load.
        }
        this.module.FS.writeFile(path, new Uint8Array(message.bytes));
        const pathPointer = this.module.stringToNewUTF8(path);
        let soundfontId;
        try {
          soundfontId = this.module._ps_load_soundfont(this.synth, pathPointer);
        } finally {
          this.module._free(pathPointer);
        }
        if (soundfontId < 0) throw new Error(`FluidSynth SoundFont load failed: ${soundfontId}`);
        const presets = this.readPresets(soundfontId);
        if (!presets.length) throw new Error("The selected SoundFont contains no presets");
        this.soundfontId = soundfontId;
        const first = presets[0];
        let selected = 0;
        for (let channel = 0; channel < 128; channel++) selected |= this.module._ps_select_program(
          this.synth, channel, soundfontId, first.bank, first.program,
        );
        if (selected !== 0) throw new Error(`Selecting first preset failed: ${selected}`);
        this.port.postMessage({ type: "soundfont-loaded", soundfontId, presets });
        return;
      }

      if (message.type === "select-program") {
        let result = 0;
        for (let channel = 0; channel < 128; channel++) result |= this.module._ps_select_program(
          this.synth, channel, this.soundfontId, message.bank, message.program,
        );
        this.port.postMessage({ type: "program-selected", ...message, result });
        return;
      }

      if (message.type === "audio-test") {
        this.stopAudioTest();
        if (message.enabled) {
          this.midiQueue.length = 0;
          this.module._ps_cc(this.synth, 0, 123, 0);
          this.audioTest = { start: currentFrame, next: currentFrame, step: 0, note: null };
        }
        return;
      }

      if (message.type === "midi" || message.type === "midi-batch") {
        if (this.audioTest) return;
        const events = message.type === "midi-batch" ? message.events : [message];
        for (const event of events) {
          this.midiQueue.push({ data: event.data, command: event.command,
            frame: Number.isFinite(event.frame) ? event.frame : currentFrame,
            sequence: this.midiSequence++ });
        }
        this.midiQueue.sort((a, b) => a.frame - b.frame || a.sequence - b.sequence);
      }
    } catch (error) {
      this.port.postMessage({ type: "error", message: String(error), stack: error?.stack });
    }
  }

  stopAudioTest() {
    if (!this.audioTest) return;
    if (this.audioTest.note != null) this.module._ps_note_off(this.synth, 0, this.audioTest.note);
    this.module._ps_note_off(this.synth, 0, 48);
    this.module._ps_pitch_bend(this.synth, 0, 8192);
    // Restore test carriers to 12-EDO without retuning their remaining release tails.
    for (let note = 48; note <= 72; note++) {
      this.dispatchMidi([0xf0, 0x7e, 0x7f, 0x08, 0x02, 0, 1, note, note, 0, 0, 0xf7]);
    }
    this.audioTest = null;
  }

  processAudioTest() {
    const test = this.audioTest;
    if (!test) return;
    if (currentFrame - test.start >= sampleRate * 30) {
      this.stopAudioTest();
      return;
    }
    if (currentFrame < test.next) {
      const phase = (currentFrame - test.start) / sampleRate;
      this.module._ps_pitch_bend(this.synth, 0, Math.round(8192 + 4096 * Math.sin(phase * Math.PI * 12)));
      return;
    }
    if (test.note != null) this.module._ps_note_off(this.synth, 0, test.note);
    test.note = 48 + Math.floor(Math.random() * 25);
    // Random +/- 50 cents, encoded as an MTS single-note real-time change.
    const pitch = test.note + Math.random() - 0.5;
    const semitone = Math.floor(pitch);
    const fraction = Math.min(16383, Math.round((pitch - semitone) * 16384));
    this.dispatchMidi([0xf0, 0x7f, 0x7f, 0x08, 0x02, 0, 1, test.note,
      semitone, fraction >> 7, fraction & 127, 0xf7]);
    this.module._ps_pitch_bend(this.synth, 0, 8192);
    this.module._ps_note_on(this.synth, 0, test.note, 72);
    test.step++;
    test.next = test.start + Math.round(test.step * sampleRate / 24);
  }

  readPresets(soundfontId) {
    const count = this.module._ps_get_preset_count(this.synth, soundfontId);
    if (count < 0) throw new Error(`FluidSynth preset enumeration failed: ${count}`);
    const capacity = 256;
    const name = this.module._malloc(capacity);
    const bank = this.module._malloc(Int32Array.BYTES_PER_ELEMENT);
    const program = this.module._malloc(Int32Array.BYTES_PER_ELEMENT);
    if (!name || !bank || !program) throw new Error("Could not allocate preset enumeration buffers");
    try {
      return Array.from({ length: count }, (_, index) => {
        const result = this.module._ps_get_preset_info(
          this.synth, soundfontId, index, name, capacity, bank, program,
        );
        if (result !== 0) throw new Error(`FluidSynth preset ${index} lookup failed: ${result}`);
        return {
          name: this.module.UTF8ToString(name),
          bank: this.module.HEAP32[bank >>> 2],
          program: this.module.HEAP32[program >>> 2],
        };
      });
    } finally {
      this.module._free(name);
      this.module._free(bank);
      this.module._free(program);
    }
  }

  dispatchMidi(data) {
    if (!data?.length) return;
    const bytes = Array.from(data, (byte) => Number(byte) & 0xff);
    if (bytes[0] === 0xf0) {
      const payload = bytes.slice(1, bytes.at(-1) === 0xf7 ? -1 : undefined);
      if (!payload.length || payload.length > 8192) return;
      this.module.HEAPU8.set(payload, this.sysexPointer);
      this.module.HEAP32[this.handledPointer >>> 2] = 0;
      this.module._ps_sysex(this.synth, this.sysexPointer, payload.length, this.handledPointer);
      return;
    }

    const status = bytes[0] & 0xf0;
    const channel = bytes[0] & 0x0f;
    const a = bytes[1] ?? 0;
    const b = bytes[2] ?? 0;
    if (status === 0x80 || (status === 0x90 && b === 0)) this.module._ps_note_off(this.synth, channel, a);
    else if (status === 0x90) this.module._ps_note_on(this.synth, channel, a, b);
    else if (status === 0xb0) this.module._ps_cc(this.synth, channel, a, b);
    else if (status === 0xd0) this.module._ps_channel_pressure(this.synth, channel, a);
    else if (status === 0xa0) this.module._ps_key_pressure(this.synth, channel, a, b);
    else if (status === 0xe0) this.module._ps_pitch_bend(this.synth, channel, (a & 127) | ((b & 127) << 7));
  }

  dispatchCommand({ channel, op, a = 0, b = 0 }) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= 128) return;
    const functions = { on: "_ps_note_on", off: "_ps_note_off", cc: "_ps_cc",
      bend: "_ps_pitch_bend", pressure: "_ps_channel_pressure" };
    const fn = functions[op];
    if (fn) this.module[fn](this.synth, channel, a, b);
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    if (!channels?.length) return true;
    const frames = channels[0].length;
    if (!this.module || !this.synth || frames !== this.blockSize) {
      channels.forEach((channel) => channel.fill(0));
      return true;
    }
    const clock = this.diagnostics && typeof performance !== "undefined" ? performance : null;
    const start = clock?.now();
    this.processAudioTest();
    let consumed = 0;
    while (consumed < this.midiQueue.length && this.midiQueue[consumed].frame <= currentFrame) {
      try {
        const event = this.midiQueue[consumed];
        if (event.command) this.dispatchCommand(event.command);
        else this.dispatchMidi(event.data);
      }
      catch (error) { this.port.postMessage({ type: "error", message: String(error) }); }
      consumed++;
    }
    if (consumed) this.midiQueue.splice(0, consumed);
    const result = this.module._ps_render(this.synth, this.leftPointer, this.rightPointer, frames);
    if (this.diagnostics) {
      this.stats.blocks++;
      if (result !== 0) this.stats.renderErrors++;
      if (clock) {
        const duration = clock.now() - start;
        this.stats.renderMs += duration;
        this.stats.maxRenderMs = Math.max(this.stats.maxRenderMs, duration);
        if (duration > frames / sampleRate * 1000) this.stats.overBudgetBlocks++;
      }
    }
    if (result !== 0) {
      channels.forEach((channel) => channel.fill(0));
      this.recordAudio(channels, frames);
      return true;
    }
    const left = this.leftPointer >>> 2;
    const right = this.rightPointer >>> 2;
    channels[0].set(this.module.HEAPF32.subarray(left, left + frames));
    if (channels[1]) channels[1].set(this.module.HEAPF32.subarray(right, right + frames));
    this.recordAudio(channels, frames);
    if (this.diagnostics) {
      for (const channel of channels) for (const value of channel) {
        if (!Number.isFinite(value)) this.stats.nonFiniteSamples++;
        else this.stats.peak = Math.max(this.stats.peak, Math.abs(value));
      }
      if (currentFrame >= this.nextReportFrame) {
        this.port.postMessage({ type: "diagnostics", ...this.stats, audioTime: currentTime,
          blockSize: frames, sampleRate, renderTimingAvailable: !!clock });
        this.nextReportFrame = currentFrame + sampleRate;
      }
    }
    return true;
  }

  recordAudio(channels, frames) {
    if (this.audioRing) {
      const length = this.audioRing[0].length;
      const first = Math.min(frames, length - this.audioWrite);
      for (let ch = 0; ch < 2; ch++) {
        const source = channels[ch] ?? channels[0];
        this.audioRing[ch].set(source.subarray(0, first), this.audioWrite);
        if (first < frames) this.audioRing[ch].set(source.subarray(first), 0);
      }
      this.audioWrite = (this.audioWrite + frames) % length;
      this.audioFrames = Math.min(length, this.audioFrames + frames);
    }
  }
}

registerProcessor("hexatone-fluidsynth", FluidSynthProcessor);
