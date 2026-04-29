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
import { keymap, notes } from "../midi_synth";
import { scalaToCents } from "../settings/scale/parse-scale";
import { detectController, getAnchorNote, getControllerById } from "../controllers/registry.js";
import { buildLinnstrumentDegreeMap, LINNS_OFF } from "../controllers/linnstrument-config.js";
import {
  transferColor,
  LUMATONE_TONIC,
  LUMATONE_TONIC_OTHER,
} from "../settings/scale/color-transfer.js";
import { RecencyStack } from "../recency_stack.js";
import { MidiCoordResolver } from "./midi-coord-resolver.js";
import { findNearestDegree } from "../input/scale-mapper.js";
import {
  degree0ToRef,
  computeNaturalAnchor,
  computeCenterPitchHz,
  chooseStaticMapCenterMidi,
  computeStaticMapDegree0,
} from "../tuning/center-anchor.js";
import { mtsTuningMap } from "../tuning/tuning-map.js";
import { resolveBulkDumpName } from "../tuning/mts-format.js";
import { debugLog } from "../debug/logging.js";
import {
  addSustainedHex,
  clearSustainedHexes,
  collectSoundingHexes,
  createSoundingNoteState,
  hasSoundingNotes,
  isCoordActive,
  iterActiveHexes,
  removeSustainedHex,
} from "./sounding-note-runtime.js";
import {
  applyTransferredCC74,
  applyTransferredPitchBend,
  applyTransferredSourceAftertouch,
  createTransferredHex,
  releaseTransferredSourceExpression,
  synchronizeTransferredPitchBend,
  shouldSuppressTransferredSourceRelease,
} from "./note-transfer-runtime.js";
import {
  beginModulation,
  cancelModulation,
  clearModulationHistory,
  clearModulationRoute,
  commitModulationTarget,
  createModulationState,
  frameForNewNotes,
  normalizeModulationHistory,
  setModulationRouteCount,
  setModulationHistoryIndex,
  settleModulationIfPossible,
} from "./modulation-runtime.js";

const RETUNE_GLIDE_TICK_MS = 4;
const RETUNE_GLIDE_TAU_MS = 40;
const RETUNE_GLIDE_MAX_CENTS_PER_SEC = 4800;
const RETUNE_GLIDE_SNAP_CENTS = 0.1;
const WHEEL_SLEW_TAU_MS = 8;
const WHEEL_SLEW_SNAP_14 = 2;
const BULK_RELEASE_PROTECT_MS = 750;

function isModulationToggleKeyCode(code) {
  return code === "Backquote" || code === "IntlBackslash";
}

function isTextEntryElement(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName === "SELECT") return true;
  if (el.isContentEditable) return true;
  if (el.tagName !== "INPUT") return false;

  const type = (el.getAttribute("type") || "text").toLowerCase();
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(type);
}

