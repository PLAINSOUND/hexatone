/**
 * composite_synth — fans out makeHex/noteOn/noteOff/retune to multiple synths
 * in parallel. Keys.js is unaware of how many outputs are active.
 *
 * Usage:
 *   const synth = create_composite_synth([sampleSynth, mtsSynth]);
 *   // then pass synth to Keyboard as normal
 */
import { stopRetiredSuperSonicOutputs } from "../supersonic_synth/transport.js";
import { stopFadingOutputToggles } from "../audio/output-toggle.js";

import { outputAttackGroup } from "../midi/output-transaction.js";
import { expressionToMidi, MIDI_EXPRESSION_14_MAX, readSnapshotExpression, snapshotMidiExpression } from "../sequencer/snapshot-expression.js";

const expressionStateBySynths = new WeakMap();
const pitchReferenceBySynth = new WeakMap();

function snapshotCents(synth, midicents, fallback, reference = pitchReferenceBySynth.get(synth)) {
  if (!reference || !Number.isFinite(midicents)) return fallback;
  return reference.cents + (midicents - 69) * 100 +
    1200 * Math.log2(440 / reference.fundamental);
}

function snapshotArgs(synth, args, midicents) {
  const reference = pitchReferenceBySynth.get(synth);
  if (!reference || !Number.isFinite(midicents)) return args;
  const next = [...args];
  const cents = snapshotCents(synth, midicents, args[1]);
  const offset = Number(args[1]) - Number(args[11]?.playbackSourceCents ?? args[1]);
  next[1] = next[5] = next[6] = cents;
  next[10] = reference.ratio;
  next[11] = { ...args[11], playbackSourceCents: cents - offset };
  return next;
}

function expressionState(synths) {
  let state = expressionStateBySynths.get(synths);
  if (!state) {
    state = { modwheel: null, expression: null, onsetMod: null };
    expressionStateBySynths.set(synths, state);
  }
  return state;
}

function controlledSynths(synths, retiringSynths) {
  for (const synth of retiringSynths) {
    if (synth.hasVoices?.() === false) retiringSynths.delete(synth);
  }
  return [...new Set([...synths, ...retiringSynths])];
}

