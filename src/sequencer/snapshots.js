// This module owns snapshot capture/playback of currently sounding notes.
// It serializes live note state into a portable snapshot form and can reapply
// those notes back onto a Keys instance. It does not manage long-term
// sequencing timelines; it is the lightweight snapshot layer used by the app.

import Point from "../keyboard/point.js";

const normalizeVelocity = (value, fallback = 72) =>
  Math.max(1, Math.min(127, Math.round(value ?? fallback)));

const normalize7Bit = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(127, Math.round(n)));
};

const normalize14Bit = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(16256, Math.round(n)));
};

const timbreToOnsetMod = (value, value14 = null) => 1 + (
  Number.isFinite(value14)
    ? Math.max(0, Math.min(16256, Number(value14))) / 16256
    : Math.max(0, Math.min(127, Number(value) || 0)) / 127
);

const snapshotPitchKey = (midicents) => {
  const n = Number(midicents);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(3);
};

const snapshotInstanceKey = (note) => {
  if (note == null || typeof note !== "object") return null;
  if (typeof note.instanceKey === "string" && note.instanceKey) return note.instanceKey;
  if (typeof note.id === "string" && note.id) {
    return `${note.snapshotId ?? ""}:${note.id}`;
  }
  if (typeof note.noteId === "string" && note.noteId) {
    return `${note.snapshotId ?? ""}:${note.noteId}`;
  }
  return null;
};

function currentControllerTimbre(runtime) {
  const liveCc1 = runtime?._controllerCCValues?.get?.(1);
  const persistedCc1 = runtime?.settings?.midiin_modwheel_value;
  return normalize7Bit(liveCc1 ?? persistedCc1);
}

function centsToReference(_settings, tuning) {
  return tuning?.degree0toRef_asArray?.[0] ?? 0;
}

function frequencyForSnapshotHex(runtime, hex) {
  const direct = runtime?._frequencyForHex?.(hex);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const centsToRef = centsToReference(runtime.settings, runtime.tuning);
  const fund = runtime.settings.fundamental;
  if (!Number.isFinite(fund) || !Number.isFinite(Number(hex?.cents))) return null;
  return fund * Math.pow(2, (Number(hex.cents) - centsToRef) / 1200);
}

function synthCentsForSnapshotNote(runtime, note) {
  const centsToRef = centsToReference(runtime.settings, runtime.tuning);
  const fundamental = Number(runtime?.settings?.fundamental);
  const frequency = 440 * Math.pow(2, (Number(note?.midicents) - 69) / 12);
  if (!Number.isFinite(centsToRef) || !Number.isFinite(fundamental) || fundamental <= 0) return null;
  if (!Number.isFinite(frequency) || frequency <= 0) return null;
  return centsToRef + Math.log2(frequency / fundamental) * 1200;
}

function attackVelocityOf(hex, settings) {
  return normalizeVelocity(
    hex?.velocity_played ??
      hex?.velocity ??
      hex?._onVel ??
      settings.midi_velocity ??
      72,
  );
}

/**
 * Capture all currently sounding notes as scale-agnostic snapshot notes.
 *
 * @param {object} runtime Keys-like runtime with settings, tuning, state, _snapshotNotes, _snapshotHexes, and _allActiveHexes().
 * @returns {Array<{ midicents: number, attackVelocity: number, releaseVelocity: number, velocity: number, pressure?: number, pressure14?: number, timbre?: number, timbre14?: number }>}
 */
