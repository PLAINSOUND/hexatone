import { calculateRotationMatrix, applyMatrixToPoint } from './matrix';
import Point from './point';
import Euclid from './euclidean';
import { rgb, HSVtoRGB, HSVtoRGB2, nameToHex, hex2rgb, rgb2hsv, getContrastYIQ, getContrastYIQ_2, rgbToHex } from './color_utils';
import { WebMidi } from 'webmidi';
import { midi_in } from '../settings/midi/midiin';
import { keymap, notes } from '../midi_synth';
import { mtsToMidiFloat, centsToMTS } from '../midi_synth';
import { scalaToCents } from '../settings/scale/parse-scale';

class Keys {
  constructor(canvas, settings, synth, typing, onLatchChange) {
    const gcd = Euclid(settings.rSteps, settings.drSteps);
    this.settings = {
      hexHeight: settings.hexSize * 2,
      hexVert: settings.hexSize * 3 / 2,
      hexWidth: Math.sqrt(3) * settings.hexSize,
      gcd, // calculates a array with 3 values: the GCD of the layout tiling (smallest step available); Bézout Coefficients to be applied to rSteps and drSteps to obtain GCD
      offset: getOffset(settings.reference_degree, settings.scale),
      centerHexOffset: computeCenterOffset(settings.rSteps, settings.drSteps, settings.center_degree || 0, gcd),
      ...settings,
    };
    this.synth = synth; // use built-in sounds or send MIDI out to an external synth
    this.typing = typing;
    this.onLatchChange = onLatchChange || null;
    this.bend = 0;
    this.state = {
      canvas,
      context: canvas.getContext('2d'),
      sustain: false,
      latch: false,
      sustainedNotes: [],
      sustainedCoords: new Set(), // coord strings of sustained notes, for redraw
      shiftHeld: false,
      isTuneDragging: false,
      pressedKeys: new Set(),
      activeHexObjects: [],
      isTouchDown: false,
      isMouseDown: false
    };
    // tuning_map_degree0: use explicit override if set, otherwise derive from the central MIDI note
    // (midiin_degree0 is stored as the note for degree 0; add center_degree to get the central note)
    const center_degree      = this.settings.center_degree  || 0;
    const central_midi_note  = (this.settings.midiin_degree0 != null ? this.settings.midiin_degree0 : 60) + center_degree;
    const tuning_map_degree0 = this.settings.tuning_map_degree0 != null ? this.settings.tuning_map_degree0 : central_midi_note;
    this.mts_tuning_map = mtsTuningMap(this.settings.sysex_type, this.settings.device_id, this.settings.tuning_map_number, tuning_map_degree0, this.settings.scale, this.settings.name, this.settings.equivInterval, this.settings.fundamental, this.settings.offset);
    
    // Set up resize handler
    window.addEventListener('resize', this.resizeHandler, false);
    window.addEventListener('orientationchange', this.resizeHandler, false);
    // visualViewport fires when browser chrome (toolbars) appear/disappear,
    // which window.resize misses — catches Brave's toolbar toggling.
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.resizeHandler, false);
    }

    //... and give it an initial call, which does the initial draw
    this.resizeHandler();

    // Set up keyboard, touch and mouse event handlers
    // Key listeners always on window — Shift sustain must work even when sidebar is closed.
    window.addEventListener("keydown", this.onKeyDown, false);
    window.addEventListener("keyup", this.onKeyUp, false);
    this.state.canvas.addEventListener("touchstart", this.handleTouch, false);
    this.state.canvas.addEventListener("touchend", this.handleTouch, false);
    this.state.canvas.addEventListener("touchmove", this.handleTouch, false);
    this.state.canvas.addEventListener("mousedown", this.mouseDown, false);
    window.addEventListener("mouseup", this.mouseUp, false);
   
   /* 
    console.log("midiin_device:", this.settings.midiin_device);
    console.log("midiin_channel:", this.settings.midiin_channel);
    console.log("midi_device:", this.settings.midi_device);
    console.log("midi_channel:", this.settings.midi_channel);
    console.log("midi_mapping:", this.settings.midi_mapping); */

    
    // sysex_auto comes from settings directly; sessionStorage read was redundant and error-prone

    if ((this.settings.sysex_auto) && (this.settings.midi_device !== "OFF") && (this.settings.midi_channel >= 0)) {
      this.midiout_data = WebMidi.getOutputById(this.settings.midi_device);
      this.mtsSendMap();
    };

    if ((this.settings.midiin_device !== "OFF") && (this.settings.midiin_channel >= 0)) { // get the MIDI noteons and noteoffs to play the internal sounds
    
      this.midiin_data = WebMidi.getInputById(this.settings.midiin_device);

      if (!this.midiin_data) {
      } else { // this.midiin_data exists

      this.midiin_data.addListener("noteon", e => {
        //console.log("(input) note_on", e.message.channel, e.note.number, e.note.rawAttack);
        this.midinoteOn(e);
        notes.played.unshift(e.note.number + (128 * (e.message.channel - 1)));
       // console.log("notes.played after noteon:", notes.played);
      });

      this.midiin_data.addListener("noteoff", e => {
        //console.log("(input) note_off", e.message.channel, e.note.number, e.note.rawRelease);
        this.midinoteOff(e);
        let index = notes.played.lastIndexOf(e.note.number + (128 * (e.message.channel - 1))); // eliminate note_played from array of played notes when using internal synth
        if (index >= 0) {
          let first_half = [];
          first_half = notes.played.slice(0, index);
          let second_half = [];
          second_half = notes.played.slice(index);
          second_half.shift();
          let newarray = [];
          notes.played = newarray.concat(first_half, second_half);
        };
        /*
        if (notes.played.length > 0) {
          console.log("notes.played after noteoff", notes.played);
        } else {
          console.log("All notes released!");
        };
        */
      });

      this.midiin_data.addListener("keyaftertouch", e => {
        // Polyphonic aftertouch for built-in synth — find the matching active hex
        // by matching note + channel encoding, then ramp its gain smoothly
        const note_played = e.message.dataBytes[0] + (128 * (e.message.channel - 1));
        const hex = this.state.activeHexObjects.find(h => h.note_played === note_played);
        if (hex && hex.aftertouch) {
          hex.aftertouch(e.message.dataBytes[1]);
        }
      });

      this.midiin_data.addListener("controlchange", e => {
        if (e.message.dataBytes[0] == 64) {
          if (e.message.dataBytes[1] > 0) {
            this.sustainOn();
            //console.log("Controller 64 (Sustain Pedal) On");
          } else {
            this.sustainOff();
            //console.log("Controller 64 (Sustain Pedal) Off");
          };
        };

        if (e.message.dataBytes[0] == 123) {
          console.log("Controller 123 (All Notes Off) Received");
          console.log("Notes being played:", notes.played);
          this.allnotesOff();
        };

        if (e.message.dataBytes[0] == 121) {
          console.log("Controller 121 (All Controllers Off) Received");
          this.sustainOff();
        };        
      });

      if ((this.settings.midi_device !== "OFF") && (this.settings.midi_channel >= 0)) { // forward other MIDI data through to output
        this.midiout_data = WebMidi.getOutputById(this.settings.midi_device);
        
        if (this.settings.midi_mapping == "multichannel") { // in multichannel output send controlchange and channel pressure on selected channel only

          this.midiin_data.addListener("controlchange", e => {
            //console.log("Control Change (thru on all channels)", e.message.dataBytes[0], e.message.dataBytes[1]);
            this.midiout_data.sendControlChange(e.message.dataBytes[0], e.message.dataBytes[1], { channels: (this.settings.midi_channel + 1) });
          });

          this.midiin_data.addListener("channelaftertouch", e => {
            //console.log("Channel Pressure (thru on all channels) ", e.message.dataBytes[0]);
            this.midiout_data.sendChannelAftertouch(e.message.dataBytes[0], { channels: (this.settings.midi_channel + 1), rawValue: true});
          });

          this.midiin_data.addListener("pitchbend", e => { // TODO decide what multichannel pitchbend should do, for now on output channel only
            //console.log("Pitch Bend (thru)", e.message.dataBytes[0], e.message.dataBytes[1]);
            this.midiout_data.sendPitchBend((2.0 * ((e.message.dataBytes[0] / 16384.0) + (e.message.dataBytes[1] / 128.0))) - 1.0, { channels: (this.settings.midi_channel + 1) });
          });

          this.midiin_data.addListener("keyaftertouch", e => {
            let note = e.message.dataBytes[0] + (128 * (e.message.channel - 1)); // finds index of stored MTS data
            this.midiout_data.sendKeyAftertouch(keymap[note][0], e.message.dataBytes[1], { channels: (keymap[note][6] + 1), rawValue: true });
            //console.log("Key Pressure MultiCh", keymap[note][6] + 1, keymap[note][0], e.message.dataBytes[1]);
          });
            
        } else { // in single-channel output send controlchange and channel pressure only on selected channel

          this.midiin_data.addListener("controlchange", e => {
            //console.log("(thru) Control Change", this.settings.midi_channel + 1, e.message.dataBytes[0], e.message.dataBytes[1]);
            this.midiout_data.sendControlChange(e.message.dataBytes[0], e.message.dataBytes[1], { channels: (this.settings.midi_channel + 1) });
          });

          this.midiin_data.addListener("channelaftertouch", e => {
            //console.log("Channel Aftertouch (thru)", this.settings.midi_channel + 1, e.message.dataBytes[0]);
            this.midiout_data.sendChannelAftertouch(e.message.dataBytes[0], { channels: (this.settings.midi_channel + 1), rawValue: true });
          });

          if (this.settings.midi_mapping == "sequential") { // handling of sequential and mts output of key pressure

            this.midiin_data.addListener("pitchbend", e => { // TODO decide what multichannel pitchbend should do
              //console.log("Pitch Bend (thru)", e.message.dataBytes[0], e.message.dataBytes[1]);
              this.midiout_data.sendPitchBend((2.0 * ((e.message.dataBytes[0] / 16384.0) + (e.message.dataBytes[1] / 128.0))) - 1.0, { channels: (this.settings.midi_channel + 1) });
            });
            
            this.midiin_data.addListener("keyaftertouch", e => {              
              let channel_offset = e.message.channel - 1 - this.settings.midiin_channel; // calculates the difference between selected central MIDI Input channel and the actual channel being sent and uses this to offset by up to +/- 4 equaves
              channel_offset = ((channel_offset + 20) % 8) - 4;
              let note_offset = channel_offset * this.settings.equivSteps;
              let note = (e.message.dataBytes[0] + note_offset + (16 * 128)) % 128; // matches note cycling in midi_synth/index,js
              this.midiout_data.sendKeyAftertouch(note, e.message.dataBytes[1], { channels: (this.settings.midi_channel + 1), rawValue: true });
              //console.log("Key Pressure Seq", this.settings.midi_channel + 1, note, e.message.dataBytes[1]);
            }); 

          } else if ((this.settings.midi_mapping == "MTS1") || (this.settings.midi_mapping == "MTS2")) {

            this.midiin_data.addListener("keyaftertouch", e => {                
              let note = e.message.dataBytes[0] + (128 * (e.message.channel - 1)); // finds index of stored MTS data
              //console.log("note", note);
              //console.log("keymap", keymap[note][0]);
              this.midiout_data.sendKeyAftertouch(keymap[note][0], e.message.dataBytes[1], { channels: (this.settings.midi_channel + 1), rawValue: true });
              //console.log("Key Pressure MTS", this.settings.midi_channel + 1, keymap[note][0], e.message.dataBytes[1]);
            });

            this.midiin_data.addListener("pitchbend", e => { // TODO decide what multichannel pitchbend should do, for now on output channel only
              //console.log("Pitch Bend (thru)", e.message.dataBytes[0], e.message.dataBytes[1]);
              this.midiout_data.sendPitchBend((2.0 * ((e.message.dataBytes[0] / 16384.0) + (e.message.dataBytes[1] / 128.0))) - 1.0, { channels: (this.settings.midi_channel + 1) });
            });

            /*
            this.midiin_data.addListener("pitchbend", e => { // pitchbend is processed as MTS real-time data allowing every note a different bend radius
              this.mtsBend(e);       
            });
            */
          };
        };
      }; // end else (midiin_data exists)
      }; // end if midiin_data guard
    };
  }; // end of constructor

  /**
   * Live-retune a single scale degree while notes are held.
   * Updates this.settings.scale[degree] and redraws that degree's hexes.
   * Also calls hex.retune(newCents) on any currently-sounding or sustained notes
   * at that degree — including notes held under the Shift sustain pedal.
   * @param {number} degree   - reducedSteps index (1..equivSteps-1; 0 = tonic, fixed)
   * @param {number} newCents - new value in cents
   */
  updateScaleDegree = (degree, newCents) => {
    if (!this.settings.scale || degree < 0) return;

    // The equave is stored as equivInterval, not in the scale array.
    // TuneCell passes degree === scale.length for the equave row.
    if (degree === this.settings.scale.length) {
      const oldEquiv = this.settings.equivInterval;
      const equivDelta = newCents - oldEquiv;
      this.settings.equivInterval = newCents;
      // Each hex is at octs * equivInterval + scale[reducedSteps],
      // so changing equivInterval by equivDelta shifts it by octs * equivDelta.
      for (const hex of this.state.activeHexObjects) {
        const [, , , octs] = this.hexCoordsToCents(hex.coords);
        if (hex.retune) hex.retune(hex.cents + octs * equivDelta);
      }
      for (const [hex] of this.state.sustainedNotes) {
        const [, , , octs] = this.hexCoordsToCents(hex.coords);
        if (hex.retune) hex.retune(hex.cents + octs * equivDelta);
      }
      this.drawGrid();
      return;
    }

    if (degree >= this.settings.scale.length) return;
    // Compute delta before mutating scale, so we can shift each hex by the same amount
    // regardless of which octave it was played in.
    const oldCents = this.settings.scale[degree];
    const delta = newCents - oldCents;
    this.settings.scale[degree] = newCents;
    for (const hex of this.state.activeHexObjects) {
      const [, reducedSteps] = this.hexCoordsToCents(hex.coords);
      if (reducedSteps === degree && hex.retune) hex.retune(hex.cents + delta);
    }
    for (const [hex] of this.state.sustainedNotes) {
      const [, reducedSteps] = this.hexCoordsToCents(hex.coords);
      if (reducedSteps === degree && hex.retune) hex.retune(hex.cents + delta);
    }
    this.drawGrid();
  };

  /**
   * Called by TuneCell on pointer-down/up so Shift-sustain keyup guard
   * knows a sidebar drag is in progress and won't drop the sustain.
   */
  setTuneDragging = (active) => {
    this.state.isTuneDragging = active;
  };

  /**
   * Imperatively update colors and redraw without reconstructing the Keys instance.
   * Called by keyboard/index.js when color settings change.
   */
  updateColors = (colors) => {
    this.settings.note_colors = colors.note_colors;
    this.settings.spectrum_colors = colors.spectrum_colors;
    this.settings.fundamental_color = colors.fundamental_color;
    this.drawGrid();
  };

  deconstruct = () => {
    for (let hex of this.state.activeHexObjects) {
      hex.noteOff();
    };
    for (let hex of this.state.sustainedNotes) {
      hex.noteOff();
    };

    window.removeEventListener('resize', this.resizeHandler, false);
    window.removeEventListener('orientationchange', this.resizeHandler, false);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.resizeHandler, false);
    }

    window.removeEventListener("keydown", this.onKeyDown, false);
    window.removeEventListener("keyup", this.onKeyUp, false);
    this.state.canvas.removeEventListener("touchstart", this.handleTouch, false);
    this.state.canvas.removeEventListener("touchend", this.handleTouch, false);
    this.state.canvas.removeEventListener("touchmove", this.handleTouch, false);
    this.state.canvas.removeEventListener("mousedown", this.mouseDown, false);
    window.removeEventListener("mouseup", this.mouseUp, false);
    this.state.canvas.removeEventListener("mousemove", this.mouseActive, false);

    if (this.midiin_data) {
      this.midiin_data.removeListener("noteon");
      this.midiin_data.removeListener("noteoff");
      this.midiin_data.removeListener("keyaftertouch");
      this.midiin_data.removeListener("controlchange");
      this.midiin_data.removeListener("channelaftertouch");
      this.midiin_data.removeListener("pitchbend");
      this.midiin_data = null;
    };
    
    if (this.midiout_data) {
      this.midiout_data = null;
      };
  };

  mtsSendMap = () => { // send the tuning map
    if (!this.midiout_data) return;
    const sysex_type = parseInt(this.settings.sysex_type);

    if (sysex_type === 127) {
      // Real-time single-note tuning change: one message per note.
      // Each entry is [127, device_id, 8, 2, map#, 1, note, mts0, mts1, mts2].
      // sendSysex(manufacturer, data) prepends F0+manufacturer and appends F7.
      // We copy each array to avoid mutating the stored tuning map.
      for (let i = 0; i < 128; i++) {
        const msg = [...this.mts_tuning_map[i]];
        const manufacturer = msg.shift(); // 127 = universal real-time
        this.midiout_data.sendSysex([manufacturer], msg);
      };
    } else if (sysex_type === 126) {
      // Non-real-time bulk tuning dump: single message for all 128 notes.
      const msg = [...this.mts_tuning_map];
      const manufacturer = msg.shift(); // 126 = universal non-real-time
      this.midiout_data.sendSysex([manufacturer], msg);
    };
  };

  /*
  mtsBend = (e) => { // generates scale specific one scale degree last note played pitch bend
    let bend = 0;
    //console.log("Pitchbend: ", e.message.dataBytes[0], e.message.dataBytes[1]);
    bend = ((e.message.dataBytes[0] + (128 * e.message.dataBytes[1])) - 8192);
    let last_noteon = notes.played[notes.played.length - 1];
    if (bend < 0) {
      bend = bend / 8192; // set bend down between 0 and -1
    } else {
      bend = bend / 8191; // set bend up between 0 and 1
    };

    this.bend = bend;
    //console.log("MTSbend: ", bend);

    if (last_noteon) {
      //console.log("last_noteon", last_noteon);
      let bend_up = keymap[last_noteon][5]; // get data from most recently played note
      let bend_down = keymap[last_noteon][4];
      let mts_current = [keymap[last_noteon][0], keymap[last_noteon][1], keymap[last_noteon][2], keymap[last_noteon][3]];
      //console.log("keymap[current]", keymap[last_noteon]);

      if (bend < 0) {
        bend = bend_down * bend; // set bend down between 0 and -1
      } else {
        bend = bend_up * bend; // set bend up between 0 and 1
      };

      if ((this.settings.midi_mapping == "MTS1") || (this.settings.midi_mapping == "MTS2")) {
        //console.log("Keys_MTSBend", bend);
        let mts_bend = centsToMTS(mtsToMidiFloat([mts_current[1], mts_current[2], mts_current[3]]), bend);
        //console.log("mtsBend-message", mts_current[0], mts_bend[0], mts_bend[1], mts_bend[2]);
     
        if ((this.settings.midi_device !== "OFF") && (this.settings.midi_channel >= 0)) { // forward other MIDI data through to output
          this.midiout_data = WebMidi.getOutputById(this.settings.midi_device);
          this.midiout_data.sendSysex([127], [127, 8, 2, 0, 1, mts_current[0], mts_bend[0], mts_bend[1], mts_bend[2]]); // generates single note pitchbend
        };
      };
    };
  };
  */

  midinoteOn = (e) => { // TODO make the display calculation relative to angle of hex, and write a separate function
    let bend = 0;
    if (this.bend) {
      bend = this.bend;
    };
    //console.log("note_on-bend", bend);
    let steps = e.note.number - this.settings.midiin_degree0;
    let channel_offset = e.message.channel - 1 - this.settings.midiin_channel;
    channel_offset = ((channel_offset + 20) % 8) - 4;
    //console.log("transposition (in equaves)", channel_offset);
    let steps_offset = channel_offset * this.settings.equivSteps;
    steps = steps + steps_offset;
    let note_played = e.note.number + (128 * (e.message.channel - 1)); // allows note and channel to be encoded and recovered for MTS key pressure
    let velocity_played = e.note.rawAttack;

    let rSteps_count = Math.round(steps / this.settings.rSteps); // how many steps to the right to get near the played note
    let rSteps_to_steps = this.settings.rSteps * rSteps_count;
    let drSteps_count = Math.round((steps - rSteps_to_steps) / this.settings.drSteps);
    let drSteps_to_steps = this.settings.drSteps * drSteps_count;
    let gcdSteps_count = Math.floor((steps - rSteps_to_steps - drSteps_to_steps) / this.settings.gcd[0]);    
    let gcdSteps_to_steps = gcdSteps_count * this.settings.gcd[0];
    let remainder = steps - rSteps_to_steps - drSteps_to_steps - gcdSteps_to_steps;
    if (remainder == 0) {
      let coords = new Point(rSteps_count + (gcdSteps_count * this.settings.gcd[1]), drSteps_count + (gcdSteps_count * this.settings.gcd[2]));
      let hex = this.hexOn(coords, note_played, velocity_played, bend);
      this.state.activeHexObjects.push(hex);
    };
  };

  midinoteOff = (e) => {
    let steps = e.note.number - this.settings.midiin_degree0;
    let channel_offset = e.message.channel - 1 - this.settings.midiin_channel;
    channel_offset = ((channel_offset + 20) % 8) - 4;
    let steps_offset = channel_offset * this.settings.equivSteps;
    steps = steps + steps_offset;

    let rSteps_count = Math.round(steps / this.settings.rSteps); // how many steps to the right to get near the played note, as before
    let rSteps_to_steps = this.settings.rSteps * rSteps_count;
    let drSteps_count = Math.round((steps - rSteps_to_steps) / this.settings.drSteps);
    let drSteps_to_steps = this.settings.drSteps * drSteps_count;
    let gcdSteps_count = Math.floor((steps - rSteps_to_steps - drSteps_to_steps) / this.settings.gcd[0]);
    let gcdSteps_to_steps = gcdSteps_count * this.settings.gcd[0];
    let remainder = steps - rSteps_to_steps - drSteps_to_steps - gcdSteps_to_steps;
    if (remainder == 0) {
      let coords = new Point(rSteps_count + (gcdSteps_count * this.settings.gcd[1]), drSteps_count + (gcdSteps_count * this.settings.gcd[2]));
      if (!this.state.sustain) this.hexOff(coords);
      let hexIndex = this.state.activeHexObjects.findIndex(function (hex) {
        return coords.equals(hex.coords);
      });
      if (hexIndex != -1) {
        this.noteOff(this.state.activeHexObjects[hexIndex], e.note.rawRelease);
        this.state.activeHexObjects.splice(hexIndex, 1);
      };
    };
  };

  allnotesOff = () => {
    if (notes.played.length > 0) {
      for (let i = 0; i < notes.played.length; i++) {
        let steps = (notes.played[i] % 128) - this.settings.midiin_degree0;
        let channel_offset = Math.floor((notes.played[i] / 128)) - this.settings.midiin_channel;
        channel_offset = ((channel_offset + 20) % 8) - 4;
        let steps_offset = channel_offset * this.settings.equivSteps;
        steps = steps + steps_offset;

        let rSteps_count = Math.round(steps / this.settings.rSteps); // how many steps to the right to get near the played note, as before
        let rSteps_to_steps = this.settings.rSteps * rSteps_count;
        let drSteps_count = Math.round((steps - rSteps_to_steps) / this.settings.drSteps);
        let drSteps_to_steps = this.settings.drSteps * drSteps_count;
        let gcdSteps_count = Math.floor((steps - rSteps_to_steps - drSteps_to_steps) / this.settings.gcd[0]);
        let gcdSteps_to_steps = gcdSteps_count * this.settings.gcd[0];
        let remainder = steps - rSteps_to_steps - drSteps_to_steps - gcdSteps_to_steps;
        if (remainder == 0) {
          let coords = new Point(rSteps_count + (gcdSteps_count * this.settings.gcd[1]), drSteps_count + (gcdSteps_count * this.settings.gcd[2]));
          if (!this.state.sustain) this.hexOff(coords);
          let hexIndex = this.state.activeHexObjects.findIndex(function (hex) {
            return coords.equals(hex.coords);
          });
          if (hexIndex != -1) {
            this.noteOff(this.state.activeHexObjects[hexIndex], 64);
            this.state.activeHexObjects.splice(hexIndex, 1);
          };
        };
      };
      notes.played = [];
      console.log("All notes released!");
    } else {
      console.log("No held notes to be released.")
    };
  };
  
  hexOn(coords, note_played, velocity_played, bend) {
    if (!bend) {
      bend = 0;
    };
    if (!velocity_played) {
      velocity_played = this.settings.midi_velocity;
    };
    if (!velocity_played) {
      velocity_played = 72;
    };
    const [cents, pressed_interval, steps, equaves, equivSteps, cents_prev, cents_next] = this.hexCoordsToCents(coords);
    const [color, text_color] = this.centsToColor(cents, true, pressed_interval);
    this.drawHex(coords, color, text_color);
    let offset = this.settings.offset[1];
    const hex = this.synth.makeHex(coords, cents, velocity_played, steps, equaves, equivSteps, cents_prev, cents_next, note_played, bend, offset);
    hex.noteOn();
    return hex;
  };

  hexOff(coords) {
    const [cents, pressed_interval] = this.hexCoordsToCents(coords);
    const key = coords.x + ',' + coords.y;
    const isSustained = this.state.sustainedCoords.has(key);
    const [color, text_color] = this.centsToColor(cents, isSustained, pressed_interval);
    this.drawHex(coords, color, text_color);
  };

  noteOff(hex, release_velocity) {
    if (this.state.sustain) {
      this.state.sustainedNotes.push([hex, release_velocity]);
      // Keep the hex visually lit while it's sustained
      const key = hex.coords.x + ',' + hex.coords.y;
      this.state.sustainedCoords.add(key);
      const [cents, pressed_interval] = this.hexCoordsToCents(hex.coords);
      const [color, text_color] = this.centsToColor(cents, true, pressed_interval);
      this.drawHex(hex.coords, color, text_color);
    } else {
      hex.noteOff(release_velocity);
    }
  };

  sustainOff(force = false) {
    if (this.state.latch && !force) return; // latch holds unless forced (e.g. Space)
    if (this.state.latch) {
      // Force-release also clears latch
      this.state.latch = false;
    }
    this.state.sustain = false;
    const notesToRelease = this.state.sustainedNotes;
    this.state.sustainedNotes = [];
    this.state.sustainedCoords.clear();
    for (let note = 0; note < notesToRelease.length; note++) {
      const hex = notesToRelease[note][0];
      const [cents, pressed_interval] = this.hexCoordsToCents(hex.coords);
      const [color, text_color] = this.centsToColor(cents, false, pressed_interval);
      this.drawHex(hex.coords, color, text_color);
      hex.noteOff(notesToRelease[note][1]);
    }
    // Fire React callback AFTER all visual/audio cleanup — Preact may flush
    // synchronously and trigger a re-render that redraws hexes mid-cleanup.
    if (this.onLatchChange) this.onLatchChange(false);
    // tempAlert('Sustain Off', 900);
  };

  sustainOn() {
    this.state.sustain = true;
    // tempAlert('Sustain On', 900);
  }

  latchToggle() {
    if (this.state.latch) {
      // Second press: release everything and turn latch off
      this.state.latch = false;
      this.sustainOff(true); // clears sustainedCoords, redraws, then fires onLatchChange
    } else {
      // First press: engage latch — sustain current and all subsequent notes
      this.state.latch = true;
      this.state.sustain = true;
      if (this.onLatchChange) this.onLatchChange(true);
      // Capture any currently active notes into sustainedNotes
      for (const hex of this.state.activeHexObjects) {
        if (!this.state.sustainedNotes.find(([h]) => h === hex)) {
          this.state.sustainedNotes.push([hex, 0]);
          this.state.sustainedCoords.add(hex.coords.x + ',' + hex.coords.y);
        }
      }
    }
  }

  /**************** Event Handlers ****************/

  motionScan = () => {
    const { x1, x2, y1, y2, z1, z2, lastShakeCount, lastShakeCheck } = this.state.shake;
    let change = Math.abs(x1 - x2 + y1 - y2 + z1 - z2);

    if (change > this.state.sensitivity) {
      if (lastShakeCheck - lastShakeCount >= 3) {
        this.state.shake.lastShakeCount = this.state.shake.lastShakeCheck;
        if (this.state.sustain == true) {
          this.sustainOff();
        } else {
          this.sustainOn();
        }
      }
    };

    // Update new position
    this.state.shake.x2 = x1;
    this.state.shake.y2 = y1;
    this.state.shake.z2 = z1;
  };

  resizeHandler = () => {
    // visualViewport gives the actual visible area after browser chrome
    // (Brave/Edge toolbar, iOS tab bar, safe areas) is subtracted.
    // Canvas is position:fixed top:0 left:0 — we set its size to exactly
    // the visible viewport, and offset by visualViewport.offsetLeft/Top
    // to handle any panning the browser may apply.
    const newWidth  = window.innerWidth;
    const newHeight = window.innerHeight;

    this.state.canvas.style.width  = newWidth  + 'px';
    this.state.canvas.style.height = newHeight + 'px';
    this.state.canvas.style.left   = '0px';
    this.state.canvas.style.top    = '0px';
    this.state.canvas.style.marginLeft = '';
    this.state.canvas.style.marginTop  = '';

    this.state.canvas.width  = newWidth;
    this.state.canvas.height = newHeight;

    // Find new centerpoint

    let centerX = newWidth / 2;
    let centerY = newHeight / 2;
    this.state.centerpoint = new Point(centerX, centerY);

    // Rotate about it

    if (this.state.rotationMatrix) {
      this.state.context.restore();
    }
    this.state.context.save();

    this.state.rotationMatrix = calculateRotationMatrix(-this.settings.rotation, this.state.centerpoint);

    // I don't know why these need to be the opposite sign of each other.
    let m = calculateRotationMatrix(this.settings.rotation, this.state.centerpoint);
    this.state.context.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);

    // Redraw Grid

    this.drawGrid();
  };

  inputIsFocused = () => {
    const tag = document.activeElement && document.activeElement.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  };

  onKeyDown = (e) => {
    // Shift: momentary sustain. Track shiftHeld separately because clicking
    // the canvas while Shift is held fires a spurious keyup immediately,
    // which would drop the sustain before mouse-up.
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) {
      this.state.shiftHeld = true;
      this.latchToggle();
      return;
    }

    // All other keys: only active when sidebar is closed (typing=false means sidebar closed).
    if (this.typing) return;
    if (this.inputIsFocused()) return;

    e.preventDefault();
    if (e.repeat) {
      return;
    } else if (e.code === 'Space') {
      this.sustainOn();
    } else if (!this.state.isMouseDown && !this.state.isTouchDown
      && (e.code in this.settings.keyCodeToCoords)
      && !this.state.pressedKeys.has(e.code)) {
      this.state.pressedKeys.add(e.code);
      const kbOffset = this.settings.centerHexOffset;
      const kbRaw = this.settings.keyCodeToCoords[e.code];
      let coords = new Point(kbRaw.x + kbOffset.x, kbRaw.y + kbOffset.y);
      let hex = this.hexOn(coords);
      this.state.activeHexObjects.push(hex);
    }
  };

  onKeyUp = (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.state.shiftHeld = false;
      // Shift is now latch (toggle) — no release action on key-up
      return;
    }

    if (this.inputIsFocused()) return;

    if (e.code === 'Space') {
      this.sustainOff(true); // force-release overrides latch
    } else if (!this.state.isMouseDown && !this.state.isTouchDown
      && (e.code in this.settings.keyCodeToCoords)) {
      if (this.state.pressedKeys.has(e.code)) {
        this.state.pressedKeys.delete(e.code);
        const kbOffset = this.settings.centerHexOffset;
        const kbRaw = this.settings.keyCodeToCoords[e.code];
        let coords = new Point(kbRaw.x + kbOffset.x, kbRaw.y + kbOffset.y);
        if (!this.state.sustain) this.hexOff(coords);
        let hexIndex = this.state.activeHexObjects.findIndex(function (hex) {
          return coords.equals(hex.coords);
        });
        if (hexIndex != -1) {
          this.noteOff(this.state.activeHexObjects[hexIndex]);
          this.state.activeHexObjects.splice(hexIndex, 1);
        }
      }
    }
  };

  mouseUp = (e) => {
    this.state.isMouseDown = false;

    if (this.state.pressedKeys.size != 0 || this.state.isTouchDown) {
      return;
    }
    this.state.canvas.removeEventListener("mousemove", this.mouseActive);
    if (this.state.activeHexObjects.length > 0) {
      const hex = this.state.activeHexObjects[0];
      if (!this.state.sustain) this.hexOff(hex.coords);
      this.noteOff(hex, 0);
      this.state.activeHexObjects.pop();
    }
    // If Shift was held but its keyup already fired while the mouse was down
    // (spurious keyup), release sustain now that the mouse is up too.
    // But don't release if a tune-handle drag is in progress in the sidebar.
    if (!this.state.shiftHeld && this.state.sustain && !this.state.isTuneDragging) {
      this.sustainOff();
    }
  };

  mouseDown = (e) => {
    if (this.state.pressedKeys.size != 0 || this.state.isTouchDown) {
      return;
    }
    this.state.isMouseDown = true;
    this.state.canvas.addEventListener("mousemove", this.mouseActive, false);
    this.mouseActive(e);
  };

  mouseActive = (e) => {
    let coords = this.getPointerPosition(e);
    coords = this.getHexCoordsAt(coords);

    if (this.state.activeHexObjects.length == 0) {
      this.state.activeHexObjects[0] = this.hexOn(coords);
    } else {
      let first = this.state.activeHexObjects[0];
      if (!(coords.equals(first.coords))) {
        this.hexOff(first.coords);
        this.noteOff(first);
        this.state.activeHexObjects[0] = this.hexOn(coords);
      }
    }
  };

  getPointerPosition(e) {
    // getBoundingClientRect gives the actual rendered position in viewport
    // coordinates, consistent with clientX/clientY on all browsers and
    // correctly accounts for CSS transforms, margins, and safe-area insets.
    const rect = e.currentTarget.getBoundingClientRect();
    return new Point(e.clientX - rect.left, e.clientY - rect.top);
  };

  getPosition(element) {
    // Legacy offsetParent walk — kept for reference but no longer used.
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  };

  handleTouch = (e) => {
    e.preventDefault();
    if (this.state.pressedKeys.size != 0 || this.state.isMouseDown) {
      this.state.isTouchDown = false;
      return;
    }
    this.state.isTouchDown = e.targetTouches.length != 0;

    for (let i = 0; i < this.state.activeHexObjects.length; i++) {
      this.state.activeHexObjects[i].release = true;
    };

    for (let i = 0; i < e.targetTouches.length; i++) {
      const rect = this.state.canvas.getBoundingClientRect();
      let coords = this.getHexCoordsAt(new Point(
        e.targetTouches[i].clientX - rect.left,
        e.targetTouches[i].clientY - rect.top));
      let found = false;

      for (let j = 0; j < this.state.activeHexObjects.length; j++) {
        if (coords.equals(this.state.activeHexObjects[j].coords)) {
          this.state.activeHexObjects[j].release = false;
          found = true;
        }
      }
      if (!(found)) {
        let newHex = this.hexOn(coords);
        this.state.activeHexObjects.push(newHex);
      }
    };

    for (let i = this.state.activeHexObjects.length - 1; i >= 0; i--) {
      if (this.state.activeHexObjects[i].release) {
        if (!this.state.sustain) this.hexOff(this.state.activeHexObjects[i].coords);
        this.noteOff(this.state.activeHexObjects[i], 0);
        this.state.activeHexObjects.splice(i, 1);
      }
    }
  };

  /**************** Rendering ****************/

  drawGrid() {
    let max = (this.state.centerpoint.x > this.state.centerpoint.y) ?
        this.state.centerpoint.x/ this.settings.hexSize :
        this.state.centerpoint.y/ this.settings.hexSize;
    max = Math.floor(max);
    const ox = this.settings.centerHexOffset.x;
    const oy = this.settings.centerHexOffset.y;
    for (let r = -max + ox; r < max + ox; r++) {
      for (let dr = -max + oy; dr < max + oy; dr++) {
        let coords = new Point(r, dr);
        this.hexOff(coords);
      }
    }
  };

  hexCoordsToScreen(hex) { /* Point */
    const ox = this.settings.centerHexOffset.x;
    const oy = this.settings.centerHexOffset.y;
    let screenX = this.state.centerpoint.x + (hex.x - ox) * this.settings.hexWidth + (hex.y - oy) * this.settings.hexWidth / 2;
    let screenY = this.state.centerpoint.y + (hex.y - oy) * this.settings.hexVert;
    return (new Point(screenX, screenY));
  };

  drawHex(p, c, current_text_color) { /* Point, color */
    let context = this.state.context;
    let hexCenter = this.hexCoordsToScreen(p);

    // Calculate hex vertices

    let x = [];
    let y = [];
    for (let i = 0; i < 6; i++) {
      let angle = 2 * Math.PI / 6 * (i + 0.5);
      x[i] = hexCenter.x + this.settings.hexSize * Math.cos(angle);
      y[i] = hexCenter.y + this.settings.hexSize * Math.sin(angle);
    };

    // Draw filled hex

    context.beginPath();
    context.moveTo(x[0], y[0]);
    for (let i = 1; i < 6; i++) {
      context.lineTo(x[i], y[i]);
    }
    context.closePath();
    context.fillStyle = c;
    context.fill();

    // Save context and create a hex shaped clip

    context.save();
    context.beginPath();
    context.moveTo(x[0], y[0]);
    for (let i = 1; i < 6; i++) {
      context.lineTo(x[i], y[i]);
    }
    context.closePath();
    context.clip();

    // Calculate hex vertices outside clipped path

    let x2 = [];
    let y2 = [];
    for (let i = 0; i < 6; i++) {
      let angle = 2 * Math.PI / 6 * (i + 0.5);
      // TODO hexSize should already be a number
      x2[i] = hexCenter.x + (parseFloat(this.settings.hexSize) + 3) * Math.cos(angle);
      y2[i] = hexCenter.y + (parseFloat(this.settings.hexSize) + 3) * Math.sin(angle);
    };

    // Draw shadowed stroke outside clip to create pseudo-3d effect

    context.beginPath();
    context.moveTo(x2[0], y2[0]);
    for (let i = 1; i < 6; i++) {
      context.lineTo(x2[i], y2[i]);
    }
    context.closePath();
    context.strokeStyle = 'darkgray';
    context.lineWidth = 5;
    context.shadowBlur = 15;
    context.shadowColor = 'black';
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
    context.stroke();
    context.restore();

    // Add a clean stroke around hex

    context.beginPath();
    context.moveTo(x[0], y[0]);
    for (let i = 1; i < 6; i++) {
      context.lineTo(x[i], y[i]);
    }
    context.closePath();
    context.lineWidth = 1;
    context.lineJoin = 'round';
    context.strokeStyle = 'slategray';
    context.stroke();

    // Add note name and equivalence interval multiple

    context.save();
    context.translate(hexCenter.x, hexCenter.y);
    context.rotate(-this.settings.rotation);
    // hexcoords = p and screenCoords = hexCenter

    context.fillStyle = getContrastYIQ(current_text_color);
    context.font = "29pt Plainsound Sans";
    context.textAlign = "center";
    context.textBaseline = "middle";

    let note = p.x * this.settings.rSteps + p.y * this.settings.drSteps;
    // TODO this should be parsed already
    let equivSteps = this.settings.scale.length;
    let equivMultiple = Math.floor(note / equivSteps);
    let reducedNote = note % equivSteps;
    if (reducedNote < 0) {
      reducedNote = equivSteps + reducedNote;
    };

    if (!this.settings.no_labels) {
      let name;
      if (this.settings.degree) {
        name = "" + reducedNote
      } else if (this.settings.note) {
        name = this.settings.note_names[reducedNote];
      } else if (this.settings.scala) {
        name = this.settings.scala_names[reducedNote];
      } else if (this.settings.cents) {
        name = Math.round((this.settings.scale[reducedNote] - this.settings.scale[this.settings.reference_degree] + 1200) % 1200).toString() + ".";
      };

      if (name) {
        context.save();
        let scaleFactor = name.length > 3 ? 3.58 / name.length : 1;
        scaleFactor *= this.settings.hexSize / 46;
        context.scale(scaleFactor, scaleFactor);
        context.fillText(name, 0, 0);
        context.restore();
      }

      let scaleFactor = this.settings.hexSize / 50;
      context.scale(scaleFactor, scaleFactor);
      context.translate(12, -30);
      context.fillStyle = getContrastYIQ_2(current_text_color);
      context.font = "14pt Plainsound Sans";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(equivMultiple, 0, 0);
    };

    context.restore();
  }

  centsToColor(cents, pressed, pressed_interval) {
    let returnColor;

    if (!this.settings.spectrum_colors) {
      if (typeof(this.settings.note_colors[pressed_interval]) === 'undefined') {
        returnColor = "#EDEDE4";
      } else {
        returnColor = this.settings.note_colors[pressed_interval];
      }

      let oldColor = returnColor;

      //convert color name to hex
      returnColor = nameToHex(returnColor);
      const current_text_color = returnColor;

      //convert the hex to rgb
      returnColor = hex2rgb(returnColor);

      //darken for pressed key
      if (pressed) {
        returnColor[0] += 200;
        returnColor[1] -= 200;
        returnColor[2] -= 200;
      }

      return [rgb(returnColor[0], returnColor[1], returnColor[2]), current_text_color];
    };

    let fcolor = hex2rgb("#" + this.settings.fundamental_color);
    fcolor = rgb2hsv(fcolor[0], fcolor[1], fcolor[2]);

    let h = fcolor.h / 360;
    let s = fcolor.s / 100;
    let v = fcolor.v / 100;
    //let h = 145/360; // green
    let reduced = (cents / 1200) % 1;
    if (reduced < 0) reduced += 1;
    h = (reduced + h) % 1;

    v = (pressed) ? v - (v / 2) : v;

    returnColor = HSVtoRGB(h, s, v);

    //setup text color
    let tcolor = HSVtoRGB2(h, s, v);
    const current_text_color = rgbToHex(tcolor.red, tcolor.green, tcolor.blue);
    return [returnColor, current_text_color];
  };

  roundTowardZero(val) {
    if (val < 0) {
    return Math.ceil(val);
    }
    return Math.floor(val);
  };

  hexCoordsToCents(coords) {
    let distance = (coords.x * this.settings.rSteps) + (coords.y * this.settings.drSteps);
    let octs = this.roundTowardZero(distance / this.settings.scale.length);
    let octs_prev = this.roundTowardZero((distance - 1) / this.settings.scale.length);
    let octs_next = this.roundTowardZero((distance + 1) / this.settings.scale.length);
    let reducedSteps = distance % this.settings.scale.length;
    let reducedSteps_prev = (distance - 1) % this.settings.scale.length;
    let reducedSteps_next = (distance + 1) % this.settings.scale.length;
    let equivSteps = this.settings.equivSteps;
    if (reducedSteps < 0) {
      reducedSteps += this.settings.scale.length;
      octs -= 1;
    };
    if (reducedSteps_prev < 0) {
      reducedSteps_prev += this.settings.scale.length;
      octs_prev -= 1;
    };
    if (reducedSteps_next < 0) {
      reducedSteps_next += this.settings.scale.length;
      octs_next -= 1;
    };
    let cents = octs * this.settings.equivInterval + this.settings.scale[reducedSteps];
    let cents_prev = octs_prev * this.settings.equivInterval + this.settings.scale[reducedSteps_prev];
    let cents_next = octs_next * this.settings.equivInterval + this.settings.scale[reducedSteps_next];
    return [cents, reducedSteps, distance, octs, equivSteps, cents_prev, cents_next];
  };

  getHexCoordsAt(coords) {
    coords = applyMatrixToPoint(this.state.rotationMatrix, coords);
    const ox = this.settings.centerHexOffset.x;
    const oy = this.settings.centerHexOffset.y;
    let x = coords.x - this.state.centerpoint.x;
    let y = coords.y - this.state.centerpoint.y;

    let q = (x * Math.sqrt(3) / 3 - y / 3) / this.settings.hexSize;
    let r = y * 2 / 3 / this.settings.hexSize;

    q = Math.round(q) + ox;
    r = Math.round(r) + oy;

    let guess = this.hexCoordsToScreen(new Point(q, r));

    // This gets an approximation; now check neighbours for minimum distance

    let minimum = 100000;
    let closestHex = new Point(q, r);
    for (let qOffset = -1; qOffset < 2; qOffset++) {
      for (let rOffset = -1; rOffset < 2; rOffset++) {
        let neighbour = new Point(q + qOffset, r + rOffset);
        let diff = this.hexCoordsToScreen(neighbour).minus(coords);
        let distance = diff.x * diff.x + diff.y * diff.y;
        if (distance < minimum) {
          minimum = distance;
          closestHex = neighbour;
        }
      }
    };

    return (closestHex);
  }
};

