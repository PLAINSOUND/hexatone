import createFluidSynth from "./fluidsynth.js";

// AudioWorkletGlobalScope does not consistently expose Performance. Emscripten
// uses this clock during SoundFont loading. Keep elapsed time nondecreasing if
// the wall clock changes; MIDI scheduling still uses audio frames below.
if (typeof globalThis.performance === "undefined") {
  const origin = Date.now();
  let elapsed = 0;
  globalThis.performance = { now: () => (elapsed = Math.max(elapsed, Date.now() - origin)) };
}

class FluidSynthProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.module = null;
    this.synth = null;
    this.blockSize = 128;
    this.midiQueue = [];
    this.midiSequence = 0;
    this.port.onmessage = ({ data }) => this.handleMessage(data);
    this.initialize(options.processorOptions.wasmBytes);
  }

  async initialize(wasmBytes) {
    try {
      const module = await createFluidSynth({ wasmBinary: wasmBytes, locateFile: () => "" });
      if (this.disposed) return;
      this.module = module;
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

  applySmoothing() {
    if (this.smoothing && this.module._ps_set_smoothing(this.synth,
      this.smoothing.pressureMs, this.smoothing.expressionMs, this.smoothing.minimumMs ?? 0) !== 0) {
      throw new Error("FluidSynth smoothing configuration failed");
    }
    this.smoothingPending = false;
  }

  setReverbSend(value) {
    this.reverbSend = Math.max(0, Math.min(127, Math.round(Number(value) || 0)));
    for (let channel = 0; channel < 128; channel++) {
      this.module._ps_cc(this.synth, channel, 91, this.reverbSend);
    }
  }

  handleMessage(message) {
    if (message?.type === "dispose") {
      if (this.disposed) return;
      this.disposed = true;
      this.midiQueue = [];
      const before = this.memorySizes();
      if (this.synth) this.module._ps_destroy(this.synth);
      this.synth = null;
      for (const pointer of [this.leftPointer, this.rightPointer, this.sysexPointer, this.handledPointer]) {
        if (pointer) this.module._free(pointer);
      }
      let soundfontFileRemoved = this.soundfontFileBytes == null || this.soundfontFileBytes === 0;
      try {
        this.module?.FS.unlink("/hexatone-soundfont.sf2");
        soundfontFileRemoved = true;
      } catch { /* No file on an unloaded processor, or cleanup unavailable. */ }
      this.soundfontFileBytes = soundfontFileRemoved ? 0 : this.soundfontFileBytes;
      const afterFree = this.memorySizes();
      this.module = null;
      this.soundfontId = null;
      this.leftPointer = this.rightPointer = this.sysexPointer = this.handledPointer = 0;
      this.heldKeys?.clear();
      this.usedChannels?.clear();
      this.port.onmessage = null;
      this.port.postMessage({ type: "processor-disposed", frame: currentFrame,
        memory: { before, afterFree, moduleReferenceReleased: true, soundfontFileRemoved,
          meaning: "Heap capacity is not live allocation size. Dropping references does not confirm browser memory reclamation." } });
      return;
    }
    if (!this.module || !this.synth || !message) return;
    try {
      if (message.type === "set-reverb") {
        this.setReverbSend(message.value);
        return;
      }
      if (message.type === "set-smoothing") {
        const time = (value) => Number.isFinite(Number(value))
          ? Math.max(0, Math.min(500, Math.round(Number(value)))) : 0;
        const next = { pressureMs: time(message.pressureMs), expressionMs: time(message.expressionMs), minimumMs: time(message.minimumMs) };
        const enabled = [next.pressureMs, next.expressionMs].filter(ms => ms > 0);
        next.minimumMs = Math.min(next.minimumMs, enabled.length ? Math.min(...enabled) : 0);
        if (this.smoothing?.pressureMs === next.pressureMs && this.smoothing?.expressionMs === next.expressionMs && this.smoothing?.minimumMs === next.minimumMs) return;
        this.smoothing = next;
        // Messages may arrive in a burst after suspension or during a drag.
        // Never do per-voice native settings work for every queued message.
        this.smoothingPending = true;
        return;
      }
      if (message.type === "release-for-shutdown") {
        this.releasing = true;
        this.silentReleaseFrames = 0;
        this.midiQueue = [];
        for (const channel of this.usedChannels ?? []) {
          this.module._ps_cc(this.synth, channel, 64, 0);
          this.module._ps_cc(this.synth, channel, 66, 0);
          // Release only rendered attacks. Scanning all 16,384 possible keys
          // blocks the audio thread and can interrupt the very tail we need.
          for (const key of this.heldKeys?.get(channel) ?? []) this.module._ps_note_off(this.synth, channel, key);
        }
        this.heldKeys?.clear();
        return;
      }
      if (this.releasing) return;
      if (message.type === "cancel-owner-events") {
        this.midiQueue = this.midiQueue.filter(event => !(event.owner === message.owner &&
          (message.scope == null || (event.scope === message.scope && event.generation === message.generation)) &&
          (message.voice == null || event.voice === message.voice) &&
          !(message.scope != null && event.command?.op === "off")));
        return;
      }
      if (message.type === "clear-recovery-events") {
        const droppedEvents = this.midiQueue.length;
        this.midiQueue = [];
        for (let channel = 0; channel < 128; channel++) this.module._ps_cc(this.synth, channel, 120, 0);
        this.port.postMessage({ type: "recovery-cleared", droppedEvents });
        return;
      }
      if (message.type === "load-soundfont" || message.type === "replace-soundfont") {
        const replacing = message.type === "replace-soundfont";
        if (this.soundfontId != null && !replacing) {
          throw new Error("Use replace-soundfont to change the loaded SoundFont");
        }
        // Events and held-key bookkeeping belong to the old bank. In
        // particular, delayed controller resets must not alter the new bank.
        this.midiQueue = [];
        this.heldKeys?.clear();
        this.usedChannels?.clear();
        if (replacing) {
          // The adapter has no sfunload export, so recreate FluidSynth to release
          // the old bank and its voices before loading the replacement.
          this.module._ps_destroy(this.synth);
          this.synth = this.module._ps_create(sampleRate);
          if (!this.synth) throw new Error("FluidSynth recreation failed during SoundFont replacement");
          this.initializeChannelTunings();
          this.applySmoothing();
          this.soundfontId = null;
        }
        const path = "/hexatone-soundfont.sf2";
        this.port.postMessage({ type: "memory-snapshot", phase: "before-soundfont-load",
          inputBytes: message.bytes.byteLength, memory: this.memorySizes() });
        try {
          this.module.FS.unlink(path);
        } catch {
          // No virtual file exists on the first load.
        }
        this.module.FS.writeFile(path, new Uint8Array(message.bytes));
        this.soundfontFileBytes = message.bytes.byteLength;
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
        // Restore before acknowledging the load, rather than waiting for a
        // later main-thread MIDI batch. Program selection preserves CC91.
        this.setReverbSend(message.reverbSend ?? this.reverbSend ?? 20);
        this.port.postMessage({ type: "soundfont-loaded", soundfontId, presets,
          memory: this.memorySizes() });
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

      if (message.type === "midi" || message.type === "midi-batch") {
        const events = message.type === "midi-batch" ? message.events : [message];
        for (const event of events) {
          this.midiQueue.push({ data: event.data, command: event.command, owner: event.owner,
            touchTrace: event.touchTrace,
            scope: event.scope, generation: event.generation, voice: event.voice,
            frame: Number.isFinite(event.frame) ? event.frame : currentFrame,
            sequence: this.midiSequence++ });
        }
        this.midiQueue.sort((a, b) => a.frame - b.frame || a.sequence - b.sequence);
      }
    } catch (error) {
      this.port.postMessage({ type: "error", message: String(error), stack: error?.stack });
    }
  }

  memorySizes() {
    return { wasmHeapCapacityBytes: this.module?.HEAPU8?.buffer?.byteLength ?? null,
      soundfontFileBytes: this.soundfontFileBytes ?? 0 };
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
    if (status === 0x80 || (status === 0x90 && b === 0)) this.dispatchCommand({ channel, op: "off", a });
    else if (status === 0x90) this.dispatchCommand({ channel, op: "on", a, b });
    else if (status === 0xb0) this.module._ps_cc(this.synth, channel, a, b);
    else if (status === 0xd0) this.module._ps_channel_pressure(this.synth, channel, a);
    else if (status === 0xa0) this.module._ps_key_pressure(this.synth, channel, a, b);
    else if (status === 0xe0) this.module._ps_pitch_bend(this.synth, channel, (a & 127) | ((b & 127) << 7));
  }

  dispatchCommand({ channel, op, a = 0, b = 0 }) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= 128) return;
    if (op === "on" && b > 0) {
      this.usedChannels ??= new Set();
      this.usedChannels.add(channel);
      this.heldKeys ??= new Map();
      if (!this.heldKeys.has(channel)) this.heldKeys.set(channel, new Set());
      this.heldKeys.get(channel).add(a);
    } else if (op === "off" || (op === "on" && b === 0)) this.heldKeys?.get(channel)?.delete(a);
    else if (op === "cc" && (a === 120 || a === 123)) this.heldKeys?.delete(channel);
    const functions = { on: "_ps_note_on", off: "_ps_note_off", cc: "_ps_cc",
      bend: "_ps_pitch_bend", pressure: "_ps_channel_pressure" };
    const fn = functions[op];
    if (fn) this.module[fn](this.synth, channel, a, b);
  }

  process(_inputs, outputs) {
    if (this.disposed) {
      if (!this.stopReported) {
        this.stopReported = true;
        this.port.postMessage({ type: "processing-stopped", frame: currentFrame });
        this.port.close();
      }
      return false;
    }
    const channels = outputs[0];
    if (!channels?.length) return true;
    const frames = channels[0].length;
    if (!this.module || !this.synth || frames !== this.blockSize) {
      channels.forEach((channel) => channel.fill(0));
      return true;
    }
    if (this.smoothingPending && !this.releasing && currentFrame >= (this.nextSmoothingFrame ?? 0)) {
      this.smoothingPending = false;
      this.nextSmoothingFrame = currentFrame + Math.ceil(sampleRate / 30);
      try { this.applySmoothing(); }
      catch (error) {
        // A control failure must not escape process() and kill the worklet.
        this.port.postMessage({ type: "error", message: String(error) });
      }
    }
    let consumed = 0;
    const touchTraces = [];
    while (consumed < this.midiQueue.length && this.midiQueue[consumed].frame <= currentFrame) {
      try {
        const event = this.midiQueue[consumed];
        if (event.command) this.dispatchCommand(event.command);
        else this.dispatchMidi(event.data);
        if (event.touchTrace != null) touchTraces.push({ type: "touch-rendered", id: event.touchTrace,
          lateFrames: Math.max(0, currentFrame - event.frame), sampleRate,
          audioTime: currentFrame / sampleRate });
      }
      catch (error) { this.port.postMessage({ type: "error", message: String(error) }); }
      consumed++;
    }
    if (consumed) this.midiQueue.splice(0, consumed);
    const result = this.module._ps_render(this.synth, this.leftPointer, this.rightPointer, frames);
    if (result !== 0) {
      channels.forEach((channel) => channel.fill(0));
      return true;
    }
    const left = this.leftPointer >>> 2;
    const right = this.rightPointer >>> 2;
    channels[0].set(this.module.HEAPF32.subarray(left, left + frames));
    if (channels[1]) channels[1].set(this.module.HEAPF32.subarray(right, right + frames));
    if (this.releasing) {
      // Include the rendered effects tail, not merely the note-off commands.
      const silent = channels.every(channel => channel.every(value => Math.abs(value) < 0.000001));
      this.silentReleaseFrames = silent ? this.silentReleaseFrames + frames : 0;
      if (this.silentReleaseFrames >= sampleRate / 4 && !this.releaseComplete) {
        this.releaseComplete = true;
        this.port.postMessage({ type: "release-complete" });
      }
    }
    for (const trace of touchTraces) this.port.postMessage(trace);
    return true;
  }

}

registerProcessor("hexatone-fluidsynth", FluidSynthProcessor);