export function captureSnapshot(runtime) {
  const seen = new Map(); // rounded midicents string -> entry (dedup)

  const add = (hex, releaseVelocity = null) => {
    const freq = frequencyForSnapshotHex(runtime, hex);
    if (!Number.isFinite(freq) || freq <= 0) return;
    const midicents = 69 + Math.log2(freq / 440) * 12;
    const key = midicents.toFixed(3);
    if (seen.has(key)) return;

    const attack = attackVelocityOf(hex, runtime.settings);
    const release = normalizeVelocity(releaseVelocity, attack);
    const entry = {
      midicents,
      attackVelocity: attack,
      releaseVelocity: release,
      // Backward-compatible alias for older snapshot consumers.
      velocity: attack,
      pressure: 0,
      timbre: 0,
    };

    const displayLabel = String(
      hex?._noteContext?.displayLabel ??
      runtime.getDisplayLabelAtCoords?.(hex?.coords, {
        frame: runtime._frameForSoundingHex?.(hex),
        geometryMode: runtime._geometryModeForSoundingHex?.(hex),
        settings: runtime._labelSettingsForSoundingHex?.(hex),
      }) ??
      "",
    ).trim();
    if (displayLabel) entry.displayLabel = displayLabel;

    const ratioText = String(hex?._noteContext?.scaleRatioText ?? hex?._noteContext?.ratioText ?? "").trim();
    if (ratioText) entry.ratioText = ratioText;
    if (Array.isArray(hex?._noteContext?.scaleMonzo)) entry.monzo = [...hex._noteContext.scaleMonzo];
    else if (Array.isArray(hex?._noteContext?.monzo)) entry.monzo = [...hex._noteContext.monzo];
    const modulationRatioText = String(hex?._noteContext?.ratioText ?? "").trim();
    if (modulationRatioText) entry.modulationRatioText = modulationRatioText;
    if (Array.isArray(hex?._noteContext?.monzo)) entry.modulationMonzo = [...hex._noteContext.monzo];

    const pressure = normalize7Bit(hex?._lastAftertouch);
    const pressure14 = normalize14Bit(hex?._lastAftertouch14);
    if (pressure != null) entry.pressure = pressure;
    if (pressure14 != null) entry.pressure14 = pressure14;

    const timbre = normalize7Bit(hex?._lastCC74) ?? currentControllerTimbre(runtime);
    const timbre14 = normalize14Bit(hex?._lastCC7414);
    if (timbre != null) entry.timbre = timbre;
    if (timbre14 != null) entry.timbre14 = timbre14;

    seen.set(key, entry);
  };

  const addSnapshotNote = (note) => {
    const midicents = Number(note?.midicents);
    if (!Number.isFinite(midicents)) return;
    const key = midicents.toFixed(3);
    if (seen.has(key)) return;

    const attack = normalizeVelocity(note.attackVelocity ?? note.velocity);
    const release = normalizeVelocity(note.releaseVelocity, attack);
    const entry = {
      midicents,
      attackVelocity: attack,
      releaseVelocity: release,
      velocity: attack,
      pressure: 0,
      timbre: 0,
    };

    const displayLabel = String(note?.displayLabel ?? "").trim();
    if (displayLabel) entry.displayLabel = displayLabel;

    const ratioText = String(note?.ratioText ?? "").trim();
    if (ratioText) entry.ratioText = ratioText;
    if (Array.isArray(note?.monzo)) entry.monzo = [...note.monzo];
    const modulationRatioText = String(note?.modulationRatioText ?? "").trim();
    if (modulationRatioText) entry.modulationRatioText = modulationRatioText;
    if (Array.isArray(note?.modulationMonzo)) entry.modulationMonzo = [...note.modulationMonzo];

    const pressure = normalize7Bit(note.pressure);
    const pressure14 = normalize14Bit(note.pressure14);
    if (pressure != null) entry.pressure = pressure;
    if (pressure14 != null) entry.pressure14 = pressure14;

    const timbre = normalize7Bit(note.timbre);
    const timbre14 = normalize14Bit(note.timbre14);
    if (timbre != null) entry.timbre = timbre;
    if (timbre14 != null) entry.timbre14 = timbre14;

    seen.set(key, entry);
  };

  for (const hex of runtime._allActiveHexes()) {
    add(hex);
  }
  for (const [hex, releaseVelocity] of runtime.state.sustainedNotes) {
    add(hex, releaseVelocity);
  }
  for (const note of runtime._snapshotNotes ?? []) {
    addSnapshotNote(note);
  }
  for (const hex of runtime._snapshotHexes ?? []) {
    add(hex, hex?._snapshotReleaseVelocity);
  }

  return Array.from(seen.values());
}