export default Keys;

function getOffset(reference_degree, scale) {
  let offset = [0, 1];
  if (reference_degree > 0) {
    offset[0] = scale[reference_degree];
    offset[1] = 2 ** (offset[0] / 1200); // offset ratio
  };
  //console.log("reference_degree:", reference_degree);
  //console.log("offset_value (cents, ratio):", offset);
  
  return offset;
};

/**
 * Compute the lattice offset that places `center_degree` at the screen centre.
 *
 * Returns a Point(r, dr) such that  r * rSteps + dr * drSteps === center_degree
 * and (r, dr) is the lattice solution closest to the origin (min r² + dr²).
 *
 * Uses the Bézout coefficients already computed by Euclid() — passed in as `gcd`
 * so the constructor can reuse the value it already computed.
 *
 * @param {number} rSteps
 * @param {number} drSteps
 * @param {number} degree   – target scale degree (0 → no shift)
 * @param {number[]} gcd    – result of Euclid(rSteps, drSteps): [g, bx, by]
 * @returns {Point}
 */
function computeCenterOffset(rSteps, drSteps, degree, gcd) {
  if (!degree) return new Point(0, 0);
  const [g, bx, by] = gcd;
  if (degree % g !== 0) return new Point(0, 0); // degree not reachable in this layout
  const signR  = rSteps  >= 0 ? 1 : -1;
  const signDR = drSteps >= 0 ? 1 : -1;
  const d  = degree / g;
  const r0  = d * bx * signR;
  const dr0 = d * by * signDR;
  // All solutions: (r0 + k*stepR, dr0 + k*stepDR) for integer k
  const stepR  =  drSteps / g;
  const stepDR = -rSteps  / g;
  // Pick k that minimises r² + dr²
  const denom = stepR * stepR + stepDR * stepDR;
  const k = denom ? Math.round(-(r0 * stepR + dr0 * stepDR) / denom) : 0;
  return new Point(r0 + k * stepR, dr0 + k * stepDR);
};

