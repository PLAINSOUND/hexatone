import { calculateRotationMatrix, applyMatrixToPoint } from "./matrix";
import Point from "./point";
import Euclid from "./euclidean";
import {
  rgb,
  HSVtoRGB,
  HSVtoRGB2,
  nameToHex,
  hex2rgb,
  rgb2hsv,
  getContrastYIQ,
  getContrastYIQ_2,
  rgbToHex,
} from "./color_utils";
import { WebMidi } from "webmidi";
import { midi_in } from "../settings/midi/midiin";
import { keymap, notes } from "../midi_synth";
import { mtsToMidiFloat, centsToMTS } from "../midi_synth";
import { scalaToCents } from "../settings/scale/parse-scale";

import { detectController, getAnchorNote } from '../controllers/registry.js';
import { RecencyStack } from '../recency_stack.js';

class Keys {
  constructor(canvas, settings, synth, typing, onLatchChange) {
    const gcd = Euclid(settings.rSteps, settings.drSteps);
    this.settings = {
      hexHeight: settings.hexSize * 2,
      hexVert: (settings.hexSize * 3) / 2,
      hexWidth: Math.sqrt(3) * settings.hexSize,
      gcd, // calculates a array with 3 values: the GCD of the layout tiling (smallest step available); Bézout Coefficients to be applied to rSteps and drSteps to obtain GCD
      degree0toRef_asArray: degree0ToRef(
        settings.reference_degree,
        settings.scale,
      ),
      centerHexOffset: computeCenterOffset(
        settings.rSteps,
        settings.drSteps,
        settings.center_degree || 0,
        gcd,
      ),
      ...settings,
    };
    this.synth = synth; // use built-in sounds and/or send MIDI out (MTS, MPE, or DIRECT) to an external synth
    this.typing = typing;
    this.onLatchChange = onLatchChange || null;
    this.bend = 0;
    this.state = {
      canvas,
      context: canvas.getContext("2d"),
      sustain: false,
      latch: false,
      sustainedNotes: [],
      sustainedCoords: new Set(), // coord strings of sustained notes, for redraw
      escHeld: false,
      isTuneDragging: false,
      pressedKeys: new Set(),
      shiftSustainedKeys: new Set(), // keys held with Shift for individual sustain
      activeHexObjects: [],
      isTouchDown: false,
      isMouseDown: false,
      lastMidiCoords: null, // screen-space Point of the most recently activated MIDI hex
    };
    // Recency stack — tracks all sounding notes most-recent-first.
    // The front entry receives wheel bend; see _handleWheelBend().
    this.recencyStack = new RecencyStack();

    // Wheel bend state — controller-agnostic.
    // _wheelBend:      current offset in cents applied to the front note.
    // _wheelTarget:    the hex currently being bent.
    // _wheelBaseCents: that hex's pitch before any bend was applied.
    //                  Snapshot feature will read this + _wheelBend.
    this._wheelBend = 0;
    this._wheelTarget = null;
    this._wheelBaseCents = null;

    // midiin_central_degree is the physical anchor note (set by controller detection/learn).
    // Fall back to the nearest MIDI note to the centre hex's frequency when not set.
    const tuning_map_degree0 = this.settings.midiin_central_degree
      ?? computeNaturalAnchor(
        this.settings.fundamental,
        this.settings.degree0toRef_asArray[0],
        this.settings.scale,
        this.settings.equivInterval,
        this.settings.center_degree,
      );
    this.mts_tuning_map = mtsTuningMap(
      this.settings.sysex_type,
      this.settings.device_id,
      this.settings.tuning_map_number,
      tuning_map_degree0,
      this.settings.scale,
      this.settings.name,
      this.settings.equivInterval,
      this.settings.fundamental,
      this.settings.degree0toRef_asArray,
    );

    // Set up resize handler
    window.addEventListener("resize", this.resizeHandler, false);
    window.addEventListener("orientationchange", this.resizeHandler, false);
    // visualViewport fires when browser chrome (toolbars) appear/disappear,
    // which window.resize misses — catches Brave's toolbar toggling.
    if (window.visualViewport) {
      window.visualViewport.addEventListener(
        "resize",
        this.resizeHandler,
        false,
      );
    }

    //... and give it an initial call, which does the initial draw
    this.resizeHandler();

    // Set up keyboard, touch and mouse event handlers
    // Key listeners always on window — ESC key sustain must work even when sidebar is closed.
    window.addEventListener("keydown", this.onKeyDown, false);
    window.addEventListener("keyup", this.onKeyUp, false);
    this.state.canvas.addEventListener("touchstart", this.handleTouch, false);
    this.state.canvas.addEventListener("touchend", this.handleTouch, false);
    this.state.canvas.addEventListener("touchmove", this.handleTouch, false);
    this.state.canvas.addEventListener(
      "touchcancel",
      this.handleTouchCancel,
      false,
    );
    this.state.canvas.addEventListener("mousedown", this.mouseDown, false);
    window.addEventListener("mouseup", this.mouseUp, false);

    /* 
    console.log("midiin_device:", this.settings.midiin_device);
    console.log("midiin_channel:", this.settings.midiin_channel);
    console.log("midi_device:", this.settings.midi_device);
    console.log("midi_channel:", this.settings.midi_channel);
    console.log("midi_mapping:", this.settings.midi_mapping); */

    // sysex_auto comes from settings directly; sessionStorage read was redundant and error-prone

    if (
      this.settings.output_mts &&
      this.settings.sysex_auto &&
      this.settings.midi_device !== "OFF" &&
      this.settings.midi_channel >= 0
    ) {
      this.midiout_data = WebMidi.getOutputById(this.settings.midi_device);
      this.mtsSendMap();
    }

    //console.log('[Keys] MIDI init — device:', JSON.stringify(this.settings.midiin_device), 'channel:', this.settings.midiin_channel, 'passthrough:', this.settings.midi_passthrough);
    if (
      this.settings.midiin_device !== "OFF" &&
      this.settings.midiin_channel >= 0
    ) {
      // get the MIDI noteons and noteoffs to play the internal sounds

      this.midiin_data = WebMidi.getInputById(this.settings.midiin_device);
      //console.log('[Keys] midiin_data lookup →', this.midiin_data ? JSON.stringify(this.midiin_data.name) : 'NULL (device not found by WebMidi)');

      if (!this.midiin_data) {
      } else {
        // this.midiin_data exists

        this._midiLearnCallback = null; // set by setMidiLearnMode()

        this.midiin_data.addListener("noteon", (e) => {
          // MIDI learn: capture the next note-on as the new anchor, don't play it.
          if (this._midiLearnCallback) {
            this._midiLearnCallback(e.note.number);
            this._midiLearnCallback = null;
            return;
          }
          //console.log("(input) note_on", e.message.channel, e.note.number, e.note.rawAttack);
          this.midinoteOn(e);
          notes.played.unshift(e.note.number + 128 * (e.message.channel - 1));
          // console.log("notes.played after noteon:", notes.played);
        });

        this.midiin_data.addListener("noteoff", (e) => {
          //console.log("(input) note_off", e.message.channel, e.note.number, e.note.rawRelease);
          this.midinoteOff(e);
          let index = notes.played.lastIndexOf(
            e.note.number + 128 * (e.message.channel - 1),
          ); // eliminate note_played from array of played notes when using internal synth
          if (index >= 0) {
            let first_half = [];
            first_half = notes.played.slice(0, index);
            let second_half = [];
            second_half = notes.played.slice(index);
            second_half.shift();
            let newarray = [];
            notes.played = newarray.concat(first_half, second_half);
          }
          /*
        if (notes.played.length > 0) {
          console.log("notes.played after noteoff", notes.played);
        } else {
          console.log("All notes released!");
        };
        */
        });

        this.midiin_data.addListener("keyaftertouch", (e) => {
          // Polyphonic aftertouch for built-in synth — find the matching active hex
          // by matching note + channel encoding, then ramp its gain smoothly
          const note_played =
            e.message.dataBytes[0] + 128 * (e.message.channel - 1);
          const hex = this.state.activeHexObjects.find(
            (h) => h.note_played === note_played,
          );
          if (hex && hex.aftertouch) {
            hex.aftertouch(e.message.dataBytes[1]);
          }
        });

        this.midiin_data.addListener("controlchange", (e) => {
          if (e.message.dataBytes[0] == 64) {
            if (e.message.dataBytes[1] > 0) {
              this.sustainOn();
              //console.log("Controller 64 (Sustain Pedal) On");
            } else {
              this.sustainOff();
              //console.log("Controller 64 (Sustain Pedal) Off");
            }
          }

          if (e.message.dataBytes[0] == 123) {
            console.log("Controller 123 (All Notes Off) Received");
            console.log("Notes being played:", notes.played);
            this.allnotesOff();
          }

          if (e.message.dataBytes[0] == 121) {
            console.log("Controller 121 (All Controllers Off) Received");
            this.sustainOff();
          }
        });

        if (
          this.settings.output_mts &&
          this.settings.midi_device !== "OFF" &&
          this.settings.midi_channel >= 0
        ) {
          // forward other MIDI data through to output (only when MTS is enabled)
          this.midiout_data = WebMidi.getOutputById(this.settings.midi_device);

          if (this.settings.midi_mapping == "multichannel") {
            // in multichannel output send controlchange and channel pressure on selected channel only, this mode is currently NOT USED, to be replaced by DIRECT mode

            this.midiin_data.addListener("controlchange", (e) => {
              //console.log("Control Change (thru on all channels)", e.message.dataBytes[0], e.message.dataBytes[1]);
              this.midiout_data.sendControlChange(
                e.message.dataBytes[0],
                e.message.dataBytes[1],
                { channels: this.settings.midi_channel + 1 },
              );
            });

            this.midiin_data.addListener("channelaftertouch", (e) => {
              //console.log("Channel Pressure (thru on all channels) ", e.message.dataBytes[0]);
              this.midiout_data.sendChannelAftertouch(e.message.dataBytes[0], {
                channels: this.settings.midi_channel + 1,
                rawValue: true,
              });
            });

            this.midiin_data.addListener("pitchbend", (e) => {
              // TODO decide what multichannel pitchbend should do, for now on output channel only
              //console.log("Pitch Bend (thru)", e.message.dataBytes[0], e.message.dataBytes[1]);
              this.midiout_data.sendPitchBend(
                2.0 *
                (e.message.dataBytes[0] / 16384.0 +
                  e.message.dataBytes[1] / 128.0) -
                1.0,
                { channels: this.settings.midi_channel + 1 },
              );
            });

            this.midiin_data.addListener("keyaftertouch", (e) => {
              let note = e.message.dataBytes[0] + 128 * (e.message.channel - 1); // finds index of stored MTS data
              this.midiout_data.sendKeyAftertouch(
                keymap[note][0],
                e.message.dataBytes[1],
                { channels: keymap[note][6] + 1, rawValue: true },
              );
              //console.log("Key Pressure MultiCh", keymap[note][6] + 1, keymap[note][0], e.message.dataBytes[1]);
            });
          } else {
            // in single-channel output send controlchange and channel pressure only on selected channel

            this.midiin_data.addListener("controlchange", (e) => {
              //console.log("(thru) Control Change", this.settings.midi_channel + 1, e.message.dataBytes[0], e.message.dataBytes[1]);
              this.midiout_data.sendControlChange(
                e.message.dataBytes[0],
                e.message.dataBytes[1],
                { channels: this.settings.midi_channel + 1 },
              );
            });

            this.midiin_data.addListener("channelaftertouch", (e) => {
              //console.log("Channel Aftertouch (thru)", this.settings.midi_channel + 1, e.message.dataBytes[0]);
              this.midiout_data.sendChannelAftertouch(e.message.dataBytes[0], {
                channels: this.settings.midi_channel + 1,
                rawValue: true,
              });
            });

            if (this.settings.midi_mapping == "sequential") {
              // handling of sequential, also currently inactive, to be replaced by "DIRECT" mode, and mts output of key pressure

              this.midiin_data.addListener("pitchbend", (e) => {
                // TO DO!!! decide what pitchbend should do
                //console.log("Pitch Bend (thru)", e.message.dataBytes[0], e.message.dataBytes[1]);
                this.midiout_data.sendPitchBend(
                  2.0 *
                  (e.message.dataBytes[0] / 16384.0 +
                    e.message.dataBytes[1] / 128.0) -
                  1.0,
                  { channels: this.settings.midi_channel + 1 },
                );
              });

              /*          Note that the channels-to-equave-transposition logic in the next section will need overhaul
               *          once static mapping per MIDI control surface is implemented. New logic: unique layout mapping
               *          unique MIDI+channel identifiers (MIDI2 compatible) i.e. Channel*128 + Note Number, and this
               *          is to be dynamically allocated based on layout and scale to optimise coverage and polyphony.
               */
              this.midiin_data.addListener("keyaftertouch", (e) => {
                let channel_offset =
                  e.message.channel - 1 - this.settings.midiin_channel; // calculates the difference between selected central MIDI Input channel and the actual channel being sent and uses this to offset by up to +/- 4 equaves
                channel_offset = ((channel_offset + 20) % 8) - 4;
                let note_offset = channel_offset * this.settings.equivSteps;
                let note =
                  (e.message.dataBytes[0] + note_offset + 16 * 128) % 128; // matches note cycling in midi_synth/index,js
                this.midiout_data.sendKeyAftertouch(
                  note,
                  e.message.dataBytes[1],
                  { channels: this.settings.midi_channel + 1, rawValue: true },
                );
                //console.log("Key Pressure Seq", this.settings.midi_channel + 1, note, e.message.dataBytes[1]);
              });
            } else if (
              this.settings.midi_mapping == "MTS1" ||
              this.settings.midi_mapping == "MTS2"
            ) {
              this.midiin_data.addListener("keyaftertouch", (e) => {
                let note =
                  e.message.dataBytes[0] + 128 * (e.message.channel - 1); // finds index of stored MTS data
                //console.log("note", note);
                //console.log("keymap", keymap[note][0]);
                this.midiout_data.sendKeyAftertouch(
                  keymap[note][0],
                  e.message.dataBytes[1],
                  { channels: this.settings.midi_channel + 1, rawValue: true },
                );
                //console.log("Key Pressure MTS", this.settings.midi_channel + 1, keymap[note][0], e.message.dataBytes[1]);
              });

              this.midiin_data.addListener("pitchbend", (e) => {
                // TODO decide what multichannel pitchbend should do, for now on output channel only
                //console.log("Pitch Bend (thru)", e.message.dataBytes[0], e.message.dataBytes[1]);
                this.midiout_data.sendPitchBend(
                  2.0 *
                  (e.message.dataBytes[0] / 16384.0 +
                    e.message.dataBytes[1] / 128.0) -
                  1.0,
                  { channels: this.settings.midi_channel + 1 },
                );
              });

              /*
            this.midiin_data.addListener("pitchbend", e => { // pitchbend is processed as MTS real-time data allowing every note a different bend radius TO DO ... reactivate this feature !
              this.mtsBend(e);       
            });
            */
            }
          }
        } // end if (output_mts)
        // Detect controller geometry and build a direct coordinate lookup map.
        // registry.buildMap() returns Map<"ch.note", {x,y}> with the anchor at (0,0).
        // Adding centerHexOffset converts to absolute hex-grid coords — the same
        // space that hexOn() / hexOff() / hexCoordsToCents() operate in.
        // No best-fit search needed: the anchor key always lands at the screen centre.
        if (!this.stepsTable || this.stepsTable.size === 0) this.buildStepsTable();
        {
          const deviceName = this.midiin_data.name?.toLowerCase() ?? '';
          //console.log('[Controller] MIDI input device name:', JSON.stringify(this.midiin_data.name));
          const entry = detectController(deviceName);
          if (entry) {
            this.controller = entry;
            const anchorNote = getAnchorNote(entry, this.settings);
            const anchorChannel = this.settings.lumatone_center_channel ?? entry.anchorChannelDefault ?? 3;
            const rawOffsets = entry.buildMap(anchorNote, anchorChannel, this.settings.rSteps, this.settings.drSteps);
            const ox = this.settings.centerHexOffset.x;
            const oy = this.settings.centerHexOffset.y;
            this.controllerMap = new Map();
            for (const [key, { x, y }] of rawOffsets) {
              this.controllerMap.set(key, new Point(x + ox, y + oy));
            }
            //console.log('[Controller] built map for:', entry.id, 'anchorNote:', anchorNote, 'size:', this.controllerMap.size);
          } else {
            this.controller = null;
            this.controllerMap = null;
            console.log('[Controller] no geometry found for device — using step arithmetic');
          }
        }

        // Universal pitch-wheel → recency-stack target.
        // Runs for ALL midi_mapping modes.  The existing per-mode pitchbend
        // listeners (forwarding to output) are preserved alongside this one.
        this.midiin_data.addListener('pitchbend', (e) => {
          const val14 = e.message.dataBytes[0] + e.message.dataBytes[1] * 128;
          this._handleWheelBend(val14);
        });

      } // end else (midiin_data exists)
    } // end if midiin_data guard
  } // end of constructor

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

