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
    if (pressure14 != null) hex.aftertouch?.(value, pressure14);
    else hex.aftertouch?.(value);
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

function nextSnapshotCoords(runtime) {
  const nextId = Number.isFinite(Number(runtime?._snapshotCoordSeed))
    ? Number(runtime._snapshotCoordSeed)
    : 0;
  runtime._snapshotCoordSeed = nextId + 1;
  const base = 9000 + nextId;
  return new Point(base, base);
}

function createSnapshotHex(runtime, note) {
  const attackVelocity = normalizeVelocity(note.attackVelocity ?? note.velocity);
  const releaseVelocity = normalizeVelocity(note.releaseVelocity, attackVelocity);
  const centsToRef = centsToReference(runtime.settings, runtime.tuning);
  const fund = runtime.settings.fundamental;
  const degree0toRefRatio = runtime.tuning.degree0toRef_asArray?.[1] ?? 1;
  const freq = 440 * Math.pow(2, (note.midicents - 69) / 12);
  const synthCents = centsToRef + Math.log2(freq / fund) * 1200;
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
  );
  hex._snapshotReleaseVelocity = releaseVelocity;
  hex._snapshotPitchKey = snapshotPitchKey(note.midicents);
  hex._snapshotMidicents = Number(note.midicents);
  hex._snapshotInstanceKey = snapshotInstanceKey(note);
  const timbre = normalize7Bit(note.timbre);
  const timbre14 = normalize14Bit(note.timbre14);
  if ((timbre != null || timbre14 != null) && typeof runtime?.synth?.setMod === "function") {
    runtime.synth.setMod(timbreToOnsetMod(timbre, timbre14));
  }
  hex.noteOn();
  applySnapshotExpression(runtime, hex, note);
  return hex;
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
  if (!legato) {
    runtime.stopSnapshot();
    return notes.map((note, index) => createSnapshotHex(runtime, note, index));
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
    const available = key ? (availableHexesByPitch.get(key) ?? []) : [];
    let reusedHex = reusedByInstance;
    if (reusedHex) {
      const reusedIndex = available.indexOf(reusedHex);
      if (reusedIndex >= 0) available.splice(reusedIndex, 1);
    } else {
      reusedHex = available.shift() ?? null;
    }
    if (key) availableHexesByPitch.set(key, available);

    if (reusedHex && !note?.reattack) {
      const attackVelocity = normalizeVelocity(note.attackVelocity ?? note.velocity);
      const releaseVelocity = normalizeVelocity(note.releaseVelocity, attackVelocity);
      reusedHex._snapshotReleaseVelocity = releaseVelocity;
      reusedHex._snapshotPitchKey = key;
      reusedHex._snapshotMidicents = Number(note.midicents);
      reusedHex._snapshotInstanceKey = instanceKey;
      // Future note-transition work can layer timed pressure/timbre ramps here.
      applySnapshotExpression(runtime, reusedHex, note);
      nextHexes.push(reusedHex);
      continue;
    }

    if (reusedHex) {
      reusedHex.noteOff(reusedHex._snapshotReleaseVelocity ?? 0);
    }

    nextHexes.push(createSnapshotHex(runtime, note));
  }

  for (const remainingHexes of availableHexesByPitch.values()) {
    for (const hex of remainingHexes) {
      hex.noteOff(hex._snapshotReleaseVelocity ?? 0);
    }
  }

  return nextHexes;
}

/**
 * Stop snapshot playback.
 *
 * @param {Array<object>} snapshotHexes active snapshot hexes
 */
export function stopSnapshot(snapshotHexes) {
  if (!snapshotHexes?.length) return;
  for (const hex of snapshotHexes) {
    hex.noteOff(hex._snapshotReleaseVelocity ?? 0);
  }
}
