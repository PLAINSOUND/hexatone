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
  containsFamily(name) {
    return synths.some((s) => s?.family === name);
  },

  makeHex: (...args) => {
    const hexes = synths.map((s) => s.makeHex(...args));
    return {
      // Keys.js reads coords, cents, release from the hex object.
      // All synths receive the same coords/cents so any one is authoritative.
      coords: hexes[0].coords,
      cents: hexes[0].cents,
      release: false,
      note_played: hexes[0].note_played,
      velocity_played: hexes.find((h) => h.velocity_played != null)?.velocity_played,
      velocity: hexes.find((h) => h.velocity != null)?.velocity,
      _onVel: hexes.find((h) => h._onVel != null)?._onVel,
      standardWheelPassthroughOnly: hexes.every((h) => h.standardWheelPassthroughOnly),
      supportsMpeTimbre: hexes.some((h) => h.supportsMpeTimbre),
      // Expose stolen coords from any child synth that had to evict a voice.
      // Keys.js uses this to redraw the displaced hex.
      _stolenCoords: hexes.reduce((acc, h) => acc || h._stolenCoords || null, null),

      noteOn(timestamp) {
        hexes.forEach((h) => h.noteOn(timestamp));
      },

      noteOff(release_velocity, timestamp) {
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
        hexes.forEach((h) => h.aftertouch && h.aftertouch(value, value14));
      },

      applySnapshotPressure(value, value14 = null) {
        hexes.forEach((h) => {
          if (h.applySnapshotPressure) h.applySnapshotPressure(value, value14);
          else h.aftertouch?.(value, value14);
        });
      },

      prepareSnapshotPressure(value, value14 = null) {
        hexes.forEach((h) => h.prepareSnapshotPressure?.(value, value14));
      },

      pressure(value, value14 = null) {
        hexes.forEach((h) => h.pressure && h.pressure(value, value14));
      },

      cc74(value, value14 = null) {
        hexes.forEach((h) => h.cc74 && h.cc74(value, value14));
      },

      polyTimbre(value, value14 = null) {
        hexes.forEach((h) => {
          if (h.isMtsOutput) return;
          if (h.polyTimbre) h.polyTimbre(value, value14);
          else if (h.cc74) h.cc74(value, value14);
        });
      },

      mpeTimbre(value, value14 = null) {
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