  previewDegree0 = (deltaCents) => {
    const newCents = deltaCents;
    for (const hex of this.state.activeHexObjects) {
      const [, reducedSteps, , octs] = this.hexCoordsToCents(hex.coords);
      if (reducedSteps === 0 && hex.retune)
        hex.retune(octs * this.settings.equivInterval + newCents);
    }
    for (const [hex] of this.state.sustainedNotes) {
      const [, reducedSteps, , octs] = this.hexCoordsToCents(hex.coords);
      if (reducedSteps === 0 && hex.retune)
        hex.retune(octs * this.settings.equivInterval + newCents);
    }
  };

  // Imperatively update the Reference Frequency without rebuilding Keys.
  // Rebuilds mts_tuning_map, retuning all sounding/sustained notes,
  // and re-sends the tuning map to any active MTS/Direct output.
  // Shift all pitches by ±1 equave without rebuilding Keys.
  // Updates octave_offset in this.settings, redraws the grid
  // (so colours update), and retunes any sounding/sustained notes.
  shiftOctave = (dir, deferred = false) => {
    this.settings.octave_offset = (this.settings.octave_offset || 0) + dir;

    // In deferred mode, sounding notes keep their current pitch — the shift
    // only applies to the next new note. If there are no sounding notes,
    // deferred and immediate are equivalent.
    const hasSoundingNotes =
      this.state.activeHexObjects.length > 0 ||
      this.state.sustainedNotes.length > 0;
    const skipRetune = deferred && hasSoundingNotes;

    if (!skipRetune) {
      // Retune all sounding and sustained notes immediately
      for (const hex of this.state.activeHexObjects) {
        const [newCents] = this.hexCoordsToCents(hex.coords);
        if ('fundamental' in hex) hex.fundamental = this.settings.fundamental;
        if (hex.retune) hex.retune(newCents);
      }
      for (const [hex] of this.state.sustainedNotes) {
        const [newCents] = this.hexCoordsToCents(hex.coords);
        if ('fundamental' in hex) hex.fundamental = this.settings.fundamental;
        if (hex.retune) hex.retune(newCents);
      }
    }

    // Always rebuild the in-memory MTS map so new notes use the new offset.
    // Each MidiHex.noteOn() sends its own single-note real-time sysex, so
    // new notes are individually retuned at trigger time regardless.
    // Only send the bulk map immediately when not deferring (or when silent).
    this.mts_tuning_map = mtsTuningMap(
      this.settings.sysex_type,
      this.settings.device_id,
      this.settings.tuning_map_number,
      this.settings.midiin_central_degree
      ?? computeNaturalAnchor(
        this.settings.fundamental,
        this.settings.degree0toRef_asArray[0],
        this.settings.scale,
        this.settings.equivInterval,
        this.settings.center_degree,
      ),
      this.settings.scale,
      this.settings.name,
      this.settings.equivInterval,
      this.settings.fundamental,
      this.settings.degree0toRef_asArray,
    );
    if (!skipRetune) {
      if (this.settings.output_mts && this.midiout_data && this.settings.sysex_auto) this.mtsSendMap();
      if (this.settings.output_direct && this.settings.direct_sysex_auto &&
        this.settings.direct_device && this.settings.direct_device !== 'OFF') {
        const directOut = WebMidi.getOutputById(this.settings.direct_device);
        if (directOut) this.mtsSendMap(directOut);
      }
    }
    this.drawGrid();
  };