class Keys {
  constructor(
    canvas,
    settings,
    synth,
    typing,
    onLatchChange,
    onModulationArmChange,
    onTakeSnapshot = null,
    inputRuntime = null,
    onFirstInteraction = null,
    tuningRuntime = null,
    onModulationStateChange = null,
    initialModulationLibrary = null,
  ) {
    const gcd = Euclid(settings.rSteps, settings.drSteps);
    this.tuning = {
      scale: tuningRuntime?.scale ? [...tuningRuntime.scale] : [...(settings.scale || [])],
      equivInterval: tuningRuntime?.equivInterval ?? settings.equivInterval,
      equivSteps: tuningRuntime?.equivSteps ?? settings.equivSteps ?? settings.scale?.length ?? 0,
      degree0toRef_asArray:
        tuningRuntime?.degree0toRefAsArray ??
        degree0ToRef(
          settings.reference_degree,
          tuningRuntime?.scale ?? settings.scale,
        ),
    };
    this.settings = {
      hexHeight: settings.hexSize * 2,
      hexVert: (settings.hexSize * 3) / 2,
      hexWidth: Math.sqrt(3) * settings.hexSize,
      gcd, // calculates a array with 3 values: the GCD of the layout tiling (smallest step available); Bézout Coefficients to be applied to rSteps and drSteps to obtain GCD
      centerHexOffset: computeCenterOffset(
        settings.rSteps,
        settings.drSteps,
        settings.center_degree || 0,
        gcd,
      ),
      ...settings,
    };
    // inputRuntime: authoritative source for all input mode decisions.
    // Falls back to settings-derived values when not provided (backwards compat
    // with any direct Keys construction that doesn't pass it yet).
    this.inputRuntime = inputRuntime || {
      target: "hex_layout",
      layoutMode: settings.midi_passthrough ? "sequential" : "controller_geometry",
      mpeInput: false,
      seqAnchorNote: settings.midiin_central_degree ?? 60,
      seqAnchorChannel: settings.midiin_anchor_channel ?? 1,
      stepsPerChannel: settings.midiin_steps_per_channel,
      stepsPerChannelDefault: settings.equivSteps,
      channelGroupSize: settings.midiin_channel_group_size ?? 1,
      legacyChannelMode: settings.midiin_channel_legacy,
      scaleTolerance: 50,
      pitchBendMode: "recency",
      pressureMode: "recency",
      wheelToRecent: settings.wheel_to_recent,
      // wheelRange and bendRange both use midiin_bend_range — unified with Pitch Bend Interval UI.
      wheelRange: settings.midiin_bend_range ?? "64/63",
      wheelScaleAware: settings.wheel_scale_aware,
      wheelSemitones: settings.midi_wheel_semitones ?? 2,
      // Pitch bend range for incoming hardware controller bend messages.
      // Applies to MPE per-note bend and single-channel pitch wheel.
      // Must match the range configured on the hardware device.
      bendRange: settings.midiin_bend_range ?? "64/63",
      bendFlip: !!settings.midiin_bend_flip,
    };

    this.synth = synth; // use built-in sounds and/or send MIDI out (MTS, MPE, or MTS bulk dump) to an external synth
    this.typing = typing;
    this.onLatchChange = onLatchChange || null;
    this.onModulationArmChange = onModulationArmChange || null;
    this.onModulationStateChange = onModulationStateChange || null;
    this.onTakeSnapshot = onTakeSnapshot || null;
    this.visualViewportResizeHandler = () => {
      if (isTextEntryElement(document.activeElement)) return;
      this.resizeHandler();
    };
    // Called once on the first touch — within the iOS gesture window — so the
    // AudioContext can be resumed and samples decoded without hanging.
    this._onFirstInteraction = onFirstInteraction || null;
    this.bend = 0;
    this.state = {
      canvas,
      context: canvas.getContext("2d"),
      ...createSoundingNoteState(),
    };
    // Recency stack — tracks all sounding notes most-recent-first.
    // The front entry receives wheel bend; see _handleWheelBend().
    this.recencyStack = new RecencyStack();

    // MIDI coordinate resolver — maps note/channel → hex-grid coords.
    // Injected with bound geometry methods so it has no direct reference to Keys.
    this.coordResolver = new MidiCoordResolver(
      this.settings,
      this.hexCoordsToCents.bind(this),
      this.hexCoordsToScreen.bind(this),
      () => this.state.centerpoint,
      this.inputRuntime,
    );

    // Scale mode microtuning state.
    // _mtsInputTable:    Map<noteNumber (0–127), Hz> — populated by incoming MTS
    //                    Single Note Tuning Change sysex. Used when target='scale'
    //                    and mpeInput=false to get the exact pitch of each note.
    // _scaleModePreBend: Map<channel (1–16), val14 (0–16383)> — the most recent
    //                    pitchbend value received on each channel when target='scale'
    //                    and mpeInput=true. Captured before note-on arrives so the
    //                    exact intended pitch can be resolved at note-on time.
    // _mpeInputBendByChannel: current per-channel bend state for MPE input mode.
    this._mtsInputTable = new Map();
    this._scaleModePreBend = new Map();
    this._mpeInputBendByChannel = new Map();
    this._retuneGlides = new Map();
    this._retuneGlideTimer = null;
    this._retuneGlideLastTime = 0;
    this._deferredBulkMapRefresh = false;
    this._deferredBulkMapTimer = null;
    this._staticDeferredBulkActive = false;
    this._recentlyReleasedHexes = new Map();
    // Per-channel slew state for MPE input pitch bend smoothing.
    // Map<channel, { current: float, target: float, raf: id|null }>
    this._bendSlew = new Map();

    // Wheel bend state — controller-agnostic.
    // _wheelValue14:   most recent non-MPE pitch-bend value (0–16383).
    // _wheelInputValue14: latest raw controller wheel sample before slew.
    // _wheelBend:      current offset in cents applied by the active wheel mode.
    // _wheelTarget:    the hex currently being bent.
    // _wheelBaseCents: that hex's pitch before any bend was applied.
    //                  Snapshot feature will read this + _wheelBend.
    this._wheelValue14 = 8192;
    this._wheelInputValue14 = 8192;
    this._wheelBend = 0;
    this._wheelTarget = null;
    this._wheelBaseCents = null;
    this._wheelSlew = {
      current: 8192,
      target: 8192,
      lastTime: 0,
      raf: null,
    };
    this._controllerCCValues = new Map();
    if (
      this.settings.midiin_device &&
      this.settings.midiin_device !== "OFF" &&
      this.settings.midiin_modwheel_source === this.settings.midiin_device &&
      Number.isFinite(this.settings.midiin_modwheel_value)
    ) {
      this._controllerCCValues.set(1, this.settings.midiin_modwheel_value);
    }
    this._channelPressureValue = 0;
    this._frameGeneration = 0;
    this._lastPlayedDegree = this.settings.reference_degree ?? 0;
    const homeFrame = this._makeFrameForDegree(this.settings.reference_degree ?? 0);
    this._harmonicFrame = homeFrame;
    const initialModulationHistory = normalizeModulationHistory(initialModulationLibrary);
    this._modulationState = createModulationState({
      homeFrame,
      currentFrame: homeFrame,
      history: initialModulationHistory,
    });
    if (initialModulationHistory.length > 0) {
      const currentFrame = this._frameForHistory(initialModulationHistory);
      this._harmonicFrame = currentFrame;
      this._modulationState.currentFrame = currentFrame;
      this._modulationState.historyIndex = this._modulationState.currentRoute?.count ?? 0;
    }

    // The tuning map anchor is always derived from the musical content (fundamental,
    // scale, center_degree) — independent of midiin_central_degree, which is a
    // hardware input setting. The hex grid is the shared reference: the tuning map
    // is built from the grid, and the input anchor maps hardware keys onto the grid.
    const tuning_map_degree0 = computeNaturalAnchor(
      this.settings.fundamental,
      this.tuning.degree0toRef_asArray[0],
      this.tuning.scale,
      this.tuning.equivInterval,
      this.settings.center_degree,
    );
    this.mts_tuning_map = mtsTuningMap(
      127,
      this.settings.device_id,
      this.settings.tuning_map_number,
      tuning_map_degree0,
      this.tuning.scale,
      this.settings.name,
      this.tuning.equivInterval,
      this.settings.fundamental,
      this.tuning.degree0toRef_asArray,
      this.settings.octave_offset || 0,
    );

    // Set up resize handler
    window.addEventListener("resize", this.resizeHandler, false);
    window.addEventListener("orientationchange", this.resizeHandler, false);
    // visualViewport fires when browser chrome (toolbars) appear/disappear,
    // which window.resize misses — catches Brave's toolbar toggling.
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", this.visualViewportResizeHandler, false);
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
    this.state.canvas.addEventListener("touchcancel", this.handleTouchCancel, false);
    this.state.canvas.addEventListener("mousedown", this.mouseDown, false);
    window.addEventListener("mouseup", this.mouseUp, false);

    // sysex_auto comes from settings directly; sessionStorage read was redundant and error-prone

    if (
      this.settings.output_mts &&
      this.settings.sysex_auto &&
      this.settings.midi_device !== "OFF" &&
      this.settings.midi_channel >= 0
    ) {
      try {
        this.midiout_data = WebMidi.getOutputById(this.settings.midi_device);
      } catch {
        this.midiout_data = null;
      }
      this.mtsSendMap();
    }

    //console.log('[Keys] MIDI init — device:', JSON.stringify(this.settings.midiin_device), 'channel:', this.settings.midiin_channel, 'passthrough:', this.settings.midi_passthrough);
    if (this.settings.midiin_device !== "OFF" && this.settings.midiin_channel >= 0) {
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
                // the anchor channel (midiin_channel). Range −4…+3, wrapping at 8 channels.
                let equaveShift = e.message.channel - 1 - this.settings.midiin_channel;
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

    if (this.midiin_data == null && this.settings.midiin_device !== "OFF" && this.settings.midiin_channel >= 0) {
      const overrideId = this.settings.midiin_controller_override || "auto";
      const entry = overrideId !== "auto" ? getControllerById(overrideId) : null;
      if (entry) {
        this.controller = entry;
      }
    }

    // lumatoneLEDs and exquisLEDs are assigned externally by app.jsx after
    // construction, via onKeysReady — the same pattern so both LED engines
    // have a stable, long-lived lifecycle independent of Keys reconstruction.
    this.lumatoneLEDs = null;
    this.exquisLEDs = null;
    this.linnstrumentLEDs = null;
  } // end of constructor

  /**
   * Live-retune a single scale degree while notes are held.
   * Updates this.tuning.scale[degree] and redraws that degree's hexes.
   * Also calls hex.retune(newCents) on any currently-sounding or sustained notes
   * at that degree — including notes held under the Shift sustain pedal.
   * @param {number} degree   - reducedSteps index (1..equivSteps-1; 0 = tonic, fixed)
   * @param {number} newCents - new value in cents
   */

  updateScaleDegree = (degree, newCents) => {
    if (!this.tuning.scale || degree < 0) return;

    // The equave is stored as equivInterval, not in the scale array.
    // TuneCell passes degree === scale.length for the equave row.
    if (degree === this.tuning.scale.length) {
      const oldEquiv = this.tuning.equivInterval;
      const equivDelta = newCents - oldEquiv;
      const bendOnly = !!this.inputRuntime.mpeInput;
      this.tuning.equivInterval = newCents;
      // Each hex is at octs * equivInterval + scale[reducedSteps],
      // so changing equivInterval by equivDelta shifts it by octs * equivDelta.
      for (const hex of this._allActiveHexes()) {
        const [, , , octs] = this.hexCoordsToCents(hex.coords);
        const baseCents = (hex._baseCents ?? hex.cents) + octs * equivDelta;
        this._queueRetuneGlide(hex, baseCents, bendOnly);
      }
      for (const [hex] of this.state.sustainedNotes) {
        const [, , , octs] = this.hexCoordsToCents(hex.coords);
        const baseCents = (hex._baseCents ?? hex.cents) + octs * equivDelta;
        this._queueRetuneGlide(hex, baseCents, bendOnly);
      }
      this._refreshSoundingHexNeighbors();
      this._kickRetuneGlides();
      this.drawGrid();
      return;
    }

    if (degree >= this.tuning.scale.length) return;
    // Compute delta before mutating scale, so we can shift each hex by the same amount
    // regardless of which octave it was played in.
    const oldCents = this.tuning.scale[degree];
    const delta = newCents - oldCents;
    const bendOnly = !!this.inputRuntime.mpeInput;
    this.tuning.scale[degree] = newCents;
    for (const hex of this._allActiveHexes()) {
      const [, reducedSteps] = this.hexCoordsToCents(hex.coords);
      if (reducedSteps === degree && hex.retune) {
        const baseCents = (hex._baseCents ?? hex.cents) + delta;
        this._queueRetuneGlide(hex, baseCents, bendOnly);
      }
    }
    for (const [hex] of this.state.sustainedNotes) {
      const [, reducedSteps] = this.hexCoordsToCents(hex.coords);
      if (reducedSteps === degree && hex.retune) {
        const baseCents = (hex._baseCents ?? hex.cents) + delta;
        this._queueRetuneGlide(hex, baseCents, bendOnly);
      }
    }
    this._refreshSoundingHexNeighbors();
    this._kickRetuneGlides();
    this.drawGrid();
  };

  setModulationArmed = (armed) => {
    if (armed) {
      this.armModulation();
    } else if (this._modulationState.mode === "awaiting_target") {
      this._modulationState = cancelModulation(this._modulationState, "user_cancelled");
      this._emitModulationState();
    }
  };

  toggleModulationArm = () => {
    if (this._modulationState.mode === "awaiting_target") {
      this._modulationState = cancelModulation(this._modulationState, "user_cancelled");
      this._emitModulationState();
      return;
    }
    if (this._modulationState.mode === "idle") {
      this.armModulation();
    }
  };

  getModulationState = () => this._modulationState;

  _sourceCentsForDegree(degree, frame = this._activeFrame()) {
    if (degree == null) return 0;
    return (this.tuning.scale?.[degree] ?? 0) + (frame?.transpositionCents ?? 0);
  }

  _frameForHistory(history = this._modulationState.history ?? []) {
    const normalized = Array.isArray(history) ? history : [];
    if (!normalized.length) {
      return this._makeFrameForDegree(this.settings.reference_degree ?? 0, {
        strategy: this._modulationState.strategy,
        sourceDegree: null,
        targetDegree: null,
        transpositionSteps: 0,
        transpositionCents: 0,
        effectiveFundamental: this.settings.fundamental,
      });
    }
    const transpositionCents = normalized.reduce((sum, route) => {
      const count = Number.isFinite(route?.count) ? Math.trunc(route.count) : 0;
      const centsDelta =
        (this.tuning.scale?.[route?.sourceDegree] ?? 0) - (this.tuning.scale?.[route?.targetDegree] ?? 0);
      return sum + count * centsDelta;
    }, 0);
    const effectiveFundamental = this.settings.fundamental * Math.pow(2, transpositionCents / 1200);
    const route = normalized[normalized.length - 1] ?? null;
    return this._makeFrameForDegree(route.targetDegree ?? this.settings.reference_degree ?? 0, {
      strategy: this._modulationState.strategy,
      sourceDegree: route.sourceDegree ?? null,
      targetDegree: route.targetDegree ?? null,
      transpositionSteps: 0,
      transpositionCents,
      effectiveFundamental,
    });
  }

  _frameForHistoryIndex(historyIndex) {
    const history = Array.isArray(this._modulationState.history) ? this._modulationState.history.map((entry) => ({ ...entry })) : [];
    if (history.length > 0) {
      history[history.length - 1].count = Number.isFinite(historyIndex) ? Math.trunc(historyIndex) : 0;
    }
    return this._frameForHistory(history);
  }

  setModulationHistoryIndex = (historyIndex) => {
    if (this._modulationState.mode !== "idle") return false;
    const nextFrame = this._frameForHistoryIndex(historyIndex);
    this._modulationState = setModulationHistoryIndex(this._modulationState, historyIndex, nextFrame);
    this._harmonicFrame = this._modulationState.currentFrame ?? this._harmonicFrame;
    this.drawGrid();
    this._emitModulationState();
    return true;
  };

  stepModulationHistory = (delta) => {
    const currentIndex = this._modulationState.historyIndex ?? 0;
    return this.setModulationHistoryIndex(currentIndex + delta);
  };

  setModulationRouteCount = (routeIndex, count) => {
    if (this._modulationState.mode !== "idle") return false;
    const history = Array.isArray(this._modulationState.history) ? this._modulationState.history.map((entry) => ({ ...entry })) : [];
    if (routeIndex < 0 || routeIndex >= history.length) return false;
    history[routeIndex].count = Number.isFinite(count) ? Math.trunc(count) : 0;
    const nextFrame = this._frameForHistory(history);
    this._modulationState = setModulationRouteCount(this._modulationState, routeIndex, count, nextFrame);
    this._harmonicFrame = this._modulationState.currentFrame ?? this._harmonicFrame;
    this.drawGrid();
    this._emitModulationState();
    return true;
  };

  stepModulationRoute = (routeIndex, delta) => {
    const route = this._modulationState.history?.[routeIndex];
    if (!route) return false;
    const currentCount = Number.isFinite(route.count) ? Math.trunc(route.count) : 0;
    return this.setModulationRouteCount(routeIndex, currentCount + delta);
  };

  clearModulationRoute = (routeIndex) => {
    const route = this._modulationState.history?.[routeIndex];
    if (!route || (Number.isFinite(route.count) ? Math.trunc(route.count) : 0) !== 0) return false;
    const history = Array.isArray(this._modulationState.history)
      ? this._modulationState.history.filter((_, index) => index !== routeIndex).map((entry) => ({ ...entry }))
      : [];
    const nextFrame = this._frameForHistory(history);
    this._modulationState = clearModulationRoute(this._modulationState, routeIndex, nextFrame);
    this._harmonicFrame = this._modulationState.currentFrame ?? this._harmonicFrame;
    this.drawGrid();
    this._emitModulationState();
    return true;
  };

  clearModulationHistory = () => {
    if ((this._modulationState.historyIndex ?? 0) !== 0) return false;
    const homeFrame = this._modulationState.homeFrame ?? this._frameForHistoryIndex(0);
    this._modulationState = clearModulationHistory(this._modulationState, homeFrame);
    this._harmonicFrame = this._modulationState.currentFrame ?? this._harmonicFrame;
    this.drawGrid();
    this._emitModulationState();
    return true;
  };

  armModulation = (strategy = this._modulationState.strategy) => {
    const sourceHex = this.recencyStack.front ?? null;
    const sourceDegree = sourceHex
      ? this._degreeForHex(sourceHex)
      : (this._lastPlayedDegree ?? this.settings.reference_degree ?? 0);
    this._modulationState = beginModulation(this._modulationState, {
      currentFrame: this._harmonicFrame,
      sourceHex,
      sourceDegree,
      strategy,
    });
    this._emitModulationState();
    return this._modulationState.mode === "awaiting_target";
  };

  _emitModulationState() {
    if (this.onModulationArmChange)
      this.onModulationArmChange(this._modulationState.mode === "awaiting_target");
    if (this.onModulationStateChange) this.onModulationStateChange(this._modulationState);
  }

  _makeFrameForDegree(degree, extra = {}) {
    this._frameGeneration += 1;
    return {
      id: `frame:${this._frameGeneration}:${degree}`,
      anchorDegree: degree,
      referenceDegree: this.settings.reference_degree ?? 0,
      strategy: extra.strategy ?? this._modulationState?.strategy ?? "retune_surface_to_source",
      sourceDegree: extra.sourceDegree ?? null,
      targetDegree: extra.targetDegree ?? null,
      transpositionSteps: extra.transpositionSteps ?? 0,
      transpositionCents: extra.transpositionCents ?? 0,
      effectiveFundamental:
        extra.effectiveFundamental ?? this.settings.fundamental,
    };
  }

  _activeFrame() {
    return frameForNewNotes(this._modulationState) ?? this._harmonicFrame;
  }

  getEffectiveFundamental = () => {
    return this._activeFrame()?.effectiveFundamental ?? this.settings.fundamental;
  };

  _labelDegreeFromFrame(reducedNote, frame = this._activeFrame()) {
    const geometryMode =
      this._modulationState?.geometryMode ??
      (frame?.strategy === "reinterpret_surface_from_target" ? "stable_surface" : "moveable_surface");
    if (geometryMode === "moveable_surface") return reducedNote;
    const scaleLength = this.tuning.scale.length || 1;
    return ((reducedNote + (frame?.transpositionSteps ?? 0)) % scaleLength + scaleLength) % scaleLength;
  }

  _scaleCentsLabelForDegree(reducedNote) {
    const scale = this.tuning.scale || [];
    const degree0Cents = scale[0] ?? 0;
    const degreeCents = scale[reducedNote] ?? degree0Cents;
    return `${Math.round(((degreeCents - degree0Cents) + 1200) % 1200)}.`;
  }

  getDisplayLabelAtCoords = (coords) => {
    const note = coords.x * this.settings.rSteps + coords.y * this.settings.drSteps;
    const equivSteps = this.tuning.scale.length || 1;
    let reducedNote = note % equivSteps;
    if (reducedNote < 0) reducedNote += equivSteps;
    const liveReducedNote = this._labelDegreeFromFrame(reducedNote);

    if (this.settings.degree) return String(liveReducedNote);
    if (this.settings.note) return this.settings.note_names?.[liveReducedNote] ?? "";
    if (this.settings.heji) return this.settings.heji_names?.[liveReducedNote] ?? "";
    if (this.settings.scala) return this.settings.scala_names?.[liveReducedNote] ?? "";
    if (this.settings.cents) return this._scaleCentsLabelForDegree(reducedNote);
    return "";
  };

  _degreeForCoords(coords) {
    const [, pressed_interval] = this.hexCoordsToCents(coords);
    return pressed_interval ?? null;
  }

  _degreeForHex(hex) {
    if (!hex?.coords) return null;
    return this._degreeForCoords(hex.coords);
  }

  _commitPendingModulationTarget(coords) {
    if (this._modulationState.mode !== "awaiting_target") return;
    const activeFrame = this._activeFrame();
    const targetDegree = this._degreeForCoords(coords);
    if ((this._modulationState.sourceDegree ?? targetDegree) === targetDegree) {
      this._modulationState = cancelModulation(this._modulationState, "no_op_modulation");
      this.drawGrid();
      this._emitModulationState();
      return;
    }
    const targetCents = this.hexCoordsToCents(coords)[0];
    const sourceCents =
      this._modulationState.sourceHex?._baseCents ??
      this._modulationState.sourceHex?.cents ??
      this._sourceCentsForDegree(this._modulationState.sourceDegree, activeFrame);
    const transpositionDeltaCents = sourceCents - targetCents;
    const transpositionCents = (activeFrame?.transpositionCents ?? 0) + transpositionDeltaCents;
    const transpositionSteps = (this._modulationState.sourceDegree ?? targetDegree) - targetDegree;
    const effectiveFundamental =
      (activeFrame?.effectiveFundamental ?? this.settings.fundamental) *
      Math.pow(2, transpositionDeltaCents / 1200);
    const pendingFrame = this._makeFrameForDegree(targetDegree, {
      strategy: this._modulationState.strategy,
      sourceDegree: this._modulationState.sourceDegree,
      targetDegree,
      transpositionSteps,
      transpositionCents,
      effectiveFundamental,
    });
    this._modulationState = commitModulationTarget(this._modulationState, {
      targetDegree,
      pendingFrame,
      sourceStillSounding: this._isHexStillSounding(this._modulationState.sourceHex),
    });
    this.drawGrid();
    this._emitModulationState();
  }

  _isHexStillSounding(targetHex) {
    if (!targetHex?.coords) return false;
    for (const hex of this._allActiveHexes()) {
      if (hex.coords.equals(targetHex.coords)) return true;
    }
    return this.state.sustainedNotes.some(([hex]) => hex.coords.equals(targetHex.coords));
  }

  _maybeTakeOverModulationTarget(coords, cents, cents_prev, cents_next) {
    if (this._modulationState.mode !== "pending_settlement") return null;
    if (this._modulationState.lastDecision?.articulation !== "takeover") return null;
    if (this._modulationState.takeoverConsumed) return null;
    const sourceHex = this._modulationState.sourceHex;
    if (!sourceHex) return null;
    if (!this._isHexStillSounding(sourceHex)) return null;
    const onsetFrameId = frameForNewNotes(this._modulationState)?.id ?? this._harmonicFrame?.id ?? null;
    const proxy = createTransferredHex(sourceHex, {
      coords,
      cents,
      cents_prev,
      cents_next,
      onsetFrameId,
    });
    this._modulationState.takeoverConsumed = true;
    this.recencyStack.remove(sourceHex);
    this.recencyStack.push(proxy);
    this._updateWheelTarget();
    this._applyCurrentWheelToHex(proxy);
    this._syncTransferredWheelBend(proxy);
    return proxy;
  }

  _applyPolyAftertouch(hex, value) {
    if (!hex || hex.release) return;
    const aftertouch = Math.max(0, Math.min(127, Number(value) || 0));
    hex._lastAftertouch = aftertouch;
    if (applyTransferredSourceAftertouch(hex, aftertouch)) return;
    hex.aftertouch?.(aftertouch);
  }

  _applyTimbreCC74(hex, value) {
    if (!hex || hex.release) return;
    const cc74 = Math.max(0, Math.min(127, Number(value) || 0));
    hex._lastCC74 = cc74;
    if (applyTransferredCC74(hex, cc74)) return;
    hex.cc74?.(cc74);
  }

  _normalizePitchBend14(value) {
    const bend = Number(value);
    if (!Number.isFinite(bend)) return 8192;
    return Math.max(0, Math.min(16383, bend));
  }

  _applyMpePitchBend(entry, channel, value14) {
    if (!entry?.hex || entry.hex.release) return;
    const bend14 = this._normalizePitchBend14(value14);
    this._mpeInputBendByChannel.set(channel, bend14);
    let norm = (bend14 - 8192) / 8192;
    if (this.inputRuntime.bendFlip) norm = -norm;
    const rangeCents = scalaToCents(this.inputRuntime.bendRange ?? "9/8");
    const baseCents = entry.hex._baseCents ?? entry.baseCents ?? entry.hex.cents;
    const bentCents = baseCents + norm * rangeCents;
    entry.baseCents = baseCents;
    entry.hex._lastPitchBend14 = bend14;
    entry.hex._lastPitchBendCents = bentCents;
    if (applyTransferredPitchBend(entry.hex, { value14: bend14, cents: bentCents })) return;
    entry.hex.retune?.(bentCents, true);
  }

  _currentWheelPitchStateForHex(hex) {
    if (!hex || this.inputRuntime.mpeInput || this._wheelValue14 === 8192) return null;
    if (!this.inputRuntime.wheelToRecent || this.inputRuntime.pitchBendMode === "all") {
      const baseCents = hex._baseCents ?? hex.cents ?? 0;
      return {
        value14: this._wheelValue14,
        cents: baseCents + this._wheelBend,
      };
    }
    if (this.inputRuntime.pitchBendMode === "recency") {
      const { bentCents } = this._resolveRecencyWheelTarget(hex, this._wheelValue14);
      return {
        value14: this._wheelValue14,
        cents: bentCents,
      };
    }
    return null;
  }

  _syncTransferredWheelBend(hex) {
    const state = this._currentWheelPitchStateForHex(hex);
    if (!state) return false;
    return synchronizeTransferredPitchBend(hex, state);
  }

  _syncTransferredWheelBends() {
    if (this.inputRuntime.mpeInput || this._wheelValue14 === 8192) return;
    const syncedSources = new Set();
    for (const hex of this._allActiveHexes()) {
      const sourceHex = hex?._transferredSource ?? hex;
      if (!sourceHex?._transferProxy || syncedSources.has(sourceHex)) continue;
      syncedSources.add(sourceHex);
      this._syncTransferredWheelBend(sourceHex);
    }
  }

  _hasLegacyFrameNotes() {
    if (this._modulationState.mode !== "pending_settlement" || !this._modulationState.oldFrame) {
      return false;
    }
    const oldFrameId = this._modulationState.oldFrame.id;
    for (const hex of this._allActiveHexes()) {
      if (hex._onsetFrameId === oldFrameId) return true;
    }
    return this.state.sustainedNotes.some(([hex]) => hex._onsetFrameId === oldFrameId);
  }

  _maybeSettleModulation() {
    if (this._modulationState.mode !== "pending_settlement") return;
    if (this._hasLegacyFrameNotes()) return;
    this._modulationState = settleModulationIfPossible(this._modulationState, {
      hasLegacyNotes: false,
    });
    this._harmonicFrame = this._modulationState.currentFrame ?? this._harmonicFrame;
    this.drawGrid();
    this._emitModulationState();
  }

  _settleModulationAfterActiveRelease() {
    if (this._modulationState.mode !== "pending_settlement") return;
    this._maybeSettleModulation();
  }

  previewDegree0 = (deltaCents) => {
    const newCents = deltaCents;
    const bendOnly = !!this.inputRuntime.mpeInput;
    for (const hex of this._allActiveHexes()) {
      const [, reducedSteps, , octs] = this.hexCoordsToCents(hex.coords);
      if (reducedSteps === 0 && hex.retune) {
        const baseCents = octs * this.tuning.equivInterval + newCents;
        this._queueRetuneGlide(hex, baseCents, bendOnly);
      }
    }
    for (const [hex] of this.state.sustainedNotes) {
      const [, reducedSteps, , octs] = this.hexCoordsToCents(hex.coords);
      if (reducedSteps === 0 && hex.retune) {
        const baseCents = octs * this.tuning.equivInterval + newCents;
        this._queueRetuneGlide(hex, baseCents, bendOnly);
      }
    }
    this._refreshSoundingHexNeighbors();
    this._kickRetuneGlides();
  };

  // Imperatively update the Reference Frequency without rebuilding Keys.
  // Rebuilds mts_tuning_map, retuning all sounding/sustained notes,
  // and re-sends the tuning map to any active MTS/Direct output.
  // Shift all pitches by ±1 equave without rebuilding Keys.
  // Updates octave_offset in this.settings, redraws the grid
  // (so colours update), and retunes any sounding/sustained notes.
  shiftOctave = (dir, deferred = false) => {
    this.settings.octave_offset = (this.settings.octave_offset || 0) + dir;
    const isStaticMtsBulk = this.settings.output_mts_bulk && this.settings.mts_bulk_mode === "static";
    const isStaticMtsBulkDeferred = deferred && isStaticMtsBulk;

    // In deferred mode, sounding notes keep their current pitch — the shift
    // only applies to the next new note. If there are no sounding notes,
    // deferred and immediate are equivalent.
    const hasSoundingNotes = this._hasSoundingNotes();
    const skipRetune = deferred && hasSoundingNotes;
    if (isStaticMtsBulk) {
      this._deferredBulkMapRefresh = false;
      this._staticDeferredBulkActive = false;
    } else {
      this._staticDeferredBulkActive = isStaticMtsBulkDeferred && hasSoundingNotes;
      this._deferredBulkMapRefresh = skipRetune && this._hasDeferredBulkTargets();
    }

    if (!skipRetune) {
      // Retune all sounding and sustained notes immediately
      for (const hex of this._allActiveHexes()) {
        const newCents = (hex._baseCents ?? hex.cents) + dir * this.tuning.equivInterval;
        if ("fundamental" in hex) hex.fundamental = this.settings.fundamental;
        if (hex.retune) hex.retune(newCents);
        hex._baseCents = newCents;
      }
      for (const [hex] of this.state.sustainedNotes) {
        const newCents = (hex._baseCents ?? hex.cents) + dir * this.tuning.equivInterval;
        if ("fundamental" in hex) hex.fundamental = this.settings.fundamental;
        if (hex.retune) hex.retune(newCents);
        hex._baseCents = newCents;
      }
      if (this._wheelBaseCents !== null) {
        this._wheelBaseCents += dir * this.tuning.equivInterval;
      }
    }

    // Always rebuild the in-memory MTS map so new notes use the new offset.
    // Each MidiHex.noteOn() sends its own single-note real-time sysex, so
    // new notes are individually retuned at trigger time regardless.
    const bulkDumpName = resolveBulkDumpName(
      this.settings.mts_bulk_tuning_map_name,
      this.settings.short_description,
      this.settings.name,
    );
    this.mts_tuning_map = mtsTuningMap(
      127,
      this.settings.device_id,
      this.settings.tuning_map_number,
      computeNaturalAnchor(
        this.settings.fundamental,
        this.tuning.degree0toRef_asArray[0],
        this.tuning.scale,
        this.tuning.equivInterval,
        this.settings.center_degree,
      ),
      this.tuning.scale,
      bulkDumpName,
      this.tuning.equivInterval,
      this.settings.fundamental,
      this.tuning.degree0toRef_asArray,
      this.settings.octave_offset || 0,
    );
    if (this._deferredBulkMapTimer != null) {
      clearTimeout(this._deferredBulkMapTimer);
      this._deferredBulkMapTimer = null;
    }
    if (isStaticMtsBulk) {
      this._sendBulkDumpOctaveRefresh(deferred && hasSoundingNotes, false);
    } else if (!skipRetune) {
      this._deferredBulkMapRefresh = false;
      this._staticDeferredBulkActive = false;
      this._sendBulkDumpOctaveRefresh(hasSoundingNotes || this._hasRecentReleasedBulkTargets());
    } else {
      this._sendBulkDumpOctaveRefresh(
        !this._staticDeferredBulkActive,
        !this._staticDeferredBulkActive,
      );
    }
    this.drawGrid();
  };

  // Reset octave offset to 0 without any retune arithmetic.
  // Called on synth rebuild, PANIC, and structural changes — contexts where
  // all notes are already dead so retuning held notes is neither needed nor safe.
  resetOctave = () => {
    this.settings.octave_offset = 0;
    this.drawGrid();
  };

  updateFundamental = (newFundamental) => {
    this.settings.fundamental = newFundamental;
    const bendOnly = !!this.inputRuntime.mpeInput;
    // Rebuild MTS tuning map with new fundamental
    this.mts_tuning_map = mtsTuningMap(
      127,
      this.settings.device_id,
      this.settings.tuning_map_number,
      computeNaturalAnchor(
        this.settings.fundamental,
        this.tuning.degree0toRef_asArray[0],
        this.tuning.scale,
        this.tuning.equivInterval,
        this.settings.center_degree,
      ),
      this.tuning.scale,
      this.settings.name,
      this.tuning.equivInterval,
      newFundamental,
      this.tuning.degree0toRef_asArray,
      this.settings.octave_offset || 0,
    );
    // If a TuneCell drag preview is in progress (or was abandoned without Save/Revert),
    // _fundamentalSnapshot holds the pre-preview base cents for each hex — the correct
    // scale-derived pitches before any drag offset was applied.
    // Using snapshot values here makes updateFundamental order-independent with respect
    // to previewFundamental(0): it works correctly whether the effect fires before or
    // after onSave's cleanup call, and also handles abandoned drags where hex.cents
    // was left at base+delta.
    const snap = this._fundamentalPreviewSnapshot ?? this._fundamentalSnapshot;
    this._fundamentalSnapshot = null; // clear — official update supersedes the preview
    this._fundamentalPreviewSnapshot = null;
    // Update fundamental on all sounding/sustained hex objects, then retune.
    // Both MidiHex and ActiveHex store this.fundamental at construction;
    // we patch it directly so retune() uses the new value.
    const allHexes = [...this._allActiveHexes(), ...[...this.state.sustainedNotes].map(([h]) => h)];
    for (const hex of allHexes) {
      if ("fundamental" in hex) hex.fundamental = newFundamental;
      const key = hex.coords.x + "," + hex.coords.y;
      const trueCents = snap
        ? (snap.get(key) ?? hex._baseCents ?? hex.cents)
        : (hex._baseCents ?? hex.cents);
      this._queueRetuneGlide(hex, trueCents, bendOnly);
    }
    this._refreshSoundingHexNeighbors();
    this._kickRetuneGlides();
    // Re-send tuning map if auto-send is enabled for the relevant output
    if (this.settings.output_mts && this.midiout_data && this.settings.sysex_auto)
      this.mtsSendMap();
    if (
      this.settings.output_mts_bulk &&
      this.settings.mts_bulk_mode === "static" &&
      this.settings.mts_bulk_sysex_auto &&
      this.settings.mts_bulk_device &&
      this.settings.mts_bulk_device !== "OFF"
    ) {
      const directOut = WebMidi.getOutputById(this.settings.mts_bulk_device);
      if (directOut) this.mtsSendMap(directOut);
    }
  };

  _fundamentalSnapshot = null;
  _fundamentalPreviewSnapshot = null;

  snapshotForFundamentalPreview = () => {
    this._fundamentalSnapshot = new Map();
    for (const hex of this._allActiveHexes())
      this._fundamentalSnapshot.set(hex.coords.x + "," + hex.coords.y, hex._baseCents ?? hex.cents);
    for (const [hex] of this.state.sustainedNotes)
      this._fundamentalSnapshot.set(hex.coords.x + "," + hex.coords.y, hex._baseCents ?? hex.cents);
    this._fundamentalPreviewSnapshot = new Map(this._fundamentalSnapshot);
  };

  previewFundamental = (deltaCents, clearSnapshot = false) => {
    const snap = this._fundamentalPreviewSnapshot ?? this._fundamentalSnapshot;
    const bendOnly = !!this.inputRuntime.mpeInput;
    const applyTo = (hex) => {
      const key = hex.coords.x + "," + hex.coords.y;
      const base = snap
        ? (snap.get(key) ?? hex._baseCents ?? hex.cents)
        : (hex._baseCents ?? hex.cents);
      this._queueRetuneGlide(hex, base + deltaCents, bendOnly);
    };
    for (const hex of this._allActiveHexes()) applyTo(hex);
    for (const [hex] of this.state.sustainedNotes) applyTo(hex);
    this._refreshSoundingHexNeighbors();
    this._kickRetuneGlides();
    if (clearSnapshot) {
      this._fundamentalSnapshot = null;
      this._fundamentalPreviewSnapshot = null;
    }
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

    // Propagate color changes to Lumatone LEDs when auto-sync is enabled.
    // sendAll() replaces the entire pending queue so rapid picker drags always
    // converge to the latest color state without unbounded queue growth.
    if (this.lumatoneLEDs && this.controllerMap && this.settings.lumatone_led_sync) {
      this.lumatoneLEDs.sendAll(this._buildLumatoneColorEntries());
    }

    if (this.exquisLEDs && this.settings.exquis_led_sync) {
      this.exquisLEDs.sendColors(this._buildExquisColorArray());
    }

    if (this.linnstrumentLEDs && this.settings.linnstrument_led_sync) {
      this.linnstrumentLEDs.updatePaletteValues(this._buildLinnstrumentColorArray());
    }
  };

  /**
   * Imperatively update label display settings without reconstructing Keys.
   * Replaces the label flags and name arrays in this.settings, then redraws.
   * Called from Keyboard wrapper when key_labels or related fields change.
   */
  updateLabels = (labels) => {
    // Clear all label flags first so only one is active.
    for (const flag of ["degree", "note", "scala", "cents", "heji", "equaves", "no_labels"]) {
      this.settings[flag] = false;
    }
    // Apply new flags and name arrays.
    Object.assign(this.settings, labels);
    this.drawGrid();
  };

  updateLiveOutputState = (nextSettings, synth) => {
    // Live output/runtime architecture update only. This is the boundary used
    // for output-family toggles and routing changes that should not reconstruct
    // Keys. Fine-grained runtime transport controls such as sustain, OCT,
    // modulation actions, or imperative volume changes should stay on their own
    // dedicated live paths instead of being funneled through this method.
    if (synth) this.synth = synth;
    if (nextSettings) Object.assign(this.settings, nextSettings);
    this.midiout_data =
      this.settings.output_mts &&
      this.settings.midi_device !== "OFF" &&
      this.settings.midi_channel >= 0
        ? WebMidi.getOutputById(this.settings.midi_device)
        : null;
    this._pushControllerStateToSynth();
  };

  // ── Snapshot capture & playback ────────────────────────────────────────────

  /**
   * Capture all currently sounding notes (active + sustained/latched) as a
   * scale-agnostic snapshot.  Each note is stored as a MIDI float (midicents)
   * where 69.0 = A4 (440 Hz), plus its played velocity.
   *
   * Returns an empty array if no notes are sounding.
   * Duplicate pitches (same key pressed from multiple paths) are deduplicated.
   *
   * @returns {Array<{ midicents: number, velocity: number }>}
   */
  getSnapshot() {
    // centsToReference: the scale offset of the reference sample from degree 0.
    // Needed to reconstruct absolute frequency from hex.cents.
    const centsToRef =
      this.settings.reference_degree > 0
        ? (this.tuning.scale[this.settings.reference_degree - 1] ?? 0)
        : 0;
    const fund = this.settings.fundamental;

    const seen = new Map(); // rounded midicents string → entry (dedup)
    const add = (hex, vel) => {
      // freq = fundamental * 2^((cents - centsToRef) / 1200)
      const freq = fund * Math.pow(2, (hex.cents - centsToRef) / 1200);
      const midicents = 69 + Math.log2(freq / 440) * 12;
      const key = midicents.toFixed(3);
      if (!seen.has(key)) {
        seen.set(key, { midicents, velocity: vel ?? 72 });
      }
    };

    for (const hex of this._allActiveHexes()) {
      add(hex, hex.velocity_played);
    }
    for (const [hex, vel] of this.state.sustainedNotes) {
      add(hex, vel ?? hex.velocity_played);
    }

    return Array.from(seen.values());
  }

  /**
   * Play back a snapshot through the current synth.
   * Pitches are absolute (midicents → Hz), re-computed relative to the
   * current fundamental so playback is scale-agnostic.
   *
   * Note: for the sample synth this is exact.  MIDI/MTS synths use dummy
   * hex coords and will play at the nearest available voice mapping — suitable
   * for proof-of-concept; a proper coord-resolution pass is deferred.
   *
   * Stops any previously playing snapshot first.
   *
   * @param {Array<{ midicents: number, velocity: number }>} notes
   */
  playSnapshot(notes) {
    this.stopSnapshot();

    const centsToRef =
      this.settings.reference_degree > 0
        ? (this.tuning.scale[this.settings.reference_degree - 1] ?? 0)
        : 0;
    const fund = this.settings.fundamental;
    const degree0toRef_ratio = this.tuning.degree0toRef_asArray?.[1] ?? 1;

    this._snapshotHexes = notes.map(({ midicents, velocity }, i) => {
      // Convert absolute pitch back to synth-relative cents.
      const freq = 440 * Math.pow(2, (midicents - 69) / 12);
      const synthCents = centsToRef + Math.log2(freq / fund) * 1200;
      // Dummy coords placed well outside the normal play grid so they never
      // collide with user-pressed keys.  Unique per note to allow polyphony.
      const dummyCoords = new Point(9000 + i, 9000 + i);
      const hex = this.synth.makeHex(
        dummyCoords,
        synthCents,
        0, // steps (unused for playback)
        0, // equaves
        this.tuning.equivSteps,
        synthCents, // cents_prev
        synthCents, // cents_next
        undefined, // note_played
        velocity,
        0, // bend
        degree0toRef_ratio,
      );
      hex.noteOn();
      return hex;
    });
  }

  /**
   * Stop any snapshot currently playing.  Safe to call when nothing is playing.
   */
  stopSnapshot() {
    if (this._snapshotHexes?.length) {
      for (const hex of this._snapshotHexes) hex.noteOff(0);
      this._snapshotHexes = [];
    }
  }

  /**
   * Manually trigger a full Lumatone LED color sync regardless of the
   * lumatone_led_sync auto-sync setting.  Called by the "Sync now" button.
   */
  syncLumatoneLEDs = () => {
    if (this.lumatoneLEDs && this.controllerMap) {
      this.lumatoneLEDs.sendAll(this._buildLumatoneColorEntries());
    }
  };

  syncExquisLEDs = () => {
    if (this.exquisLEDs && this.controllerMap) {
      this.exquisLEDs.sendColors(this._buildExquisColorArray());
    }
  };

  syncLinnstrumentLEDs = () => {
    if (this.linnstrumentLEDs && this.controllerMap) {
      this.linnstrumentLEDs.sendPaletteValues(this._buildLinnstrumentColorArray());
    }
  };

  /**
   * Build a 128-element palette-value array for the LinnStrument 128.
   * Indexed by MIDI note number (0–127).
   *
   * Two-pass approach:
   *   1. Collect every scale degree that appears in the controller map, with
   *      its screen hex colour.  buildLinnstrumentDegreeMap() analyses the
   *      full colour set — clustering low-saturation shades into White/Off
   *      tiers, reserving Red for degree 0, hue-matching the rest.
   *   2. Apply the resulting degree→paletteValue map to all 128 note slots.
   *
   * @returns {number[]}  128 LinnStrument CC22 palette values
   */
  _buildLinnstrumentColorArray() {
    // Pass 1: gather one colour sample per unique scale degree.
    const degreeColors = new Map();
    for (const [, coords] of this.controllerMap) {
      const [cents, reducedSteps] = this.hexCoordsToCents(coords);
      if (!degreeColors.has(reducedSteps)) {
        degreeColors.set(reducedSteps, this._getScreenHexColor(cents, reducedSteps));
      }
    }

    // Pass 2: analyse the full degree set and get palette assignments.
    const degreeMap = buildLinnstrumentDegreeMap(degreeColors);

    // Pass 3: fill the 128-slot output array.
    // UF mode keys are "ch.col" (ch=row 1-8, col=1-16/25).
    // _sendCell expects a flat note index: (row-1)*16 + (col-1).
    const values = new Array(128).fill(LINNS_OFF);
    for (const [mapKey, coords] of this.controllerMap) {
      const dot = mapKey.indexOf(".");
      const ch   = parseInt(mapKey.slice(0, dot), 10);
      const col  = parseInt(mapKey.slice(dot + 1), 10);
      const note = (ch - 1) * 16 + (col - 1);
      if (note < 0 || note > 127) continue;
      const [, reducedSteps] = this.hexCoordsToCents(coords);
      values[note] = degreeMap.get(reducedSteps) ?? LINNS_OFF;
    }
    return values;
  }

  /**
   * Send the complete Lumatone layout — note/channel (CMD 00h) + colour (CMD 01h)
   * for all 280 keys — via the ACK-gated sysex queue.
   *
   * Note assignment: key k on board b → MIDI note k, channel b-1 (0-indexed).
   * This matches the standard Lumatone sequential layout (key = note, block = channel).
   *
   * Prepends a CMD 0Eh to enable polyphonic aftertouch on the hardware.
   *
   * One-time setup only — key assignments don't change; use syncLumatoneLEDs()
   * for subsequent colour updates.
   */
  sendLumatoneLayout = () => {
    if (!this.lumatoneLEDs) return;

    // All keys get colour #000000 so they appear dark/unlit on
    // the hardware.  Hexatone will sync actual colours via syncLumatoneLEDs()
    // once the layout is established.
    const entries = [];
    for (let b = 1; b <= 5; b++) {
      for (let k = 0; k < 56; k++) {
        entries.push({
          board: b,   // sysex board byte 1–5
          key: k,     // key index 0–55
          note: k,    // note = key index (sequential mapping)
          channel: b - 1, // 0-indexed channel (0–4)
          hexColor: "#000000",
        });
      }
    }

    // Enable polyphonic aftertouch before the key layout.
    this.lumatoneLEDs.sendLayout(entries, [{ cmd: 0x0e, board: 0, value: 1 }]);
  };

  /**
   * Activate or cancel MIDI-learn mode for the anchor note.
   * While active, the next note-on from the hardware controller is captured as
   * the new anchor and forwarded to `callback(noteNumber, channel)` instead of being played.
   * The channel (1-based) is included so multi-channel controllers (e.g. Lumatone)
   * can identify which channel/block the anchor key belongs to.
   * @param {boolean} active
   * @param {function(number, number):void} [callback]
   */
  setMidiLearnMode = (active, callback) => {
    this._midiLearnCallback = active ? (callback ?? null) : null;
  };

  // ── Lumatone LED helpers ────────────────────────────────────────────────────

  /**
   * Build the full list of { board, key, hexColor } entries for all keys in
   * controllerMap.  Applies screen→Lumatone colour transfer and handles the
   * tonic (degree 0) special colours.
   *
   * controllerMap is always built (even in sequential/bypass mode) so this
   * path works regardless of routing mode.
   *
   * @returns {Array<{ board: number, key: number, hexColor: string }>}
   */
  _buildLumatoneColorEntries() {
    const entries = [];
    for (const [mapKey, coords] of this.controllerMap) {
      // mapKey format: "ch.note"  (ch = board 1-5, note = key 0-55 within block)
      const dotIdx = mapKey.indexOf(".");
      const board = parseInt(mapKey.slice(0, dotIdx), 10);
      const key = parseInt(mapKey.slice(dotIdx + 1), 10);
      const hexColor = this._getLumatoneHexColor(coords);
      entries.push({ board, key, hexColor });
    }
    return entries;
  }

  // ── Exquis LED helpers ──────────────────────────────────────────────────────

  /**
   * Build a 61-element color array for the Exquis, indexed by Rainbow Layout
   * note number (0–60 = pad ID).
   *
   * controllerMap keys are "1.note" (single channel), so the note number is
   * everything after the dot. Unmapped pads default to black.
   *
   * @returns {string[]}  61 CSS hex colors ('#rrggbb')
   */
  _buildExquisColorArray() {
    const colors = new Array(61).fill("#000000");

    if (this.inputRuntime?.layoutMode === "sequential") {
      const scale = this.tuning.scale || [];
      const len = scale.length;
      if (len === 0) return colors;

      const anchorNote = this.settings.midiin_central_degree ?? 60;
      const centerDegree = this.settings.center_degree || 0;

      for (let note = 0; note <= 60; note++) {
        let steps = note - anchorNote + centerDegree;
        let octs = Math.trunc(steps / len);
        let reducedSteps = steps % len;
        if (reducedSteps < 0) {
          reducedSteps += len;
          octs -= 1;
        }
        const cents = octs * this.tuning.equivInterval + scale[reducedSteps];
        if (reducedSteps === 0) {
          colors[note] = octs === 0 ? LUMATONE_TONIC : LUMATONE_TONIC_OTHER;
        } else {
          colors[note] = transferColor(this._getScreenHexColor(cents, reducedSteps));
        }
      }
      return colors;
    }

    for (const [mapKey, coords] of this.controllerMap) {
      const note = parseInt(mapKey.slice(mapKey.indexOf(".") + 1), 10);
      if (note >= 0 && note <= 60) {
        colors[note] = this._getLumatoneHexColor(coords);
      }
    }
    return colors;
  }

  /**
   * Return the Lumatone-adjusted hex color ('#rrggbb') for a key at the given
   * hex-grid coords.
   *
   * Degree 0 (tonic) uses the special Lumatone tonic constants rather than
   * routing through transferColor(), matching the behaviour of lumatone-export.js.
   *
   * @param {Point} coords  – absolute hex-grid coordinates
   * @returns {string}      – '#rrggbb'
   */
  _getLumatoneHexColor(coords) {
    const [cents, reducedSteps, , octs] = this.hexCoordsToCents(coords);

    if (reducedSteps === 0) {
      // Tonic: use Lumatone-specific constants (not screen-derived).
      return octs === 0 ? LUMATONE_TONIC : LUMATONE_TONIC_OTHER;
    }

    // All other degrees: get screen color then map to Lumatone space.
    const screenHex = this._getScreenHexColor(cents, reducedSteps);
    return transferColor(screenHex);
  }

  /**
   * Return the unpressed screen hex color for the given degree / cents value,
   * applying the same logic as centsToColor() (without the pressed-key darkening).
   *
   * @param {number} cents         – pitch in cents (used for spectrum mode)
   * @param {number} reducedSteps  – scale degree index
   * @returns {string}             – '#rrggbb'
   */
  _getScreenHexColor(cents, reducedSteps) {
    if (!this.settings.spectrum_colors) {
      const colors = this.settings.note_colors;
      if (!colors || typeof colors[reducedSteps] === "undefined") return "#edede4";
      return nameToHex(colors[reducedSteps]);
    }

    // Spectrum mode: derive hue from cents position (same formula as centsToColor).
    const fcolor = hex2rgb("#" + this.settings.fundamental_color);
    const hsv = rgb2hsv(fcolor[0], fcolor[1], fcolor[2]);
    let h = hsv.h / 360;
    const s = hsv.s / 100;
    const v = hsv.v / 100;
    let reduced = (cents / 1200) % 1;
    if (reduced < 0) reduced += 1;
    h = (reduced + h) % 1;
    const { red, green, blue } = HSVtoRGB2(h, s, v);
    return rgbToHex(red, green, blue);
  }

  deconstruct = () => {
    if (this._retuneGlideTimer != null) {
      clearTimeout(this._retuneGlideTimer);
      this._retuneGlideTimer = null;
    }
    this._stopWheelSlew(true);
    if (this._deferredBulkMapTimer != null) {
      clearTimeout(this._deferredBulkMapTimer);
      this._deferredBulkMapTimer = null;
    }
    for (const timeoutId of this._recentlyReleasedHexes.values()) {
      clearTimeout(timeoutId);
    }
    this._recentlyReleasedHexes.clear();
    this._retuneGlides.clear();
    this._retuneGlideLastTime = 0;
    this._deferredBulkMapRefresh = false;
    this._staticDeferredBulkActive = false;
    // Graceful noteOff for all active and sustained notes — allows synth
    // release envelopes to run rather than cutting sound abruptly via panic().
    for (const hex of this._allActiveHexes()) {
      hex.noteOff(0);
    }
    for (const [hex, vel] of this.state.sustainedNotes) {
      hex.noteOff(vel);
    }
    // Belt-and-suspenders: send CC123 on all output channels. Covers the case
    // where notes were held on a physical controller at the moment of refresh —
    // the MIDI input listener is torn down before noteOff can fire normally.
    if (this.synth?.allSoundOff) this.synth.allSoundOff();
    this.state.activeMouse = null;
    this.state.activeTouch.clear();
    this.state.activeKeyboard.clear();
    this.state.activeMidi.clear();
    this.state.activeMidiByChannel.clear();
    this._mpeInputBendByChannel.clear();
    this._bendSlew.forEach((s) => {
      if (s.raf !== null) cancelAnimationFrame(s.raf);
    });
    this._bendSlew.clear();
    this.state.sustainedNotes = [];
    this.state.sustainedCoords.clear();
    this.recencyStack.clear();

    // Notify the app that latch/sustain is gone — the new Keys instance will
    // start with latch: false, so the UI indicator must match. Without this,
    // synth-only rebuilds (e.g. FluidSynth connecting) leave the app showing
    // latch as active while the new Keys has no sustain state, causing the
    // next click to produce a brief non-sustained note instead of latching.
    if (this.onLatchChange) this.onLatchChange(false);
    this._modulationState = cancelModulation(this._modulationState, "deconstruct");
    this._emitModulationState();

    // Stop any snapshot that is still playing.
    this.stopSnapshot();

    // lumatoneLEDs / exquisLEDs / linnstrumentLEDs are owned by app.jsx — not destroyed here.
    this.lumatoneLEDs = null;
    this.linnstrumentLEDs = null;

    window.removeEventListener("resize", this.resizeHandler, false);
    window.removeEventListener("orientationchange", this.resizeHandler, false);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener("resize", this.visualViewportResizeHandler, false);
    }

    window.removeEventListener("keydown", this.onKeyDown, false);
    window.removeEventListener("keyup", this.onKeyUp, false);
    this.state.canvas.removeEventListener("touchstart", this.handleTouch, false);
    this.state.canvas.removeEventListener("touchend", this.handleTouch, false);
    this.state.canvas.removeEventListener("touchmove", this.handleTouch, false);
    this.state.canvas.removeEventListener("touchcancel", this.handleTouchCancel, false);
    this.state.canvas.removeEventListener("mousedown", this.mouseDown, false);
    window.removeEventListener("mouseup", this.mouseUp, false);
    this.state.canvas.removeEventListener("mousemove", this.mouseActive, false);

    if (this.midiin_data) {
      for (const eventName of [
        "noteon",
        "noteoff",
        "keyaftertouch",
        "controlchange",
        "channelaftertouch",
        "pitchbend",
        "sysex",
      ]) {
        try {
          this.midiin_data.removeListener(eventName);
        } catch {
          // WebMidi.disable() may already have torn down this input's internal
          // listener tables before Keys deconstructs. Cleanup should remain
          // best-effort and never block the rebuild / disable path.
        }
      }
      this.midiin_data = null;
    }

    if (this.midiout_data) {
      this.midiout_data = null;
    }
  };

