import createFluidSynth from "./fluidsynth.js";

class FluidSynthProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.module = null;
    this.synth = null;
    this.blockSize = 128;
    this.port.onmessage = ({ data }) => this.handleMessage(data);
    this.initialize(options.processorOptions.wasmBytes);
  }

  async initialize(wasmBytes) {
    try {
      this.module = await createFluidSynth({ wasmBinary: wasmBytes, locateFile: () => "" });
      this.synth = this.module._ps_create(sampleRate);
      if (!this.synth) throw new Error("FluidSynth instance creation failed");
      const result = this.module._ps_activate_tuning(this.synth, 0, 0, 0, 0);
      if (result !== 0) throw new Error(`Activating MTS tuning map 0 failed: ${result}`);

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

  handleMessage(message) {
    if (!this.module || !this.synth || !message) return;
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
          const tuningResult = this.module._ps_activate_tuning(this.synth, 0, 0, 0, 0);
          if (tuningResult !== 0) {
            throw new Error(`Reactivating MTS tuning map 0 failed: ${tuningResult}`);
          }
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
        const selected = this.module._ps_select_program(
          this.synth, 0, soundfontId, first.bank, first.program,
        );
        if (selected !== 0) throw new Error(`Selecting first preset failed: ${selected}`);
        this.port.postMessage({ type: "soundfont-loaded", soundfontId, presets });
        return;
      }

      if (message.type === "select-program") {
        const result = this.module._ps_select_program(
          this.synth, 0, this.soundfontId, message.bank, message.program,
        );
        this.port.postMessage({ type: "program-selected", ...message, result });
        return;
      }

      if (message.type === "midi") this.dispatchMidi(message.data);
    } catch (error) {
      this.port.postMessage({ type: "error", message: String(error), stack: error?.stack });
    }
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
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    if (!channels?.length) return true;
    const frames = channels[0].length;
    if (!this.module || !this.synth || frames !== this.blockSize) {
      channels.forEach((channel) => channel.fill(0));
      return true;
    }
    const result = this.module._ps_render(this.synth, this.leftPointer, this.rightPointer, frames);
    if (result !== 0) {
      channels.forEach((channel) => channel.fill(0));
      return true;
    }
    const left = this.leftPointer >>> 2;
    const right = this.rightPointer >>> 2;
    channels[0].set(this.module.HEAPF32.subarray(left, left + frames));
    if (channels[1]) channels[1].set(this.module.HEAPF32.subarray(right, right + frames));
    return true;
  }
}

registerProcessor("hexatone-fluidsynth", FluidSynthProcessor);