function mtsTuningMap(sysex_type, device_id, tuning_map_number, tuning_map_degree0, scale, name, equave, fundamental, offset) {
  //console.log("mts-input-scale:", scale)
  if (parseInt(sysex_type) === 127) {
    let header = [127, device_id, 8, 2, tuning_map_number, 1]; // sysex real-time single-note tuning change of tuning map, 128 notes
    let fundamental_cents = 1200 * Math.log2(fundamental / 440);
    let degree_0_cents = fundamental_cents - offset[0];
    let map_offset = degree_0_cents - (100 * (tuning_map_degree0 - 69));
    let mts_data = [];

    for (let i = 0; i < 128; i++) {
      mts_data[i] = [127, 127, 127];
      // target_cents: pitch of slot i in cents, measured from degree_0_cents.
      // tuning_map_degree0 is the MIDI note anchor; target_cents is the offset from it.
      // centsToMTS(note, bend): note = float MIDI anchor, bend = cents offset from that anchor.
      const target_cents = scale[((i - tuning_map_degree0) + (128 * scale.length)) % scale.length] + map_offset + (equave * (Math.floor(((i - tuning_map_degree0) + (128 * scale.length)) / scale.length) - 128));
      if (typeof target_cents === "number") {
        mts_data[i] = centsToMTS(tuning_map_degree0, target_cents);
        //console.log("mts_data[", i, "]:", mts_data[i]);
      };
    };

    /*let low = 0;
    //console.log("low", low, mts_data[low]);
    while ((mts_data[low][0] < 0) && (low < 127)) {
      low++;
    };
    if (mts_data[low][0] < 0) {
      mts_data[low] = [0, 0, 0];
    };
    for (let i = 0; i < low; i++) {
      if ((low < 128) && (mts_data[low][0] >= 0)) {
        mts_data[i] = mts_data[low]; // repeat the lowest possible note at the bottom end of the map as needed
      };        
    };

    let high = 127;
    while ( (mts_data[high][0] > 127) && (high > 0) ) {
      high--;
    };
    while ( ((mts_data[high][0] == 127) && (mts_data[high][1] == 127) && (mts_data[high][2] == 127)) && (high >= 0) ) { // no F7 F7 F7 messages !
      high--;
    };
    if (mts_data[high][0] > 127) {
      mts_data[high] = [127, 127, 126];
    };

    for (let i = 127; i > high; i--) {
      if ( (high >= 0) && (mts_data[high] <= 127) && (mts_data[high] != [127, 127, 127]) ) {
        mts_data[i] = mts_data[high]; // repeat the highest possible note at the top of the map as needed
      };
    };*/

    let sysex = [];
    for (let j = 0; j < 128; j++) {
      sysex[j] = [];
      for (let i = 0; i < header.length; i++) {
        sysex[j].push(header[i]);
      };
      sysex[j].push(j);
      sysex[j].push(mts_data[j][0]);
      sysex[j].push(mts_data[j][1]);
      sysex[j].push(mts_data[j][2]);
    };
    //console.log("mts-tuning_map", sysex);
    return sysex;

  } else if (parseInt(sysex_type) === 126) {
    let name_array = Array.from(name);
    let ascii_name = [];
    for (let i = 0; i < 16; i++) {
      let char = 32;
      if (i < name_array.length) {
        char = name_array[i].charCodeAt();
      };
      if ((char > 31) && (char < 128)) {
        ascii_name.push(char);
      } else {
        ascii_name.push(32); // pad with spaces if needed
      };
    };
    
    let header = [126, device_id, 8, 1, tuning_map_number]; // non-real-time bulk tuning dump (0x7E=126): 128 notes
    for (let i = 0; i < 16; i++) {
      header.push(ascii_name[i]);
    };
    let fundamental_cents = 1200 * Math.log2(fundamental / 440);
    let degree_0_cents = fundamental_cents - offset[0];
    let map_offset = degree_0_cents - (100 * (tuning_map_degree0 - 69));
    let mts_data = [];

    for (let i = 0; i < 128; i++) {
      mts_data[i] = [127, 127, 127];
      const target_cents = scale[((i - tuning_map_degree0) + (128 * scale.length)) % scale.length] + map_offset + (equave * (Math.floor(((i - tuning_map_degree0) + (128 * scale.length)) / scale.length) - 128));
      if (typeof target_cents === "number") {
        mts_data[i] = centsToMTS(tuning_map_degree0, target_cents);
      };
    }; 
    
    /*let low = 0;
    //console.log("low", low, mts_data[low]);
    while ( (mts_data[low][0] < 0) && (low < 127) ) {
      low++;
    };

    for (let i = 0; i < low; i++) {
      if ((low < 128) && (mts_data[low][0] >= 0)) {
        mts_data[i] = mts_data[low]; // repeat the lowest possible note at the bottom end of the map as needed
      } else {
        mts_data[i] = [i, 0, 0]; // if data is invalid, load 12edo
      };        
    };

    let high = 127;
    while ( (mts_data[high][0] > 127) && (high > 0) ) {
      high--;
    };
    while ( ((mts_data[high][0] == 127) && (mts_data[high][1] == 127) && (mts_data[high][2] == 127)) && (high >= 0) ) { // no F7 F7 F7 messages !
      high--;
    };*/

    // Clamp entries that fell out of MTS range to their nearest valid value.
    // [127,127,127] is reserved as "no tuning data" — replace with max valid.
    for (let i = 0; i < 128; i++) {
      if (mts_data[i][0] === 127 && mts_data[i][1] === 127 && mts_data[i][2] === 127) {
        mts_data[i] = [127, 127, 126]; // highest valid MTS value
      }
    };

    // Build sysex payload: header + 128×3 tuning bytes.
    // Note: header starts with 126 (0x7E = universal non-real-time manufacturer ID).
    // sendSysex(manufacturer, data) will wrap with F0…F7, so we shift 126 off
    // and pass the rest as data — checksum must be computed on the data portion only.
    let sysex = [];
    for (let i = 0; i < header.length; i++) {
      sysex.push(header[i]);
    };
    for (let i = 0; i < 128; i++) {
      sysex.push(mts_data[i][0]);
      sysex.push(mts_data[i][1]);
      sysex.push(mts_data[i][2]);
    };

    // Checksum per MTS spec: XOR of all bytes from device_id through last tuning byte,
    // masked to 7 bits. sysex[0] is 126 (manufacturer), so start from index 1.
    let checksum = 0;
    for (let i = 1; i < sysex.length; i++) {
      checksum ^= sysex[i];
    };
    checksum &= 0x7F;
    sysex.push(checksum);
    
    return sysex;
  };
};