  mtsSendMap = (midiOutput, protectHeld = true, protectRecentReleased = true) => {
    // send the tuning map
    const output = midiOutput || this.midiout_data;
    if (!output) return;
    // Direct output uses the non-real-time bulk-dump path.
    // Main MTS real-time output always uses single-note real-time messages,
    // regardless of any stale sysex_type setting left over from older UI state.
    const isMtsBulkOutput =
      this.settings.output_mts_bulk &&
      this.settings.mts_bulk_device &&
      this.settings.mts_bulk_device !== "OFF" &&
      output.id === this.settings.mts_bulk_device;
    const sysex_type = isMtsBulkOutput ? 126 : 127;
    const tuningMap = isMtsBulkOutput
      ? mtsTuningMap(
          126,
          this.settings.mts_bulk_device_id ?? 127,
          this.settings.mts_bulk_tuning_map_number ?? 0,
          this.settings.mts_bulk_mode === "static"
            ? computeStaticMapDegree0(
                chooseStaticMapCenterMidi(
                  computeCenterPitchHz(
                    this.settings.fundamental,
                    this.tuning.degree0toRef_asArray[0],
                    this.tuning.scale,
                    this.tuning.equivInterval,
                    this.settings.center_degree,
                  ),
                ),
                this.settings.center_degree,
              )
            : computeNaturalAnchor(
                this.settings.fundamental,
                this.tuning.degree0toRef_asArray[0],
                this.tuning.scale,
                this.tuning.equivInterval,
                this.settings.center_degree,
              ),
          this.tuning.scale,
          resolveBulkDumpName(
            this.settings.mts_bulk_tuning_map_name,
            this.settings.short_description,
            this.settings.name,
          ),
          this.tuning.equivInterval,
          this.settings.fundamental,
          this.tuning.degree0toRef_asArray,
          this.settings.octave_offset || 0,
        )
      : this.mts_tuning_map;

    if (sysex_type === 127) {
      // Real-time single-note tuning change: one message per note.
      // Each entry is [127, device_id, 8, 2, map#, 1, note, mts0, mts1, mts2].
      // sendSysex(manufacturer, data) prepends F0+manufacturer and appends F7.
      // We copy each array to avoid mutating the stored tuning map.
      for (let i = 0; i < 128; i++) {
        const msg = [...tuningMap[i]];
        const manufacturer = msg.shift(); // 127 = universal real-time
        output.sendSysex([manufacturer], msg);
      }
    } else if (sysex_type === 126) {
      // Non-real-time bulk tuning dump: single message for all 128 notes.
      // tuningMap is a flat byte array from buildBulkDumpMessage, already starting
      // with 126 (0x7E universal non-real-time). Send as raw bytes via output.send()
      // matching the pattern used by createBulkDynamicTransport.sendBulkDump().
      //
      // Build a protected copy: any carrier slot currently held by a sustained
      // or active note keeps its exact current tuning bytes so the synth does
      // not retune it mid-sustain.
      const sustainedSlots = new Map(); // carrier slot → [tt, yy, zz]
      if (protectHeld) {
        for (const hex of this._collectProtectedBulkHexes(protectRecentReleased)) {
          if (hex.mts && hex.mts.length >= 4) {
            if (!sustainedSlots.has(hex.mts[0])) {
              sustainedSlots.set(hex.mts[0], [hex.mts[1], hex.mts[2], hex.mts[3]]);
            }
          }
        }
      }

      // Clone and patch protected slots.
      // Layout of tuningMap (from buildBulkDumpMessage):
      //   [126, device_id, 8, 1, map#, name(16 bytes)] = 21 header bytes
      //   then 128 × 3 tuning bytes (note0_tt, note0_yy, note0_zz, ...)
      //   then 1 checksum byte
      const msg = [...tuningMap];
      const HEADER_LEN = 21; // 126 + device_id + 8 + 1 + map# + 16-byte name
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

      output.send([0xf0, ...msg, 0xf7]);
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
    const removed = removeSustainedHex(this.state, coords);
    if (!removed) return false;
    const [hex, vel] = removed.entry;
    hex.noteOff(releaseVelocity || vel);
    this._scheduleDeferredBulkRefresh();
    this.hexOff(coords);
    return true;
  }

  // Yields every active hex object across all four input sources.
  // Use this anywhere that needs to act on all sounding notes regardless of how they
  // were triggered (retune, snapshot, MTS guard, panic, deconstruct, etc.).
  *_allActiveHexes() {
    yield* iterActiveHexes(this.state);
  }

  // Returns true if any input source currently has a hex active at these coords.
  // Used by hexOff() to decide whether to draw the hex as unlit: if another source
  // still holds the coord, the hex must remain visually lit.
  _isCoordActive(coords) {
    return isCoordActive(this.state, coords);
  }

  _hasSoundingNotes() {
    return hasSoundingNotes(this.state);
  }

  _hasRecentReleasedBulkTargets() {
    return this._recentlyReleasedHexes.size > 0;
  }

  _collectProtectedBulkHexes(includeRecentReleased = true) {
    return collectSoundingHexes(this.state, {
      includeRecentReleased,
      recentReleasedHexes: this._recentlyReleasedHexes,
    });
  }

  _hasDeferredBulkTargets() {
    const hasDirectBulk =
      this.settings.output_mts_bulk &&
      this.settings.mts_bulk_device &&
      this.settings.mts_bulk_device !== "OFF";
    return hasDirectBulk;
  }

  _sendBulkDumpOctaveRefresh(protectHeld = true, protectRecentReleased = true) {
    if (
      this.settings.output_mts_bulk &&
      this.settings.mts_bulk_device &&
      this.settings.mts_bulk_device !== "OFF"
    ) {
      const directOut = WebMidi.getOutputById(this.settings.mts_bulk_device);
      if (directOut) this.mtsSendMap(directOut, protectHeld, protectRecentReleased);
    }
  }

  _scheduleDeferredBulkRefresh() {
    if (!this._deferredBulkMapRefresh) return;
    if (this._deferredBulkMapTimer != null) return;
    this._deferredBulkMapTimer = setTimeout(() => {
      this._deferredBulkMapTimer = null;
      if (!this._deferredBulkMapRefresh) return;
      this._sendBulkDumpOctaveRefresh(true);
      if (!this._hasSoundingNotes() && !this._hasRecentReleasedBulkTargets()) {
        this._deferredBulkMapRefresh = false;
      }
    }, 0);
  }

  _trackRecentlyReleasedHex(hex) {
    if (!hex?.mts || hex.mts.length < 4 || !this._hasDeferredBulkTargets()) return;
    const existing = this._recentlyReleasedHexes.get(hex);
    if (existing != null) clearTimeout(existing);
    const timeoutId = setTimeout(() => {
      this._recentlyReleasedHexes.delete(hex);
    }, BULK_RELEASE_PROTECT_MS);
    this._recentlyReleasedHexes.set(hex, timeoutId);
  }

  // Apply channel step offset to a base coordinate.
  // Gets the raw steps at baseCoords, adds channelToStepsOffset(channel),
  // then returns the best visible coord for those combined steps.
  // If stepsPerChannel is effectively zero (single-channel device or
  // stepsPerChannel === 0) returns baseCoords unchanged.
  _applyChannelOffset(baseCoords, channel) {
    const stepsPerChannel = this.inputRuntime.stepsPerChannel ?? this.tuning.equivSteps;
    if (!stepsPerChannel) return baseCoords;
    const channelOffset = this.channelToStepsOffset(channel);
    if (channelOffset === 0) return baseCoords;
    const [, , baseSteps] = this.hexCoordsToCents(baseCoords);
    return this.bestVisibleCoord(baseSteps + channelOffset) ?? baseCoords;
  }

  _normalizeInputAddress(channel, note) {
    return this.controller?.normalizeInput?.(channel, note, this.settings) ?? { channel, note };
  }

  _resolveScaleInputPitchCents(channel, note, fallbackPitchHz) {
    const controllerPitchCents = this.controller?.resolveScaleInputPitchCents?.(
      channel,
      note,
      this.settings,
    );
    if (controllerPitchCents != null) return controllerPitchCents;

    const degree0toRefCents = this.tuning.degree0toRef_asArray[0];
    const degree0Hz = this.settings.fundamental / Math.pow(2, degree0toRefCents / 1200);
    return 1200 * Math.log2(fallbackPitchHz / degree0Hz);
  }

  midinoteOn = (e) => {
    const bend = this.bend || 0;
    const note_played = e.note.number + 128 * (e.message.channel - 1);
    const velocity_played = e.note.rawAttack;

    // Some controllers can emit a retrigger for the same note/channel before the
    // matching note-off arrives. Replace the old voice explicitly so a bent tail
    // cannot survive underneath the new onset.
    const existingHex = this.state.activeMidi.get(note_played);
    if (existingHex) {
      this.state.activeMidi.delete(note_played);
      if (
        this.inputRuntime.mpeInput &&
        this.state.activeMidiByChannel.get(e.message.channel)?.hex === existingHex
      ) {
        this.state.activeMidiByChannel.delete(e.message.channel);
      }
      this.recencyStack.remove(existingHex);
      existingHex.noteOff(0);
      this._trackRecentlyReleasedHex(existingHex);
      this._updateWheelTarget(false);
    }

    let coords;

    if (this.inputRuntime.target === "scale") {
      // Scale target mode: map incoming MIDI pitch to nearest scale degree.
      // Purely musical reference — independent of layout settings
      // (center_degree, midiin_central_degree, rSteps, etc.).
      // pitchCents: incoming note expressed as cents above degree 0.
      // Resolve exact pitch: MPE pre-bend > MTS table > plain 12-EDO.
      let pitchHz;
      if (this.inputRuntime.mpeInput) {
        const preBend = this._scaleModePreBend.get(e.message.channel) ?? 8192;
        const norm = (preBend - 8192) / 8192; // −1…+1
        const bendRange = this.inputRuntime.scaleBendRange ?? 48;
        const baseHz = 440 * Math.pow(2, (e.note.number - 69) / 12);
        pitchHz = baseHz * Math.pow(2, (norm * bendRange) / 12);
      } else {
        pitchHz =
          this._mtsInputTable.get(e.note.number) ?? 440 * Math.pow(2, (e.note.number - 69) / 12);
      }
      const pitchCents = this._resolveScaleInputPitchCents(
        e.message.channel,
        e.note.number,
        pitchHz,
      );
      const result = findNearestDegree(
        pitchCents,
        this.tuning.scale,
        this.tuning.equivInterval,
        this.inputRuntime.scaleTolerance ?? 50,
        this.inputRuntime.scaleFallback || "discard",
      );
      if (result === null) return; // out of tolerance, discard
      if (!this.coordResolver.stepsTable) this.coordResolver.buildStepsTable();
      coords = this.coordResolver.bestVisibleCoord(result.steps);
    } else if (this.inputRuntime.layoutMode === "sequential") {
      const normalized = this._normalizeInputAddress(e.message.channel, e.note.number);
      if (!normalized) return;
      // Sequential mode: ignore controller geometry, use step arithmetic.
      // Also forward raw notes when MTS output is off (MTS via hexOn would double them).
      if (!this.settings.output_mts && this.midiout_data && this.settings.midi_channel >= 0) {
        this.midiout_data.sendNoteOn(e.note.number, {
          channels: this.settings.midi_channel + 1,
          rawAttack: velocity_played,
        });
      }
      coords = this.coordResolver.bestVisibleCoord(
        this.coordResolver.noteToSteps(normalized.note, normalized.channel),
      );
    } else if (this.controllerMap) {
      // Known controller: direct coordinate lookup from pre-built map.
      // Single-channel controllers always use ch=1; multi-channel use the real channel.
      const lookupChannel = this.controller.multiChannel ? e.message.channel : 1;
      const baseCoords = this.controllerMap.get(`${lookupChannel}.${e.note.number}`) ?? null;
      if (baseCoords === null) return;
      const inputChannel = e.message.channel;
      // The controllerMap already encodes physical position exactly — no channel offset.
      // Controllers that opt into channel-offset arithmetic on top of their map
      // (e.g. Generic Keyboard) apply the user's per-channel transposition here.
      coords = this.controller.applyChannelOffsetOnMap
        ? this._applyChannelOffset(baseCoords, inputChannel)
        : baseCoords;
    } else {
      // Generic keyboard: step arithmetic with channel-based transposition.
      coords = this.coordResolver.bestVisibleCoord(
        this.coordResolver.noteToSteps(e.note.number, e.message.channel),
      );
    }

    if (coords === null) return;
    if (this._midiLatchToggle(coords, velocity_played)) return;
    const hex = this.hexOn(coords, note_played, velocity_played, bend);
    if (this.inputRuntime.mpeInput) hex._inputChannel = e.message.channel;
    this.state.activeMidi.set(note_played, hex);
    // In MPE input mode also track by channel so per-channel expression events
    // (pitch bend, pressure, CC74) can look up the correct hex directly.
    if (this.inputRuntime.mpeInput) {
      // Store both the hex and its base pitch (cents at note-on, before any bend).
      // The pitch bend handler reads baseCents — not hex.cents, which retune() mutates.
      this.state.activeMidiByChannel.set(e.message.channel, {
        hex,
        baseCents: hex._baseCents ?? hex.cents,
      });
    }
    this.coordResolver.lastMidiCoords = this.hexCoordsToScreen(coords);
  };

  midinoteOff = (e) => {
    let coordsList;

    if (this.inputRuntime.target === "scale") {
      // Scale mode: re-resolve pitch to steps for visual release.
      // Mirror the same pitch resolution as midinoteOn so we release the right key.
      let pitchHz;
      if (this.inputRuntime.mpeInput) {
        const preBend = this._scaleModePreBend.get(e.message.channel) ?? 8192;
        const norm = (preBend - 8192) / 8192;
        const bendRange = this.inputRuntime.scaleBendRange ?? 48;
        const baseHz = 440 * Math.pow(2, (e.note.number - 69) / 12);
        pitchHz = baseHz * Math.pow(2, (norm * bendRange) / 12);
      } else {
        pitchHz =
          this._mtsInputTable.get(e.note.number) ?? 440 * Math.pow(2, (e.note.number - 69) / 12);
      }
      const pitchCents = this._resolveScaleInputPitchCents(
        e.message.channel,
        e.note.number,
        pitchHz,
      );
      const result = findNearestDegree(
        pitchCents,
        this.tuning.scale,
        this.tuning.equivInterval,
        this.inputRuntime.scaleTolerance ?? 50,
        // Always accept on note-off — we must release whatever was activated.
        "accept",
      );
      if (result === null) {
        coordsList = [];
      } else {
        coordsList = this.coordResolver.stepsToVisibleCoords(result.steps);
      }
    } else if (this.inputRuntime.layoutMode === "sequential" || !this.controllerMap) {
      const normalized = this._normalizeInputAddress(e.message.channel, e.note.number);
      // Sequential or generic keyboard: step arithmetic (may hit multiple visible coords).
      if (
        this.inputRuntime.layoutMode === "sequential" &&
        !this.settings.output_mts &&
        this.midiout_data &&
        this.settings.midi_channel >= 0
      ) {
        this.midiout_data.sendNoteOff(e.note.number, {
          channels: this.settings.midi_channel + 1,
          rawRelease: e.note.rawRelease,
        });
      }
      coordsList = normalized
        ? this.coordResolver.stepsToVisibleCoords(
            this.coordResolver.noteToSteps(normalized.note, normalized.channel),
          )
        : [];
    } else {
      // Known controller: direct lookup returns exactly one coord.
      const lookupChannel = this.controller.multiChannel ? e.message.channel : 1;
      const baseCoords = this.controllerMap.get(`${lookupChannel}.${e.note.number}`);
      if (!baseCoords) {
        coordsList = [];
      } else {
        const coords = this.controller.applyChannelOffsetOnMap
          ? this._applyChannelOffset(baseCoords, e.message.channel)
          : baseCoords;
        coordsList = [coords];
      }
    }

    const note_played = e.note.number + 128 * (e.message.channel - 1);
    const hex = this.state.activeMidi.get(note_played);
    if (hex) {
      this.noteOff(hex, e.note.rawRelease);
      this.state.activeMidi.delete(note_played); // clear BEFORE hexOff
      // In MPE input mode, remove the channel→hex mapping. Only remove if this
      // note's hex is still the registered one — a fast retrigger on the same
      // channel could have already registered a newer hex.
      if (
        this.inputRuntime.mpeInput &&
        this.state.activeMidiByChannel.get(e.message.channel)?.hex === hex
      ) {
        this.state.activeMidiByChannel.delete(e.message.channel);
        this._mpeInputBendByChannel.delete(e.message.channel);
        const slew = this._bendSlew.get(e.message.channel);
        if (slew) {
          if (slew.raf !== null) cancelAnimationFrame(slew.raf);
          this._bendSlew.delete(e.message.channel);
        }
      }
      this._settleModulationAfterActiveRelease();
    }
    // hexOff is called per coord for visual update (may cover multiple visible coords)
    for (const coords of coordsList) {
      if (!this.state.sustain) this.hexOff(coords);
    }
  };

  allnotesOff = () => {
    this._retuneGlides.clear();
    if (this._retuneGlideTimer != null) {
      clearTimeout(this._retuneGlideTimer);
      this._retuneGlideTimer = null;
    }
    this._stopWheelSlew(true);
    this._retuneGlideLastTime = 0;
    if (notes.played.length > 0) {
      for (const note_played of notes.played) {
        const note = note_played % 128;
        const channel = Math.floor(note_played / 128) + 1; // 1-indexed

        let coordsList;
        if (this.inputRuntime.layoutMode !== "sequential" && this.controllerMap) {
          // Known controller: direct lookup.
          const lookupChannel = this.controller.multiChannel ? channel : 1;
          const baseCoords = this.controllerMap.get(`${lookupChannel}.${note}`);
          if (!baseCoords) {
            coordsList = [];
          } else {
            const coords = this.controller.applyChannelOffsetOnMap
              ? this._applyChannelOffset(baseCoords, channel)
              : baseCoords;
            coordsList = [coords];
          }
        } else {
          // Sequential or generic keyboard: step arithmetic.
          const normalized = this._normalizeInputAddress(channel, note);
          coordsList = this.coordResolver.stepsToVisibleCoords(
            this.coordResolver.noteToSteps(normalized.note, normalized.channel),
          );
        }

        const hex = this.state.activeMidi.get(note_played);
        if (hex) {
          this.noteOff(hex, 64);
          this.state.activeMidi.delete(note_played); // clear BEFORE hexOff
          this._settleModulationAfterActiveRelease();
        }
        for (const coords of coordsList) {
          if (!this.state.sustain) this.hexOff(coords);
        }
      }
      notes.played = [];
      this.state.activeMidiByChannel.clear();
      this._mpeInputBendByChannel.clear();
      this._bendSlew.forEach((s) => {
        if (s.raf !== null) cancelAnimationFrame(s.raf);
      });
      this._bendSlew.clear();
    } else {
    }
  };

  panic = () => {
    this._retuneGlides.clear();
    if (this._retuneGlideTimer != null) {
      clearTimeout(this._retuneGlideTimer);
      this._retuneGlideTimer = null;
    }
    this._stopWheelSlew(true);
    this._retuneGlideLastTime = 0;
    // Send CC123 (All Notes Off) to all active output engines.
    // allSoundOff() on the composite synth fans out to every child (MPE, MTS,
    // static bulk, sample) using their own raw output ports — no WebMidi
    // dependency, no settings lookup, always reaches the right channels.
    if (this.synth?.allSoundOff) this.synth.allSoundOff();

    // Work with a copy to avoid iteration issues
    const activeHexes = [...this._allActiveHexes()];
    const sustainedHexes = [...this.state.sustainedNotes];

    // Kill all active notes across all input sources
    for (const hex of activeHexes) {
      hex.noteOff(0);
      // Redraw hex as unpressed
      const [cents, pressed_interval] = this.hexCoordsToCents(hex.coords);
      const [color, text_color] = this.centsToColor(cents, false, pressed_interval);
      this.drawHex(hex.coords, color, text_color);
    }
    this.state.activeMouse = null;
    this.state.activeTouch.clear();
    this.state.activeKeyboard.clear();
    this.state.activeMidi.clear();
    this.state.activeMidiByChannel.clear();
    this._mpeInputBendByChannel.clear();
    this._bendSlew.forEach((s) => {
      if (s.raf !== null) cancelAnimationFrame(s.raf);
    });
    this._bendSlew.clear();
    // Reset drag-state flags in case panic fires mid-drag
    this.state.isMouseDown = false;
    this.state.isTouchDown = false;
    this.state.canvas.removeEventListener("mousemove", this.mouseActive);

    // Kill all sustained notes - process newest first
    for (let i = sustainedHexes.length - 1; i >= 0; i--) {
      const [hex, releaseVel] = sustainedHexes[i];
      hex.noteOff(releaseVel);

      const [cents, pressed_interval] = this.hexCoordsToCents(hex.coords);
      const [color, text_color] = this.centsToColor(cents, false, pressed_interval);
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
    this._wheelValue14 = 8192;
    this._wheelInputValue14 = 8192;
    this._wheelSlew.current = 8192;
    this._wheelSlew.target = 8192;

    // Reset sustain/latch state
    this.state.sustain = false;
    this.state.latch = false;
    if (this.onLatchChange) this.onLatchChange(false);
    this._modulationState = cancelModulation(this._modulationState, "panic");
    this._emitModulationState();

    // Stop any snapshot playback
    this.stopSnapshot();

  };

  releaseAllKeyboardNotes = () => {
    for (const code of this.state.pressedKeys) {
      const kbRaw = this.settings.keyCodeToCoords[code];
      if (!kbRaw) continue;
      const kbOffset = this.settings.centerHexOffset;
      const coords = new Point(kbRaw.x + kbOffset.x, kbRaw.y + kbOffset.y);
      const hex = this.state.activeKeyboard.get(code);
      if (hex) {
        this.noteOff(hex, 0);
        this.state.activeKeyboard.delete(code); // clear BEFORE hexOff
        this._settleModulationAfterActiveRelease();
      }
      if (!this.state.sustain) this.hexOff(coords);
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
    this._commitPendingModulationTarget(coords);
    if (this._staticDeferredBulkActive && this._deferredBulkMapRefresh) {
      this._sendBulkDumpOctaveRefresh(this._hasSoundingNotes(), false);
      this._deferredBulkMapRefresh = false;
      if (!this._hasSoundingNotes()) {
        this._staticDeferredBulkActive = false;
      }
    }
    if (!bend) {
      bend = 0;
    }
    if (!velocity_played) {
      velocity_played = this.settings.midi_velocity;
    }
    if (!velocity_played) {
      velocity_played = 72;
    }
    const [cents, pressed_interval, steps, equaves, equivSteps, cents_prev, cents_next] =
      this.hexCoordsToCents(coords);
    this._lastPlayedDegree = pressed_interval ?? this._lastPlayedDegree;
    const [color, text_color] = this.centsToColor(cents, true, pressed_interval);
    this.drawHex(coords, color, text_color);
    const transferredHex = this._maybeTakeOverModulationTarget(coords, cents, cents_prev, cents_next);
    if (transferredHex) {
      return transferredHex;
    }
    let degree0toRef_ratio = this.tuning.degree0toRef_asArray[1]; // array[0] is cents, array[1] is the ratio
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
    hex._onsetFrameId = frameForNewNotes(this._modulationState)?.id ?? this._harmonicFrame?.id ?? null;
    hex._baseCents = hex.cents;
    // Store neighbour pitches for scale-aware wheel bend.
    hex.cents_prev = cents_prev;
    hex.cents_next = cents_next;
    // Track in recency stack so wheel bend and snapshot can find this note.
    this.recencyStack.push(hex);
    this._updateWheelTarget();
    this._applyCurrentWheelToHex(hex);
    //console.log("hex on at ", [coords.x, coords.y]);
    return hex;
  }

  hexOff(coords) {
    const [cents, pressed_interval] = this.hexCoordsToCents(coords);
    const key = coords.x + "," + coords.y;
    const isSustained = this.state.sustainedCoords.has(key);
    // If another input source still has this coord active, keep it visually lit
    // (e.g. MIDI holds a note while the computer keyboard releases the same hex).
    const isActiveElsewhere = this._isCoordActive(coords);
    const [color, text_color] = this.centsToColor(
      cents,
      isSustained || isActiveElsewhere,
      pressed_interval,
    );
    this.drawHex(coords, color, text_color);
  }

  noteOff(hex, release_velocity) {
    if (shouldSuppressTransferredSourceRelease(hex)) {
      releaseTransferredSourceExpression(hex);
      this.recencyStack.remove(hex);
      this._updateWheelTarget(true);
      return;
    }
    if (this.state.sustain) {
      const result = addSustainedHex(this.state, hex, release_velocity);
      if (result.added) {
        // Keep the hex visually lit while it's sustained
        const [cents, pressed_interval] = this.hexCoordsToCents(hex.coords);
        const [color, text_color] = this.centsToColor(cents, true, pressed_interval);
        this.drawHex(hex.coords, color, text_color);
      }
    } else {
      if (this._deferredBulkMapRefresh && !this._staticDeferredBulkActive) {
        this._sendBulkDumpOctaveRefresh(true);
      }
      hex.noteOff(release_velocity);
      this._trackRecentlyReleasedHex(hex);
      // Note is going silent — remove from recency stack and update wheel target.
      this.recencyStack.remove(hex);
      this._updateWheelTarget(true);
      if (this._staticDeferredBulkActive) {
        this._deferredBulkMapRefresh = this._hasSoundingNotes();
        if (!this._deferredBulkMapRefresh) this._staticDeferredBulkActive = false;
      } else {
        this._scheduleDeferredBulkRefresh();
      }
      this._maybeSettleModulation();
    }
  }

  sustainOff(force = false) {
    if (this.state.latch && !force) return; // latch holds unless forced (e.g. Space)
    if (this.state.latch) {
      // Force-release also clears latch
      this.state.latch = false;
    }
    this.state.sustain = false;
    const notesToRelease = clearSustainedHexes(this.state);
    if (
      this._deferredBulkMapRefresh &&
      !this._staticDeferredBulkActive &&
      notesToRelease.length > 0
    ) {
      this._sendBulkDumpOctaveRefresh(true);
    }
    for (let note = 0; note < notesToRelease.length; note++) {
      const hex = notesToRelease[note][0];
      const [cents, pressed_interval] = this.hexCoordsToCents(hex.coords);
      const [color, text_color] = this.centsToColor(cents, false, pressed_interval);
      this.drawHex(hex.coords, color, text_color);
      hex.noteOff(notesToRelease[note][1]);
      this._trackRecentlyReleasedHex(hex);
      this.recencyStack.remove(hex);
    }
    this._updateWheelTarget(true);
    if (this._staticDeferredBulkActive) {
      this._deferredBulkMapRefresh = this._hasSoundingNotes();
      if (!this._deferredBulkMapRefresh) this._staticDeferredBulkActive = false;
    } else {
      this._scheduleDeferredBulkRefresh();
    }
    this._maybeSettleModulation();
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
      // Capture any currently active notes (from all sources) into sustainedNotes
      for (const hex of this._allActiveHexes()) {
        if (!this.state.sustainedNotes.find(([h]) => h === hex)) {
          this.state.sustainedNotes.push([hex, 0]);
          this.state.sustainedCoords.add(hex.coords.x + "," + hex.coords.y);
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
    let m = calculateRotationMatrix(this.settings.rotation, this.state.centerpoint);
    this.state.context.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);

    // Redraw Grid
    this.drawGrid();

    // Rebuild the steps→coords lookup table now that centerpoint and grid range
    // are up to date. Must come after drawGrid() so centerpoint is already set.
    this.coordResolver.buildStepsTable();
  };

  inputIsFocused = () => {
    const tag = document.activeElement && document.activeElement.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  };

  onKeyDown = (e) => {
    // DEBUG: check what key code is produced
    // console.log('Key pressed:', e.code, e.key);

    // Delete : Panic - kill all notes
    if ((e.code === "Delete" && !e.repeat) || (e.code === "Backspace" && !e.repeat)) {
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

    // Enter: take a snapshot of currently-sounding notes (only when notes are active).
    if (e.code === "Enter" && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const hasNotes =
        this.state.activeMouse !== null ||
        this.state.activeTouch.size > 0 ||
        this.state.activeKeyboard.size > 0 ||
        this.state.activeMidi.size > 0 ||
        this.state.sustainedNotes.length > 0;
      if (hasNotes && this.onTakeSnapshot) {
        this.onTakeSnapshot();
        return;
      }
    }

    // Modulation arm/disarm should behave like Escape sustain: global, not tied
    // to whether the sidebar is closed or a text input currently has focus.
    if (
      isModulationToggleKeyCode(e.code) &&
      !e.repeat &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey
    ) {
      e.preventDefault();
      this.toggleModulationArm();
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
    } else if (e.code in this.settings.keyCodeToCoords) {
      // Keyboard now operates independently — no mutex guard against mouse/touch.
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
            hex.noteOff(vel);
            this.hexOff(coords);
          }
          // Remove from activeKeyboard
          this.state.activeKeyboard.delete(e.code);
        } else {
          // Play note and shift-sustain it
          this.state.pressedKeys.add(e.code);
          this.state.shiftSustainedKeys.add(e.code);
          const kbOffset = this.settings.centerHexOffset;
          const kbRaw = this.settings.keyCodeToCoords[e.code];
          let coords = new Point(kbRaw.x + kbOffset.x, kbRaw.y + kbOffset.y);
          let hex = this.hexOn(coords);
          this.state.activeKeyboard.set(e.code, hex);
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
            hex.noteOff(vel);
            this.hexOff(coords);
          }
          // Remove from activeKeyboard
          this.state.activeKeyboard.delete(e.code);
        } else if (!this.state.pressedKeys.has(e.code)) {
          // Calculate coords for this key
          const kbOffset = this.settings.centerHexOffset;
          const kbRaw = this.settings.keyCodeToCoords[e.code];
          let coords = new Point(kbRaw.x + kbOffset.x, kbRaw.y + kbOffset.y);

          // When latch is active, check if this note is already sustained.
          // If so, toggle it off (same behavior as mouse/touch).
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
          this.state.activeKeyboard.set(e.code, hex);
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

    if (isModulationToggleKeyCode(e.code)) {
      return;
    }

    // Only process other keys when sidebar is closed and no input is focused
    if (!this.typing) return;
    if (this.inputIsFocused()) return;

    if (e.code === "Space") {
      this.sustainOff(true); // force-release overrides latch
    } else if (e.code in this.settings.keyCodeToCoords) {
      // Keyboard now operates independently — no mutex guard against mouse/touch.
      // Skip release for shift-sustained keys — they stay held until re-pressed without Shift.
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
        const hex = this.state.activeKeyboard.get(e.code);
        if (hex) {
          this.noteOff(hex, 0);
          this.state.activeKeyboard.delete(e.code); // clear BEFORE hexOff
          this._settleModulationAfterActiveRelease();
        }
        if (!this.state.sustain) this.hexOff(coords);
      }
    }
  };

  mouseUp = (_e) => {
    // Gate on isMouseDown — only true if this drag started on the canvas.
    // This correctly handles both off-canvas releases (processes activeMouse)
    // and UI button clicks (isMouseDown was never set, so we ignore them).
    if (!this.state.isMouseDown) return;
    this.state.isMouseDown = false;
    this.state.mouseDownToggledCoord = null;

    // Mouse now operates independently of touch/keyboard — no mutex guard needed.
    this.state.canvas.removeEventListener("mousemove", this.mouseActive);

    if (this.state.activeMouse) {
      const coords = this.state.activeMouse.coords;
      this.noteOff(this.state.activeMouse, 0);
      this.state.activeMouse = null; // clear BEFORE hexOff so _isCoordActive is honest
      this._settleModulationAfterActiveRelease();
      if (!this.state.sustain) this.hexOff(coords);
    }

    // If Escape keyup fired spuriously while mouse was down,
    // release sustain now. But not if a tune-handle drag is in progress.
    if (!this.state.escHeld && this.state.sustain && !this.state.isTuneDragging) {
      this.sustainOff();
    }
  };

  mouseDown = (e) => {
    if (this._onFirstInteraction) {
      this._onFirstInteraction();
    }
    // Mouse now operates independently — no mutex guard against keyboard/touch.

    // Clean up stale activeMouse (e.g. mouseUp fired off-canvas).
    // Call hex.noteOff directly — bypassing noteOff() — so stale notes
    // are silenced outright rather than being routed into sustainedNotes.
    if (this.state.activeMouse) {
      this.state.activeMouse.noteOff(0);
      this.state.activeMouse = null;
    }

    this.state.mouseDownToggledCoord = null;
    this.state.isMouseDown = true;
    this.state.canvas.addEventListener("mousemove", this.mouseActive, false);
    this.mouseActive(e);
  };

  mouseActive = (e) => {
    let coords = this.getPointerPosition(e);
    coords = this.getHexCoordsAt(coords);

    if (this.state.activeMouse === null) {
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
      this.state.activeMouse = this.hexOn(coords);
    } else {
      const first = this.state.activeMouse;
      if (!coords.equals(first.coords)) {
        // When sliding TO a sustained note with latch active, toggle it off.
        if (this.state.latch) {
          const key = coords.x + "," + coords.y;
          const sustainedIdx = this.state.sustainedNotes.findIndex(
            ([h]) => h.coords.x === coords.x && h.coords.y === coords.y,
          );
          if (sustainedIdx !== -1) {
            // Release old active hex — clear activeMouse BEFORE hexOff
            const oldCoords = first.coords;
            this.noteOff(first, 0);
            this.state.activeMouse = null;
            this._settleModulationAfterActiveRelease();
            this.hexOff(oldCoords);
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
        // Normal slide to new hex — clear activeMouse BEFORE hexOff so
        // _isCoordActive correctly sees the old entry as gone.
        const oldCoords = first.coords;
        this.noteOff(first, 0);
        this.state.activeMouse = null;
        this._settleModulationAfterActiveRelease();
        this.hexOff(oldCoords);
        this.state.activeMouse = this.hexOn(coords);
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
    // Gesture-bound audio recovery may be needed again after iOS sleep/background.
    if (this._onFirstInteraction) {
      this._onFirstInteraction();
    }
    // Touch now operates independently — no mutex guard against mouse/keyboard.

    this.state.isTouchDown = e.targetTouches.length !== 0;

    // Build the set of touch identifiers currently active in this event.
    const currentIds = new Set();
    for (let i = 0; i < e.targetTouches.length; i++) {
      currentIds.add(e.targetTouches[i].identifier);
    }

    // Release any stored touches whose identifier is no longer in the live event
    // (finger lifted). Clear from Map BEFORE calling hexOff so _isCoordActive is honest.
    for (const [id, hex] of this.state.activeTouch) {
      if (!currentIds.has(id)) {
        const coords = hex.coords;
        this.noteOff(hex, 0);
        this.state.activeTouch.delete(id);
        this._settleModulationAfterActiveRelease();
        if (!this.state.sustain) this.hexOff(coords);
      }
    }

    // Process each currently live touch point.
    const rect = this.state.canvas.getBoundingClientRect();
    for (let i = 0; i < e.targetTouches.length; i++) {
      const touch = e.targetTouches[i];
      const id = touch.identifier;
      const coords = this.getHexCoordsAt(
        new Point(touch.clientX - rect.left, touch.clientY - rect.top),
      );

      const existing = this.state.activeTouch.get(id);

      if (existing) {
        // Finger already tracked — check if it moved to a different hex.
        if (!existing.coords.equals(coords)) {
          const oldCoords = existing.coords;
          this.noteOff(existing, 0);
          this.state.activeTouch.delete(id); // clear BEFORE hexOff
          this._settleModulationAfterActiveRelease();
          if (!this.state.sustain) this.hexOff(oldCoords);
          this._touchStartOnCoords(id, coords);
        }
        // else: same hex, nothing to do
      } else {
        // New finger down.
        this._touchStartOnCoords(id, coords);
      }
    }
  };

  // Helper: start a touch note at coords for the given touch identifier.
  // Handles latch-toggle (if the coord is already sustained, toggle it off
  // instead of playing a new note). Otherwise plays and stores in activeTouch.
  _touchStartOnCoords(id, coords) {
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
        return; // latch toggle — no new note
      }
    }
    const newHex = this.hexOn(coords);
    this.state.activeTouch.set(id, newHex);
  }

  // Handle touchcancel — when the browser cancels a touch (e.g. gesture, notification).
  // This prevents notes from getting stuck on mobile.
  handleTouchCancel = (_e) => {
    this.state.isTouchDown = false;

    // Release all active touch notes. Snapshot the entries first so we can
    // clear the Map before calling hexOff (keeps _isCoordActive honest).
    const entries = [...this.state.activeTouch.entries()];
    this.state.activeTouch.clear();
    for (const [, hex] of entries) {
      const coords = hex.coords;
      this.noteOff(hex, 0);
      this._settleModulationAfterActiveRelease();
      if (!this.state.sustain) this.hexOff(coords);
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
  // Delegating shims — logic lives in MidiCoordResolver (midi-coord-resolver.js).
  // Kept here so existing call sites inside Keys (midinoteOn/Off, allnotesOff)
  // continue to work without change.
  channelToStepsOffset(channel) {
    return this.coordResolver.channelToStepsOffset(channel);
  }
  buildStepsTable() {
    this.coordResolver.buildStepsTable();
  }
  stepsToVisibleCoords(steps) {
    return this.coordResolver.stepsToVisibleCoords(steps);
  }

  // ── CC and channel-pressure passthrough ──────────────────────────────────
  //
  // Send a CC or channel-pressure message to all currently active MIDI outputs:
  //   - MTS output: send on configured midi_channel
  //   - MPE output: send on the manager channel (zone-wide per MPE spec)
  // These helpers are called from the universal controlchange / channelaftertouch
  // listeners before any internal consumption logic.

  _passthroughCC(cc, value) {
    if (
      this.midiout_data &&
      this.settings.midi_device !== "OFF" &&
      this.settings.midi_channel >= 0
    ) {
      this.midiout_data.sendControlChange(cc, value, { channels: this.settings.midi_channel + 1 });
    }
    if (this.settings.output_mpe && this.settings.mpe_device !== "OFF") {
      const mpeOutput = WebMidi.getOutputById(this.settings.mpe_device);
      if (mpeOutput) {
        const managerCh = parseInt(this.settings.mpe_manager_ch) || 1;
        mpeOutput.sendControlChange(cc, value, { channels: managerCh });
      }
    }
  }

  _passthroughChannelPressure(value) {
    if (
      this.midiout_data &&
      this.settings.midi_device !== "OFF" &&
      this.settings.midi_channel >= 0
    ) {
      this.midiout_data.sendChannelAftertouch(value, {
        channels: this.settings.midi_channel + 1,
        rawValue: true,
      });
    }
    if (this.settings.output_mpe && this.settings.mpe_device !== "OFF") {
      const mpeOutput = WebMidi.getOutputById(this.settings.mpe_device);
      if (mpeOutput) {
        const managerCh = parseInt(this.settings.mpe_manager_ch) || 1;
        mpeOutput.sendChannelAftertouch(value, { channels: managerCh, rawValue: true });
      }
    }
  }

  // Send a pitch-bend message to all active outputs.
  // val14: 0–16383 (centre 8192).  Converted to WebMidi's −1…+1 float.
  // For MPE output we send on the manager channel (zone-wide per MPE spec).
  // Individual MPE voice-channel bends are handled by the hex's retune() call —
  // we do not also send on the manager channel when in MPE input mode, since
  // that would double-apply the bend.
  _passthroughPitchBend(val14) {
    const normalized = val14 / 8192.0 - 1.0; // 0→−1, 8192→0, 16383→≈+1
    if (
      this.midiout_data &&
      this.settings.midi_device !== "OFF" &&
      this.settings.midi_channel >= 0
    ) {
      this.midiout_data.sendPitchBend(normalized, { channels: this.settings.midi_channel + 1 });
    }
    // MPE: only send zone-wide PB on manager channel when NOT in MPE input mode.
    // In MPE input mode each voice channel carries its own per-note bend via retune().
    if (
      !this.inputRuntime.mpeInput &&
      this.settings.output_mpe &&
      this.settings.mpe_device !== "OFF"
    ) {
      const mpeOutput = WebMidi.getOutputById(this.settings.mpe_device);
      if (mpeOutput) {
        const managerCh = parseInt(this.settings.mpe_manager_ch) || 1;
        mpeOutput.sendPitchBend(normalized, { channels: managerCh });
      }
    }
  }

  _getControllerState() {
    return {
      ccValues: Object.fromEntries(this._controllerCCValues),
      channelPressure: this._channelPressureValue,
      pitchBend14: this._wheelValue14,
    };
  }

  _pushControllerStateToSynth() {
    if (this.synth?.rememberControllerState) {
      this.synth.rememberControllerState(this._getControllerState());
    }
    if (this.synth?.applyControllerState) {
      this.synth.applyControllerState(this._getControllerState());
    }
  }

  _rememberControllerStateInSynth() {
    if (this.synth?.rememberControllerState) {
      this.synth.rememberControllerState(this._getControllerState());
    }
  }

  // ── Wheel bend (pitch bend routing) ──────────────────────────────────────
  //
  // _handleWheelBend is the universal entry point: call it with any 14-bit
  // value (0–16383, centre 8192) from any controller — wheel, expression pedal,
  // OSC, or the future mod-matrix.
  //
  // Two top-level modes:
  //
  //   Standard mode (!wheelToRecent):
  //     Raw pitch bend passthrough to all MIDI outputs (caller's responsibility,
  //     see pitchbend listener above).  For sample synth, retune all active hexes
  //     directly using the semitone range (inputRuntime.wheelSemitones).
  //     No recency-stack logic — all voices move together.
  //
  //   Recency/all mode (wheelToRecent = true):
  //     Two sub-modes (inputRuntime.pitchBendMode):
  //
  //     'recency' (default): target the front of the recency stack.
  //       _updateWheelTarget keeps the target in sync as notes change.
  //       Scale-aware asymmetric bend is available in this mode only.
  //
  //     'all': apply the same bend offset to every currently sounding hex.
  //       Each hex is shifted by the same number of cents from its own base pitch.
  //       For MPE output the host receives a manager-channel PB (zone-wide, one
  //       message) via _passthroughPitchBend — individual voice channels are not
  //       also retuned to avoid doubling the bend.
  //
  // _wheelBend stores the current offset in cents (0 at rest).  It is used by
  // _updateWheelTarget to apply an in-flight bend when the recency front changes.
  //
  // Snapshot integration (future): capture `_wheelBaseCents + _wheelBend` as
  // the committed pitch for _wheelTarget, then reset _wheelBend to 0.

  _handleWheelBend(val14) {
    this._wheelValue14 = val14;
    if (!this.inputRuntime.wheelToRecent) {
      // Standard mode: bend the internal sample engine only. External MIDI/MTS/MPE
      // outputs receive raw pitch-bend passthrough in the listener above.
      // Uses hex._baseCents (frozen at note-on) to avoid accumulation drift.
      const norm = (val14 - 8192) / 8192; // −1 … +1
      const rangeCents = (this.inputRuntime.wheelSemitones ?? 2) * 100;
      const offsetCents = norm * rangeCents;
      this._wheelBend = offsetCents;
      for (const hex of this._allActiveHexes()) {
        if (hex.standardWheelRetune) {
          hex.standardWheelRetune((hex._baseCents ?? hex.cents) + offsetCents);
        }
      }
      this._syncTransferredWheelBends();
      return;
    }

    const norm = (val14 - 8192) / 8192; // −1 … +1

    if (this.inputRuntime.pitchBendMode === "all") {
      // All-notes mode: apply a uniform cent offset to every active hex.
      // We use the symmetric fixed-range calculation only (scale-aware
      // asymmetric bend is inherently single-target).
      // Uses hex._baseCents (frozen at note-on) to avoid accumulation drift.
      const rangeCents = scalaToCents(this.inputRuntime.wheelRange ?? "64/63");
      const offsetCents = norm * rangeCents;
      this._wheelBend = offsetCents;
      for (const hex of this._allActiveHexes()) {
        hex.retune((hex._baseCents ?? hex.cents) + offsetCents, true);
      }
      this._syncTransferredWheelBends();
      return;
    }

    // 'recency' mode (default): target the front of the recency stack.
    const target = this.recencyStack.front;
    if (!target) return;

    if (this._wheelTarget !== target) {
      this._wheelTarget = target;
    }
    const { baseCents, bentCents } = this._resolveRecencyWheelTarget(target, val14);
    this._wheelBaseCents = baseCents;
    this._wheelBend = bentCents - baseCents;
    target.retune(bentCents, true);
    this._syncTransferredWheelBend(target);
  }

  _handleIncomingWheelBend(val14) {
    this._wheelInputValue14 = val14;
    // Apply controller pitch bend synchronously. The old rAF slew path can
    // stall when the browser window is not focused, which drops live bend
    // expression while notes/CC still pass through.
    this._stopWheelSlew(false);
    this._wheelSlew.current = val14;
    this._wheelSlew.target = val14;
    this._handleWheelBend(val14);
  }

  _setWheelSlewTarget(val14) {
    this._wheelSlew.target = val14;
    if (this._wheelSlew.raf == null) {
      this._wheelSlew.current = this._wheelValue14;
      this._wheelSlew.lastTime = 0;
      this._wheelSlew.raf = requestAnimationFrame(this._tickWheelSlew);
    }
  }

  _tickWheelSlew = (timestamp) => {
    this._wheelSlew.raf = null;
    const state = this._wheelSlew;
    const dt = state.lastTime ? Math.min(Math.max(timestamp - state.lastTime, 1), 50) : 16;
    state.lastTime = timestamp;
    const factor = 1 - Math.exp(-dt / WHEEL_SLEW_TAU_MS);
    const next = state.current + (state.target - state.current) * factor;
    state.current = Math.abs(state.target - next) <= WHEEL_SLEW_SNAP_14 ? state.target : next;
    this._handleWheelBend(state.current);
    if (state.current !== state.target) {
      state.raf = requestAnimationFrame(this._tickWheelSlew);
    } else {
      state.lastTime = 0;
    }
  };

  _stopWheelSlew(resetToCurrent = false) {
    if (this._wheelSlew.raf != null) cancelAnimationFrame(this._wheelSlew.raf);
    this._wheelSlew.raf = null;
    this._wheelSlew.lastTime = 0;
    if (resetToCurrent) {
      this._wheelSlew.current = this._wheelValue14;
      this._wheelSlew.target = this._wheelValue14;
    }
  }

  _resolveRecencyWheelTarget(target, val14 = this._wheelValue14) {
    const baseCents = target?._baseCents ?? target?.cents ?? 0;
    const norm = (val14 - 8192) / 8192; // −1 … +1

    let bentCents;
    if (
      this.inputRuntime.wheelScaleAware &&
      target?.cents_prev != null &&
      target?.cents_next != null
    ) {
      if (norm < 0) {
        bentCents = baseCents + norm * (baseCents - target.cents_prev);
      } else {
        bentCents = baseCents + norm * (target.cents_next - baseCents);
      }
    } else {
      const rangeCents = scalaToCents(this.inputRuntime.wheelRange ?? "64/63");
      bentCents = baseCents + norm * rangeCents;
    }

    return { baseCents, bentCents };
  }

  _applyCurrentWheelToHex(hex) {
    if (!hex || this._wheelValue14 === 8192) return;
    if (this.inputRuntime.wheelToRecent && this.inputRuntime.pitchBendMode === "recency") {
      return;
    }
    const baseCents = hex._baseCents ?? hex.cents;
    if (!this.inputRuntime.wheelToRecent) {
      hex.retune(baseCents + this._wheelBend, true);
      return;
    }
    if (this.inputRuntime.pitchBendMode === "all") {
      hex.retune(baseCents + this._wheelBend, true);
    }
  }

  _reapplyCurrentWheelBend() {
    if (this.inputRuntime.mpeInput) return;
    if (this._wheelValue14 === 8192) return;
    if (this.inputRuntime.wheelToRecent && this.inputRuntime.pitchBendMode === "recency") {
      this._wheelTarget = null;
      this._wheelBaseCents = null;
    }
    this._handleWheelBend(this._wheelValue14);
  }

  _retuneHexFromBase(hex, baseCents, bendOnly = false) {
    if (!hex?.retune || hex.release) return;
    hex._baseCents = baseCents;
    if (this.inputRuntime.mpeInput && hex._inputChannel != null) {
      const channel = hex._inputChannel;
      const entry = this.state.activeMidiByChannel.get(channel) ?? { hex, baseCents };
      entry.baseCents = baseCents;
      this._applyMpePitchBend(entry, channel, this._mpeInputBendByChannel.get(channel) ?? 8192);
      return;
    }
    hex.retune(baseCents, bendOnly);
  }

  _queueRetuneGlide(hex, targetBase, bendOnly = false) {
    if (!hex?.retune || hex.release) return;
    const currentBase = this._retuneGlides.get(hex)?.currentBase ?? hex._baseCents ?? hex.cents;
    this._retuneGlides.set(hex, { currentBase, targetBase, bendOnly });
  }

  _kickRetuneGlides() {
    if (this._retuneGlides.size === 0) return;
    if (this._retuneGlideTimer == null) {
      this._retuneGlideLastTime = performance.now() - RETUNE_GLIDE_TICK_MS;
      this._retuneGlideTimer = setTimeout(this._tickRetuneGlides, 0);
    }
  }

  _tickRetuneGlides = () => {
    this._retuneGlideTimer = null;
    if (this._retuneGlides.size === 0) {
      this._retuneGlideLastTime = 0;
      return;
    }

    const now = performance.now();
    const dt = this._retuneGlideLastTime
      ? Math.min(Math.max(now - this._retuneGlideLastTime, 1), 50)
      : RETUNE_GLIDE_TICK_MS;
    this._retuneGlideLastTime = now;

    let hasPending = false;
    for (const [hex, glide] of this._retuneGlides) {
      if (!hex?.retune || hex.release) {
        this._retuneGlides.delete(hex);
        continue;
      }
      const factor = 1 - Math.exp(-dt / RETUNE_GLIDE_TAU_MS);
      const desiredStep = (glide.targetBase - glide.currentBase) * factor;
      const maxStep = (RETUNE_GLIDE_MAX_CENTS_PER_SEC * dt) / 1000;
      const step = Math.sign(desiredStep) * Math.min(Math.abs(desiredStep), maxStep);
      let nextBase = glide.currentBase + step;
      if (Math.abs(glide.targetBase - nextBase) < RETUNE_GLIDE_SNAP_CENTS) {
        nextBase = glide.targetBase;
      } else {
        hasPending = true;
      }
      glide.currentBase = nextBase;
      this._retuneHexFromBase(hex, nextBase, glide.bendOnly);
      if (nextBase === glide.targetBase) this._retuneGlides.delete(hex);
    }

    this._refreshSoundingHexNeighbors();
    if (!this.inputRuntime.mpeInput && this._wheelValue14 !== 8192) {
      this._reapplyCurrentWheelBend();
    }

    if (hasPending || this._retuneGlides.size > 0) {
      this._retuneGlideTimer = setTimeout(this._tickRetuneGlides, RETUNE_GLIDE_TICK_MS);
    } else {
      this._retuneGlideLastTime = 0;
    }
  };

  _reapplyCurrentInputBends() {
    if (this.inputRuntime.mpeInput) {
      for (const [channel, entry] of this.state.activeMidiByChannel) {
        if (!entry || entry.hex.release) continue;
        this._applyMpePitchBend(entry, channel, this._mpeInputBendByChannel.get(channel) ?? 8192);
      }
      return;
    }
    this._reapplyCurrentWheelBend();
  }

  _refreshSoundingHexNeighbors() {
    const refresh = (hex) => {
      const [, , , , , cents_prev, cents_next] = this.hexCoordsToCents(hex.coords);
      hex.cents_prev = cents_prev;
      hex.cents_next = cents_next;
    };
    for (const hex of this._allActiveHexes()) refresh(hex);
    for (const [hex] of this.state.sustainedNotes) refresh(hex);
  }

  // Called whenever the recency stack changes.  If the front note has changed,
  // redirects bend to the new front while leaving the old target frozen at its
  // last sounded pitch.
  _updateWheelTarget(smoothReturn = false) {
    const newFront = this.recencyStack.front;
    if (newFront === this._wheelTarget) return; // no change

    this._wheelTarget = newFront;

    if (newFront) {
      this._wheelBaseCents = newFront._baseCents ?? newFront.cents;
      if (this.inputRuntime.wheelToRecent && this.inputRuntime.pitchBendMode === "recency") {
        const { baseCents, bentCents } = this._resolveRecencyWheelTarget(newFront, this._wheelValue14);
        this._wheelBaseCents = baseCents;
        this._wheelBend = bentCents - baseCents;
        if (smoothReturn && this._wheelValue14 !== 8192 && newFront?.retune) {
          this._queueRetuneGlide(newFront, baseCents, true);
          this._kickRetuneGlides();
        } else {
          newFront.retune(bentCents, true);
        }
      } else if (this._wheelBend !== 0) {
        newFront.retune(this._wheelBaseCents + this._wheelBend);
      }
    } else {
      this._wheelBaseCents = null;
    }
  }

  // Desaturate a CSS hex colour toward grey by the given amount (0=none, 1=full grey).
  _desaturateColor(hex, amount) {
    if (!hex || hex.length < 6) return hex;
    const h = hex.replace("#", "");
    if (h.length < 6) return hex;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const grey = 0.299 * r + 0.587 * g + 0.114 * b;
    const nr = Math.round(r + (grey - r) * amount);
    const ng = Math.round(g + (grey - g) * amount);
    const nb = Math.round(b + (grey - b) * amount);
    return "#" + [nr, ng, nb].map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  bestVisibleCoord(steps) {
    return this.coordResolver.bestVisibleCoord(steps);
  }

  hexCoordsToScreen(hex) {
    /* Point */
    const ox = this.settings.centerHexOffset.x;
    const oy = this.settings.centerHexOffset.y;
    let screenX =
      this.state.centerpoint.x +
      (hex.x - ox) * this.settings.hexWidth +
      ((hex.y - oy) * this.settings.hexWidth) / 2;
    let screenY = this.state.centerpoint.y + (hex.y - oy) * this.settings.hexVert;
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
      x2[i] = hexCenter.x + (parseFloat(this.settings.hexSize) + 3) * Math.cos(angle);
      y2[i] = hexCenter.y + (parseFloat(this.settings.hexSize) + 3) * Math.sin(angle);
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
    let equivSteps = this.tuning.scale.length;
    let equivMultiple = Math.floor(note / equivSteps);
    let reducedNote = note % equivSteps;
    if (reducedNote < 0) {
      reducedNote = equivSteps + reducedNote;
    }
    const liveReducedNote = this._labelDegreeFromFrame(reducedNote);

    if (!this.settings.no_labels || this.settings.equaves) {
      let name;
      if (!this.settings.no_labels && this.settings.degree) {
        name = "" + liveReducedNote;
      } else if (!this.settings.no_labels && this.settings.note) {
        // Safe access: if note_names is undefined or index out of bounds, show nothing
        name = this.settings.note_names?.[liveReducedNote] ?? "";
      } else if (!this.settings.no_labels && this.settings.heji) {
        // Auto-generated HEJI names from reference frame + committed ratios.
        name = this.settings.heji_names?.[liveReducedNote] ?? "";
      } else if (!this.settings.no_labels && this.settings.scala) {
        // Safe access: scala_names should always exist if scale exists, but be defensive
        name = this.settings.scala_names?.[liveReducedNote] ?? "";
      } else if (!this.settings.no_labels && this.settings.cents) {
        name = this._scaleCentsLabelForDegree(reducedNote);
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
      if (this.settings.equaves) {
        context.translate(12, -30);
        context.fillStyle = getContrastYIQ_2(current_text_color);
        context.font = "14pt Plainsound Sans";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(equivMultiple, 0, 0);
      }
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

      let _oldColor = returnColor;

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
    let distance = coords.x * this.settings.rSteps + coords.y * this.settings.drSteps;
    let octs = this.roundTowardZero(distance / this.tuning.scale.length);
    let octs_prev = this.roundTowardZero((distance - 1) / this.tuning.scale.length);
    let octs_next = this.roundTowardZero((distance + 1) / this.tuning.scale.length);
    let reducedSteps = distance % this.tuning.scale.length;
    let reducedSteps_prev = (distance - 1) % this.tuning.scale.length;
    let reducedSteps_next = (distance + 1) % this.tuning.scale.length;
    let equivSteps = this.tuning.equivSteps;
    if (reducedSteps < 0) {
      reducedSteps += this.tuning.scale.length;
      octs -= 1;
    }
    if (reducedSteps_prev < 0) {
      reducedSteps_prev += this.tuning.scale.length;
      octs_prev -= 1;
    }
    if (reducedSteps_next < 0) {
      reducedSteps_next += this.tuning.scale.length;
      octs_next -= 1;
    }
    // octave_offset shifts all pitches by N equaves without rebuilding
    const octOff = this.settings.octave_offset || 0;
    const liveFrame = this._activeFrame();
    const transpositionCents = liveFrame?.transpositionCents ?? 0;
    const geometryMode =
      this._modulationState?.geometryMode ??
      (liveFrame?.strategy === "reinterpret_surface_from_target" ? "stable_surface" : "moveable_surface");
    const centsIndex = geometryMode === "moveable_surface"
      ? reducedSteps
      : this._labelDegreeFromFrame(reducedSteps, liveFrame);
    const centsIndexPrev = geometryMode === "moveable_surface"
      ? reducedSteps_prev
      : this._labelDegreeFromFrame(reducedSteps_prev, liveFrame);
    const centsIndexNext = geometryMode === "moveable_surface"
      ? reducedSteps_next
      : this._labelDegreeFromFrame(reducedSteps_next, liveFrame);
    const liveReducedSteps = this._labelDegreeFromFrame(reducedSteps, liveFrame);
    let cents =
      (octs + octOff) * this.tuning.equivInterval + this.tuning.scale[centsIndex] + transpositionCents;
    let cents_prev =
      (octs_prev + octOff) * this.tuning.equivInterval +
      this.tuning.scale[centsIndexPrev] +
      transpositionCents;
    let cents_next =
      (octs_next + octOff) * this.tuning.equivInterval +
      this.tuning.scale[centsIndexNext] +
      transpositionCents;
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
    return [cents, liveReducedSteps, distance, octs, equivSteps, cents_prev, cents_next];
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

    let _guess = this.hexCoordsToScreen(new Point(q, r));

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