  updateFundamental = (newFundamental) => {
    this.settings.fundamental = newFundamental;
    // Rebuild MTS tuning map with new fundamental
    this.mts_tuning_map = mtsTuningMap(
      this.settings.sysex_type,
      this.settings.device_id,
      this.settings.tuning_map_number,
      this.settings.midiin_central_degree
      ?? computeNaturalAnchor(
        this.settings.fundamental,
        this.settings.degree0toRef_asArray[0],
        this.settings.scale,
        this.settings.equivInterval,
        this.settings.center_degree,
      ),
      this.settings.scale,
      this.settings.name,
      this.settings.equivInterval,
      newFundamental,
      this.settings.degree0toRef_asArray,
    );
    // If a TuneCell drag preview is in progress (or was abandoned without Save/Revert),
    // _fundamentalSnapshot holds the pre-preview base cents for each hex — the correct
    // scale-derived pitches before any drag offset was applied.
    // Using snapshot values here makes updateFundamental order-independent with respect
    // to previewFundamental(0): it works correctly whether the effect fires before or
    // after onSave's cleanup call, and also handles abandoned drags where hex.cents
    // was left at base+delta.
    const snap = this._fundamentalSnapshot;
    this._fundamentalSnapshot = null; // clear — official update supersedes the preview
    // Update fundamental on all sounding/sustained hex objects, then retune.
    // Both MidiHex and ActiveHex store this.fundamental at construction;
    // we patch it directly so retune() uses the new value.
    const allHexes = [
      ...this.state.activeHexObjects,
      ...[...this.state.sustainedNotes].map(([h]) => h),
    ];
    for (const hex of allHexes) {
      if ('fundamental' in hex) hex.fundamental = newFundamental;
      const key = hex.coords.x + ',' + hex.coords.y;
      const trueCents = snap ? (snap.get(key) ?? hex.cents) : hex.cents;
      hex.cents = trueCents; // sync to base, cancelling any preview offset
      if (hex.retune) hex.retune(trueCents);
    }
    // Re-send tuning map if auto-send is enabled for the relevant output
    if (this.settings.output_mts && this.midiout_data && this.settings.sysex_auto) this.mtsSendMap();
    if (this.settings.output_direct && this.settings.direct_sysex_auto &&
      this.settings.direct_device && this.settings.direct_device !== 'OFF') {
      const directOut = WebMidi.getOutputById(this.settings.direct_device);
      if (directOut) this.mtsSendMap(directOut);
    }
  };

  _fundamentalSnapshot = null;

  snapshotForFundamentalPreview = () => {
    this._fundamentalSnapshot = new Map();
    for (const hex of this.state.activeHexObjects)
      this._fundamentalSnapshot.set(hex.coords.x + ',' + hex.coords.y, hex.cents);
    for (const [hex] of this.state.sustainedNotes)
      this._fundamentalSnapshot.set(hex.coords.x + ',' + hex.coords.y, hex.cents);
  };

  previewFundamental = (deltaCents) => {
    const snap = this._fundamentalSnapshot;
    const applyTo = (hex) => {
      const key = hex.coords.x + ',' + hex.coords.y;
      const base = snap ? (snap.get(key) ?? hex.cents) : hex.cents;
      if (hex.retune) hex.retune(base + deltaCents);
    };
    for (const hex of this.state.activeHexObjects) applyTo(hex);
    for (const [hex] of this.state.sustainedNotes) applyTo(hex);
    if (deltaCents === 0) this._fundamentalSnapshot = null;
  };

  /**
   * Called by TuneCell on pointer-down/up so Shift-sustain keyup guard
   * knows a sidebar drag is in progress and won't drop the sustain.
   */
  setTuneDragging = (active) => {
    this.state.isTuneDragging = active;
  };

  setTuneDragging = (active) => {
    this.state.isTuneDragging = active;
  };

  /**
   * Imperatively update colors and redraw without reconstructing the Keys instance.
   * RAF-batched: multiple rapid color changes result in only one redraw per frame.
   */
  updateColors = (colors) => {
    this.settings.note_colors = colors.note_colors;
    this.settings.spectrum_colors = colors.spectrum_colors;
    this.settings.fundamental_color = colors.fundamental_color;

    // Batch redraws via RAF - at most one per 16ms frame
    if (!this._colorRafPending) {
      this._colorRafPending = true;
      requestAnimationFrame(() => {
        this._colorRafPending = false;
        this.drawGrid();
      });
    }
  };

  /**
   * Activate or cancel MIDI-learn mode for the anchor note.
   * While active, the next note-on from the hardware controller is captured as
   * the new anchor and forwarded to `callback(noteNumber)` instead of being played.
   * @param {boolean} active
   * @param {function(number):void} [callback]
   */
  setMidiLearnMode = (active, callback) => {
    this._midiLearnCallback = active ? (callback ?? null) : null;
  };

  deconstruct = () => {
    // Graceful noteOff for all active and sustained notes — allows synth
    // release envelopes to run rather than cutting sound abruptly via panic().
    for (const hex of this.state.activeHexObjects) {
      hex.noteOff(0);
    }
    for (const [hex, vel] of this.state.sustainedNotes) {
      hex.noteOff(vel);
    }
    this.state.activeHexObjects = [];
    this.state.sustainedNotes = [];
    this.state.sustainedCoords.clear();
    this.recencyStack.clear();

    // Notify the app that latch/sustain is gone — the new Keys instance will
    // start with latch: false, so the UI indicator must match. Without this,
    // synth-only rebuilds (e.g. FluidSynth connecting) leave the app showing
    // latch as active while the new Keys has no sustain state, causing the
    // next click to produce a brief non-sustained note instead of latching.
    if (this.onLatchChange) this.onLatchChange(false);


    window.removeEventListener("resize", this.resizeHandler, false);
    window.removeEventListener("orientationchange", this.resizeHandler, false);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener(
        "resize",
        this.resizeHandler,
        false,
      );
    }

