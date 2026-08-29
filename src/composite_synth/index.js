/**
 * composite_synth — fans out makeHex/noteOn/noteOff/retune to multiple synths
 * in parallel. Keys.js is unaware of how many outputs are active.
 *
 * Usage:
 *   const synth = create_composite_synth([sampleSynth, mtsSynth]);
 *   // then pass synth to Keyboard as normal
 */

const expressionStateBySynths = new WeakMap();

function expressionState(synths) {
  let state = expressionStateBySynths.get(synths);
  if (!state) {
    state = { modwheel: null, expression: null, onsetMod: null };
    expressionStateBySynths.set(synths, state);
  }
  return state;
}

export const create_composite_synth = (synths) => ({
  family: "composite",
  families: synths.map((s) => s?.family).filter(Boolean),
  childSynths() {
    return [...synths];
  },
  containsFamily(name) {
    return synths.some((s) => s?.family === name);
  },

  makeHex: (...args) => {
    let hexSynths = [...synths];
    const hexes = hexSynths.map((s) => s.makeHex(...args));
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
      cents: firstHex.cents,
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
      // child voices in-place so a newly enabled output (or newly loaded sample)
      // joins currently sounding notes without restarting the sequencer.
      reconcileSynths(nextSynths, timestamp) {
        const desired = Array.isArray(nextSynths) ? nextSynths.filter(Boolean) : [];
        for (let index = hexSynths.length - 1; index >= 0; index -= 1) {
          if (desired.includes(hexSynths[index])) continue;
          if (this._compositeSounding) hexes[index]?.noteOff?.(0, timestamp);
          hexSynths.splice(index, 1);
          hexes.splice(index, 1);
        }

        for (const nextSynth of desired) {
          if (hexSynths.includes(nextSynth) || typeof nextSynth?.makeHex !== "function") continue;
          const nextArgs = [...args];
          nextArgs[1] = this.cents;
          nextArgs[11] = { ...(nextArgs[11] ?? {}), deferNoteOn: true };
          const child = nextSynth.makeHex(...nextArgs);
          if (Number.isFinite(Number(this.cents))) child.retune?.(Number(this.cents), true);
          hexSynths.push(nextSynth);
          hexes.push(child);
          if (!this._compositeSounding) continue;
          child.noteOn?.(timestamp);
          if (this._compositeLastPressure != null || this._compositeLastPressure14 != null) {
            const pressure = this._compositeLastPressure ?? this._compositeLastPressure14 >> 7;
            if (child.applySnapshotPressure)
              child.applySnapshotPressure(pressure, this._compositeLastPressure14);
            else child.aftertouch?.(pressure, this._compositeLastPressure14);
          }
          if (this._compositeLastTimbre != null || this._compositeLastTimbre14 != null) {
            const timbre = this._compositeLastTimbre ?? this._compositeLastTimbre14 >> 7;
            if (child.polyTimbre) child.polyTimbre(timbre, this._compositeLastTimbre14);
            else child.cc74?.(timbre, this._compositeLastTimbre14);
          }
        }
      },

      hasDisplacedVoice() {
        return hexes.some((h) => h.hasDisplacedVoice?.() === true);
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
        this._compositeSounding = true;
        this.release = false;
        hexes.forEach((h) => h.noteOn(timestamp));
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
        // wheel expression. Every child must receive the same target cents.
        this.cents = newCents;
        hexes.forEach((h) => {
          if (h.sequenceRetune) h.sequenceRetune(newCents);
          else if (h.retune) h.retune(newCents, true);
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
        this._compositeLastPressure = value;
        this._compositeLastPressure14 = value14;
        hexes.forEach((h) => h.aftertouch && h.aftertouch(value, value14));
      },

      applySnapshotPressure(value, value14 = null) {
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

      transitionSnapshotExpression(note, durationMs) {
        hexes.forEach((h) => {
          if (h.transitionSnapshotExpression?.(note, durationMs) === true) {
            return;
          }
          const pressure = Number.isFinite(note?.pressure14)
            ? Number(note.pressure14) >> 7
            : note?.pressure;
          if (pressure != null) {
            if (h.applySnapshotPressure)
              h.applySnapshotPressure(pressure, note?.pressure14 ?? null);
            else h.aftertouch?.(pressure, note?.pressure14 ?? null);
          }
          if (h.isMtsOutput) return;
          const timbre = Number.isFinite(note?.timbre14)
            ? Number(note.timbre14) >> 7
            : note?.timbre;
          if (timbre == null) return;
          if (h.polyTimbre) h.polyTimbre(timbre, note?.timbre14 ?? null);
          else h.cc74?.(timbre, note?.timbre14 ?? null);
        });
        return true;
      },

      pressure(value, value14 = null) {
        this._compositeLastPressure = value;
        this._compositeLastPressure14 = value14;
        hexes.forEach((h) => h.pressure && h.pressure(value, value14));
      },

      cc74(value, value14 = null) {
        this._compositeLastTimbre = value;
        this._compositeLastTimbre14 = value14;
        hexes.forEach((h) => h.cc74 && h.cc74(value, value14));
      },

      polyTimbre(value, value14 = null) {
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

  forceAudioRebuild() {
    const rebuildables = synths.filter((s) => s.forceAudioRebuild || s.prepare);
    return Promise.all(
      rebuildables.map((s) => (s.forceAudioRebuild ? s.forceAudioRebuild() : s.prepare())),
    );
  },

  currentTime() {
    for (const synth of synths) {
      const time = synth?.currentTime?.();
      if (Number.isFinite(time)) return time;
    }
    return null;
  },

  setVolume(value) {
    synths.forEach((s) => s.setVolume && s.setVolume(value));
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

  applyControllerState(state) {
    synths.forEach((s) => s.applyControllerState && s.applyControllerState(state));
  },

  allSoundOff() {
    synths.forEach((s) => s.allSoundOff && s.allSoundOff());
  },
});
