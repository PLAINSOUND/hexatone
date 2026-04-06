/**
 * composite_synth — fans out makeHex/noteOn/noteOff/retune to multiple synths
 * in parallel. Keys.js is unaware of how many outputs are active.
 *
 * Usage:
 *   const synth = create_composite_synth([sampleSynth, mtsSynth]);
 *   // then pass synth to Keyboard as normal
 */

export const create_composite_synth = (synths) => ({
  makeHex: (...args) => {
    const hexes = synths.map(s => s.makeHex(...args));
    return {
      // Keys.js reads coords, cents, release from the hex object.
      // All synths receive the same coords/cents so any one is authoritative.
      coords:      hexes[0].coords,
      cents:       hexes[0].cents,
      release:     false,
      note_played: hexes[0].note_played,
      // Expose stolen coords from any child synth that had to evict a voice.
      // Keys.js uses this to redraw the displaced hex.
      _stolenCoords: hexes.reduce((acc, h) => acc || h._stolenCoords || null, null),

      noteOn() {
        hexes.forEach(h => h.noteOn());
      },

      noteOff(release_velocity) {
        hexes.forEach(h => h.noteOff(release_velocity));
      },

      retune(newCents, bendOnly = false) {
        // Update our own cents so keys.js sustain logic stays in sync
        this.cents = newCents;
        hexes.forEach(h => h.retune && h.retune(newCents, bendOnly));
      },

      standardWheelRetune(newCents) {
        this.cents = newCents;
        hexes.forEach((h) => h.standardWheelRetune && h.standardWheelRetune(newCents));
      },

      aftertouch(value) {
        hexes.forEach(h => h.aftertouch && h.aftertouch(value));
      },

      pressure(value) {
        hexes.forEach(h => h.pressure && h.pressure(value));
      },

      cc74(value) {
        hexes.forEach(h => h.cc74 && h.cc74(value));
      },

      modwheel(value) {
        hexes.forEach(h => h.modwheel && h.modwheel(value));
      },

      expression(value) {
        hexes.forEach(h => h.expression && h.expression(value));
      },
    };
  },

  // prepare() is called by app.jsx on preset change — forward and return a
  // combined promise so the caller can await all sub-synths being ready.
  prepare() {
    return Promise.all(synths.filter(s => s.prepare).map(s => s.prepare()));
  },

  setVolume(value) {
    synths.forEach(s => s.setVolume && s.setVolume(value));
  },

  rememberControllerState(state) {
    synths.forEach(s => s.rememberControllerState && s.rememberControllerState(state));
  },

  applyControllerState(state) {
    synths.forEach(s => s.applyControllerState && s.applyControllerState(state));
  },

  allSoundOff() {
    synths.forEach(s => s.allSoundOff && s.allSoundOff());
  },
});