    window.removeEventListener("keydown", this.onKeyDown, false);
    window.removeEventListener("keyup", this.onKeyUp, false);
    this.state.canvas.removeEventListener(
      "touchstart",
      this.handleTouch,
      false,
    );
    this.state.canvas.removeEventListener("touchend", this.handleTouch, false);
    this.state.canvas.removeEventListener("touchmove", this.handleTouch, false);
    this.state.canvas.removeEventListener(
      "touchcancel",
      this.handleTouchCancel,
      false,
    );
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
    }

    if (this.midiout_data) {
      this.midiout_data = null;
    }
  };

  mtsSendMap = (midiOutput) => {
    // send the tuning map
    const output = midiOutput || this.midiout_data;
    if (!output) return;
    // When called with a direct output, use 126 (non-RT bulk)
    const isDirectOutput = this.settings.output_direct &&
      this.settings.direct_device && this.settings.direct_device !== 'OFF' &&
      output.id === this.settings.direct_device;
    const sysex_type = isDirectOutput ? 126 : parseInt(this.settings.sysex_type);

    if (sysex_type === 127) {
      // Real-time single-note tuning change: one message per note.
      // Each entry is [127, device_id, 8, 2, map#, 1, note, mts0, mts1, mts2].
      // sendSysex(manufacturer, data) prepends F0+manufacturer and appends F7.
      // We copy each array to avoid mutating the stored tuning map.
      for (let i = 0; i < 128; i++) {
        const msg = [...this.mts_tuning_map[i]];
        const manufacturer = msg.shift(); // 127 = universal real-time
        output.sendSysex([manufacturer], msg);
      }
    } else if (sysex_type === 126) {
      // Non-real-time bulk tuning dump: single message for all 128 notes.
      // Build a protected copy: any carrier slot currently held by a sustained
      // or active note keeps its exact current tuning bytes so the synth does
      // not retune it mid-sustain.
      const sustainedSlots = new Map(); // carrier slot → [mts1, mts2, mts3]
      const allActive = [
        ...this.state.activeHexObjects,
        ...this.state.sustainedNotes.map(([h]) => h),
      ];
      for (const hex of allActive) {
        if (hex.mts && hex.mts.length >= 4) {
          sustainedSlots.set(hex.mts[0], [hex.mts[1], hex.mts[2], hex.mts[3]]);
        }
      }

      // Clone the full 128-entry tuning map and patch protected slots
      const msg = [...this.mts_tuning_map];
      const manufacturer = msg.shift(); // 126 = universal non-real-time
      // After shift, layout is:
      //   [device_id, 8, 1, map#, name(16 bytes)] = 20 header bytes
      //   then 128 × 3 tuning bytes (note0_tt, note0_yy, note0_zz, ...)
      //   then 1 checksum byte
      const HEADER_LEN = 20;
      let patched = false;
      for (const [slot, tuning] of sustainedSlots) {
        const skip = HEADER_LEN + slot * 3;
        if (skip + 2 < msg.length - 1) {
          // -1 to stay before checksum
          msg[skip] = tuning[0];
          msg[skip + 1] = tuning[1];
          msg[skip + 2] = tuning[2];
          patched = true;
        }
      }

      // Recompute checksum if any entries were patched (XOR bytes 1..end-1)
      if (patched) {
        let checksum = 0;
        for (let i = 1; i < msg.length - 1; i++) checksum ^= msg[i];
        msg[msg.length - 1] = checksum & 0x7f;
      }

      output.sendSysex([manufacturer], msg);
    }
  };

  /*   TO DO !!! reinstate
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

  // Helper: if latch is active and coords is already sustained, toggle it off.
  // Returns true if the note was toggled off (caller should return/continue).
  _midiLatchToggle(coords, releaseVelocity = 0) {
    if (!this.state.latch) return false;
    const key = coords.x + ',' + coords.y;
    const sustainedIdx = this.state.sustainedNotes.findIndex(
      ([h]) => h.coords.x === coords.x && h.coords.y === coords.y,
    );
    if (sustainedIdx === -1) return false;
    const [hex, vel] = this.state.sustainedNotes[sustainedIdx];
    this.state.sustainedNotes.splice(sustainedIdx, 1);
    this.state.sustainedCoords.delete(key);
    hex.noteOff(releaseVelocity || vel);
    this.hexOff(coords);
    return true;
  }

  // Apply channel step offset to a base coordinate.
  // Gets the raw steps at baseCoords, adds channelToStepsOffset(channel),
  // then returns the best visible coord for those combined steps.
  // If stepsPerChannel is effectively zero (single-channel device or
  // stepsPerChannel === 0) returns baseCoords unchanged.
  _applyChannelOffset(baseCoords, channel) {
    const stepsPerChannel = this.settings.midiin_steps_per_channel ?? this.settings.equivSteps;
    if (!stepsPerChannel) return baseCoords;
    const channelOffset = this.channelToStepsOffset(channel);
    if (channelOffset === 0) return baseCoords;
    const [, , baseSteps] = this.hexCoordsToCents(baseCoords);
    return this.bestVisibleCoord(baseSteps + channelOffset) ?? baseCoords;
  }

  midinoteOn = (e) => {
    const bend = this.bend || 0;
    const note_played = e.note.number + 128 * (e.message.channel - 1);
    const velocity_played = e.note.rawAttack;

    let coords;

    if (this.settings.midi_passthrough) {
      // Bypass mode: ignore controller geometry, use step arithmetic.
      // Also forward raw notes when MTS output is off (MTS via hexOn would double them).
      if (!this.settings.output_mts && this.midiout_data && this.settings.midi_channel >= 0) {
        this.midiout_data.sendNoteOn(e.note.number, {
          channels: this.settings.midi_channel + 1,
          rawAttack: velocity_played,
        });
      }
      const steps = (e.note.number - this.settings.midiin_central_degree)
        + (this.settings.center_degree || 0)
        + this.channelToStepsOffset(e.message.channel);
      coords = this.bestVisibleCoord(steps);
    } else if (this.controllerMap) {
      // Known controller: direct coordinate lookup from pre-built map.
      // Single-channel controllers always use ch=1; multi-channel use the real channel.
      const ch = this.controller.multiChannel ? e.message.channel : 1;
      const baseCoords = this.controllerMap.get(`${ch}.${e.note.number}`) ?? null;
      if (baseCoords === null) return;
      // The controllerMap already encodes physical position exactly — no channel offset.
      // Applying _applyChannelOffset here would use bestVisibleCoord() which is
      // position-dependent and returns different results on note-on vs note-off,
      // causing stuck notes. Use baseCoords directly.
      coords = baseCoords;
    } else {
      // Generic keyboard: step arithmetic with channel-based transposition.
      const steps = (e.note.number - this.settings.midiin_central_degree)
        + (this.settings.center_degree || 0)
        + this.channelToStepsOffset(e.message.channel);
      coords = this.bestVisibleCoord(steps);
    }

    if (coords === null) return;
    if (this._midiLatchToggle(coords, velocity_played)) return;
    const hex = this.hexOn(coords, note_played, velocity_played, bend);
    this.state.activeHexObjects.push(hex);
    this.state.lastMidiCoords = this.hexCoordsToScreen(coords);
  };

  midinoteOff = (e) => {
    let coordsList;

    if (this.settings.midi_passthrough || !this.controllerMap) {
      // Bypass or generic keyboard: step arithmetic (may hit multiple visible coords).
      if (this.settings.midi_passthrough && !this.settings.output_mts && this.midiout_data && this.settings.midi_channel >= 0) {
        this.midiout_data.sendNoteOff(e.note.number, {
          channels: this.settings.midi_channel + 1,
          rawRelease: e.note.rawRelease,
        });
      }
      const steps = (e.note.number - this.settings.midiin_central_degree)
        + (this.settings.center_degree || 0)
        + this.channelToStepsOffset(e.message.channel);
      coordsList = this.stepsToVisibleCoords(steps);
    } else {
      // Known controller: direct lookup returns exactly one coord.
      const ch = this.controller.multiChannel ? e.message.channel : 1;
      const baseCoords = this.controllerMap.get(`${ch}.${e.note.number}`);
      coordsList = baseCoords ? [baseCoords] : [];
    }

    for (const coords of coordsList) {
      if (!this.state.sustain) this.hexOff(coords);
      const hexIndex = this.state.activeHexObjects.findIndex(h => coords.equals(h.coords));
      if (hexIndex !== -1) {
        this.noteOff(this.state.activeHexObjects[hexIndex], e.note.rawRelease);
        this.state.activeHexObjects.splice(hexIndex, 1);
      }
    }
  };

  allnotesOff = () => {
    if (notes.played.length > 0) {
      for (const note_played of notes.played) {
        const note = note_played % 128;
        const channel = Math.floor(note_played / 128) + 1; // 1-indexed

        let coordsList;
        if (!this.settings.midi_passthrough && this.controllerMap) {
          // Known controller: direct lookup.
          const ch = this.controller.multiChannel ? channel : 1;
          const baseCoords = this.controllerMap.get(`${ch}.${note}`);
          coordsList = baseCoords ? [baseCoords] : [];
        } else {
          // Bypass or generic keyboard: step arithmetic.
          const steps = (note - this.settings.midiin_central_degree)
            + (this.settings.center_degree || 0)
            + this.channelToStepsOffset(channel);
          coordsList = this.stepsToVisibleCoords(steps);
        }

        for (const coords of coordsList) {
          if (!this.state.sustain) this.hexOff(coords);
          const hexIndex = this.state.activeHexObjects.findIndex(h => coords.equals(h.coords));
          if (hexIndex !== -1) {
            this.noteOff(this.state.activeHexObjects[hexIndex], 64);
            this.state.activeHexObjects.splice(hexIndex, 1);
          }
        }
      }
      notes.played = [];
      console.log("All notes released!");
    } else {
      console.log("No held notes to be released.");
    }
  };

  panic = () => {
    // Send MIDI All Notes Off (CC 123) to external devices first
    // This tells external synths to stop all sound immediately

    // MTS output - send CC123 on configured channel
    if (
      this.midiout_data &&
      this.settings.midi_device !== "OFF" &&
      this.settings.midi_channel >= 0
    ) {
      this.midiout_data.sendControlChange(123, 0, {
        channels: this.settings.midi_channel + 1,
      });
    }

    // MPE output - send CC123 on all MPE channels (master + note channels)
    if (
      this.settings.mpe_device !== "OFF" &&
      this.settings.mpe_lo_ch > 0 &&
      this.settings.mpe_hi_ch >= this.settings.mpe_lo_ch
    ) {
      const mpeOutput = WebMidi.getOutputById(this.settings.mpe_device);
      if (mpeOutput) {
        // Send on master channel
        const masterCh = parseInt(this.settings.mpe_master_ch) || 1;
        mpeOutput.sendControlChange(123, 0, { channels: masterCh });
        // Send on all note channels
        for (
          let ch = this.settings.mpe_lo_ch;
          ch <= this.settings.mpe_hi_ch;
          ch++
        ) {
          mpeOutput.sendControlChange(123, 0, { channels: ch });
        }
      }
    }

    // Work with a copy to avoid iteration issues
    const activeHexes = [...this.state.activeHexObjects];
    const sustainedHexes = [...this.state.sustainedNotes];

    // Kill all active notes (mouse/touch/keyboard played) - process newest first
    for (let i = activeHexes.length - 1; i >= 0; i--) {
      const hex = activeHexes[i];
      // Use the same noteOff method as sustainOff for proper audio handling
      hex.noteOff(0);

      // Redraw hex as unpressed
      const [cents, pressed_interval] = this.hexCoordsToCents(hex.coords);
      const [color, text_color] = this.centsToColor(
        cents,
        false,
        pressed_interval,
      );
      this.drawHex(hex.coords, color, text_color);
    }
    this.state.activeHexObjects = [];

    // Kill all sustained notes - process newest first
    for (let i = sustainedHexes.length - 1; i >= 0; i--) {
      const [hex, releaseVel] = sustainedHexes[i];
      hex.noteOff(releaseVel);

      const [cents, pressed_interval] = this.hexCoordsToCents(hex.coords);
      const [color, text_color] = this.centsToColor(
        cents,
        false,
        pressed_interval,
      );
      this.drawHex(hex.coords, color, text_color);
    }

    this.state.sustainedNotes = [];
    this.state.sustainedCoords.clear();
    this.state.shiftSustainedKeys.clear();
    this.state.pressedKeys.clear();

    // Clear MIDI note tracking
    notes.played = [];

    // Reset recency stack and wheel bend
    this.recencyStack.clear();
    this._wheelBend = 0;
    this._wheelTarget = null;
    this._wheelBaseCents = null;

    // Reset sustain/latch state
    this.state.sustain = false;
    this.state.latch = false;
    if (this.onLatchChange) this.onLatchChange(false);

    console.log("PANIC - all notes killed!");
  };

  releaseAllKeyboardNotes = () => {
    for (const code of this.state.pressedKeys) {
      const kbRaw = this.settings.keyCodeToCoords[code];
      if (!kbRaw) continue;
      const kbOffset = this.settings.centerHexOffset;
      const coords = new Point(kbRaw.x + kbOffset.x, kbRaw.y + kbOffset.y);
      if (!this.state.sustain) this.hexOff(coords);
      const hexIndex = this.state.activeHexObjects.findIndex(h => coords.equals(h.coords));
      if (hexIndex !== -1) {
        this.noteOff(this.state.activeHexObjects[hexIndex], 0);
        this.state.activeHexObjects.splice(hexIndex, 1);
      }
    }
    this.state.pressedKeys.clear();
  };

  resetLatch = () => {
    // Reset sustain/latch state
    this.state.sustain = false;
    this.state.latch = false;
    if (this.onLatchChange) this.onLatchChange(false);
  };

  hexOn(coords, note_played, velocity_played, bend) {
    if (!bend) {
      bend = 0;
    }
    if (!velocity_played) {
      velocity_played = this.settings.midi_velocity;
    }
    if (!velocity_played) {
      velocity_played = 72;
    }
    const [
      cents,
      pressed_interval,
      steps,
      equaves,
      equivSteps,
      cents_prev,
      cents_next,
    ] = this.hexCoordsToCents(coords);
    const [color, text_color] = this.centsToColor(
      cents,
      true,
      pressed_interval,
    );
    this.drawHex(coords, color, text_color);
    let degree0toRef_ratio = this.settings.degree0toRef_asArray[1]; // array[0] is cents, array[1] is the ratio
    const hex = this.synth.makeHex(
      coords,
      cents,
      steps,
      equaves,
      equivSteps,
      cents_prev,
      cents_next,
      note_played,
      velocity_played,
      bend,
      degree0toRef_ratio,
    );
    hex.noteOn();
    // Track in recency stack so wheel bend and snapshot can find this note.
    this.recencyStack.push(hex);
    this._updateWheelTarget();
    //console.log("hex on at ", [coords.x, coords.y]);
    return hex;
  }

  hexOff(coords) {
    const [cents, pressed_interval] = this.hexCoordsToCents(coords);
    const key = coords.x + "," + coords.y;
    const isSustained = this.state.sustainedCoords.has(key);
    const [color, text_color] = this.centsToColor(
      cents,
      isSustained,
      pressed_interval,
    );
    this.drawHex(coords, color, text_color);
  }

  noteOff(hex, release_velocity) {
    if (this.state.sustain) {
      // Check for duplicate by coords, not object reference
      const key = hex.coords.x + "," + hex.coords.y;
      const alreadySustained = this.state.sustainedNotes.some(
        ([h]) => h.coords.x === hex.coords.x && h.coords.y === hex.coords.y,
      );

      if (!alreadySustained) {
        this.state.sustainedNotes.push([hex, release_velocity]);
        // Keep the hex visually lit while it's sustained
        const key = hex.coords.x + "," + hex.coords.y;
        this.state.sustainedCoords.add(key);
        const [cents, pressed_interval] = this.hexCoordsToCents(hex.coords);
        const [color, text_color] = this.centsToColor(
          cents,
          true,
          pressed_interval,
        );
        this.drawHex(hex.coords, color, text_color);
      }
    } else {
      hex.noteOff(release_velocity);
      // Note is going silent — remove from recency stack and update wheel target.
      this.recencyStack.remove(hex);
      this._updateWheelTarget();
    }
  }

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
      const [color, text_color] = this.centsToColor(
        cents,
        false,
        pressed_interval,
      );
      this.drawHex(hex.coords, color, text_color);
      hex.noteOff(notesToRelease[note][1]);
      this.recencyStack.remove(hex);
    }
    this._updateWheelTarget();
    // Fire React callback AFTER all visual/audio cleanup — Preact may flush
    // synchronously and trigger a re-render that redraws hexes mid-cleanup.
    if (this.onLatchChange) this.onLatchChange(false);
    // tempAlert('Sustain Off', 900);
  }

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
          this.state.sustainedCoords.add(hex.coords.x + "," + hex.coords.y);
        }
      }
    }
  }

  /**************** Event Handlers ****************/

  motionScan = () => {
    const { x1, x2, y1, y2, z1, z2, lastShakeCount, lastShakeCheck } =
      this.state.shake;
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
    }

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
    const newWidth = window.innerWidth;
    const newHeight = window.innerHeight;

    this.state.canvas.style.width = newWidth + "px";
    this.state.canvas.style.height = newHeight + "px";
    this.state.canvas.style.left = "0px";
    this.state.canvas.style.top = "0px";
    this.state.canvas.style.marginLeft = "";
    this.state.canvas.style.marginTop = "";

    this.state.canvas.width = newWidth;
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

    this.state.rotationMatrix = calculateRotationMatrix(
      -this.settings.rotation,
      this.state.centerpoint,
    );

    // I don't know why these need to be the opposite sign of each other.
    let m = calculateRotationMatrix(
      this.settings.rotation,
      this.state.centerpoint,
    );
    this.state.context.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);

    // Redraw Grid
    this.drawGrid();

    // Rebuild the steps→coords lookup table now that centerpoint and grid range
    // are up to date. Must come after drawGrid() so centerpoint is already set.
    this.buildStepsTable();

  };

  inputIsFocused = () => {
    const tag = document.activeElement && document.activeElement.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  };

  onKeyDown = (e) => {
    // DEBUG: check what key code is produced
    // console.log('Key pressed:', e.code, e.key);

    // Delete : Panic - kill all notes
    if (
      (e.code === "Delete" && !e.repeat) ||
      (e.code === "Backspace" && !e.repeat)
    ) {
      this.panic();
      return;
    }

    // Escape: toggle sustain. Track escHeld separately because clicking
    // the canvas while Escape is held fires a spurious keyup immediately,
    // which would drop the sustain before mouse-up.

    if (e.code === "Escape" && !e.repeat) {
      this.state.escHeld = true;
      this.latchToggle();
      return;
    }

    // All other keys: only active when sidebar is closed (typing=false means sidebar closed).
    if (!this.typing) return;
    if (this.inputIsFocused()) return;

    // Block note-on if Command/Ctrl/Alt are held (browser shortcuts)
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    e.preventDefault();
    if (e.repeat) {
      return;
    } else if (e.code === "Space") {
      this.sustainOn();
    } else if (
      !this.state.isMouseDown &&
      !this.state.isTouchDown &&
      e.code in this.settings.keyCodeToCoords
    ) {
      // Shift+key: individual note sustain (latch for this specific key)
      // If key is already shift-sustained, release it
      if (e.shiftKey) {
        if (this.state.shiftSustainedKeys.has(e.code)) {
          // Release the shift-sustained note
          this.state.shiftSustainedKeys.delete(e.code);
          const kbOffset = this.settings.centerHexOffset;
          const kbRaw = this.settings.keyCodeToCoords[e.code];
          let coords = new Point(kbRaw.x + kbOffset.x, kbRaw.y + kbOffset.y);
          // Find and release the sustained hex
          let hexIndex = this.state.sustainedNotes.findIndex(
            ([h]) => h.coords.x === coords.x && h.coords.y === coords.y,
          );
          if (hexIndex !== -1) {
            const [hex, vel] = this.state.sustainedNotes[hexIndex];
            this.state.sustainedNotes.splice(hexIndex, 1);
            const key = coords.x + "," + coords.y;
            this.state.sustainedCoords.delete(key);
            this.hexOff(coords);
            hex.noteOff(vel);
          }
          // Also remove from activeHexObjects if present
          let activeIndex = this.state.activeHexObjects.findIndex(
            (h) => h.coords.x === coords.x && h.coords.y === coords.y,
          );
          if (activeIndex !== -1) {
            this.state.activeHexObjects.splice(activeIndex, 1);
          }
        } else {
          // Play note and shift-sustain it
          this.state.pressedKeys.add(e.code);
          this.state.shiftSustainedKeys.add(e.code);
          const kbOffset = this.settings.centerHexOffset;
          const kbRaw = this.settings.keyCodeToCoords[e.code];
          let coords = new Point(kbRaw.x + kbOffset.x, kbRaw.y + kbOffset.y);
          let hex = this.hexOn(coords);
          this.state.activeHexObjects.push(hex);
          // Add to sustained notes immediately
          this.state.sustainedNotes.push([hex, 0]);
          const key = coords.x + "," + coords.y;
          this.state.sustainedCoords.add(key);
        }
      } else {
        // No Shift: check if this key was shift-sustained, if so release it
        if (this.state.shiftSustainedKeys.has(e.code)) {
          this.state.shiftSustainedKeys.delete(e.code);
          const kbOffset = this.settings.centerHexOffset;
          const kbRaw = this.settings.keyCodeToCoords[e.code];
          let coords = new Point(kbRaw.x + kbOffset.x, kbRaw.y + kbOffset.y);
          // Find and release the sustained hex
          let hexIndex = this.state.sustainedNotes.findIndex(
            ([h]) => h.coords.x === coords.x && h.coords.y === coords.y,
          );
          if (hexIndex !== -1) {
            const [hex, vel] = this.state.sustainedNotes[hexIndex];
            this.state.sustainedNotes.splice(hexIndex, 1);
            const key = coords.x + "," + coords.y;
            this.state.sustainedCoords.delete(key);
            this.hexOff(coords);
            hex.noteOff(vel);
          }
          // Also remove from activeHexObjects if present
          let activeIndex = this.state.activeHexObjects.findIndex(
            (h) => h.coords.x === coords.x && h.coords.y === coords.y,
          );
          if (activeIndex !== -1) {
            this.state.activeHexObjects.splice(activeIndex, 1);
          }
        } else if (!this.state.pressedKeys.has(e.code)) {
          // Calculate coords for this key
          const kbOffset = this.settings.centerHexOffset;
          const kbRaw = this.settings.keyCodeToCoords[e.code];
          let coords = new Point(kbRaw.x + kbOffset.x, kbRaw.y + kbOffset.y);

          // When latch is active, check if this note is already sustained
          // If so, toggle it off (same behavior as mouse/touch)
          if (this.state.latch) {
            const key = coords.x + "," + coords.y;
            const sustainedIdx = this.state.sustainedNotes.findIndex(
              ([h]) => h.coords.x === coords.x && h.coords.y === coords.y,
            );
            if (sustainedIdx !== -1) {
              // Toggle off: release the sustained note
              const [hex, vel] = this.state.sustainedNotes[sustainedIdx];
              this.state.sustainedNotes.splice(sustainedIdx, 1);
              this.state.sustainedCoords.delete(key);
              hex.noteOff(vel);
              this.hexOff(coords);
              return; // Don't trigger a new note
            }
          }

          // Normal note-on (no latch, or note not sustained)
          this.state.pressedKeys.add(e.code);
          let hex = this.hexOn(coords);
          this.state.activeHexObjects.push(hex);
        }
      }
    }
  };

  onKeyUp = (e) => {
    if (e.code === "Escape") {
      this.state.escHeld = false;
      // Escape is now latch (toggle) — no release action on key-up
      return;
    }

    // Only process other keys when sidebar is closed and no input is focused
    if (!this.typing) return;
    if (this.inputIsFocused()) return;

    if (e.code === "Space") {
      this.sustainOff(true); // force-release overrides latch
    } else if (
      !this.state.isMouseDown &&
      !this.state.isTouchDown &&
      e.code in this.settings.keyCodeToCoords
    ) {
      // Skip release for shift-sustained keys - they stay held until re-pressed without Shift
      if (this.state.shiftSustainedKeys.has(e.code)) {
        // Remove from pressedKeys but keep in shiftSustainedKeys and sustainedNotes
        this.state.pressedKeys.delete(e.code);
        return;
      }
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
    // Gate on isMouseDown — only true if this drag started on the canvas.
    // This correctly handles both off-canvas releases (processes activeHexObjects)
    // and UI button clicks (isMouseDown was never set, so we ignore them).
    if (!this.state.isMouseDown) return;
    this.state.isMouseDown = false;
    this.state.mouseDownToggledCoord = null;

    if (this.state.pressedKeys.size != 0 || this.state.isTouchDown) return;

    this.state.canvas.removeEventListener("mousemove", this.mouseActive);

    for (const hex of this.state.activeHexObjects) {
      if (!this.state.sustain) this.hexOff(hex.coords);
      this.noteOff(hex, 0);
    }
    this.state.activeHexObjects = [];

    // If Escape keyup fired spuriously while mouse was down,
    // release sustain now. But not if a tune-handle drag is in progress.
    if (!this.state.escHeld && this.state.sustain && !this.state.isTuneDragging) {
      this.sustainOff();
    }
  };

  mouseDown = (e) => {
    if (this.state.pressedKeys.size != 0 || this.state.isTouchDown) return;

    // Clean up stale activeHexObjects (e.g. mouseUp fired off-canvas).
    // Call hex.noteOff directly — bypassing noteOff() — so stale notes
    // are silenced outright rather than being routed into sustainedNotes.
    for (const hex of this.state.activeHexObjects) {
      hex.noteOff(0);
    }
    this.state.activeHexObjects = [];

    this.state.mouseDownToggledCoord = null;
    this.state.isMouseDown = true;
    this.state.canvas.addEventListener("mousemove", this.mouseActive, false);
    this.mouseActive(e);
  };

  mouseActive = (e) => {
    let coords = this.getPointerPosition(e);
    coords = this.getHexCoordsAt(coords);

    if (this.state.activeHexObjects.length == 0) {
      // When latch is active, clicking a sustained hex toggles it off.
      if (this.state.latch) {
        const key = coords.x + "," + coords.y;
        const sustainedIdx = this.state.sustainedNotes.findIndex(
          ([h]) => h.coords.x === coords.x && h.coords.y === coords.y,
        );
        if (sustainedIdx !== -1) {
          const [hex, vel] = this.state.sustainedNotes[sustainedIdx];
          this.state.sustainedNotes.splice(sustainedIdx, 1);
          this.state.sustainedCoords.delete(key);
          hex.noteOff(vel);
          this.hexOff(coords);
          this.state.mouseDownToggledCoord = key;
          return;
        }
        // Guard: don't re-play a coord just toggled off this click
        if (this.state.mouseDownToggledCoord === key) return;
      }
      this.state.activeHexObjects[0] = this.hexOn(coords);
    } else {
      let first = this.state.activeHexObjects[0];
      if (!coords.equals(first.coords)) {
        // When sliding TO a sustained note, check by coords, not object reference.
        if (this.state.latch) {
          const key = coords.x + "," + coords.y;
          const sustainedIdx = this.state.sustainedNotes.findIndex(
            ([h]) => h.coords.x === coords.x && h.coords.y === coords.y,
          );
          if (sustainedIdx !== -1) {
            // Release old active hex
            this.hexOff(first.coords);
            this.noteOff(first, 0);
            this.state.activeHexObjects = [];
            // Toggle off the sustained note
            const [hex, vel] = this.state.sustainedNotes[sustainedIdx];
            this.state.sustainedNotes.splice(sustainedIdx, 1);
            this.state.sustainedCoords.delete(key);
            hex.noteOff(vel);
            this.hexOff(coords);
            this.state.mouseDownToggledCoord = key;
            return;
          }
        }
        // Normal slide to new hex
        this.hexOff(first.coords);
        this.noteOff(first, 0);
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
  }

  getPosition(element) {
    // Legacy offsetParent walk — kept for reference but no longer used.
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  }

  handleTouch = (e) => {
    e.preventDefault();
    if (this.state.pressedKeys.size != 0 || this.state.isMouseDown) {
      this.state.isTouchDown = false;
      return;
    }
    this.state.isTouchDown = e.targetTouches.length != 0;

    for (let i = 0; i < this.state.activeHexObjects.length; i++) {
      this.state.activeHexObjects[i].release = true;
    }

    for (let i = 0; i < e.targetTouches.length; i++) {
      const rect = this.state.canvas.getBoundingClientRect();
      let coords = this.getHexCoordsAt(
        new Point(
          e.targetTouches[i].clientX - rect.left,
          e.targetTouches[i].clientY - rect.top,
        ),
      );
      let found = false;

      for (let j = 0; j < this.state.activeHexObjects.length; j++) {
        if (coords.equals(this.state.activeHexObjects[j].coords)) {
          this.state.activeHexObjects[j].release = false;
          found = true;
        }
      }

      if (!found) {
        // When latch is active, check if this coord is in sustainedNotes —
        // if so, release it (toggle off) rather than triggering a new note.
        if (this.state.latch) {
          const key = coords.x + "," + coords.y;
          const sustainedIdx = this.state.sustainedNotes.findIndex(
            ([h]) => h.coords.x === coords.x && h.coords.y === coords.y,
          );
          if (sustainedIdx !== -1) {
            const [hex, vel] = this.state.sustainedNotes[sustainedIdx];
            this.state.sustainedNotes.splice(sustainedIdx, 1);
            this.state.sustainedCoords.delete(key);
            hex.noteOff(vel);
            this.hexOff(coords);
            found = true; // don't trigger a new note
          }
        }
      }

      if (!found) {
        let newHex = this.hexOn(coords);
        this.state.activeHexObjects.push(newHex);
      }
    }

    for (let i = this.state.activeHexObjects.length - 1; i >= 0; i--) {
      if (this.state.activeHexObjects[i].release) {
        if (!this.state.sustain)
          this.hexOff(this.state.activeHexObjects[i].coords);
        this.noteOff(this.state.activeHexObjects[i], 0);
        this.state.activeHexObjects.splice(i, 1);
      }
    }
  };

  // Handle touchcancel - when the browser cancels a touch (e.g., gesture, notification)
  // This prevents notes from getting stuck on mobile
  handleTouchCancel = (e) => {
    this.state.isTouchDown = false;

    // Release all active touch notes
    for (let i = this.state.activeHexObjects.length - 1; i >= 0; i--) {
      const hex = this.state.activeHexObjects[i];
      if (!this.state.sustain) this.hexOff(hex.coords);
      this.noteOff(hex, 0);
      this.state.activeHexObjects.splice(i, 1);
    }
  };

  /**************** Rendering ****************/

  drawGrid() {
    let max =
      this.state.centerpoint.x > this.state.centerpoint.y
        ? this.state.centerpoint.x / this.settings.hexSize
        : this.state.centerpoint.y / this.settings.hexSize;
    max = Math.floor(max);
    const ox = this.settings.centerHexOffset.x;
    const oy = this.settings.centerHexOffset.y;
    for (let r = -max + ox; r < max + ox; r++) {
      for (let dr = -max + oy; dr < max + oy; dr++) {
        let coords = new Point(r, dr);
        this.hexOff(coords);
      }
    }
  }

  // Returns the steps offset (in scale degrees) contributed by the MIDI channel.
  // Channel 1 is always home (offset 0). Each subsequent channel shifts by
  // stepsPerChannel degrees: null → one equave (equivSteps), 0 → no shift, N → N degrees.
  channelToStepsOffset(channel) {
    const stepsPerChannel = this.settings.midiin_steps_per_channel ?? this.settings.equivSteps;
    return (channel - 1) * stepsPerChannel;
  }

  // Builds a Map from steps (scale-degree distance from origin) to an array of
  // all visible coords that produce that steps value. Covers exactly the same
  // hex range as drawGrid(), so every lit hex is guaranteed to be on-screen.
  // Must be called after this.state.centerpoint is set and whenever layout
  // settings change (triggered via resizeHandler).
  buildStepsTable() {
    const max = Math.floor(
      Math.max(this.state.centerpoint.x, this.state.centerpoint.y)
      / this.settings.hexSize
    );
    const ox = this.settings.centerHexOffset.x;
    const oy = this.settings.centerHexOffset.y;

    this.stepsTable = new Map();
    for (let r = -max + ox; r < max + ox; r++) {
      for (let dr = -max + oy; dr < max + oy; dr++) {
        const coords = new Point(r, dr);
        // hexCoordsToCents returns [cents, reducedSteps, distance, ...];
        // 'distance' (index 2) is the raw step count from the origin — our key.
        const [, , steps] = this.hexCoordsToCents(coords);
        if (!this.stepsTable.has(steps)) {
          this.stepsTable.set(steps, []);
        }
        this.stepsTable.get(steps).push(coords);
      }
    }
  }

  // Returns all visible coords for a given steps value, or [] if none on screen.
  // Used by midinoteOff / allnotesOff to scan activeHexObjects for the coord
  // that was actually activated — must return the full candidate list.
  stepsToVisibleCoords(steps) {
    return this.stepsTable?.get(steps) ?? [];
  }

  // ── Recency-stack wheel bend ──────────────────────────────────────────────
  //
  // _handleWheelBend is the universal entry point: call it with any 14-bit
  // value (0–16383, centre 8192) from any controller — wheel, expression pedal,
  // OSC, or the future mod-matrix.  It targets the front of the recency stack.
  //
  // _updateWheelTarget is called whenever the stack changes (noteOn/Off/panic)
  // to silently redirect the current bend to the new front note.
  //
  // Snapshot integration (future): capture `_wheelBaseCents + _wheelBend` as
  // the committed new pitch for _wheelTarget, then reset _wheelBend to 0.

  _handleWheelBend(val14) {
    // Default ±200 cents (2 semitones) — will become a setting.
    const rangeCents = this.settings.midi_wheel_range ?? 200;
    this._wheelBend = ((val14 - 8192) / 8192) * rangeCents;

    const target = this.recencyStack.front;
    if (!target) return;

    // Ensure we have the right base — handles the case where _updateWheelTarget
    // set a new target and the wheel moved before the next noteOn/Off.
    if (this._wheelTarget !== target) {
      if (this._wheelTarget && this._wheelBend === 0) {
        // Wheel is at centre — safe to silently adopt new target.
      }
      this._wheelTarget = target;
      this._wheelBaseCents = target.cents;
    }

    target.retune(this._wheelBaseCents + this._wheelBend);
  }

  // Called whenever the recency stack changes.  If the front note has changed,
  // resets the old target to its base pitch and redirects bend to the new front.
  _updateWheelTarget() {
    const newFront = this.recencyStack.front;
    if (newFront === this._wheelTarget) return; // no change

    // Reset pitch on the old target only if it's still sounding.
    // If it has been released its channel may have been reallocated,
    // and retuning it would send a spurious PB to the new note.
    if (this._wheelTarget && !this._wheelTarget.release &&
      this._wheelBaseCents !== null) {
      this._wheelTarget.retune(this._wheelBaseCents);
    }

    this._wheelTarget = newFront;

    if (newFront) {
      // Capture the new target's unmodified pitch as the bend origin.
      this._wheelBaseCents = newFront.cents;
      // Apply the current wheel position immediately if it's non-zero.
      if (this._wheelBend !== 0) {
        newFront.retune(this._wheelBaseCents + this._wheelBend);
      }
    } else {
      this._wheelBaseCents = null;
    }
  }

  // Desaturate a CSS hex colour toward grey by the given amount (0=none, 1=full grey).
  _desaturateColor(hex, amount) {
    if (!hex || hex.length < 6) return hex;
    const h = hex.replace('#', '');
    if (h.length < 6) return hex;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const grey = 0.299 * r + 0.587 * g + 0.114 * b;
    const nr = Math.round(r + (grey - r) * amount);
    const ng = Math.round(g + (grey - g) * amount);
    const nb = Math.round(b + (grey - b) * amount);
    return '#' + [nr, ng, nb].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  // Returns the single best coord for a note-on.
  //
  // Strategy: decaying anchor + radius gate.
  //
  // The anchor starts at lastMidiCoords and is pulled 15% of the way back
  // toward screen centre on every call, so a melodic run stays local while
  // a drift toward the edge is continuously corrected. Candidates outside
  // 75% of the screen half-dimension are filtered out first (gate); if every
  // candidate is outside the gate we fall back to the full set so there is
  // always a result. Among survivors, pick the one nearest the anchor.
  //
  // Returns null only when no candidates exist at all.
  bestVisibleCoord(steps) {
    const candidates = this.stepsToVisibleCoords(steps);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const cx = this.state.centerpoint.x;
    const cy = this.state.centerpoint.y;

    // Decay anchor 15% back toward centre each note.
    const DECAY = 0.15;
    const last = this.state.lastMidiCoords;
    const anchorX = last ? last.x + DECAY * (cx - last.x) : cx;
    const anchorY = last ? last.y + DECAY * (cy - last.y) : cy;

    // Gate: exclude candidates whose screen position is beyond 75% of the
    // smaller half-dimension (keeps notes away from the canvas edge).
    const GATE_FRACTION = 0.75;
    const gate = GATE_FRACTION * Math.min(cx, cy); // cx,cy are half-dimensions
    const gate2 = gate * gate;

    let pool = candidates.filter((coords) => {
      const s = this.hexCoordsToScreen(coords);
      const dx = s.x - cx;
      const dy = s.y - cy;
      return dx * dx + dy * dy <= gate2;
    });

    // Safety fallback: if every candidate is outside the gate use them all.
    if (pool.length === 0) pool = candidates;

    // Pick the pool member nearest to the decayed anchor.
    let best = null;
    let bestDist = Infinity;
    for (const coords of pool) {
      const s = this.hexCoordsToScreen(coords);
      const dx = s.x - anchorX;
      const dy = s.y - anchorY;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = coords;
      }
    }
    return best;
  }

  hexCoordsToScreen(hex) {
    /* Point */
    const ox = this.settings.centerHexOffset.x;
    const oy = this.settings.centerHexOffset.y;
    let screenX =
      this.state.centerpoint.x +
      (hex.x - ox) * this.settings.hexWidth +
      ((hex.y - oy) * this.settings.hexWidth) / 2;
    let screenY =
      this.state.centerpoint.y + (hex.y - oy) * this.settings.hexVert;
    return new Point(screenX, screenY);
  }

  drawHex(p, c, current_text_color) {
    /* Point, color */
    let context = this.state.context;
    let hexCenter = this.hexCoordsToScreen(p);

    // Calculate hex vertices

    let x = [];
    let y = [];
    for (let i = 0; i < 6; i++) {
      let angle = ((2 * Math.PI) / 6) * (i + 0.5);
      x[i] = hexCenter.x + this.settings.hexSize * Math.cos(angle);
      y[i] = hexCenter.y + this.settings.hexSize * Math.sin(angle);
    }

    // Draw filled hex  (controller overlay disabled — TODO re-enable after debug)

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
      let angle = ((2 * Math.PI) / 6) * (i + 0.5);
      // TODO hexSize should already be a number
      x2[i] =
        hexCenter.x + (parseFloat(this.settings.hexSize) + 3) * Math.cos(angle);
      y2[i] =
        hexCenter.y + (parseFloat(this.settings.hexSize) + 3) * Math.sin(angle);
    }

    // Draw shadowed stroke outside clip to create pseudo-3d effect

    context.beginPath();
    context.moveTo(x2[0], y2[0]);
    for (let i = 1; i < 6; i++) {
      context.lineTo(x2[i], y2[i]);
    }
    context.closePath();
    context.strokeStyle = "darkgray";
    context.lineWidth = 5;
    context.shadowBlur = 15;
    context.shadowColor = "black";
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
    context.lineJoin = "round";
    context.strokeStyle = "slategray";
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
    // TO DO !!! this should be parsed already
    let equivSteps = this.settings.scale.length;
    let equivMultiple = Math.floor(note / equivSteps);
    let reducedNote = note % equivSteps;
    if (reducedNote < 0) {
      reducedNote = equivSteps + reducedNote;
    }

    if (!this.settings.no_labels) {
      let name;
      if (this.settings.degree) {
        name = "" + reducedNote;
      } else if (this.settings.note) {
        // Safe access: if note_names is undefined or index out of bounds, show nothing
        name = this.settings.note_names?.[reducedNote] ?? "";
      } else if (this.settings.scala) {
        // Safe access: scala_names should always exist if scale exists, but be defensive
        name = this.settings.scala_names?.[reducedNote] ?? "";
      } else if (this.settings.cents) {
        name =
          Math.round(
            (this.settings.scale[reducedNote] -
              this.settings.scale[this.settings.reference_degree] +
              1200) %
            1200,
          ).toString() + ".";
      }

      if (name) {
        context.save();
        let scaleFactor = name.length > 3 ? 3.58 / name.length : 1;
        scaleFactor *= this.settings.hexSize / 46;
        context.scale(scaleFactor, scaleFactor);
        context.fillText(name, 0, 0);
        context.restore();
      }

      // TO DO !! make these into CSS settings ? font and colour ?

      let scaleFactor = this.settings.hexSize / 50;
      context.scale(scaleFactor, scaleFactor);
      context.translate(12, -30);
      context.fillStyle = getContrastYIQ_2(current_text_color);
      context.font = "14pt Plainsound Sans";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(equivMultiple, 0, 0);
    }

    context.restore();
  }

  centsToColor(cents, pressed, pressed_interval) {
    let returnColor;

    if (!this.settings.spectrum_colors) {
      // Safe access: check note_colors exists before indexing
      const colors = this.settings.note_colors;
      if (!colors || typeof colors[pressed_interval] === "undefined") {
        returnColor = "#EDEDE4";
      } else {
        returnColor = colors[pressed_interval];
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

      return [
        rgb(returnColor[0], returnColor[1], returnColor[2]),
        current_text_color,
      ];
    }

    let fcolor = hex2rgb("#" + this.settings.fundamental_color);
    fcolor = rgb2hsv(fcolor[0], fcolor[1], fcolor[2]);

    let h = fcolor.h / 360;
    let s = fcolor.s / 100;
    let v = fcolor.v / 100;

    let reduced = (cents / 1200) % 1;
    if (reduced < 0) reduced += 1;
    h = (reduced + h) % 1;

    v = pressed ? v - v / 2 : v;

    returnColor = HSVtoRGB(h, s, v);

    // setup text color
    let tcolor = HSVtoRGB2(h, s, v);
    const current_text_color = rgbToHex(tcolor.red, tcolor.green, tcolor.blue);
    return [returnColor, current_text_color];
  }

  roundTowardZero(val) {
    if (val < 0) {
      return Math.ceil(val);
    }
    return Math.floor(val);
  }

  hexCoordsToCents(coords) {
    let distance =
      coords.x * this.settings.rSteps + coords.y * this.settings.drSteps;
    let octs = this.roundTowardZero(distance / this.settings.scale.length);
    let octs_prev = this.roundTowardZero(
      (distance - 1) / this.settings.scale.length,
    );
    let octs_next = this.roundTowardZero(
      (distance + 1) / this.settings.scale.length,
    );
    let reducedSteps = distance % this.settings.scale.length;
    let reducedSteps_prev = (distance - 1) % this.settings.scale.length;
    let reducedSteps_next = (distance + 1) % this.settings.scale.length;
    let equivSteps = this.settings.equivSteps;
    if (reducedSteps < 0) {
      reducedSteps += this.settings.scale.length;
      octs -= 1;
    }
    if (reducedSteps_prev < 0) {
      reducedSteps_prev += this.settings.scale.length;
      octs_prev -= 1;
    }
    if (reducedSteps_next < 0) {
      reducedSteps_next += this.settings.scale.length;
      octs_next -= 1;
    }
    // octave_offset shifts all pitches by N equaves without rebuilding
    const octOff = this.settings.octave_offset || 0;
    let cents =
      (octs + octOff) * this.settings.equivInterval + this.settings.scale[reducedSteps];
    let cents_prev =
      (octs_prev + octOff) * this.settings.equivInterval +
      this.settings.scale[reducedSteps_prev];
    let cents_next =
      (octs_next + octOff) * this.settings.equivInterval +
      this.settings.scale[reducedSteps_next];
    /*  let dataArray = [
      "cents = ", cents,
      "reducedSteps = ", reducedSteps,
      "distance = ", distance,
      "octs = ", octs,
      "equivSteps = ", equivSteps,
      "cents_prev = ", cents_prev,
      "cents_next = ", cents_next
    ]
    console.log("hexCoordsToCents at coords: ", coords, dataArray); */
    return [
      cents,
      reducedSteps,
      distance,
      octs,
      equivSteps,
      cents_prev,
      cents_next,
    ];
  }

  getHexCoordsAt(coords) {
    coords = applyMatrixToPoint(this.state.rotationMatrix, coords);
    const ox = this.settings.centerHexOffset.x;
    const oy = this.settings.centerHexOffset.y;
    let x = coords.x - this.state.centerpoint.x;
    let y = coords.y - this.state.centerpoint.y;

    let q = ((x * Math.sqrt(3)) / 3 - y / 3) / this.settings.hexSize;
    let r = (y * 2) / 3 / this.settings.hexSize;

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
    }

    return closestHex;
  }
}

export default Keys;

function degree0ToRef(reference_degree, scale) {
  let degree0_to_reference_asArray = [0, 1];
  if (reference_degree > 0) {
    degree0_to_reference_asArray[0] = scale[reference_degree];
    degree0_to_reference_asArray[1] =
      2 ** (degree0_to_reference_asArray[0] / 1200); // offset ratio
  }

  return degree0_to_reference_asArray;
}

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
  const signR = rSteps >= 0 ? 1 : -1;
  const signDR = drSteps >= 0 ? 1 : -1;
  const d = degree / g;
  const r0 = d * bx * signR;
  const dr0 = d * by * signDR;
  // All solutions: (r0 + k * stepR, dr0 + k * stepDR) for integer k
  const stepR = drSteps / g;
  const stepDR = -rSteps / g;
  // Pick k that minimises r² + dr²
  const denom = stepR * stepR + stepDR * stepDR;
  const k = denom ? Math.round(-(r0 * stepR + dr0 * stepDR) / denom) : 0;
  return new Point(r0 + k * stepR, dr0 + k * stepDR);
}