function applySnapshotExpression(runtime, hex, note) {
  const pressure = normalize7Bit(note.pressure);
  const pressure14 = normalize14Bit(note.pressure14);
  if (pressure != null || pressure14 != null) {
    const value = pressure ?? (pressure14 >> 7);
    if (hex.applySnapshotPressure) {
      hex.applySnapshotPressure(value, pressure14);
    } else if (pressure14 != null) {
      hex.aftertouch?.(value, pressure14);
    } else {
      hex.aftertouch?.(value);
    }
  }

  const timbre = normalize7Bit(note.timbre);
  const timbre14 = normalize14Bit(note.timbre14);
  if (timbre != null || timbre14 != null) {
    const value = timbre ?? (timbre14 >> 7);
    const synthRoutesOscModwheel =
      runtime?.synth?.family === "osc" ||
      runtime?.synth?.containsFamily?.("osc") === true;
    if (synthRoutesOscModwheel && hex.modwheel) {
      hex.modwheel(value);
      return;
    }
    if (hex.polyTimbre) {
      if (timbre14 != null) hex.polyTimbre(value, timbre14);
      else hex.polyTimbre(value);
    } else if (hex.cc74) {
      if (timbre14 != null) hex.cc74(value, timbre14);
      else hex.cc74(value);
    }
  }
}

function activeSnapshotHexesByInstance(runtime) {
  const byInstance = new Map();
  if (!runtime) return byInstance;
  for (const hex of runtime._snapshotHexes ?? []) {
    const instanceKey = typeof hex?._snapshotInstanceKey === "string" ? hex._snapshotInstanceKey : null;
    if (instanceKey) byInstance.set(instanceKey, hex);
  }
  return byInstance;
}

function soundingSnapshotHexes(runtime) {
  if (!(runtime?._soundingSnapshotHexes instanceof Set)) {
    runtime._soundingSnapshotHexes = new Set(runtime?._snapshotHexes ?? []);
  }
  return runtime._soundingSnapshotHexes;
}

function registerSoundingSnapshotHex(runtime, hex) {
  if (!runtime || !hex) return;
  soundingSnapshotHexes(runtime).add(hex);
}

function releaseSnapshotHex(runtime, hex, releaseVelocity = 0) {
  if (!hex) return;
  hex.noteOff?.(releaseVelocity);
  runtime?._soundingSnapshotHexes?.delete(hex);
}

function retuneSnapshotHex(runtime, hex, synthCents, bendOnly = false) {
  if (!Number.isFinite(synthCents)) return;
  hex._baseCents = synthCents;
  if (bendOnly && typeof hex?.standardWheelRetune === "function") {
    hex.standardWheelRetune(synthCents);
    return;
  }
  if (typeof runtime?._retuneHexFromBase === "function") {
    runtime._retuneHexFromBase(hex, synthCents, bendOnly);
    return;
  }
  if (typeof hex?.retune === "function") {
    hex.retune(synthCents, bendOnly);
  }
}

function sequenceRetuneSnapshotHex(hex, synthCents) {
  if (!Number.isFinite(synthCents) || !hex) return;
  hex._baseCents = synthCents;
  if (typeof hex.sequenceRetune === "function") {
    hex.sequenceRetune(synthCents);
    return;
  }
  if (typeof hex.retune === "function") hex.retune(synthCents, true);
}

function nextSnapshotCoords(runtime) {
  const nextId = Number.isFinite(Number(runtime?._snapshotCoordSeed))
    ? Number(runtime._snapshotCoordSeed)
    : 0;
  runtime._snapshotCoordSeed = nextId + 1;
  const base = 9000 + nextId;
  return new Point(base, base);
}