export const create_composite_synth = (synths, retiringSynths = new Set(), pitchReference = null) => {
  // References belong to engine instances, not the current canvas. Retained
  // voices and engines may still use the reference from before a preset change.
  if (pitchReference) {
    for (const synth of synths) {
      pitchReferenceBySynth.set(synth, pitchReference);
    }
  }
  return ({
  family: "composite",
  families: synths.map((s) => s?.family).filter(Boolean),
  childSynths() {
    return [...synths];
  },
  containsFamily(name) {
    return synths.some((s) => s?.family === name);
  },
  getDiagnostics() {
    return {
      family: "composite",
      families: synths.map((s) => s?.family).filter(Boolean),
      outputs: synths.map((s) => s?.getDiagnostics?.() ?? { family: s?.family ?? "unknown" }),
    };
  },

  makeHex: (...args) => {
    let hexSynths = [...synths];
    const hexPitchReferences = hexSynths.map((s) => pitchReferenceBySynth.get(s));
    const hexes = hexSynths.map((s) => s.makeHex(...snapshotArgs(s, args, args[11]?.absoluteMidicents)));
    const firstHex = hexes[0] ?? {
      coords: args[0] ?? null,
      cents: Number(args[1]) || 0,
      release: false,
      note_played: args[7],
      velocity_played: args[8],
      velocity: args[8],
      _onVel: args[8],
    };
    const compositeHex = {
      // Keys.js reads coords, cents, release from the hex object.
      // All synths receive the same coords/cents so any one is authoritative.
      coords: firstHex.coords,
      cents: Number.isFinite(args[11]?.absoluteMidicents) ? args[1] : firstHex.cents,
      release: false,
      note_played: firstHex.note_played,
      velocity_played: hexes.find((h) => h.velocity_played != null)?.velocity_played,
      velocity: hexes.find((h) => h.velocity != null)?.velocity,
      _onVel: hexes.find((h) => h._onVel != null)?._onVel,
      standardWheelPassthroughOnly: hexes.every((h) => h.standardWheelPassthroughOnly),
      supportsMpeTimbre: hexes.some((h) => h.supportsMpeTimbre),
      // Expose stolen coords from any child synth that had to evict a voice.
      // Keys.js uses this to redraw the displaced hex.
      _stolenCoords: hexes.reduce((acc, h) => acc || h._stolenCoords || null, null),
      _compositeSounding: false,
      _compositeLastPressure: null,
      _compositeLastPressure14: null,
      _compositeLastTimbre: null,
      _compositeLastTimbre14: null,

      // Existing Keys note objects survive output-graph changes. Reconcile the
      // child voices in-place so a newly enabled output joins sounding notes.
      // Replacing a sample instrument instead preserves held voices until release.
      reconcileSynths(nextSynths, timestamp) {
        const desired = Array.isArray(nextSynths) ? nextSynths.filter(Boolean) : [];
        // A held sample voice keeps its instrument until its musical release.
        // Store the newest graph for a later attack on this same wrapper.
        this._nextSynths = desired;
        const keepSample =
          this._compositeSounding &&
          hexSynths.some((s) => s.family === "sample") &&
          desired.some((s) => s.family === "sample");
        for (let index = hexSynths.length - 1; index >= 0; index -= 1) {
          if (desired.includes(hexSynths[index])) continue;
          if (keepSample && hexSynths[index].family === "sample") continue;
          if (this._compositeSounding) hexes[index]?.noteOff?.(0, timestamp);
          hexSynths.splice(index, 1);
          hexPitchReferences.splice(index, 1);
          hexes.splice(index, 1);
        }

        for (const nextSynth of desired) {
          if (hexSynths.includes(nextSynth) || typeof nextSynth?.makeHex !== "function") continue;
          if (keepSample && nextSynth.family === "sample") continue;
          const nextArgs = [...args];
          nextArgs[1] = this.cents;
          nextArgs[11] = { ...(nextArgs[11] ?? {}), deferNoteOn: true };
          const childArgs = snapshotArgs(nextSynth, nextArgs, this._snapshotMidicents);
          const child = nextSynth.makeHex(...childArgs);
          if (Number.isFinite(Number(childArgs[1]))) child.retune?.(Number(childArgs[1]), true);
          hexSynths.push(nextSynth);
          hexPitchReferences.push(pitchReferenceBySynth.get(nextSynth));
          hexes.push(child);
          if (!this._compositeSounding) continue;
          child._attackGroup = this._attackGroup;
          child.noteOn?.(timestamp);
          if (this._compositeLastPressure != null || this._compositeLastPressure14 != null) {
            const pressure = this._compositeLastPressure ?? this._compositeLastPressure14 >> 7;
            if (this._compositeNormalizedPressure != null && child.applyNormalizedSnapshotPressure)
              child.applyNormalizedSnapshotPressure(this._compositeNormalizedPressure);
            else if (child.applySnapshotPressure)
              child.applySnapshotPressure(pressure, this._compositeLastPressure14);
            else child.aftertouch?.(pressure, this._compositeLastPressure14);
          }
          if (this._compositeLastTimbre != null || this._compositeLastTimbre14 != null) {
            const timbre = this._compositeLastTimbre ?? this._compositeLastTimbre14 >> 7;
            if (this._compositeNormalizedTimbre != null && child.applyNormalizedSnapshotTimbre)
              child.applyNormalizedSnapshotTimbre(this._compositeNormalizedTimbre);
            else if (child.polyTimbre) child.polyTimbre(timbre, this._compositeLastTimbre14);
            else child.cc74?.(timbre, this._compositeLastTimbre14);
          }
        }
      },

      hasDisplacedVoice() {
        return hexes.some((h) => h.hasDisplacedVoice?.() === true);
      },

      needsRetainedVoiceRecovery() {
        return this._compositeSounding && hexes.some(h => h.needsRetainedVoiceRecovery?.() === true);
      },

      recoverRetainedVoice(note, timestamp) {
        if (!this._compositeSounding || this.release) return false;
        let recovered = false;
        for (let i = 0; i < hexes.length; i++) {
          const old = hexes[i];
          if (old.needsRetainedVoiceRecovery?.() !== true) continue;
          if (old.recoverRetainedVoice?.(note, timestamp) === true) {
            recovered = true;
            continue;
          }
          // Replace only the missing local child. Healthy MIDI/OSC children
          // retain ownership and receive no new attack or release.
          old.cancelPendingEvents?.();
          old.noteOff?.(0, timestamp);
          const nextArgs = [...args];
          nextArgs[1] = this.cents;
          nextArgs[8] = note.attackVelocity ?? note.velocity ?? args[8];
          nextArgs[11] = { ...args[11], deferNoteOn: true };
          const child = hexSynths[i].makeHex(...snapshotArgs(hexSynths[i], nextArgs, this._snapshotMidicents));
          hexes[i] = child;
          child.prepareSnapshotExpression?.(note);
          const expression = readSnapshotExpression(note);
          if (child.prepareNormalizedSnapshotPressure) child.prepareNormalizedSnapshotPressure(expression.pressure);
          else child.prepareSnapshotPressure?.(expressionToMidi(expression.pressure), expressionToMidi(expression.pressure, MIDI_EXPRESSION_14_MAX));
          child._attackGroup = this._attackGroup;
          child.noteOn?.(timestamp);
          child.applyNormalizedSnapshotPressure?.(expression.pressure);
          child.applyNormalizedSnapshotTimbre?.(expression.timbre);
          recovered = true;
        }
        return recovered;
      },

      displacedVoiceAt() {
        const values = hexes
          .filter((h) => h.hasDisplacedVoice?.() === true)
          .map((h) => h.displacedVoiceAt?.())
          .filter(Number.isFinite);
        return values.length ? Math.min(...values) : Infinity;
      },

      recoverDisplacedVoice(note, timestamp) {
        let found = false;
        let recovered = true;
        for (const h of hexes) {
          if (h.hasDisplacedVoice?.() !== true) continue;
          found = true;
          if (h.recoverDisplacedVoice?.(note, timestamp) !== true) recovered = false;
        }
        return found && recovered;
      },

      noteOn(timestamp) {
        if (!this._compositeSounding && this._nextSynths) {
          this.reconcileSynths(this._nextSynths, timestamp);
        }
        this._compositeSounding = true;
        this.release = false;
        this._attackGroup = outputAttackGroup();
        hexes.forEach((h) => {
          h._attackGroup = this._attackGroup;
          h.noteOn(timestamp);
        });
      },

      noteOff(release_velocity, timestamp) {
        this._compositeSounding = false;
        this.release = true;
        hexes.forEach((h) => {
          if (Number.isFinite(Number(timestamp))) h.noteOff(release_velocity, Number(timestamp));
          else h.noteOff(release_velocity);
        });
      },

      retune(newCents, bendOnly = false, bend21 = null) {
        // Update our own cents so keys.js sustain logic stays in sync
        this.cents = newCents;
        hexes.forEach((h) => h.retune && h.retune(newCents, bendOnly, bend21));
      },

      sequenceRetune(newCents) {
        // Sequencer PITCH is an absolute playback transform, not controller
        // wheel expression. Preserve the absolute pitch across child references.
        this.cents = newCents;
        hexes.forEach((h, index) => {
          const target = snapshotCents(hexSynths[index], this._snapshotMidicents, newCents, hexPitchReferences[index]);
          if (h.sequenceRetune) h.sequenceRetune(target);
          else if (h.retune) h.retune(target, true);
        });
      },

      retuneSnapshot(newCents, bendOnly, midicents) {
        this.cents = newCents;
        hexes.forEach((h, index) => {
          const target = snapshotCents(hexSynths[index], midicents, newCents, hexPitchReferences[index]);
          if (bendOnly && h.standardWheelRetune) h.standardWheelRetune(target);
          else h.retune?.(target, bendOnly);
        });
      },

      standardWheelRetune(newCents) {
        this.cents = newCents;
        hexes.forEach((h) => {
          if (h.standardWheelPassthroughOnly) return;
          if (h.standardWheelRetune) {
            h.standardWheelRetune(newCents);
          } else if (h.retune) {
            h.retune(newCents, true);
          }
        });
      },

      aftertouch(value, value14 = null) {
        this._compositeNormalizedPressure = null;
        this._compositeLastPressure = value;
        this._compositeLastPressure14 = value14;
        hexes.forEach((h) => h.aftertouch && h.aftertouch(value, value14));
      },

      applySnapshotPressure(value, value14 = null) {
        this._compositeNormalizedPressure = null;
        this._compositeLastPressure = value;
        this._compositeLastPressure14 = value14;
        hexes.forEach((h) => {
          if (h.applySnapshotPressure) h.applySnapshotPressure(value, value14);
          else h.aftertouch?.(value, value14);
        });
      },

      prepareSnapshotPressure(value, value14 = null) {
        hexes.forEach((h) => h.prepareSnapshotPressure?.(value, value14));
      },

      prepareSnapshotExpression(note) {
        hexes.forEach((h) => h.prepareSnapshotExpression?.(note));
      },

      prepareNormalizedSnapshotPressure(value) {
        hexes.forEach((h) => {
          if (h.prepareNormalizedSnapshotPressure) h.prepareNormalizedSnapshotPressure(value);
          else h.prepareSnapshotPressure?.(expressionToMidi(value), expressionToMidi(value, MIDI_EXPRESSION_14_MAX));
        });
      },

      applyNormalizedSnapshotPressure(value) {
        this._compositeNormalizedPressure = value;
        this._compositeLastPressure = expressionToMidi(value);
        this._compositeLastPressure14 = expressionToMidi(value, MIDI_EXPRESSION_14_MAX);
        hexes.forEach((h) => {
          if (h.applyNormalizedSnapshotPressure) h.applyNormalizedSnapshotPressure(value);
          else if (h.applySnapshotPressure) h.applySnapshotPressure(this._compositeLastPressure, this._compositeLastPressure14);
          else h.aftertouch?.(this._compositeLastPressure, this._compositeLastPressure14);
        });
      },

      applyNormalizedSnapshotTimbre(value) {
        this._compositeNormalizedTimbre = value;
        this._compositeLastTimbre = expressionToMidi(value);
        this._compositeLastTimbre14 = expressionToMidi(value, MIDI_EXPRESSION_14_MAX);
        hexes.forEach((h) => {
          if (h.applyNormalizedSnapshotTimbre) h.applyNormalizedSnapshotTimbre(value);
          else if (h.polyTimbre) h.polyTimbre(this._compositeLastTimbre, this._compositeLastTimbre14);
          else h.cc74?.(this._compositeLastTimbre, this._compositeLastTimbre14);
        });
      },

      transitionSnapshotExpression(note, durationMs) {
        const canonical = note.expression ? readSnapshotExpression(note) : null;
        if (canonical) {
          this._compositeNormalizedPressure = canonical.pressure;
          this._compositeNormalizedTimbre = canonical.timbre;
          this._compositeLastPressure = expressionToMidi(canonical.pressure);
          this._compositeLastPressure14 = expressionToMidi(canonical.pressure, MIDI_EXPRESSION_14_MAX);
          this._compositeLastTimbre = expressionToMidi(canonical.timbre);
          this._compositeLastTimbre14 = expressionToMidi(canonical.timbre, MIDI_EXPRESSION_14_MAX);
        }
        const midiNote = snapshotMidiExpression(note);
        hexes.forEach((h) => {
          if (h.transitionSnapshotExpression?.(midiNote, durationMs) === true) {
            return;
          }
          const pressure = Number.isFinite(midiNote?.pressure14)
            ? Number(midiNote.pressure14) >> 7
            : midiNote?.pressure;
          if (pressure != null) {
            if (canonical && h.applyNormalizedSnapshotPressure) h.applyNormalizedSnapshotPressure(canonical.pressure);
            else if (h.applySnapshotPressure)
              h.applySnapshotPressure(pressure, midiNote?.pressure14 ?? null);
            else h.aftertouch?.(pressure, midiNote?.pressure14 ?? null);
          }
          if (h.isMtsOutput) return;
          const timbre = Number.isFinite(midiNote?.timbre14)
            ? Number(midiNote.timbre14) >> 7
            : midiNote?.timbre;
          if (timbre == null) return;
          if (canonical && h.applyNormalizedSnapshotTimbre) h.applyNormalizedSnapshotTimbre(canonical.timbre);
          else if (h.polyTimbre) h.polyTimbre(timbre, midiNote?.timbre14 ?? null);
          else h.cc74?.(timbre, midiNote?.timbre14 ?? null);
        });
        return true;
      },

      pressure(value, value14 = null) {
        this._compositeLastPressure = value;
        this._compositeLastPressure14 = value14;
        hexes.forEach((h) => h.pressure && h.pressure(value, value14));
      },

      cc74(value, value14 = null) {
        this._compositeNormalizedTimbre = null;
        this._compositeLastTimbre = value;
        this._compositeLastTimbre14 = value14;
        hexes.forEach((h) => h.cc74 && h.cc74(value, value14));
      },

      polyTimbre(value, value14 = null) {
        this._compositeNormalizedTimbre = null;
        this._compositeLastTimbre = value;
        this._compositeLastTimbre14 = value14;
        hexes.forEach((h) => {
          if (h.isMtsOutput) return;
          if (h.polyTimbre) h.polyTimbre(value, value14);
          else if (h.cc74) h.cc74(value, value14);
        });
      },

      mpeTimbre(value, value14 = null) {
        this._compositeLastTimbre = value;
        this._compositeLastTimbre14 = value14;
        hexes.forEach((h) => h.mpeTimbre && h.mpeTimbre(value, value14));
      },

      modwheel(value) {
        const state = expressionState(synths);
        if (value === state.modwheel) return;
        state.modwheel = value;
        hexes.forEach((h) => h.modwheel && h.modwheel(value));
      },

      expression(value) {
        const state = expressionState(synths);
        if (value === state.expression) return;
        state.expression = value;
        hexes.forEach((h) => h.expression && h.expression(value));
      },
    };
    return compositeHex;
  },

  // prepare() is called by app.jsx on preset change — forward and return a
  // combined promise so the caller can await all sub-synths being ready.
  prepare() {
    return Promise.all(synths.filter((s) => s.prepare).map((s) => s.prepare()));
  },

  ensureAwake() {
    const wakeables = synths.filter((s) => s.ensureAwake || s.prepare);
    return Promise.all(wakeables.map((s) => (s.ensureAwake ? s.ensureAwake() : s.prepare())));
  },

  async forceAudioRebuild() {
    // Rebuild the shared-context owner first. AudioWorklets such as the local
    // FluidSynth backend must then rebind to the replacement context. Keep
    // these phases ordered because recreating the context invalidates old nodes.
    const contextOwner = synths.filter((s) => s.family === "sample" && s.forceAudioRebuild);
    const rebuilders = synths.filter(
      (s) => s.forceAudioRebuild && !contextOwner.includes(s),
    );
    await Promise.all(contextOwner.map((s) => s.forceAudioRebuild()));
    await Promise.all(rebuilders.map((s) => s.forceAudioRebuild()));
    const wakeables = synths.filter(
      (s) => !rebuilders.includes(s) && !contextOwner.includes(s) && (s.ensureAwake || s.prepare),
    );
    await Promise.all(wakeables.map((s) => (s.ensureAwake ? s.ensureAwake() : s.prepare())));
  },

  currentTime() {
    for (const synth of synths) {
      const time = synth?.currentTime?.();
      if (Number.isFinite(time)) return time;
    }
    return null;
  },

  setVolume(value) {
    controlledSynths(synths, retiringSynths).forEach((s) => s.setVolume && s.setVolume(value));
  },

  setMod(value) {
    const state = expressionState(synths);
    if (value === state.onsetMod) return;
    state.onsetMod = value;
    synths.forEach((s) => s.setMod && s.setMod(value));
  },

  applyZoneModwheel(value) {
    // Keep note-level deduplication synchronized with the preceding raw
    // zone-wide update. A sequence voice may immediately restore its stored
    // timbre (or apply a shaped value), which must not be mistaken for an
    // already-sent duplicate.
    expressionState(synths).modwheel = value;
    synths.forEach((s) => s.applyZoneModwheel?.(value));
  },

  rememberControllerState(state) {
    synths.forEach((s) => s.rememberControllerState && s.rememberControllerState(state));
  },

  applyControllerState(state, options) {
    synths.forEach((s) => {
      if (!s.applyControllerState) return;
      if (options === undefined) s.applyControllerState(state);
      else s.applyControllerState(state, options);
    });
  },

  cancelSequenceEvents() {
    synths.forEach((s) => s.cancelSequenceEvents?.());
  },

  allSoundOff() {
    stopFadingOutputToggles();
    stopRetiredSuperSonicOutputs();
    controlledSynths(synths, retiringSynths).forEach((s) => s.allSoundOff && s.allSoundOff());
    retiringSynths.clear();
  },
});
};