/**
 * Default tuning-map anchor when no MIDI controller has set midiin_central_degree.
 * Returns the nearest MIDI note to the frequency of the on-screen centre hex,
 * which is typically in the A3–A4 range and gives good coverage either side.
 *
 * @param {number}   fundamental         Hz assigned to reference_degree
 * @param {number}   degree0toRef_cents  cents from degree 0 to reference degree
 *                                       (= settings.degree0toRef_asArray[0])
 * @param {number[]} scale               numeric-cents scale array (scale[0] = 0)
 * @param {number}   equivInterval       equivalence interval in cents (e.g. 1200)
 * @param {number}   center_degree       scale degree shown at screen centre
 */
function computeNaturalAnchor(fundamental, degree0toRef_cents, scale, equivInterval, center_degree) {
  // Absolute position of scale degree 0 in MIDI note space
  const degree0_midi = 69 + (1200 * Math.log2(fundamental / 440) - degree0toRef_cents) / 100;
  // Pitch of center_degree from degree 0 in cents
  const cd = center_degree || 0;
  let octs = Math.floor(cd / scale.length);
  let red = ((cd % scale.length) + scale.length) % scale.length;
  const center_pitch_cents = octs * equivInterval + scale[red];
  return Math.max(0, Math.min(127, Math.round(degree0_midi + center_pitch_cents / 100)));
}