function setSnapshotPitchReference(hex, synthCents, noteMidicents, pitchOffsetCents = 0) {
  const safeOffset = Number.isFinite(Number(pitchOffsetCents)) ? Number(pitchOffsetCents) : 0;
  hex._snapshotSourceBaseCents = synthCents - safeOffset;
  hex._snapshotSourceMidicents = Number(noteMidicents) - (safeOffset / 100);
  hex._snapshotAppliedPitchOffsetCents = safeOffset;
}

function createSnapshotHex(runtime, note, options = {}) {
  const attackVelocity = normalizeVelocity(note.attackVelocity ?? note.velocity);
  const releaseVelocity = normalizeVelocity(note.releaseVelocity, attackVelocity);
  const degree0toRefRatio = runtime.tuning.degree0toRef_asArray?.[1] ?? 1;
  const synthCents = synthCentsForSnapshotNote(runtime, note);
  const pitchOffsetCents = Number(options?.pitchOffsetCents) || 0;
  const playbackSourceCents = synthCents - pitchOffsetCents;
  const dummyCoords = nextSnapshotCoords(runtime);
  const hex = runtime.synth.makeHex(
    dummyCoords,
    synthCents,
    0,
    0,
    runtime.tuning.equivSteps,
    synthCents,
    synthCents,
    undefined,
    attackVelocity,
    0,
    degree0toRefRatio,
    { playbackSourceCents },
  );
  hex._snapshotReleaseVelocity = releaseVelocity;
  hex._snapshotPitchKey = snapshotPitchKey(note.midicents);
  hex._snapshotMidicents = Number(note.midicents);
  hex._snapshotInstanceKey = snapshotInstanceKey(note);
  hex._baseCents = synthCents;
  setSnapshotPitchReference(hex, synthCents, note.midicents, pitchOffsetCents);
  const timbre = normalize7Bit(note.timbre);
  const timbre14 = normalize14Bit(note.timbre14);
  if ((timbre != null || timbre14 != null) && typeof runtime?.synth?.setMod === "function") {
    runtime.synth.setMod(timbreToOnsetMod(timbre, timbre14));
  }
  hex.noteOn();
  registerSoundingSnapshotHex(runtime, hex);
  applySnapshotExpression(runtime, hex, note);
  return hex;
}

function snapshotGestureVoices(runtime) {
  if (!(runtime?._snapshotGestureVoices instanceof Map)) {
    runtime._snapshotGestureVoices = new Map();
  }
  return runtime._snapshotGestureVoices;
}

function snapshotVoiceOwners(runtime) {
  if (!(runtime?._snapshotVoiceOwners instanceof Map)) {
    runtime._snapshotVoiceOwners = new Map();
  }
  return runtime._snapshotVoiceOwners;
}

export function beginSnapshotGesture(runtime, gestureId, options = {}) {
  if (!runtime || gestureId == null) return;
  if (options.replace === true) runtime.stopSnapshot?.();
  snapshotGestureVoices(runtime).set(gestureId, new Set());
}

