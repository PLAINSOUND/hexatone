import createFluidSynth from "./fluidsynth.js";

const SOUNDFONT_CACHE_BUDGET = 2048 * 1024 * 1024; // Estimated file + native sample bytes.
const MIDI_CHANNELS = 256;
const isAttack = event => event.command
  ? event.command.op === "on" && event.command.b > 0
  : event.data?.[0] >> 4 === 9 && event.data?.[2] > 0;

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
    const budget = options.processorOptions.soundfontCacheBudget;
    this.soundfontCacheBudget = Number.isSafeInteger(budget) && budget > 0 ? budget : SOUNDFONT_CACHE_BUDGET;
    this.latencyDiagnostics = !!options.processorOptions.latencyDiagnostics;
    this.diagnosticSilentFrames = 0;
    this.diagnosticOnsets = [];
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
    // MTS tuning programs are seven-bit; the upper 128 channels use bank 1.
    for (let channel = 0; channel < MIDI_CHANNELS; channel++) {
      const result = this.module._ps_activate_tuning(this.synth, channel, channel >> 7, channel & 127, 0);
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
    for (const channel of this.usedChannels ?? []) {
      this.module._ps_cc(this.synth, channel, 91, this.reverbSend);
    }
  }

  handleMessage(message) {
    if (message?.type === "latency-diagnostics") {
      this.latencyDiagnostics = !!message.enabled;
      this.diagnosticSilentFrames = 0;
      this.diagnosticOnsets = [];
      return;
    }
    if (message?.type === "dispose") {
      if (this.disposed) return;
      this.disposed = true;
      this.midiQueue = [];
      this.pendingSoundfont = null;
      this.diagnosticOnsets = [];
      const before = this.memorySizes();
      if (this.synth) this.module._ps_destroy(this.synth);
      this.synth = null;
      for (const pointer of [this.leftPointer, this.rightPointer, this.sysexPointer, this.handledPointer]) {
        if (pointer) this.module._free(pointer);
      }
      let soundfontFileRemoved = true;
      const paths = this.soundfontFiles?.size
        ? [...this.soundfontFiles.values()].map(file => file.path) : ["/hexatone-soundfont.sf2"];
      for (const path of paths) {
        try { this.module?.FS.unlink(path); }
        catch { if (this.soundfontFileBytes > 0) soundfontFileRemoved = false; }
      }
      this.soundfontFiles?.clear();
      this.soundfontCache?.clear();
      this.retiredSoundfonts?.clear();
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
        this.pendingSoundfont = null;
        this.releasing = true;
        this.silentReleaseFrames = 0;
        this.midiQueue = [];
        this.diagnosticOnsets = [];
        this.diagnosticSilentFrames = 0;
        for (const channel of this.usedChannels ?? []) {
          this.module._ps_cc(this.synth, channel, 64, 0);
          this.module._ps_cc(this.synth, channel, 66, 0);
          // Release only rendered attacks. Scanning all possible channel/key pairs
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
        this.diagnosticOnsets = [];
        this.diagnosticSilentFrames = 0;
        for (let channel = 0; channel < MIDI_CHANNELS; channel++) this.module._ps_cc(this.synth, channel, 120, 0);
        this.heldKeys?.clear();
        this.port.postMessage({ type: "recovery-cleared", droppedEvents });
        return;
      }
      if (message.type === "cancel-pending-soundfont") {
        if (message.requestId != null && this.pendingSoundfont?.requestId !== message.requestId) return;
        this.pendingSoundfont = null;
        this.notifySoundfontCache();
        return;
      }
      if (message.type === "unpin-soundfonts") {
        for (const [id, bank] of this.soundfontFiles ?? []) {
          if (message.cacheKey ? bank.cacheKey === message.cacheKey : bank.pinned) {
            if (message.cacheKey) (this.retiredSoundfonts ??= new Set()).add(id);
            bank.pinned = false;
            bank.evictOnIdle = true;
          }
        }
        if (!this.collectRetiredSoundfonts(true)) this.notifySoundfontCache();
        return;
      }
      if (message.type === "select-cached-soundfont") {
        this.pendingSoundfont = null;
        const id = this.soundfontCache?.get(message.cacheKey);
        const bank = this.soundfontFiles?.get(id);
        if (bank) {
          if (message.prepareOnly) {
            bank.pinned = true;
            bank.evictOnIdle = false;
          }
          else this.activateBank(id, bank, message);
        }
        this.notifySoundfontCache();
        this.port.postMessage({ type: "soundfont-cache-result", requestId: message.requestId,
          hit: !!bank, ...(bank ? { soundfontId: id, presets: bank.presets,
            selectedPreset: this.selectedProgram } : {}) });
        return;
      }
      if (message.type === "load-soundfont" || message.type === "replace-soundfont") {
        const residentId = message.reuseAllowed ? this.soundfontCache?.get(message.cacheKey) : null;
        const resident = this.soundfontFiles?.get(residentId);
        if (resident) {
          this.pendingSoundfont = null;
          if (message.prepareOnly) {
            resident.pinned = true;
            resident.evictOnIdle = false;
          }
          else this.activateBank(residentId, resident, message);
          this.notifySoundfontCache();
          this.port.postMessage({ type: "soundfont-loaded", requestId: message.requestId,
            cacheKey: message.cacheKey, soundfontId: residentId, presets: resident.presets, selectedPreset: this.selectedProgram, cached: true });
          return;
        }
        if (message.waitForSilence) {
          this.pendingSoundfont = message;
          this.port.postMessage({ type: "soundfont-staged", cacheKey: message.cacheKey, requestId: message.requestId, deferred: true });
          this.notifySoundfontCache();
        } else {
          this.pendingSoundfont = null;
          this.loadSoundfont(message);
        }
        return;
      }

      if (message.type === "select-program") {
        const result = this.soundfontFiles?.get(this.soundfontId)?.presets.some(
          preset => preset.bank === message.bank && preset.program === message.program) ? 0 : -1;
        if (result === 0) this.selectedProgram = { bank: message.bank, program: message.program };
        this.port.postMessage({ ...message, type: "program-selected", result });
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

  notifySoundfontCache() {
    const keys = [];
    const preparedKeys = [];
    const restartEntries = [];
    let estimatedBytes = 0;
    let preparedBytes = 0;
    for (const [id, bank] of this.soundfontFiles ?? []) {
      estimatedBytes += bank.bytes * 2;
      if (bank.cacheKey && this.soundfontCache?.get(bank.cacheKey) === id) {
        keys.push(bank.cacheKey);
        if (!bank.evictOnIdle) restartEntries.push([bank.cacheKey, bank.lastUsed ?? 0]);
        if (bank.pinned) {
          preparedKeys.push(bank.cacheKey);
          preparedBytes += bank.bytes * 2;
        }
      }
    }
    this.port?.postMessage({ type: "soundfont-cache", keys, preparedKeys, restartEntries, estimatedBytes, preparedBytes,
      budgetBytes: this.soundfontCacheBudget ?? SOUNDFONT_CACHE_BUDGET,
      stagedBytes: this.pendingSoundfont?.bytes.byteLength ?? 0, ...this.memorySizes() });
  }

  activateBank(id, bank, message) {
    const requested = typeof message.preferredPreset === "string" ? message.preferredPreset.split(":").map(Number) : null;
    const preset = bank.presets.find(p => p.bank === requested?.[0] && p.program === requested?.[1]) ?? bank.presets[0];
    if (!message.retainSoundingVoices) {
      this.setReverbSend(message.reverbSend ?? this.reverbSend ?? 20);
    }
    this.retiredSoundfonts ??= new Set();
    if (this.soundfontId != null && this.soundfontId !== id) this.retiredSoundfonts.add(this.soundfontId);
    this.retiredSoundfonts.delete(id);
    this.soundfontId = id;
    this.selectedProgram = { bank: preset.bank, program: preset.program };
    bank.lastUsed = this.bankUseCounter = (this.bankUseCounter ?? 0) + 1;
  }

  commitPendingBank() {
    const message = this.pendingSoundfont;
    if (!message) return;
    this.pendingSoundfont = null;
    try {
      this.port.postMessage({ type: "soundfont-loading", requestId: message.requestId });
      this.loadSoundfont({ ...message, deferredCommit: true });
      this.collectRetiredSoundfonts(true);
    } catch (error) {
      this.port.postMessage({ type: "soundfont-switch-error", requestId: message.requestId, message: String(error) });
    }
  }

  loadSoundfont(message) {
    if (this.soundfontId != null && message.type !== "replace-soundfont")
      throw new Error("Use replace-soundfont to change the loaded SoundFont");
    const allowEvictPrepared = message.waitForSilence && !message.prepareOnly;
    if (message.prepareOnly || allowEvictPrepared) {
      const extra = message.bytes.byteLength * 2;
      const budget = this.soundfontCacheBudget ?? SOUNDFONT_CACHE_BUDGET;
      if (message.prepareOnly && extra <= budget) this.collectRetiredSoundfonts(true, extra);
      const required = extra + (message.prepareOnly ? (this.soundfontFileBytes ?? 0) * 2 : 0);
      if (required > budget) {
        const mib = 1024 * 1024;
        throw new Error(`SoundFont memory budget exceeded (${Math.ceil(required / mib)} MiB estimated, ` +
          `${Math.floor(budget / mib)} MiB allowed). Unload banks or choose a smaller bank.`);
      }
      if (allowEvictPrepared) {
        this.collectRetiredSoundfonts(true, extra, true);
        if ((this.soundfontFileBytes ?? 0) * 2 + extra > budget)
          throw new Error("SoundFont memory budget exceeded: banks still in use.");
      }
    }
    const previousId = this.soundfontId;
    const previousBytes = this.soundfontFileBytes ?? 0;
    // Unique paths prevent FluidSynth's sample cache from confusing two banks.
    const path = `/hexatone-soundfont-${this.soundfontSequence = (this.soundfontSequence ?? 0) + 1}.sf2`;
    const loadStartedAt = Date.now();
    this.port.postMessage({ type: "memory-snapshot", phase: "before-soundfont-load",
      inputBytes: message.bytes.byteLength, memory: this.memorySizes() });
    let soundfontId;
    try {
      this.module.FS.writeFile(path, new Uint8Array(message.bytes));
      this.soundfontFileBytes = previousBytes + message.bytes.byteLength;
      const fileReadyAt = Date.now();
      const pathPointer = this.module.stringToNewUTF8(path);
      try { soundfontId = this.module._ps_load_soundfont(this.synth, pathPointer); }
      finally { this.module._free(pathPointer); }
      if (soundfontId < 0) throw new Error(`FluidSynth SoundFont load failed: ${soundfontId}`);
      const bankReadyAt = Date.now();
      const presets = this.readPresets(soundfontId);
      if (!presets.length) throw new Error("The selected SoundFont contains no presets");
      const bank = { path, bytes: message.bytes.byteLength, presets, cacheKey: message.cacheKey,
        pinned: message.prepareOnly === true && message.pinned !== false };
      if (message.prepareOnly) {
        this.retiredSoundfonts ??= new Set();
        this.retiredSoundfonts.add(soundfontId);
        bank.lastUsed = this.bankUseCounter = (this.bankUseCounter ?? 0) + 1;
      } else this.activateBank(soundfontId, bank, message);
      this.soundfontFiles ??= new Map();
      this.soundfontFiles.set(soundfontId, bank);
      this.soundfontCache ??= new Map();
      if (message.cacheKey) {
        const previous = this.soundfontFiles.get(this.soundfontCache.get(message.cacheKey));
        if (previous) { previous.pinned = false; previous.evictOnIdle = true; }
        this.soundfontCache.set(message.cacheKey, soundfontId);
      }
      // Publish residency and pin state before acknowledging this load. In
      // particular, restoring the next bank must see the bank just loaded.
      if (!message.cacheKey || !this.collectRetiredSoundfonts(true, 0, allowEvictPrepared)) this.notifySoundfontCache();
      // Keep the synth, tuning maps, held keys and queued releases intact.
      // Program selection affects only future note-ons in FluidSynth.
      this.port.postMessage({ type: "soundfont-loaded", soundfontId, presets,
        loadTimingMs: { virtualFile: fileReadyAt - loadStartedAt,
          nativeLoad: bankReadyAt - fileReadyAt, presetSetup: Date.now() - bankReadyAt },
        memory: this.memorySizes(), selectedPreset: this.selectedProgram,
        cacheKey: message.cacheKey, requestId: message.requestId, deferredCommit: !!message.deferredCommit });
    } catch (error) {
      // Even an unused failed bank waits for an idle synth: native lazy unload
      // uses threads, so the adapter deliberately refuses it while voices play.
      if (soundfontId >= 0 && this.module._ps_unload_soundfont(this.synth, soundfontId) !== 0) {
        this.soundfontFiles ??= new Map();
        this.soundfontFiles.set(soundfontId, { path, bytes: message.bytes.byteLength });
        this.retiredSoundfonts ??= new Set();
        this.retiredSoundfonts.add(soundfontId);
      } else {
        try { this.module.FS.unlink(path); } catch { /* No file if creation failed. */ }
        this.soundfontFileBytes = previousBytes;
      }
      throw error;
    }
  }

  collectRetiredSoundfonts(force = false, extra = 0, allowEvictPrepared = false) {
    const replacing = allowEvictPrepared && extra > 0;
    if ((!this.retiredSoundfonts?.size && !replacing) || (!force && currentFrame < (this.nextBankCleanupFrame ?? 0))) return;
    this.nextBankCleanupFrame = currentFrame + Math.ceil(sampleRate / 4);
    // Wait for release tails too. This conservative test avoids the native
    // lazy-unload timer, which requires threads unavailable in this WASM build.
    if (this.lastOutputSounding || this.module._ps_active_voice_count(this.synth) !== 0) return;
    let estimate = this.soundfontFileBytes * 2 + extra;
    let changed = false;
    let candidates = [...(this.retiredSoundfonts ?? [])].sort((a, b) =>
      Number(Boolean(this.soundfontFiles?.get(a)?.pinned)) - Number(Boolean(this.soundfontFiles?.get(b)?.pinned)) ||
      (this.soundfontFiles?.get(a)?.lastUsed ?? 0) - (this.soundfontFiles?.get(b)?.lastUsed ?? 0));
    const deficit = estimate - (this.soundfontCacheBudget ?? SOUNDFONT_CACHE_BUDGET);
    if (replacing && deficit > 0) {
      if (this.soundfontId != null && !candidates.includes(this.soundfontId)) candidates.push(this.soundfontId);
      candidates = candidates.filter(id =>
        !this.midiQueue?.some(event => event.command?.patchProgram?.soundfontId === id));
      const bytes = id => (this.soundfontFiles.get(id)?.bytes ?? 0) * 2;
      if (candidates.reduce((sum, id) => sum + bytes(id), 0) < deficit) return;
      // Prefer a single bank. Among sufficient banks, take the least recently
      // used. If several are needed, largest first minimizes the number lost.
      candidates.sort((a, b) => {
        const aFits = bytes(a) >= deficit;
        const bFits = bytes(b) >= deficit;
        if (aFits !== bFits) return aFits ? -1 : 1;
        if (!aFits && bytes(a) !== bytes(b)) return bytes(b) - bytes(a);
        return (this.soundfontFiles.get(a)?.lastUsed ?? 0) - (this.soundfontFiles.get(b)?.lastUsed ?? 0);
      });
    }
    for (const id of candidates) {
      const cached = this.soundfontFiles?.get(id);
      if (cached?.pinned && !allowEvictPrepared) continue;
      if (!cached?.evictOnIdle && cached?.cacheKey && this.soundfontCache?.get(cached.cacheKey) === id &&
          estimate <= (this.soundfontCacheBudget ?? SOUNDFONT_CACHE_BUDGET)) continue;
      if (this.midiQueue?.some(event => event.command?.patchProgram?.soundfontId === id)) continue;
      if (this.module._ps_unload_soundfont(this.synth, id) !== 0) continue;
      this.retiredSoundfonts?.delete(id);
      if (id === this.soundfontId) {
        this.soundfontId = null;
        this.selectedProgram = null;
        this.port.postMessage({ type: "soundfont-unloaded", soundfontId: id });
      }
      changed = true;
      if (cached && this.soundfontCache?.get(cached.cacheKey) === id) this.soundfontCache.delete(cached.cacheKey);
      const file = this.soundfontFiles?.get(id);
      if (file) {
        try {
          this.module.FS.unlink(file.path);
          this.soundfontFiles.delete(id);
          this.soundfontFileBytes = Math.max(0, this.soundfontFileBytes - file.bytes);
          estimate -= file.bytes * 2;
        } catch { /* Dispose retries file cleanup. */ }
      }
    }
    if (changed) this.notifySoundfontCache();
    return changed;
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

  dispatchCommand({ channel, op, a = 0, b = 0, patchProgram }) {
    if (op === "volume") {
      // Include channels in their release tail. New attacks initialize their own CC7.
      for (const used of this.usedChannels ?? []) this.module._ps_cc(this.synth, used, 7, b);
      return;
    }
    if (!Number.isInteger(channel) || channel < 0 || channel >= MIDI_CHANNELS) return;
    if (op === "on" && b > 0) {
      const program = patchProgram ?? (this.selectedProgram && { soundfontId: this.soundfontId, ...this.selectedProgram });
      if (program) {
        if (!this.soundfontFiles?.has(program.soundfontId)) return;
        this.channelPrograms ??= [];
        const current = this.channelPrograms[channel];
        if (current?.soundfontId !== program.soundfontId || current.bank !== program.bank || current.program !== program.program) {
          const result = this.module._ps_select_program(this.synth, channel, program.soundfontId, program.bank, program.program);
          if (result !== 0) throw new Error(`Selecting SoundFont preset failed: ${result}`);
          this.channelPrograms[channel] = program;
        }
      }
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
    const pending = this.pendingSoundfont;
    // Leave near-term attacks on the current patch. A named cold recall can
    // wait for a gap without fading, cutting notes or holding the MIDI queue.
    let attackDue = false;
    if (pending) {
      for (const event of this.midiQueue) {
        if (event.frame > currentFrame + frames) break;
        if (isAttack(event)) { attackDue = true; break; }
      }
    }
    if (pending && !attackDue && !this.lastOutputSounding &&
        this.module._ps_active_voice_count(this.synth) === 0) this.commitPendingBank();
    else if (pending && !pending.waitReported) {
      pending.waitReported = true;
      this.port.postMessage({ type: "soundfont-waiting", requestId: pending.requestId });
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
    try { this.collectRetiredSoundfonts(); }
    catch (error) { this.port.postMessage({ type: "error", message: String(error) }); }
    const left = this.leftPointer >>> 2;
    const right = this.rightPointer >>> 2;
    channels[0].set(this.module.HEAPF32.subarray(left, left + frames));
    if (channels[1]) channels[1].set(this.module.HEAPF32.subarray(right, right + frames));
    // Voice count excludes reverb tails. Cold loading and cache eviction must
    // also wait for the audible output to settle.
    this.lastOutputSounding = false;
    outputScan: for (const channel of channels) {
      for (let i = 0; i < frames; i++) if (Math.abs(channel[i]) > 0.000001) {
        this.lastOutputSounding = true;
        break outputScan;
      }
    }
    // Optional diagnostic only: do not scan audio or read the wall clock when
    // disabled. An onset in an already sounding mixture cannot be attributed
    // to an individual key, so only observe attacks following 20 ms of silence.
    if (this.latencyDiagnostics) {
      this.diagnosticOnsets ??= [];
      if ((this.diagnosticSilentFrames ?? 0) >= sampleRate * 0.02) {
        for (const trace of touchTraces) {
          if (this.diagnosticOnsets.length < 64)
            this.diagnosticOnsets.push({ id: trace.id, expires: currentFrame + sampleRate * 2 });
        }
      }
      const threshold = 0.00001;
      let first = -1;
      for (let i = 0; i < frames; i++) {
        if (channels.some(channel => Math.abs(channel[i]) > threshold)) { first = i; break; }
      }
      this.diagnosticOnsets = this.diagnosticOnsets.filter(trace => trace.expires >= currentFrame);
      if (first >= 0) {
        const renderedAtEpochMs = this.diagnosticOnsets.length ? Date.now() : null;
        for (const trace of this.diagnosticOnsets) this.port.postMessage({ type: "touch-first-signal",
          id: trace.id, renderedAtEpochMs, audioTime: (currentFrame + first) / sampleRate, threshold });
        this.diagnosticOnsets = [];
        this.diagnosticSilentFrames = 0;
      } else this.diagnosticSilentFrames = (this.diagnosticSilentFrames ?? 0) + frames;
    }
    if (this.releasing) {
      // Include the rendered effects tail, not merely the note-off commands.
      const silent = channels.every(channel => channel.every(value => Math.abs(value) < 0.000001));
      this.silentReleaseFrames = silent ? this.silentReleaseFrames + frames : 0;
      if (this.silentReleaseFrames >= sampleRate / 4 && !this.releaseComplete) {
        this.releaseComplete = true;
        this.port.postMessage({ type: "release-complete" });
      }
    }
    for (const trace of touchTraces) this.port.postMessage({ ...trace, renderedAtEpochMs: Date.now() });
    return true;
  }

}

registerProcessor("hexatone-fluidsynth", FluidSynthProcessor);