function mtsTuningMap(
  sysex_type,
  device_id,
  tuning_map_number,
  tuning_map_degree0,
  scale,
  name,
  equave,
  fundamental,
  degree0toRef_asArray,
) {
  //console.log("mts-input-scale:", scale)
  if (parseInt(sysex_type) === 127) {
    let header = [127, device_id, 8, 2, tuning_map_number, 1]; // sysex real-time single-note tuning change of tuning map, 128 notes
    let fundamental_cents = 1200 * Math.log2(fundamental / 440);
    let degree_0_cents = fundamental_cents - degree0toRef_asArray[0];
    let map_offset = degree_0_cents - 100 * (tuning_map_degree0 - 69);
    let mts_data = [];

    for (let i = 0; i < 128; i++) {
      mts_data[i] = [127, 127, 127];
      // target_cents: pitch of slot i in cents, measured from degree_0_cents.
      // tuning_map_degree0 is the MIDI note anchor; target_cents is the offset from it.
      // centsToMTS(note, bend): note = float MIDI anchor, bend = cents offset from that anchor.
      const target_cents =
        scale[(i - tuning_map_degree0 + 128 * scale.length) % scale.length] +
        map_offset +
        equave *
        (Math.floor(
          (i - tuning_map_degree0 + 128 * scale.length) / scale.length,
        ) -
          128);
      if (typeof target_cents === "number") {
        mts_data[i] = centsToMTS(tuning_map_degree0, target_cents);
        //console.log("mts_data[", i, "]:", mts_data[i]);
      }
    }

    let sysex = [];
    for (let j = 0; j < 128; j++) {
      sysex[j] = [];
      for (let i = 0; i < header.length; i++) {
        sysex[j].push(header[i]);
      }
      sysex[j].push(j);
      sysex[j].push(mts_data[j][0]);
      sysex[j].push(mts_data[j][1]);
      sysex[j].push(mts_data[j][2]);
    }
    //console.log("mts-tuning_map", sysex);
    return sysex;
  } else if (parseInt(sysex_type) === 126) {
    let name_array = Array.from(name);
    let ascii_name = [];
    for (let i = 0; i < 16; i++) {
      let char = 32;
      if (i < name_array.length) {
        char = name_array[i].charCodeAt();
      }
      if (char > 31 && char < 128) {
        ascii_name.push(char);
      } else {
        ascii_name.push(32); // pad with spaces if needed
      }
    }

    let header = [126, device_id, 8, 1, tuning_map_number]; // non-real-time bulk tuning dump (0x7E=126): 128 notes
    for (let i = 0; i < 16; i++) {
      header.push(ascii_name[i]);
    }
    let fundamental_cents = 1200 * Math.log2(fundamental / 440);
    let degree_0_cents = fundamental_cents - degree0toRef_asArray[0];
    let map_offset = degree_0_cents - 100 * (tuning_map_degree0 - 69);
    let mts_data = [];

    for (let i = 0; i < 128; i++) {
      mts_data[i] = [127, 127, 127];
      const target_cents =
        scale[(i - tuning_map_degree0 + 128 * scale.length) % scale.length] +
        map_offset +
        equave *
        (Math.floor(
          (i - tuning_map_degree0 + 128 * scale.length) / scale.length,
        ) -
          128);
      if (typeof target_cents === "number") {
        mts_data[i] = centsToMTS(tuning_map_degree0, target_cents);
      }
    }

    // Clamp entries that fell out of MTS range to their nearest valid value.
    // [127,127,127] is reserved as "no tuning data" — replace with max valid.
    for (let i = 0; i < 128; i++) {
      if (
        mts_data[i][0] === 127 &&
        mts_data[i][1] === 127 &&
        mts_data[i][2] === 127
      ) {
        mts_data[i] = [127, 127, 126]; // highest valid MTS value
      }
    }

    // Build sysex payload: header + 128×3 tuning bytes.
    // Note: header starts with 126 (0x7E = universal non-real-time manufacturer ID).
    // sendSysex(manufacturer, data) will wrap with F0…F7, so we shift 126 off
    // and pass the rest as data — checksum must be computed on the data portion only.
    let sysex = [];
    for (let i = 0; i < header.length; i++) {
      sysex.push(header[i]);
    }
    for (let i = 0; i < 128; i++) {
      sysex.push(mts_data[i][0]);
      sysex.push(mts_data[i][1]);
      sysex.push(mts_data[i][2]);
    }

    // Checksum per MTS spec: XOR of all bytes from device_id through last tuning byte,
    // masked to 7 bits. sysex[0] is 126 (manufacturer), so start from index 1.
    let checksum = 0;
    for (let i = 1; i < sysex.length; i++) {
      checksum ^= sysex[i];
    }
    checksum &= 0x7f;
    sysex.push(checksum);

    return sysex;
  }
}