export function attackSnapshotGestureNote(runtime, gestureId, note, options = {}) {
  if (!runtime || gestureId == null || !note) return null;
  const gestureVoices = snapshotGestureVoices(runtime);
  const voiceOwners = snapshotVoiceOwners(runtime);
  const ownedVoices = gestureVoices.get(gestureId) ?? new Set();
  gestureVoices.set(gestureId, ownedVoices);
  const pitchKey = snapshotPitchKey(note.midicents);

  let hex = null;
  let attacked = false;
  if (options.legato === true && pitchKey) {
    hex = [...soundingSnapshotHexes(runtime)].find((candidate) => {
      if (!candidate || candidate.release === true) return false;
      const candidateKey = candidate._snapshotPitchKey
        ?? snapshotPitchKey(candidate._snapshotMidicents);
      const owners = voiceOwners.get(candidate);
      return candidateKey === pitchKey && !owners?.has(gestureId);
    }) ?? null;
  }

  if (hex) {
    const attackVelocity = normalizeVelocity(note.attackVelocity ?? note.velocity);
    hex._snapshotReleaseVelocity = normalizeVelocity(note.releaseVelocity, attackVelocity);
    applySnapshotExpression(runtime, hex, note);
  } else {
    hex = createSnapshotHex(runtime, note, options);
    runtime._snapshotHexes = [...(runtime._snapshotHexes ?? []), hex];
    attacked = true;
  }

  const owners = voiceOwners.get(hex) ?? new Set();
  owners.add(gestureId);
  voiceOwners.set(hex, owners);
  ownedVoices.add(hex);
  runtime._snapshotNotes = [
    ...(runtime._snapshotNotes ?? []),
    { ...note, _snapshotGestureId: gestureId, _snapshotHex: hex },
  ];
  return { hex, attacked };
}

export function releaseSnapshotGestureNote(runtime, gestureId, hex) {
  if (!runtime || gestureId == null || !hex) return;
  const gestureVoices = snapshotGestureVoices(runtime);
  const voiceOwners = snapshotVoiceOwners(runtime);
  const ownedVoices = gestureVoices.get(gestureId);
  if (!ownedVoices?.has(hex)) return;

  ownedVoices.delete(hex);
  const owners = voiceOwners.get(hex);
  owners?.delete(gestureId);
  if (!owners?.size) {
    voiceOwners.delete(hex);
    releaseSnapshotHex(runtime, hex, hex._snapshotReleaseVelocity ?? 0);
    runtime._snapshotHexes = (runtime._snapshotHexes ?? []).filter(
      (candidate) => candidate !== hex,
    );
  }
  runtime._snapshotNotes = (runtime._snapshotNotes ?? []).filter(
    (note) => !(note?._snapshotGestureId === gestureId && note?._snapshotHex === hex),
  );
}

export function stopSnapshotGesture(runtime, gestureId) {
  if (!runtime || gestureId == null) return;
  const gestureVoices = snapshotGestureVoices(runtime);
  const ownedVoices = gestureVoices.get(gestureId);
  if (ownedVoices) {
    for (const hex of ownedVoices) {
      releaseSnapshotGestureNote(runtime, gestureId, hex);
    }
  }
  gestureVoices.delete(gestureId);
  runtime._snapshotNotes = (runtime._snapshotNotes ?? []).filter(
    (note) => note?._snapshotGestureId !== gestureId,
  );
}

/**
 * Play snapshot notes through the current synth.
 *
 * Snapshot pitches are absolute MIDI floats. Playback converts them back to
 * synth-relative cents for the current fundamental/reference context.
 *
 * @param {object} runtime Keys-like runtime with settings, tuning, synth, and stopSnapshot().
 * @param {Array<{ midicents: number, attackVelocity?: number, releaseVelocity?: number, velocity?: number, pressure?: number, pressure14?: number, timbre?: number, timbre14?: number }>} notes
 * @returns {Array<object>} active snapshot hexes
 */
