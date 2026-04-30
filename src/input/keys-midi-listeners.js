import Point from "../keyboard/point.js";
import { WebMidi } from "webmidi";
import { keymap, notes } from "../midi_synth";
import { scalaToCents } from "../settings/scale/parse-scale";
import { detectController, getAnchorNote, getControllerById } from "../controllers/registry.js";
import { debugLog } from "../debug/logging.js";

export function setupMidiInput() {
    //console.log('[Keys] MIDI init — device:', JSON.stringify(this.settings.midiin_device), 'passthrough:', this.settings.midi_passthrough);
    if (this.settings.midiin_device !== "OFF") {
      // get the MIDI noteons and noteoffs to play the internal sounds

      try {
        this.midiin_data = WebMidi.getInputById(this.settings.midiin_device);
      } catch {
        this.midiin_data = null;
      }
      if (!this.midiin_data) {
      } else {
        // this.midiin_data exists

        this._midiLearnCallback = null; // set by setMidiLearnMode()

        this.midiin_data.addListener("noteon", (e) => {
          // MIDI learn: capture the next note-on as the new anchor, don't play it.
          if (this._midiLearnCallback) {
            // Pass both note number and channel so multi-channel controllers
            // (e.g. Lumatone) can identify which block/channel the anchor is on.
            this._midiLearnCallback(e.note.number, e.message.channel);
            this._midiLearnCallback = null;
            return;
          }
          debugLog("MIDImonitoring", "noteon", {
            channel: e.message.channel,
            note: e.note.number,
            velocity: e.note.rawAttack,
          });
          this.midinoteOn(e);
          notes.played.unshift(e.note.number + 128 * (e.message.channel - 1));
        });

        this.midiin_data.addListener("noteoff", (e) => {
          debugLog("MIDImonitoring", "noteoff", {
            channel: e.message.channel,
            note: e.note.number,
            velocity: e.note.rawRelease,
          });
          this.midinoteOff(e);
          let index = notes.played.lastIndexOf(e.note.number + 128 * (e.message.channel - 1)); // eliminate note_played from array of played notes when using internal synth
          if (index >= 0) {
            let first_half = [];
            first_half = notes.played.slice(0, index);
            let second_half = [];
            second_half = notes.played.slice(index);
            second_half.shift();
            let newarray = [];
            notes.played = newarray.concat(first_half, second_half);
          }
        });

        this.midiin_data.addListener("keyaftertouch", (e) => {
          debugLog("MIDImonitoring", "keyaftertouch", {
            channel: e.message.channel,
            note: e.message.dataBytes[0],
            value: e.message.dataBytes[1],
          });
          // Polyphonic aftertouch for built-in synth — find the matching active hex
          // by matching note + channel encoding, then ramp its gain smoothly
          const note_played = e.message.dataBytes[0] + 128 * (e.message.channel - 1);
          const hex = this.state.activeMidi.get(note_played);
          this._applyPolyAftertouch(hex, e.message.dataBytes[1]);
        });

        // Universal CC listener — runs for all output modes.
        // 1. Passes all CCs through to the configured output channel(s).
        // 2. Consumes CC64/66/67 (sustain/sostenuto/soft) internally AND forwards.
        // 3. Consumes CC120/121/123 (all-sound-off/reset/all-notes-off) internally.
        // 4. Routes CC1/CC11 (modwheel/expression) to all active hexes (global broadcast).
        // 5. Routes CC74 (brightness) to the front-of-recency-stack hex (non-MPE mode).
        //    In MPE input mode (Step 3.5) CC74 will be routed per-channel instead.
        // LinnStrument User Firmware Mode: 14-bit X data buffer.
        // Key: `ch.col` (same as activeMidi key), value: LSB awaiting MSB.
        // On current hardware/firmware builds observed in Hexatone testing,
        // LinnStrument sends the X pair as LSB first, then MSB.
        this._linnUfXLsb = new Map();
        this._linnUfXCurrent = new Map(); // latest x14 per "ch.col" — snapshot at note-on for zero-point

        this.midiin_data.addListener("controlchange", (e) => {
          const cc = e.message.dataBytes[0];
          const value = e.message.dataBytes[1];
          debugLog("MIDImonitoring", "controlchange", { channel: e.message.channel, cc, value });

          // ── LinnStrument User Firmware Mode X data ────────────────────────
          // CC 1-25  = X MSB (col = CC, 1-indexed, ch = row).
          // CC 33-57 = X LSB (col = CC-32, 1-indexed, ch = row).
          // Combine to 14-bit value (0-4265 across the full pad width).
          if (this.controller?.id === "linnstrument") {
            if (cc >= 33 && cc <= 57) {
              // X — first CC of the pair (LSB)
              const col = cc - 32;
              const key = `${e.message.channel}.${col}`;
              this._linnUfXLsb.set(key, value);
              return;
            } else if (cc >= 1 && cc <= 25) {
              // X — second CC of the pair (MSB)
              const col = cc;
              const key = `${e.message.channel}.${col}`;
              const lsb = this._linnUfXLsb.get(key);
              if (lsb === undefined) return;
              this._linnUfXLsb.delete(key);
              const x14 = (value << 7) | lsb;           // 14-bit: 0 (left edge col 1) to ~2727 (right edge col 16) or ~4265 (col 25)
              this._linnUfXCurrent.set(key, x14);
              const note_played = col + 128 * (e.message.channel - 1);
              const hex = this.state.activeMidi.get(note_played);
              if (hex && !hex.release && hex.retune) {
                const COL_WIDTH = 171;                   // measured: 2727 / 16 ≈ 170.4
                const cellCentre = (col - 1) * COL_WIDTH + COL_WIDTH / 2;
                const deviation = (x14 - cellCentre) / (COL_WIDTH / 2); // −1…+1
                const curved = Math.sign(deviation) * Math.pow(Math.abs(deviation), 5); // x^5: wide stable centre, bends only at edges
                const rangeCents = scalaToCents(this.inputRuntime.wheelRange ?? "64/63");
                hex.retune(hex._baseCents + curved * rangeCents);
              }
              return;
            }
          }

          if (cc === 121) {
            this._controllerCCValues.clear();
            for (const resetCC of [1, 11, 64, 66, 67, 74]) {
              this._controllerCCValues.set(resetCC, 0);
            }
          } else if (cc !== 120 && cc !== 123) {
            this._controllerCCValues.set(cc, value);
          }

          // ── Passthrough to all active outputs ─────────────────────────────
          // CC74 is not forwarded in MTS mode — no meaningful mapping exists.
          const isMTSOutput =
            this.settings.midi_mapping === "MTS1" || this.settings.midi_mapping === "MTS2";
          if (!(cc === 74 && isMTSOutput)) this._passthroughCC(cc, value);

          // ── Internal consumption ──────────────────────────────────────────
          if (cc >= 65 && cc <= 89 && this.controller?.id === "linnstrument") {
            // LinnStrument User Firmware Mode Y data:
            // CC 65-89 = per-cell Y position, ch=row(1-8), cc-64=col(1-25).
            // This range overlaps sostenuto/soft pedal CCs — must be checked
            // first so those generic handlers don't swallow LinnStrument Y messages.
            const col = cc - 64;                                   // 1-indexed column
            const note_played = col + 128 * (e.message.channel - 1);
            const hex = this.state.activeMidi.get(note_played);
            this._applyTimbreCC74(hex, value); // Y → timbre/slide
          } else if (cc === 64) {
            // Sustain pedal
            if (value > 0) {
              this.sustainOn();
            } else {
              this.sustainOff();
            }
          } else if (cc === 66) {
            // Sostenuto — stub; full implementation in a later step
          } else if (cc === 67) {
            // Soft pedal — stub; full implementation in a later step
          } else if (cc === 120 || cc === 123) {
            // All Sound Off / All Notes Off
            this.allnotesOff();
          } else if (cc === 121) {
            // Reset All Controllers
            this.sustainOff();
          } else if (cc === 1) {
            // Mod wheel — broadcast to all active hexes (zone-wide)
            if (this.settings.midiin_device && this.settings.midiin_device !== "OFF") {
              sessionStorage.setItem("midiin_modwheel_value", String(value));
              sessionStorage.setItem("midiin_modwheel_source", this.settings.midiin_device);
            }
            for (const hex of this._allActiveHexes()) {
              if (hex.modwheel) hex.modwheel(value);
            }
          } else if (cc === 11) {
            // Expression — broadcast to all active hexes (zone-wide)
            for (const hex of this._allActiveHexes()) {
              if (hex.expression) hex.expression(value);
            }
          } else if (cc === 74) {
            // CC74 (timbre/slide): always routed to active hexes (sample synth filter,
            // MPE voice expression, etc.) regardless of output mode.
            // Passthrough to MTS output is suppressed above — no meaningful MTS mapping.
            if (this.inputRuntime.mpeInput) {
              // MPE input mode: CC74 is per-voice, carried on the note's channel.
              const entry = this.state.activeMidiByChannel.get(e.message.channel);
              if (entry && !entry.hex.release) this._applyTimbreCC74(entry.hex, value);
            } else {
              // Non-MPE: brightness to front of recency stack (global target).
              const front = this.recencyStack.front;
              if (front && front.cc74) front.cc74(value);
            }
          }

          this._rememberControllerStateInSynth();
        });

        // Universal channel-pressure (aftertouch) listener.
        this.midiin_data.addListener("channelaftertouch", (e) => {
          const value = e.message.dataBytes[0];
          debugLog("MIDImonitoring", "channelaftertouch", { channel: e.message.channel, value });
          this._channelPressureValue = value;

          if (this.inputRuntime.mpeInput) {
            // MPE input mode: channel pressure is per-voice, carried on the note's channel.
            // We've resolved which note it belongs to, so route as polyphonic aftertouch
            // (hex.aftertouch) rather than channel pressure (hex.pressure) — this lets
            // MTS output send 0xAn poly-AT with the correct carrier note number.
            const entry = this.state.activeMidiByChannel.get(e.message.channel);
            if (entry && !entry.hex.release) {
              this._applyPolyAftertouch(entry.hex, value);
            }
            return;
          }

          // Non-MPE: passthrough then dispatch by pressureMode.
          this._passthroughChannelPressure(value);

          if (this.inputRuntime.pressureMode === "all") {
            for (const hex of this._allActiveHexes()) {
              if (hex.pressure) hex.pressure(value);
            }
          } else {
            // 'recency' mode (default): target front of recency stack
            const front = this.recencyStack.front;
            if (front && front.pressure) front.pressure(value);
          }

          this._rememberControllerStateInSynth();
        });

        if (
          this.settings.output_mts &&
          this.settings.midi_device !== "OFF" &&
          this.settings.midi_channel >= 0
        ) {
          // forward other MIDI data through to output (only when MTS is enabled)
          this.midiout_data = WebMidi.getOutputById(this.settings.midi_device);

          // CC and channel-pressure passthrough is now handled by the universal
          // controlchange / channelaftertouch listeners above (_passthroughCC /
          // _passthroughChannelPressure).  Only per-mode pitchbend and keyaftertouch
          // passthrough with note-remapping logic are kept here.

          // Pitchbend passthrough is now handled universally by _passthroughPitchBend
          // (called from the universal 'pitchbend' listener below).
          // Only keyaftertouch listeners with note-remapping logic are kept here.

          if (this.settings.midi_mapping == "multichannel") {
            // Multichannel output — currently NOT USED, to be replaced by MTS bulk dump mode.
            this.midiin_data.addListener("keyaftertouch", (e) => {
              let note = e.message.dataBytes[0] + 128 * (e.message.channel - 1); // finds index of stored MTS data
              this.midiout_data.sendKeyAftertouch(keymap[note][0], e.message.dataBytes[1], {
                channels: keymap[note][6] + 1,
                rawValue: true,
              });
            });
          } else {
            // Single-channel output.
            if (this.settings.midi_mapping == "sequential") {
              // Sequential — inactive, to be replaced by MTS bulk dump mode.
              // Note-remapping: channel offset → equave shift → remapped output note.
              // Note that the channels-to-equave-transposition logic here will need
              // overhaul once static mapping per MIDI control surface is implemented.
              this.midiin_data.addListener("keyaftertouch", (e) => {
                // equaveShift: how many equaves this channel is transposed relative to
                // the anchor channel. Range -4...+3, wrapping at 8 channels.
                let equaveShift = e.message.channel - (this.settings.midiin_anchor_channel ?? 1);
                equaveShift = ((equaveShift + 20) % 8) - 4;
                // scaleStepShift: the same transposition expressed as scale degrees
                // (equaveShift × equivSteps), used to remap the output note number.
                const scaleStepShift = equaveShift * this.tuning.equivSteps;
                let note = (e.message.dataBytes[0] + scaleStepShift + 16 * 128) % 128;
                this.midiout_data.sendKeyAftertouch(note, e.message.dataBytes[1], {
                  channels: this.settings.midi_channel + 1,
                  rawValue: true,
                });
              });
            } else if (
              this.settings.midi_mapping == "MTS1" ||
              this.settings.midi_mapping == "MTS2"
            ) {
              this.midiin_data.addListener("keyaftertouch", (e) => {
                let note = e.message.dataBytes[0] + 128 * (e.message.channel - 1);
                this.midiout_data.sendKeyAftertouch(keymap[note][0], e.message.dataBytes[1], {
                  channels: this.settings.midi_channel + 1,
                  rawValue: true,
                });
              });
            }
          }
        } // end if (output_mts)
        // Detect controller geometry and build a direct coordinate lookup map.
        // registry.buildMap() returns Map<"ch.note", {x,y}> with the anchor at (0,0).
        // Adding centerHexOffset converts to absolute hex-grid coords — the same
        // space that hexOn() / hexOff() / hexCoordsToCents() operate in.
        // No best-fit search needed: the anchor key always lands at the screen centre.
        if (!this.coordResolver.stepsTable) this.coordResolver.buildStepsTable();
        {
          const deviceName = this.midiin_data.name?.toLowerCase() ?? "";
          const overrideId = this.settings.midiin_controller_override || "auto";
          //console.log('[Controller] MIDI input device name:', JSON.stringify(this.midiin_data.name));
          const entry =
            overrideId !== "auto" ? getControllerById(overrideId) : detectController(deviceName);
          if (entry) {
            this.controller = entry;
            // Multi-channel controllers (e.g. Lumatone) use a per-block note number (0–55),
            // stored in lumatone_center_note. Single-channel controllers use midiin_central_degree (0–127).
            // In sequential mode, controller geometry is bypassed — only step arithmetic is used.
            // But we still build the map so LED color sync works for single-channel controllers.
            const isSequential = this.settings.midi_passthrough;
            const useGeometryMap = !isSequential || !entry.multiChannel;

            if (useGeometryMap) {
              // For multi-channel controllers (Lumatone): validate anchor within valid ranges
              // For single-channel controllers: always build the map (for LED color sync)
              let anchorNote;
              let anchorChannel;

              if (entry.multiChannel) {
                // Multi-channel: use lumatone_center_note, lumatone_center_channel
                const constraints = entry.learnConstraints;
                anchorNote = this.settings.lumatone_center_note;
                anchorChannel = this.settings.lumatone_center_channel;

                // Defensive validation: ensure anchor values are within controller's valid ranges
                if (constraints?.noteRange) {
                  const { min, max } = constraints.noteRange;
                  if (anchorNote == null || anchorNote < min || anchorNote > max) {
                    anchorNote = entry.anchorDefault ?? 26;
                  }
                }
                if (constraints?.channelRange) {
                  const { min, max } = constraints.channelRange;
                  if (anchorChannel == null || anchorChannel < min || anchorChannel > max) {
                    anchorChannel = entry.anchorChannelDefault ?? 3;
                  }
                }
              } else {
                // Single-channel: use midiin_central_degree (Exquis, AXIS-49, etc.)
                anchorNote = getAnchorNote(entry, this.settings);
                anchorChannel = 1;
              }

              const rawOffsets = entry.multiChannel
                ? entry.buildMap(anchorNote, anchorChannel, entry.defaultCols)
                : entry.buildMap(anchorNote, anchorChannel, this.settings.rSteps, this.settings.drSteps);
              const ox = this.settings.centerHexOffset.x;
              const oy = this.settings.centerHexOffset.y;
              this.controllerMap = new Map();
              for (const [key, { x, y }] of rawOffsets) {
                this.controllerMap.set(key, new Point(x + ox, y + oy));
              }
              //console.log('[Controller] built map for:', entry.id, 'anchorNote:', anchorNote, 'size:', this.controllerMap.size);
            } else {
              this.controllerMap = null;
              //console.log('[Controller] sequential mode for multi-channel — no geometry map');
            }
          } else {
            this.controller = null;
            this.controllerMap = null;
            // No geometry map for this device — step arithmetic will be used instead
          }
        }

        // Universal pitch-wheel listener — runs for ALL midi_mapping modes.
        this.midiin_data.addListener("pitchbend", (e) => {
          const val14 = e.message.dataBytes[0] + e.message.dataBytes[1] * 128;
          debugLog("MIDImonitoring", "pitchbend", {
            channel: e.message.channel,
            value14: val14,
          });

          if (this.inputRuntime.mpeInput) {
            // MPE input mode: pitch bend is per-voice, carried on the note's channel.
            // Route to the hex registered on this channel, bypassing the recency stack.
            this._mpeInputBendByChannel.set(e.message.channel, val14);
            const entry = this.state.activeMidiByChannel.get(e.message.channel);
            if (entry && !entry.hex.release) this._applyMpePitchBend(entry, e.message.channel, val14);
            // In MPE input mode we do NOT pass through to the output — each hex's
            // retune() call handles expression for its own output engine.
            // Scale mode pre-bend capture: record bend per channel so note-on can
            // use it to resolve the exact intended pitch.
            if (this.inputRuntime.target === "scale") {
              this._scaleModePreBend.set(e.message.channel, val14);
            }
            return;
          }

          // Non-MPE: dispatch to wheel bend handler, then optionally passthrough.
          //
          // wheelToRecent (recency/all mode): pitch is realized by hex.retune()
          // against the active target notes, so raw PB passthrough must stay OFF
          // for all outputs or the bend is applied twice.
          //
          // Standard mode (!wheelToRecent): raw PB passes through to all outputs,
          // including MTS, while the internal sample engine is retuned directly.
          const val14f = this.inputRuntime.bendFlip ? 16383 - val14 : val14;
          this._handleIncomingWheelBend(val14f);
          if (!this.inputRuntime.wheelToRecent) {
            // Standard mode: raw PB to all outputs (MTS included).
            this._passthroughPitchBend(val14f);
          }
          this._rememberControllerStateInSynth();
        });

        // MTS Single Note Tuning Change sysex listener — non-MPE scale mode only.
        // Sysex format (Universal Real-Time, 0xF0 0x7F):
        //   F0 7F <device_id> 08 02 <count> [<note> <xx> <yy> <zz>] ... F7
        // Hz per note: 440 * 2^((note + semiFrac - 69) / 12)
        //   where semiFrac = xx + (yy*128 + zz) / 16384 (xx = semitone, yy:zz = fraction)
        // Reference: MIDI Tuning Standard (MTS), CA-020.
        this.midiin_data.addListener("sysex", (e) => {
          if (this.inputRuntime.target !== "scale" || this.inputRuntime.mpeInput) return;
          const d = e.message.data;
          // Minimum: F0 7F dev 08 02 count note xx yy zz F7 = 11 bytes, count >= 1
          if (d.length < 11) return;
          // d[0]=0xF0, d[1]=0x7F (Universal Real-Time), d[2]=device id, d[3]=0x08, d[4]=0x02
          if (d[1] !== 0x7f || d[3] !== 0x08 || d[4] !== 0x02) return;
          const count = d[5];
          for (let i = 0; i < count; i++) {
            const offset = 6 + i * 4;
            if (offset + 3 >= d.length) break; // guard against truncated message
            const noteNum = d[offset];
            const semis = d[offset + 1]; // semitone (0–127)
            const fracHi = d[offset + 2]; // MSB of 14-bit fraction
            const fracLo = d[offset + 3]; // LSB of 14-bit fraction
            const semiFrac = semis + (fracHi * 128 + fracLo) / 16384;
            const hz = 440 * Math.pow(2, (semiFrac - 69) / 12);
            this._mtsInputTable.set(noteNum, hz);
          }
        });
      } // end else (midiin_data exists)
    } // end if midiin_data guard

    if (this.midiin_data == null && this.settings.midiin_device !== "OFF") {
      const overrideId = this.settings.midiin_controller_override || "auto";
      const entry = overrideId !== "auto" ? getControllerById(overrideId) : null;
      if (entry) {
        this.controller = entry;
      }
    }
}