export function playSnapshot(runtime, notes, options = {}) {
  const legato = !!options.legato;
  const bendOnlyRetune = !!options.bendOnlyRetune;
  const pitchOffsetCents = Number(options?.pitchOffsetCents) || 0;
  if (!legato) {
    runtime.stopSnapshot();
    return notes.map((note) => createSnapshotHex(runtime, note, { pitchOffsetCents }));
  }

  const availableHexesByPitch = new Map();
  const availableHexesByInstance = new Map();
  for (const hex of runtime._snapshotHexes ?? []) {
    const instanceKey = typeof hex?._snapshotInstanceKey === "string" ? hex._snapshotInstanceKey : null;
    if (instanceKey) availableHexesByInstance.set(instanceKey, hex);
    const key = hex?._snapshotPitchKey ?? snapshotPitchKey(hex?._snapshotMidicents);
    if (!key) continue;
    const list = availableHexesByPitch.get(key) ?? [];
    list.push(hex);
    availableHexesByPitch.set(key, list);
  }

  const nextHexes = [];
  for (const note of notes) {
    const key = snapshotPitchKey(note.midicents);
    const instanceKey = snapshotInstanceKey(note);
    const reusedByInstance = instanceKey != null
      ? (availableHexesByInstance.get(instanceKey) ?? null)
      : null;
    if (instanceKey != null) availableHexesByInstance.delete(instanceKey);
    let reusedHex = reusedByInstance;
    if (reusedHex) {
      const previousKey = reusedHex?._snapshotPitchKey ?? snapshotPitchKey(reusedHex?._snapshotMidicents);
      const previousAvailable = previousKey ? (availableHexesByPitch.get(previousKey) ?? []) : [];
      const reusedIndex = previousAvailable.indexOf(reusedHex);
      if (reusedIndex >= 0) previousAvailable.splice(reusedIndex, 1);
      if (previousKey) availableHexesByPitch.set(previousKey, previousAvailable);
    } else {
      const available = key ? (availableHexesByPitch.get(key) ?? []) : [];
      reusedHex = available.shift() ?? null;
      if (key) availableHexesByPitch.set(key, available);
    }

    if (reusedHex && !note?.reattack) {
      const attackVelocity = normalizeVelocity(note.attackVelocity ?? note.velocity);
      const releaseVelocity = normalizeVelocity(note.releaseVelocity, attackVelocity);
      const synthCents = synthCentsForSnapshotNote(runtime, note);
      reusedHex._snapshotReleaseVelocity = releaseVelocity;
      reusedHex._snapshotPitchKey = key;
      reusedHex._snapshotMidicents = Number(note.midicents);
      reusedHex._snapshotInstanceKey = instanceKey;
      setSnapshotPitchReference(reusedHex, synthCents, note.midicents, pitchOffsetCents);
      retuneSnapshotHex(runtime, reusedHex, synthCents, bendOnlyRetune);
      // Future note-transition work can layer timed pressure/timbre ramps here.
      applySnapshotExpression(runtime, reusedHex, note);
      nextHexes.push(reusedHex);
      continue;
    }

    if (reusedHex) {
      releaseSnapshotHex(runtime, reusedHex, reusedHex._snapshotReleaseVelocity ?? 0);
    }

    nextHexes.push(createSnapshotHex(runtime, note, { pitchOffsetCents }));
  }

  for (const remainingHexes of availableHexesByPitch.values()) {
    for (const hex of remainingHexes) {
      releaseSnapshotHex(runtime, hex, hex._snapshotReleaseVelocity ?? 0);
    }
  }

  return nextHexes;
}

/**
 * Retune currently sounding snapshot hexes in place without replaying them.
 *
 * This is used by real-time playback modifiers such as the sequencer pitch
 * offset, where already sounding notes should bend smoothly rather than
 * rearticulate. It only updates existing snapshot hexes and does not create
 * or release notes.
 *
 * @param {object} runtime Keys-like runtime with active `_snapshotHexes`
 * @param {Array<object>} notes snapshot notes describing the current sounding set
 * @param {{ bendOnly?: boolean }} options
 */
export function retuneSnapshotHexes(runtime, notes, options = {}) {
  const usedHexes = new Set();
  if (!runtime) return usedHexes;
  const bendOnly = options?.bendOnly !== false;
  const sequencePitch = options?.sequencePitch === true;
  const pitchOffsetCents = Number(options?.pitchOffsetCents) || 0;
  const activeByInstance = activeSnapshotHexesByInstance(runtime);
  const fallbackHexes = [...(runtime._snapshotHexes ?? [])];

  for (const note of notes ?? []) {
    const instanceKey = snapshotInstanceKey(note);
    let hex = instanceKey != null ? (activeByInstance.get(instanceKey) ?? null) : null;
    // A note with an instance id that is absent from the active map is a new
    // or already-released note, not a license to bend an unrelated voice.
    // The positional fallback only exists for legacy notes without ids.
    if (!hex && instanceKey == null) {
      hex = fallbackHexes.find((candidate) => candidate && !usedHexes.has(candidate)) ?? null;
    }
    if (!hex || usedHexes.has(hex)) continue;
    usedHexes.add(hex);

    const synthCents = synthCentsForSnapshotNote(runtime, note);
    hex._snapshotPitchKey = snapshotPitchKey(note.midicents);
    hex._snapshotMidicents = Number(note.midicents);
    if (instanceKey != null) hex._snapshotInstanceKey = instanceKey;
    setSnapshotPitchReference(hex, synthCents, note.midicents, pitchOffsetCents);
    if (sequencePitch) sequenceRetuneSnapshotHex(hex, synthCents);
    else retuneSnapshotHex(runtime, hex, synthCents, bendOnly);
    applySnapshotExpression(runtime, hex, note);
  }
  return usedHexes;
}

/**
 * Retune every currently sounding snapshot voice to one absolute offset.
 *
 * Unlike retuneSnapshotHexes, this deliberately does not reconstruct a cue's
 * note set. Legato voices may have originated in an earlier cue and must still
 * follow a live global pitch gesture. Each target is reconstructed from the
 * voice's immutable unshifted base, so skipped frames cannot accumulate error.
 */
export function retuneActiveSnapshotHexes(runtime, pitchOffsetCents, options = {}) {
  if (!runtime) return;
  const safePitchOffsetCents = Number(pitchOffsetCents);
  if (!Number.isFinite(safePitchOffsetCents)) return;
  const skipHexes = options?.skipHexes instanceof Set ? options.skipHexes : null;

  const activeHexes = new Set([
    ...(runtime._snapshotHexes ?? []),
    ...soundingSnapshotHexes(runtime),
  ]);
  for (const hex of activeHexes) {
    if (!hex || hex.release === true || skipHexes?.has(hex)) {
      if (hex?.release === true) runtime._soundingSnapshotHexes?.delete(hex);
      continue;
    }
    const storedSourceBaseCents = Number(hex._snapshotSourceBaseCents);
    const appliedOffset = Number(hex._snapshotAppliedPitchOffsetCents) || 0;
    const currentBaseCents = Number(hex._baseCents);
    const sourceBaseCents = Number.isFinite(storedSourceBaseCents)
      ? storedSourceBaseCents
      : currentBaseCents - appliedOffset;
    if (!Number.isFinite(sourceBaseCents)) continue;
    hex._snapshotSourceBaseCents = sourceBaseCents;
    hex._snapshotAppliedPitchOffsetCents = safePitchOffsetCents;
    const sourceMidicents = Number(hex._snapshotSourceMidicents);
    if (Number.isFinite(sourceMidicents)) {
      const nextMidicents = sourceMidicents + (safePitchOffsetCents / 100);
      hex._snapshotMidicents = nextMidicents;
      hex._snapshotPitchKey = snapshotPitchKey(nextMidicents);
    }
    sequenceRetuneSnapshotHex(hex, sourceBaseCents + safePitchOffsetCents);
  }
}

/**
 * Stop snapshot playback.
 *
 * @param {Array<object>} snapshotHexes active snapshot hexes
 */
export function stopSnapshot(snapshotHexes, runtime = null) {
  for (const hex of snapshotHexes ?? []) {
    releaseSnapshotHex(runtime, hex, hex._snapshotReleaseVelocity ?? 0);
  }
  runtime?._snapshotGestureVoices?.clear();
  runtime?._snapshotVoiceOwners?.clear();
}
