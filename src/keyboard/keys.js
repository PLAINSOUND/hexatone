// Keys is the long-lived keyboard runtime coordinator.
// It owns persistent live state, wires together the smaller keyboard runtimes,
// and bridges between tuning, rendering, input, synth note lifecycle, and
// modulation state. It does not try to keep every algorithm inline: geometry,
// controller remapping, labels, rendering, note transfer, and modulation
// bookkeeping are delegated to dedicated modules and called from here.

import { calculateRotationMatrix } from "./matrix";
import Point from "./point";
import Euclid from "./euclidean";
import { WebMidi } from "webmidi";
import { RecencyStack } from "../recency_stack.js";
import { MidiCoordResolver } from "./midi-coord-resolver.js";
import {
  degree0ToRef,
  computeNaturalAnchor,
} from "../tuning/center-anchor.js";
import { mtsTuningMap } from "../tuning/tuning-map.js";
import { resolveBulkDumpName } from "../tuning/mts-format.js";
import {
  createSoundingNoteState,
  hasSoundingNotes,
  isCoordActive,
  iterActiveHexes,
} from "./sounding-note-runtime.js";
import {
  modulatedControllerCoords,
  refreshRuntimeDisplayOffset,
  syncControllerColorsForModulation,
} from "./modulation-controller-runtime.js";
import { coordsForLiveInputAddress } from "./input-address-runtime.js";
import {
  derivePendingModulationCommit,
  setAwaitingModulationSource as deriveSetAwaitingModulationSource,
  syncAwaitingModulationSource as deriveSyncAwaitingModulationSource,
} from "./modulation-gesture-runtime.js";
import {
  beginModulation,
  cancelModulation,
  clearModulationHistory,
  clearModulationRoute,
  commitModulationTarget,
  createModulationState,
  frameForNewNotes,
  normalizeModulationHistory,
  resetModulationRouteCounts,
  setModulationRouteCount,
  setModulationHistoryIndex,
  settleModulationIfPossible,
} from "../tuning/modulation-runtime.js";
import {
  createKeysFrame,
  deriveFrameForHistory,
  deriveFrameForHistoryIndex,
} from "./keys-frame-runtime.js";
import * as KeysLabels from "./keys-labels.js";
import * as KeysRenderer from "./keys-renderer.js";
import * as KeysBrowserInput from "./keys-browser-input.js";
import * as KeysControllerLeds from "./keys-controller-leds.js";
import * as KeysMidiInput from "./keys-midi-input.js";
import * as LiveHexRuntime from "./live-hex-runtime.js";
import * as PanicRuntime from "./panic-runtime.js";
import * as InputMidiListeners from "../input/keys-midi-listeners.js";
import * as InputExpressionRuntime from "../input/keys-expression-runtime.js";
import * as SequencerSnapshots from "../sequencer/snapshots.js";
import * as MtsOutputRuntime from "../midi_synth/mts-output-runtime.js";
import { deriveLiveHexPitch } from "./keys-geometry-runtime.js";
import {
  clearFundamentalPreview,
  createTuningPreviewState,
  getEffectiveScaleRuntime,
  getFundamentalPreviewDeltaCents,
  setDegreePreview,
  clearDegreePreview,
  setFundamentalPreview,
} from "../tuning/tuning-preview-runtime.js";
import {
  classifyReleaseForSettlement,
  evaluateSettlement,
  hasLegacyFrameNotes,
  normalizeSettlementNotes,
} from "./note-context-runtime.js";
import {
  deriveModulationIdentityForHistory,
  modulationHistoryKey,
} from "../tuning/modulation-frame-runtime.js";

function ratioTextForModulationDelta(tuning, sourceDegree, targetDegree, transpositionDeltaCents) {
  const sourceRatio = tuning?.degreeIntervals?.[sourceDegree]?.ratio ?? null;
  const targetRatio = tuning?.degreeIntervals?.[targetDegree]?.ratio ?? null;
  const equaveRatio = tuning?.equaveInterval?.ratio ?? null;
  const equaveCents = tuning?.equivInterval ?? tuning?.equaveCents ?? 1200;
  if (!sourceRatio || !targetRatio || !equaveRatio || !Number.isFinite(transpositionDeltaCents)) {
    return null;
  }

  const reducedDelta = (tuning?.scale?.[sourceDegree] ?? 0) - (tuning?.scale?.[targetDegree] ?? 0);
  const equavePower = Number.isFinite(equaveCents) && Math.abs(equaveCents) > 0
    ? Math.round((transpositionDeltaCents - reducedDelta) / equaveCents)
    : 0;
  const ratio = sourceRatio.div(targetRatio);
  const displacedRatio = equavePower >= 0
    ? ratio.mul(equaveRatio.pow(equavePower))
    : ratio.div(equaveRatio.pow(Math.abs(equavePower)));
  return displacedRatio?.toFraction ? displacedRatio.toFraction() : null;
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
      runtime_display_offset_x: 0,
      runtime_display_offset_y: 0,
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
      layoutMode:
        settings.midiin_controller_override === "hakenaudio"
          ? "controller_geometry"
          : (settings.midi_passthrough ? "sequential" : "controller_geometry"),
      mpeInput: false,
      seqAnchorNote: settings.midiin_anchor_note ?? settings.midiin_central_degree ?? 60,
      seqAnchorChannel: settings.midiin_anchor_channel ?? 1,
      stepsPerChannel: settings.midiin_steps_per_channel,
      stepsPerChannelDefault: settings.equivSteps,
      channelGroupSize: settings.midiin_channel_group_size ?? 1,
      legacyChannelMode: settings.midiin_channel_legacy,
      scaleTolerance: 50,
      scaleBendRange: settings.midiin_scale_bend_range ?? 48,
      hakenXGlideShaping: settings.hakenaudio_x_glide_shaping ?? 100,
      hakenXGlideMode: settings.hakenaudio_x_glide_mode ?? "pitch_bending",
      hakenPressureVelocity: settings.hakenaudio_pressure_velocity ?? 64,
      hakenNoteOffDelay: settings.hakenaudio_note_off_delay ?? 20,
      hakenXLpf: settings.hakenaudio_x_lpf ?? 60,
      hakenYLpf: settings.hakenaudio_y_lpf ?? 30,
      hakenZLpf: settings.hakenaudio_z_lpf ?? 125,
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
    this._scaleModePreBend21 = new Map();
    this._mpeInputBendByChannel = new Map();
    this._mpeInputAftertouchByChannel = new Map();
    this._mpeInputCC74ByChannel = new Map();
    this._hakenMpeBend21ByChannel = new Map();
    this._hakenMpePlusLsbByChannel = new Map();
    this._retuneGlides = new Map();
    this._retuneGlideTimer = null;
    this._retuneGlideLastTime = 0;
    this._gridRedrawRaf = null;
    this._gridRedrawTimer = null;
    this._lastSoundActivityTime = 0;
    this._lastResizeSignature = null;
    this._visibleGridCoords = [];
    this._hexGeometryCache = new Map();
    this._staticGridCanvas = null;
    this._staticGridContext = null;
    this._staticGridUsable = false;
    this._staticGridValid = false;
    this._canvasTransform = null;
    this._deferredBulkMapRefresh = false;
    this._deferredBulkMapTimer = null;
    this._staticDeferredBulkActive = false;
    this._recentlyReleasedHexes = new Map();
    // Wheel bend state — controller-agnostic.
    // _wheelValue14:   most recent non-MPE pitch-bend value (0–16383).
    // _wheelInputValue14: latest raw controller wheel sample.
    // _wheelBend:      current offset in cents applied by the active wheel mode.
    // _wheelTarget:    the hex currently being bent.
    // _wheelBaseCents: that hex's pitch before any bend was applied.
    //                  Snapshot feature will read this + _wheelBend.
    this._wheelValue14 = 8192;
    this._wheelInputValue14 = 8192;
    this._wheelBend = 0;
    this._wheelTarget = null;
    this._wheelBaseCents = null;
    this._wheelInputState = {
      current: 8192,
      target: 8192,
    };
    this._controllerCCValues = new Map();
    this._lastHexOnSuppressed = false;
    this._suppressedMidiNotes = new Set();
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
    this._liveScaleTableVersion = 0;
    this._liveScaleTableListeners = new Set();
    this._effectiveScaleRuntimeCache = new Map();
    this._modulationIdentityKey = "";
    this._modulationIdentity = {
      cents: 0,
      ratioText: null,
      monzo: null,
    };
    this._lastPlayedDegree = this.settings.reference_degree ?? 0;
    const homeFrame = this._makeFrameForDegree(this.settings.reference_degree ?? 0);
    this._harmonicFrame = homeFrame;
    const initialModulationHistory = normalizeModulationHistory(initialModulationLibrary);
    this._modulationState = createModulationState({
      homeFrame,
      currentFrame: homeFrame,
      history: initialModulationHistory,
      strategy: this._selectedModulationStrategy(),
    });
    this._modulationHomeAnchor = this._extractCurrentAnchorSettings();
    if (initialModulationHistory.length > 0) {
      const currentFrame = this._frameForHistory(initialModulationHistory);
      this._harmonicFrame = currentFrame;
      this._modulationState.currentFrame = currentFrame;
      this._modulationState.historyIndex = this._modulationState.currentRoute?.count ?? 0;
      Object.assign(this.settings, this._anchorSettingsFromHistory(initialModulationHistory));
    }
    this._refreshCachedModulationIdentity();
    if (this.settings.modulation_style === "fixed_do") {
      this.settings.runtime_display_offset_x = this._modulationState.currentFrame?.geometryShiftRSteps ?? 0;
      this.settings.runtime_display_offset_y = this._modulationState.currentFrame?.geometryShiftDrSteps ?? 0;
    }

    // The tuning map anchor is always derived from the musical content (fundamental,
    // scale, center_degree) — independent of midiin_anchor_note, which is a
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

    InputMidiListeners.setupMidiInput.call(this);

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
      return;
    }

    if (degree >= this.tuning.scale.length) return;
    const committedCents = this.tuning.scale[degree];
    const bendOnly = !!this.inputRuntime.mpeInput;
    this._tuningPreviewState =
      Math.abs(newCents - committedCents) > 0.000001
        ? setDegreePreview(this._tuningPreviewState, degree, newCents)
        : clearDegreePreview(this._tuningPreviewState, degree);
    for (const hex of this._allActiveHexes()) {
      const [, reducedSteps] = this.hexCoordsToCents(hex.coords);
      if (reducedSteps === degree && hex.retune) {
        const [baseCents] = this._liveCentsForHex(hex);
        this._queueRetuneGlide(hex, baseCents, bendOnly);
      }
    }
    for (const [hex] of this.state.sustainedNotes) {
      const [, reducedSteps] = this.hexCoordsToCents(hex.coords);
      if (reducedSteps === degree && hex.retune) {
        const [baseCents] = this._liveCentsForHex(hex);
        this._queueRetuneGlide(hex, baseCents, bendOnly);
      }
    }
    if (this._hasSoundingNotes()) this._bumpLiveScaleTableVersion();
    this._refreshSoundingHexNeighbors();
    this._kickRetuneGlides();
    this.scheduleGridRedraw();
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
    return deriveFrameForHistory({
      history,
      scale: this.tuning.scale,
      referenceDegree: this.settings.reference_degree ?? 0,
      fundamental: this.settings.fundamental,
      strategy: this._modulationState.strategy,
      fixedDoEnabled: this.settings.modulation_style === "fixed_do",
      makeFrame: (degree, extra = {}) => this._makeFrameForDegree(degree, extra),
    });
  }

  _frameForHistoryIndex(historyIndex) {
    return deriveFrameForHistoryIndex({
      history: this._modulationState.history,
      historyIndex,
      scale: this.tuning.scale,
      referenceDegree: this.settings.reference_degree ?? 0,
      fundamental: this.settings.fundamental,
      strategy: this._modulationState.strategy,
      fixedDoEnabled: this.settings.modulation_style === "fixed_do",
      makeFrame: (degree, extra = {}) => this._makeFrameForDegree(degree, extra),
    });
  }

  _applyModulationStateTransition(nextState, options = {}) {
    this._modulationState = nextState;
    this._refreshCachedModulationIdentity();
    if (options.updateFrame !== false) {
      this._harmonicFrame = this._modulationState.currentFrame ?? this._harmonicFrame;
    }
    if (options.refreshRuntimeDisplayOffset) {
      this._refreshRuntimeDisplayOffset();
    }
    if (options.redraw === "immediate") {
      this.scheduleImmediateGridRedraw();
    } else if (options.redraw !== false) {
      this.scheduleGridRedraw();
    }
    if (options.syncControllerColors) {
      this._syncControllerColorsForModulation();
    }
    if (options.emit !== false) {
      this._emitModulationState();
    }
  }

  setModulationHistoryIndex = (historyIndex) => {
    if (this._modulationState.mode !== "idle") return false;
    const nextFrame = this._frameForHistoryIndex(historyIndex);
    this._applyModulationStateTransition(
      setModulationHistoryIndex(this._modulationState, historyIndex, nextFrame),
      {
        refreshRuntimeDisplayOffset: true,
        redraw: "immediate",
        syncControllerColors: true,
      },
    );
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
    this._applyModulationStateTransition(
      setModulationRouteCount(this._modulationState, routeIndex, count, nextFrame),
      {
        refreshRuntimeDisplayOffset: true,
        redraw: "immediate",
        syncControllerColors: true,
      },
    );
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
    this._applyModulationStateTransition(
      clearModulationRoute(this._modulationState, routeIndex, nextFrame),
      {
        refreshRuntimeDisplayOffset: true,
        redraw: "immediate",
        syncControllerColors: true,
      },
    );
    return true;
  };

  clearModulationHistory = () => {
    if ((this._modulationState.historyIndex ?? 0) !== 0) return false;
    const homeFrame = this._modulationState.homeFrame ?? this._frameForHistoryIndex(0);
    this._applyModulationStateTransition(
      clearModulationHistory(this._modulationState, homeFrame),
      {
        refreshRuntimeDisplayOffset: true,
        redraw: "immediate",
        syncControllerColors: true,
      },
    );
    return true;
  };

  resetModulationRouteCounts = () => {
    if (this._modulationState.mode !== "idle") return false;
    const homeFrame = this._modulationState.homeFrame ?? this._frameForHistoryIndex(0);
    this._applyModulationStateTransition(
      resetModulationRouteCounts(this._modulationState, homeFrame),
      {
        refreshRuntimeDisplayOffset: true,
        redraw: "immediate",
        syncControllerColors: true,
      },
    );
    return true;
  };

  _selectedModulationStrategy() {
    return this.settings.modulation_style === "fixed_do"
      ? "retune_surface_in_place"
      : "retune_surface_to_source";
  }

  _isFixedDoStrategy(strategy = this._modulationState.strategy) {
    return strategy === "retune_surface_in_place";
  }

  _syncModulationStyleFromSettings(options = {}) {
    const strategy = this._selectedModulationStrategy();
    const nextState = {
      ...this._modulationState,
      strategy,
      geometryMode: "moveable_surface",
    };
    this._modulationState = nextState;
    if (this._modulationState.mode !== "idle") return;
    this._applyModulationStateTransition(
      {
        ...this._modulationState,
        currentFrame: this._frameForHistory(this._modulationState.history),
      },
      {
        refreshRuntimeDisplayOffset: true,
        redraw: options.redraw === false ? false : "immediate",
        syncControllerColors: true,
        emit: options.emit === true,
      },
    );
  }

  armModulation = (strategy = this._selectedModulationStrategy()) => {
    const sourceHex = this.recencyStack.front ?? null;
    const sourceDegree = sourceHex
      ? this._degreeForHex(sourceHex)
      : null;
    this._modulationState = beginModulation(this._modulationState, {
      currentFrame: this._harmonicFrame,
      sourceHex,
      sourceDegree,
      strategy,
    });
    this._emitModulationState();
    return this._modulationState.mode === "awaiting_target";
  };

  _syncControllerColorsForModulation() {
    syncControllerColorsForModulation(this);
  }

  _syncControllerAutoColors() {
    InputMidiListeners.syncControllerAutoColors.call(this);
  }

  _emitModulationState() {
    if (this.onModulationArmChange)
      this.onModulationArmChange(this._modulationState.mode === "awaiting_target");
    if (this.onModulationStateChange) this.onModulationStateChange(this._modulationState);
  }

  _setAwaitingModulationSource(sourceHex = null, sourceDegree = null, sourceCoords = null) {
    this._modulationState = deriveSetAwaitingModulationSource(
      this,
      sourceHex,
      sourceDegree,
      sourceCoords,
    );
    this._emitModulationState();
  }

  _syncAwaitingModulationSource() {
    this._modulationState = deriveSyncAwaitingModulationSource(this);
    this._emitModulationState();
  }

  _makeFrameForDegree(degree, extra = {}) {
    this._frameGeneration += 1;
    return createKeysFrame({
      id: `frame:${this._frameGeneration}:${degree}`,
      degree,
      referenceDegree: this.settings.reference_degree ?? 0,
      fundamental: this.settings.fundamental,
      strategy: extra.strategy ?? this._modulationState?.strategy ?? "retune_surface_to_source",
      sourceDegree: extra.sourceDegree ?? null,
      targetDegree: extra.targetDegree ?? null,
      transpositionSteps: extra.transpositionSteps ?? 0,
      transpositionCents: extra.transpositionCents ?? 0,
      geometryShiftRSteps: extra.geometryShiftRSteps ?? 0,
      geometryShiftDrSteps: extra.geometryShiftDrSteps ?? 0,
      effectiveFundamental:
        extra.effectiveFundamental ?? this.settings.fundamental,
    });
  }

  _rebaseFrameFundamental(frame, fundamental = this.settings.fundamental) {
    if (!frame) return frame;
    const effectiveFundamental =
      fundamental * Math.pow(2, (frame.transpositionCents ?? 0) / 1200);
    if (frame.effectiveFundamental === effectiveFundamental) return frame;
    return {
      ...frame,
      effectiveFundamental,
    };
  }

  _rebaseModulationFrameFundamentals() {
    this._harmonicFrame = this._rebaseFrameFundamental(this._harmonicFrame);
    this._modulationState = {
      ...this._modulationState,
      homeFrame: this._rebaseFrameFundamental(this._modulationState.homeFrame),
      currentFrame: this._rebaseFrameFundamental(this._modulationState.currentFrame),
      oldFrame: this._rebaseFrameFundamental(this._modulationState.oldFrame),
      pendingFrame: this._rebaseFrameFundamental(this._modulationState.pendingFrame),
    };
  }

  _activeFrame() {
    return frameForNewNotes(this._modulationState) ?? this._harmonicFrame;
  }

  _effectiveScaleRuntimeForFrame(frame = this._activeFrame()) {
    const frameId = frame?.id ?? "__default__";
    const effectiveFundamental = frame?.effectiveFundamental ?? this.settings.fundamental;
    const cached = this._effectiveScaleRuntimeCache.get(frameId);
    if (
      cached &&
      cached.previewState === this._tuningPreviewState &&
      cached.scale === this.tuning.scale &&
      cached.equivInterval === this.tuning.equivInterval &&
      cached.referenceDegree === (this.settings.reference_degree ?? 0) &&
      cached.effectiveFundamental === effectiveFundamental
    ) {
      return cached.runtime;
    }
    const runtime = getEffectiveScaleRuntime(this._previewSource(frame), this._tuningPreviewState);
    this._effectiveScaleRuntimeCache.set(frameId, {
      previewState: this._tuningPreviewState,
      scale: this.tuning.scale,
      equivInterval: this.tuning.equivInterval,
      referenceDegree: this.settings.reference_degree ?? 0,
      effectiveFundamental,
      runtime,
    });
    return runtime;
  }

  _refreshCachedModulationIdentity() {
    const history = this._modulationState?.history ?? [];
    const nextKey = modulationHistoryKey(history);
    if (nextKey === this._modulationIdentityKey) return;
    this._modulationIdentityKey = nextKey;
    this._modulationIdentity = deriveModulationIdentityForHistory(history);
  }

  _createNoteContext(frame = this._activeFrame(), geometryMode = this._modulationState?.geometryMode) {
    if (!frame) return null;
    this._refreshCachedModulationIdentity();
    const modulationIdentity = this._modulationIdentity;
    return {
      frameId: frame.id ?? null,
      frame,
      geometryMode: geometryMode ?? "moveable_surface",
      transpositionCents: frame.transpositionCents ?? 0,
      effectiveFundamental: frame.effectiveFundamental ?? this.settings.fundamental,
      ratioText: modulationIdentity.ratioText,
      monzo: Array.isArray(modulationIdentity.monzo) ? [...modulationIdentity.monzo] : null,
      displayLabel: null,
    };
  }

  _frameById(frameId) {
    if (!frameId) return null;
    const frames = [
      this._modulationState?.oldFrame,
      this._modulationState?.pendingFrame,
      this._modulationState?.currentFrame,
      this._modulationState?.homeFrame,
      this._harmonicFrame,
    ];
    for (const frame of frames) {
      if (frame?.id === frameId) return frame;
    }
    return null;
  }

  _frameForNoteContext(noteContext) {
    return noteContext?.frame ?? this._frameById(noteContext?.frameId) ?? null;
  }

  _frameForSoundingHex(hex) {
    return this._frameForNoteContext(hex?._noteContext) ??
      this._frameById(hex?._onsetFrameId) ??
      this._activeFrame();
  }

  _geometryModeForSoundingHex(hex) {
    return hex?._noteContext?.geometryMode ?? this._modulationState?.geometryMode;
  }

  _labelSettingsForNoteContext() {
    return this.settings;
  }

  _labelSettingsForSoundingHex(hex) {
    return this._labelSettingsForNoteContext(hex?._noteContext);
  }

  _bumpLiveScaleTableVersion() {
    if (this._liveScaleTableListeners.size === 0) return;
    this._liveScaleTableVersion += 1;
    const snapshot = this.getLiveScaleTableSnapshot();
    for (const listener of this._liveScaleTableListeners) {
      listener(snapshot);
    }
  }

  getLiveScaleTableVersion = () => this._liveScaleTableVersion;

  subscribeLiveScaleTable(listener) {
    if (typeof listener !== "function") return () => {};
    this._liveScaleTableListeners.add(listener);
    listener(this.getLiveScaleTableSnapshot());
    return () => {
      this._liveScaleTableListeners.delete(listener);
    };
  }

  _frequencyForHex(hex) {
    if (!hex) return null;
    const fundamental = hex.fundamental ?? hex._noteContext?.effectiveFundamental ?? this.settings.fundamental;
    const degree0ToReferenceCents = this.tuning.degree0toRef_asArray?.[0] ?? 0;
    if (!Number.isFinite(fundamental) || !Number.isFinite(hex.cents)) return null;
    return fundamental * Math.pow(2, (hex.cents - degree0ToReferenceCents) / 1200);
  }

  _liveScaleTableRowForHex(hex) {
    const degree = this._degreeForHex(hex);
    if (!Number.isFinite(degree)) return null;
    const displayLabel = this.getDisplayLabelAtCoords(hex.coords, {
      frame: this._frameForSoundingHex(hex),
      geometryMode: this._geometryModeForSoundingHex(hex),
      settings: this._labelSettingsForSoundingHex(hex),
    });
    return {
      degree,
      frequencyHz: this._frequencyForHex(hex),
      displayLabel: hex?._noteContext?.displayLabel ?? displayLabel,
      ratioText: hex?._noteContext?.ratioText ?? null,
      monzo: Array.isArray(hex?._noteContext?.monzo) ? [...hex._noteContext.monzo] : null,
    };
  }

  getLiveScaleTableSnapshot = () => {
    const seen = new Set();
    const rowsByDegree = {};
    const sameMonzo = (a, b) => {
      if (a === b) return true;
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      return a.every((value, index) => value === b[index]);
    };
    const pushHex = (hex) => {
      if (!hex?.coords || seen.has(hex)) return;
      seen.add(hex);
      const row = this._liveScaleTableRowForHex(hex);
      if (!row) return;
      const key = String(row.degree);
      const current = rowsByDegree[key];
      if (!current) {
        rowsByDegree[key] = {
          degree: row.degree,
          frequencyHz: row.frequencyHz,
          displayLabel: row.displayLabel,
          ratioText: row.ratioText,
          monzo: row.monzo,
          noteCount: 1,
          mixed: false,
        };
        return;
      }
      current.noteCount += 1;
      const sameLabel = current.displayLabel === row.displayLabel;
      const sameRatio = current.ratioText === row.ratioText;
      const sameFrequency =
        Number.isFinite(current.frequencyHz) &&
        Number.isFinite(row.frequencyHz) &&
        Math.abs(current.frequencyHz - row.frequencyHz) < 0.0005;
      if (!sameLabel || !sameRatio || !sameFrequency || !sameMonzo(current.monzo, row.monzo)) {
        current.mixed = true;
      }
    };
    for (const hex of this._allActiveHexes()) pushHex(hex);
    for (const [hex] of this.state.sustainedNotes) pushHex(hex);
    return {
      version: this._liveScaleTableVersion,
      rowsByDegree,
    };
  };

  getEffectiveFundamental = () => {
    return this._activeFrame()?.effectiveFundamental ?? this.settings.fundamental;
  };

  _labelDegreeFromFrame(reducedNote, frame = this._activeFrame()) {
    return KeysLabels.labelDegreeFromActiveFrame.call(this, reducedNote, frame);
  }

  _scaleCentsLabelForDegree(reducedNote) {
    return KeysLabels.scaleCentsLabelForActiveDegree.call(this, reducedNote);
  }

  getDisplayLabelAtCoords = (coords, options = {}) => {
    return KeysLabels.getDisplayLabelAtCoords.call(this, coords, options);
  };

  getLiveNoteDisplayState = () => {
    const seen = new Set();
    const notes = [];
    const pushSnapshot = (hex, source) => {
      if (!hex?.coords || seen.has(hex)) return;
      seen.add(hex);
      notes.push({
        source,
        coords: { x: hex.coords.x, y: hex.coords.y },
        degree: this._degreeForHex(hex),
        displayLabel: this.getDisplayLabelAtCoords(hex.coords, {
          frame: this._frameForSoundingHex(hex),
          geometryMode: this._geometryModeForSoundingHex(hex),
          settings: this._labelSettingsForSoundingHex(hex),
        }),
        noteContext: hex._noteContext
          ? {
            frameId: hex._noteContext.frameId ?? null,
            frame: hex._noteContext.frame ?? null,
            transpositionCents: hex._noteContext.transpositionCents ?? 0,
            effectiveFundamental: hex._noteContext.effectiveFundamental ?? this.settings.fundamental,
            ratioText: hex._noteContext.ratioText ?? null,
            monzo: Array.isArray(hex._noteContext.monzo) ? [...hex._noteContext.monzo] : null,
            geometryMode: hex._noteContext.geometryMode ?? null,
            displayLabel: hex._noteContext.displayLabel ?? null,
          }
          : null,
      });
    };
    for (const hex of this._allActiveHexes()) pushSnapshot(hex, "active");
    for (const [hex] of this.state.sustainedNotes) pushSnapshot(hex, "sustained");
    return notes;
  };

  _emitLiveNoteDisplayState() {
    this._bumpLiveScaleTableVersion();
    if (!this.onLiveNoteStateChange) return;
    this.onLiveNoteStateChange(this.getLiveNoteDisplayState());
  }

  _degreeForCoords(coords) {
    const [, pressed_interval] = this.hexCoordsToCents(coords);
    return pressed_interval ?? null;
  }

  _degreeForHex(hex) {
    if (!hex?.coords) return null;
    return this._degreeForCoords(hex.coords);
  }

  _coordsForLiveInputAddress(inputAddress) {
    return coordsForLiveInputAddress(this, inputAddress);
  }

  _modulatedControllerCoords(coords, frame = this._activeFrame()) {
    return modulatedControllerCoords(this, coords, frame);
  }

  _refreshRuntimeDisplayOffset() {
    refreshRuntimeDisplayOffset(this);
  }

  _currentControllerAnchorAddress() {
    if (!this.controller) return null;
    if (this.controller.multiChannel) {
      return {
        channel:
          this.settings.midiin_anchor_channel ??
          this.controller.anchorChannelDefault ??
          1,
        note:
          this.settings.midiin_anchor_note ??
          this.settings.midiin_central_degree ??
          this.controller.anchorDefault ??
          60,
      };
    }
    return {
      channel: 1,
      note: this.settings.midiin_anchor_note ?? this.settings.midiin_central_degree ?? this.controller.anchorDefault ?? 60,
    };
  }

  _extractCurrentAnchorSettings() {
    return {
      midiin_anchor_note: this.settings.midiin_anchor_note ?? this.settings.midiin_central_degree ?? 60,
      midiin_anchor_channel: this.settings.midiin_anchor_channel ?? 1,
      controller_virtual_anchor_x: Number.isFinite(this.settings.controller_virtual_anchor_x)
        ? this.settings.controller_virtual_anchor_x
        : null,
      controller_virtual_anchor_y: Number.isFinite(this.settings.controller_virtual_anchor_y)
        ? this.settings.controller_virtual_anchor_y
        : null,
    };
  }

  _captureModulationHomeAnchor() {
    this._modulationHomeAnchor = this._extractCurrentAnchorSettings();
  }

  _rawReducedStepsForCoords(coords) {
    const scaleLength = this.tuning.scale.length || 1;
    let distance = coords.x * this.settings.rSteps + coords.y * this.settings.drSteps;
    let reducedSteps = distance % scaleLength;
    if (reducedSteps < 0) reducedSteps += scaleLength;
    return reducedSteps;
  }

  _rawStepsForCoords(coords) {
    return coords.x * this.settings.rSteps + coords.y * this.settings.drSteps;
  }

  _surfaceDeltaFromCoords(sourceCoords, targetCoords) {
    if (!sourceCoords || !targetCoords) return null;
    return new Point(
      Math.trunc(targetCoords.x - sourceCoords.x),
      Math.trunc(targetCoords.y - sourceCoords.y),
    );
  }

  _reduceFixedDoStepDelta(rawStepDelta) {
    const scaleLength = this.tuning.scale.length || 0;
    if (!scaleLength || !Number.isFinite(rawStepDelta)) return Math.trunc(rawStepDelta || 0);
    let reduced = Math.trunc(rawStepDelta % scaleLength);
    if (reduced < 0) reduced += scaleLength;
    const alternate = reduced - scaleLength;
    return Math.abs(alternate) < Math.abs(reduced) ? alternate : reduced;
  }

  _normalizedFixedDoTargetCoords(sourceCoords, targetCoords) {
    if (
      this.inputRuntime.layoutMode !== "sequential" ||
      !sourceCoords ||
      !targetCoords
    ) {
      return targetCoords;
    }
    const sourceRaw = this._rawStepsForCoords(sourceCoords);
    const targetRaw = this._rawStepsForCoords(targetCoords);
    const reducedDelta = this._reduceFixedDoStepDelta(targetRaw - sourceRaw);
    if (reducedDelta === targetRaw - sourceRaw) return targetCoords;
    return this.coordResolver.coordForSteps(sourceRaw + reducedDelta) ?? targetCoords;
  }

  _routeEquaveOffset(entry) {
    const transpositionDeltaCents = Number(entry?.transpositionDeltaCents);
    const equaveCents = this.tuning.equivInterval ?? 1200;
    if (
      !Number.isFinite(transpositionDeltaCents) ||
      !Number.isFinite(equaveCents) ||
      Math.abs(equaveCents) < 0.000001
    ) {
      return 0;
    }
    const sourceDegree = entry?.sourceDegree ?? null;
    const targetDegree = entry?.targetDegree ?? null;
    if (sourceDegree == null || targetDegree == null) return 0;
    const reducedDeltaCents =
      (this.tuning.scale?.[sourceDegree] ?? 0) - (this.tuning.scale?.[targetDegree] ?? 0);
    return Math.round((reducedDeltaCents - transpositionDeltaCents) / equaveCents);
  }

  _controllerAnchorAddressForSettings(settingsLike = this.settings) {
    if (!this.controller) return null;
    if (this.controller.multiChannel) {
      return {
        channel:
          settingsLike.midiin_anchor_channel ??
          this.controller.anchorChannelDefault ??
          1,
        note:
          settingsLike.midiin_anchor_note ??
          settingsLike.midiin_central_degree ??
          this.controller.anchorDefault ??
          60,
      };
    }
    return {
      channel: 1,
      note: settingsLike.midiin_anchor_note ?? settingsLike.midiin_central_degree ?? this.controller.anchorDefault ?? 60,
    };
  }

  _buildControllerMapForSettings(settingsLike = this.settings) {
    if (!this.controller || typeof this.controller.buildMap !== "function") return null;

    const isSequential = !!settingsLike.midi_passthrough;
    const useGeometryMap = !isSequential || !this.controller.multiChannel;
    if (!useGeometryMap) return null;

    let anchorNote;
    let anchorChannel;

    if (this.controller.multiChannel) {
      const constraints = this.controller.learnConstraints;
      anchorNote = settingsLike.midiin_anchor_note ?? settingsLike.midiin_central_degree;
      anchorChannel = settingsLike.midiin_anchor_channel;

      if (!this.controller.supportsVirtualAnchor && constraints?.noteRange) {
        const { min, max } = constraints.noteRange;
        if (anchorNote == null || anchorNote < min || anchorNote > max) {
          anchorNote = this.controller.anchorDefault ?? 26;
        }
      }
      if (!this.controller.supportsVirtualAnchor && constraints?.channelRange) {
        const { min, max } = constraints.channelRange;
        if (anchorChannel == null || anchorChannel < min || anchorChannel > max) {
          anchorChannel = this.controller.anchorChannelDefault ?? 3;
        }
      }
    } else {
      anchorNote = settingsLike.midiin_anchor_note ?? settingsLike.midiin_central_degree ?? this.controller.anchorDefault ?? 60;
      anchorChannel = 1;
    }

    const rawOffsets = this.controller.multiChannel
      ? this.controller.buildMap(anchorNote, anchorChannel, this.controller.defaultCols)
      : this.controller.buildMap(anchorNote, anchorChannel, settingsLike.rSteps, settingsLike.drSteps);
    const anchorAddress = this._controllerAnchorAddressForSettings(settingsLike);
    const virtualAnchorCoords = (
      Number.isFinite(settingsLike.controller_virtual_anchor_x) &&
      Number.isFinite(settingsLike.controller_virtual_anchor_y)
    )
      ? new Point(settingsLike.controller_virtual_anchor_x, settingsLike.controller_virtual_anchor_y)
      : null;
    const actualAnchorCoords = anchorAddress
      ? rawOffsets.get(`${anchorAddress.channel}.${anchorAddress.note}`) ?? null
      : null;
    const virtualDx = virtualAnchorCoords && actualAnchorCoords
      ? virtualAnchorCoords.x - actualAnchorCoords.x
      : 0;
    const virtualDy = virtualAnchorCoords && actualAnchorCoords
      ? virtualAnchorCoords.y - actualAnchorCoords.y
      : 0;
    const ox = settingsLike.centerHexOffset.x;
    const oy = settingsLike.centerHexOffset.y;
    const controllerMap = new Map();
    for (const [key, { x, y }] of rawOffsets) {
      controllerMap.set(key, new Point(x + virtualDx + ox, y + virtualDy + oy));
    }
    return controllerMap;
  }

  _controllerAnchorCoordsForSettings(controllerMap, settingsLike = this.settings) {
    if (!controllerMap || !this.controller) return null;
    if (
      Number.isFinite(settingsLike.controller_virtual_anchor_x) &&
      Number.isFinite(settingsLike.controller_virtual_anchor_y)
    ) {
      return new Point(settingsLike.controller_virtual_anchor_x, settingsLike.controller_virtual_anchor_y);
    }
    const anchorAddress = this._controllerAnchorAddressForSettings(settingsLike);
    const anchorCoords = controllerMap.get(`${anchorAddress.channel}.${anchorAddress.note}`);
    if (anchorCoords) return anchorCoords;
    if (this.controller.supportsVirtualAnchor) {
      return new Point(settingsLike.centerHexOffset.x, settingsLike.centerHexOffset.y);
    }
    return null;
  }

  _virtualAnchorSettingsForSurfaceDelta(anchorSettings, surfaceDelta) {
    if (!this.controller || typeof this.controller.translateVirtualAnchor !== "function") return null;
    const anchorAddress = this._controllerAnchorAddressForSettings({ ...this.settings, ...anchorSettings });
    if (!anchorAddress) return null;
    const nextAddress = this.controller.translateVirtualAnchor(
      anchorAddress.note,
      anchorAddress.channel,
      surfaceDelta,
    );
    if (!nextAddress) return null;
    return this._anchorSettingsForControllerAddress(
      anchorSettings,
      nextAddress.channel,
      nextAddress.note,
    );
  }

  _findNearestControllerCoordsForDegree(controllerMap, degree, anchorCoords) {
    let best = null;
    let bestDist = Infinity;
    for (const coords of controllerMap.values()) {
      if (this._rawReducedStepsForCoords(coords) !== degree) continue;
      const dx = coords.x - anchorCoords.x;
      const dy = coords.y - anchorCoords.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = coords;
      }
    }
    return best;
  }

  _findNearestControllerCoordsForRawStep(controllerMap, rawStep, referenceCoords) {
    let best = null;
    let bestDist = Infinity;
    for (const coords of controllerMap.values()) {
      if (this._rawStepsForCoords(coords) !== rawStep) continue;
      const dx = coords.x - referenceCoords.x;
      const dy = coords.y - referenceCoords.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = coords;
      }
    }
    return best;
  }

  _coordForRawStepNearReference(rawStep, referenceCoords) {
    const previousLastMidiCoords = this.coordResolver.lastMidiCoords;
    try {
      this.coordResolver.lastMidiCoords = this.hexCoordsToScreen(referenceCoords);
      return this.coordResolver.coordForSteps(rawStep);
    } finally {
      this.coordResolver.lastMidiCoords = previousLastMidiCoords;
    }
  }

  _anchorSettingsForControllerAddress(anchorSettings, channel, note) {
    const next = {
      ...anchorSettings,
      midiin_anchor_note: note,
      midiin_anchor_channel: channel,
      controller_virtual_anchor_x: null,
      controller_virtual_anchor_y: null,
    };
    return next;
  }

  _anchorUpdateForSurfaceDelta(surfaceDelta, anchorSettings) {
    if (!surfaceDelta) return anchorSettings;
    const dx = Number(surfaceDelta.x);
    const dy = Number(surfaceDelta.y);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
      return anchorSettings;
    }

    if (this.inputRuntime.layoutMode !== "sequential") {
      const controllerMap = this._buildControllerMapForSettings({ ...this.settings, ...anchorSettings });
      if (controllerMap && this.controller) {
        const virtualUpdate = this._virtualAnchorSettingsForSurfaceDelta(anchorSettings, { x: dx, y: dy });
        if (this.controller.id === "lumatone" && virtualUpdate) return virtualUpdate;
        const anchorCoords = this._controllerAnchorCoordsForSettings(
          controllerMap,
          { ...this.settings, ...anchorSettings },
        );
        if (anchorCoords) {
          const desiredAnchorCoords = new Point(anchorCoords.x - dx, anchorCoords.y - dy);
          for (const [key, coords] of controllerMap.entries()) {
            if (!coords.equals(desiredAnchorCoords)) continue;
            const [channelText, noteText] = key.split(".");
            return this._anchorSettingsForControllerAddress(
              anchorSettings,
              parseInt(channelText, 10),
              parseInt(noteText, 10),
            );
          }
          if (virtualUpdate) return virtualUpdate;
          return {
            ...anchorSettings,
            controller_virtual_anchor_x: desiredAnchorCoords.x,
            controller_virtual_anchor_y: desiredAnchorCoords.y,
          };
        }
      }
    }

    const rawStepDelta = dx * this.settings.rSteps + dy * this.settings.drSteps;
    return {
      ...anchorSettings,
      midiin_anchor_note: (anchorSettings.midiin_anchor_note ?? anchorSettings.midiin_central_degree ?? 60) - rawStepDelta,
      midiin_anchor_channel: anchorSettings.midiin_anchor_channel ?? 1,
    };
  }

  _legacyAnchorUpdateForReplayRoute(entry, anchorSettings, direction = 1) {
    const equaveOffset = this._routeEquaveOffset(entry);
    const scaleLength = this.tuning.scale.length || 1;
    const sourceDegree = direction >= 0 ? entry?.sourceDegree : entry?.targetDegree;
    const targetDegree = direction >= 0
      ? (entry?.targetDegree ?? 0) + equaveOffset * scaleLength
      : (entry?.sourceDegree ?? 0) - equaveOffset * scaleLength;
    if (sourceDegree == null || targetDegree == null) return anchorSettings;
    const stepDelta = sourceDegree - targetDegree;

    if (this.inputRuntime.layoutMode !== "sequential") {
      const controllerMap = this._buildControllerMapForSettings({ ...this.settings, ...anchorSettings });
      if (controllerMap && this.controller) {
        const anchorCoords = this._controllerAnchorCoordsForSettings(
          controllerMap,
          { ...this.settings, ...anchorSettings },
        );
        const sourceCoords = anchorCoords
          ? this._findNearestControllerCoordsForDegree(
            controllerMap,
            ((sourceDegree % scaleLength) + scaleLength) % scaleLength,
            anchorCoords,
          )
          : null;
        if (anchorCoords && sourceCoords) {
          const sourceRaw = this._rawStepsForCoords(sourceCoords);
          const targetRaw = sourceRaw + stepDelta;
          const targetCoords = this._coordForRawStepNearReference(targetRaw, sourceCoords);
          if (!targetCoords) return anchorSettings;
          const desiredAnchorCoords = new Point(
            anchorCoords.x + sourceCoords.x - targetCoords.x,
            anchorCoords.y + sourceCoords.y - targetCoords.y,
          );
          for (const [key, coords] of controllerMap.entries()) {
            if (!coords.equals(desiredAnchorCoords)) continue;
            const [channelText, noteText] = key.split(".");
            return this._anchorSettingsForControllerAddress(
              anchorSettings,
              parseInt(channelText, 10),
              parseInt(noteText, 10),
            );
          }
          const surfaceDelta = new Point(
            targetCoords.x - sourceCoords.x,
            targetCoords.y - sourceCoords.y,
          );
          const virtualUpdate = this._virtualAnchorSettingsForSurfaceDelta(anchorSettings, surfaceDelta);
          if (virtualUpdate) return virtualUpdate;
        }
      }
    }

    return {
      ...anchorSettings,
      midiin_anchor_note: (anchorSettings.midiin_anchor_note ?? anchorSettings.midiin_central_degree ?? 60) + stepDelta,
      midiin_anchor_channel: anchorSettings.midiin_anchor_channel ?? 1,
    };
  }

  _anchorUpdateForReplayRoute(entry, anchorSettings, direction = 1) {
    const dx = Number(entry?.surfaceDeltaX);
    const dy = Number(entry?.surfaceDeltaY);
    if (Number.isFinite(dx) && Number.isFinite(dy)) {
      const signedDelta = new Point(
        direction >= 0 ? Math.trunc(dx) : -Math.trunc(dx),
        direction >= 0 ? Math.trunc(dy) : -Math.trunc(dy),
      );
      return this._anchorUpdateForSurfaceDelta(signedDelta, anchorSettings);
    }
    return this._legacyAnchorUpdateForReplayRoute(entry, anchorSettings, direction);
  }

  _anchorSettingsFromHistory(history = this._modulationState.history ?? []) {
    const base = { ...(this._modulationHomeAnchor ?? this._extractCurrentAnchorSettings()) };
    if (this.settings.modulation_style !== "fixed_do") return base;

    let next = { ...base };
    for (const entry of Array.isArray(history) ? history : []) {
      const count = Number.isFinite(entry?.count) ? Math.trunc(entry.count) : 0;
      if (count > 0) {
        for (let index = 0; index < count; index += 1) {
          next = this._anchorUpdateForReplayRoute(entry, next, 1);
        }
      } else if (count < 0) {
        for (let index = 0; index < Math.abs(count); index += 1) {
          next = this._anchorUpdateForReplayRoute(entry, next, -1);
        }
      }
    }
    return next;
  }

  _applyAnchorSettingsUpdate(update, options = {}) {
    if (!update) return;
    Object.assign(this.settings, update);
    this.updateInputRuntime(this.inputRuntime, update);
    this._repositionLiveHexesAfterAnchorRewrite();
    if (this._hasSoundingNotes()) this.scheduleImmediateGridRedraw();
    if (options.persist !== false && this.onControllerAnchorRewrite) {
      const emittedUpdate = { ...update };
      if (emittedUpdate.controller_virtual_anchor_x == null) {
        delete emittedUpdate.controller_virtual_anchor_x;
      }
      if (emittedUpdate.controller_virtual_anchor_y == null) {
        delete emittedUpdate.controller_virtual_anchor_y;
      }
      this.onControllerAnchorRewrite(emittedUpdate, {
        controller: this.controller ?? null,
        runtimeOnly: options.runtimeOnly === true,
      });
    }
  }

  _applyAnchorFromModulationHistory(history = this._modulationState.history ?? [], options = {}) {
    this._applyAnchorSettingsUpdate(this._anchorSettingsFromHistory(history), options);
  }

  _deriveFixedDoAnchorRewrite(surfaceDelta) {
    if (!surfaceDelta) return null;
    const update = this._anchorUpdateForSurfaceDelta(surfaceDelta, this._extractCurrentAnchorSettings());
    if (!update) return null;
    return { update, controller: this.controller ?? null };
  }

  _repositionLiveHexesAfterAnchorRewrite() {
    const liveHexes = new Set([
      ...this._allActiveHexes(),
      ...this.state.sustainedNotes.map(([hex]) => hex),
    ]);
    for (const hex of liveHexes) {
      const nextCoords = this._coordsForLiveInputAddress(hex?._liveInputAddress);
      if (!nextCoords || !hex?.coords || hex.coords.equals(nextCoords)) continue;
      hex.coords = nextCoords;
    }
  }

  _applyFixedDoAnchorRewrite(anchorRewrite) {
    if (!anchorRewrite?.update) return;
    this._applyAnchorSettingsUpdate(anchorRewrite.update, { persist: true, runtimeOnly: true });
  }

  _commitPendingModulationTarget(coords) {
    const decision = derivePendingModulationCommit(this, coords);
    if (decision.type === "noop") return { suppressNoteOn: false };
    if (decision.type === "rearm_source") {
      this._setAwaitingModulationSource(null, decision.targetDegree, coords);
      return { suppressNoteOn: false };
    }
    if (decision.type === "cancel") {
      this._applyModulationStateTransition(decision.nextState, {
        updateFrame: false,
        refreshRuntimeDisplayOffset: false,
        redraw: "deferred",
        syncControllerColors: false,
      });
      return { suppressNoteOn: false };
    }
    this._applyModulationStateTransition(
      commitModulationTarget(this._modulationState, {
        targetDegree: decision.targetDegree,
        pendingFrame: decision.pendingFrame,
        deltaRSteps: decision.geometryDelta?.deltaRSteps,
        deltaDrSteps: decision.geometryDelta?.deltaDrSteps,
        transpositionDeltaCents: decision.transpositionDeltaCents,
        transpositionRatioText: ratioTextForModulationDelta(
          this.tuning,
          this._modulationState.sourceDegree,
          decision.targetDegree,
          decision.transpositionDeltaCents,
        ),
        sourceStillSounding: decision.sourceStillSounding,
        articulation: decision.isFixedDo ? "reanchor_hold_source" : undefined,
      }),
      {
        refreshRuntimeDisplayOffset: true,
        redraw: "deferred",
        syncControllerColors: true,
      },
    );
    return { suppressNoteOn: decision.suppressNoteOn };
  }

  _isHexStillSounding(targetHex) {
    if (!targetHex?.coords) return false;
    for (const hex of this._allActiveHexes()) {
      if (hex.coords.equals(targetHex.coords)) return true;
    }
    return this.state.sustainedNotes.some(([hex]) => hex.coords.equals(targetHex.coords));
  }

  _isHexActivelyHeld(targetHex) {
    if (!targetHex) return false;
    for (const hex of this._allActiveHexes()) {
      if (hex === targetHex) return true;
    }
    return false;
  }

  _maybeTakeOverModulationTarget(coords, cents, cents_prev, cents_next) {
    return LiveHexRuntime.maybeTakeOverModulationTarget(
      this,
      coords,
      cents,
      cents_prev,
      cents_next,
    );
  }

  _applyPolyAftertouch(hex, value) {
    return InputExpressionRuntime.applyPolyAftertouch.call(this, hex, value);
  }

  _applyTimbreCC74(hex, value) {
    return InputExpressionRuntime.applyTimbreCC74.call(this, hex, value);
  }

  _normalizePitchBend14(value) {
    return InputExpressionRuntime.normalizePitchBend14.call(this, value);
  }

  _applyMpePitchBend(entry, channel, value14) {
    return InputExpressionRuntime.applyMpePitchBend.call(this, entry, channel, value14);
  }

  _activeHexesForInputChannel(channel) {
    return InputExpressionRuntime.activeHexesForInputChannel.call(this, channel);
  }

  _currentWheelPitchStateForHex(hex) {
    return InputExpressionRuntime.currentWheelPitchStateForHex.call(this, hex);
  }

  _syncTransferredWheelBend(hex) {
    return InputExpressionRuntime.syncTransferredWheelBend.call(this, hex);
  }

  _syncTransferredWheelBends() {
    return InputExpressionRuntime.syncTransferredWheelBends.call(this);
  }

  _hasLegacyFrameNotes() {
    return hasLegacyFrameNotes(this._modulationState, this._settlementNotesSnapshot());
  }

  _settlementNotesSnapshot() {
    return normalizeSettlementNotes(
      [...this._allActiveHexes()],
      this.state.sustainedNotes,
    );
  }

  _maybeSettleModulation() {
    const settlement = evaluateSettlement(this._modulationState, this._settlementNotesSnapshot());
    if (!settlement.canSettle) return;
    this._applyModulationStateTransition(
      settleModulationIfPossible(this._modulationState, {
        hasLegacyNotes: settlement.hasLegacyNotes,
      }),
      {
        refreshRuntimeDisplayOffset: false,
        redraw: "deferred",
        syncControllerColors: false,
      },
    );
  }

  _settleModulationAfterActiveRelease() {
    const release = classifyReleaseForSettlement(this._modulationState, {
      suppressed: false,
      notes: this._settlementNotesSnapshot(),
    });
    if (!release.shouldRetrySettlement) return;
    this._maybeSettleModulation();
  }

  previewDegree0 = (deltaCents) => {
    this.updateScaleDegree(0, deltaCents);
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
    this.scheduleGridRedraw();
  };

  // Reset octave offset to 0 without any retune arithmetic.
  // Called on synth rebuild, PANIC, and structural changes — contexts where
  // all notes are already dead so retuning held notes is neither needed nor safe.
  resetOctave = () => {
    this.settings.octave_offset = 0;
    this.scheduleGridRedraw();
  };

  updateFundamental = (newFundamental) => {
    this.settings.fundamental = newFundamental;
    this._tuningPreviewState = clearFundamentalPreview(this._tuningPreviewState);
    this._rebaseModulationFrameFundamentals();
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
    // Update fundamental on all sounding/sustained hex objects, then retune.
    // Both MidiHex and ActiveHex store this.fundamental at construction;
    // we patch it directly so retune() uses the new value.
    const allHexes = [...this._allActiveHexes(), ...[...this.state.sustainedNotes].map(([h]) => h)];
    for (const hex of allHexes) {
      if ("fundamental" in hex) hex.fundamental = newFundamental;
      const [trueCents] = this._liveCentsForHex(hex, false);
      this._queueRetuneGlide(hex, trueCents, bendOnly);
    }
    if (allHexes.length > 0) this._bumpLiveScaleTableVersion();
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
    this._emitModulationState();
  };

  _fundamentalSnapshot = null;
  _fundamentalPreviewSnapshot = null;
  _tuningPreviewState = createTuningPreviewState();

  snapshotForFundamentalPreview = () => {
    // Fundamental preview now derives from a transient runtime delta rather than
    // capturing per-hex snapshots. The method remains for API compatibility.
  };

  previewFundamental = (deltaCents, clearSnapshot = false) => {
    this._tuningPreviewState = clearSnapshot
      ? clearFundamentalPreview(this._tuningPreviewState)
      : setFundamentalPreview(this._tuningPreviewState, deltaCents);
    const bendOnly = !!this.inputRuntime.mpeInput;
    const applyTo = (hex) => {
      const [baseCents] = this._liveCentsForHex(hex, true);
      this._queueRetuneGlide(hex, baseCents, bendOnly);
    };
    for (const hex of this._allActiveHexes()) applyTo(hex);
    for (const [hex] of this.state.sustainedNotes) applyTo(hex);
    if (this._hasSoundingNotes()) this._bumpLiveScaleTableVersion();
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
    return KeysBrowserInput.setTuneDragging.call(this, active);
  };

  /**
   * Imperatively update colors and redraw without reconstructing the Keys instance.
   * RAF-batched: multiple rapid color changes result in only one redraw per frame.
   */
  updateColors = (colors) => {
    return KeysControllerLeds.updateColors.call(this, colors);
  };

  /**
   * Imperatively update label display settings without reconstructing Keys.
   * Replaces the label flags and name arrays in this.settings, then redraws.
   * Called from Keyboard wrapper when key_labels or related fields change.
   */
  updateLabels = (labels) => {
    return KeysLabels.updateLabels.call(this, labels);
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

  updateInputRuntime = (nextRuntime, nextSettings = null) => {
    const previousMidiInputDevice = this.settings.midiin_device;
    const previousModulationStyle = this.settings.modulation_style;
    const previousRouteKey = JSON.stringify({
      device: this.settings.midiin_device,
      override: this.settings.midiin_controller_override,
      passthrough: !!this.settings.midi_passthrough,
      tonalplexusMode: this.settings.tonalplexus_input_mode,
      target: this.inputRuntime?.target,
      layoutMode: this.inputRuntime?.layoutMode,
      mpeInput: !!this.inputRuntime?.mpeInput,
    });
    const nextRouteKey = JSON.stringify({
      device: nextSettings?.midiin_device ?? this.settings.midiin_device,
      override: nextSettings?.midiin_controller_override ?? this.settings.midiin_controller_override,
      passthrough: !!(nextSettings?.midi_passthrough ?? this.settings.midi_passthrough),
      tonalplexusMode: nextSettings?.tonalplexus_input_mode ?? this.settings.tonalplexus_input_mode,
      target: nextRuntime?.target ?? this.inputRuntime?.target,
      layoutMode: nextRuntime?.layoutMode ?? this.inputRuntime?.layoutMode,
      mpeInput: !!(nextRuntime?.mpeInput ?? this.inputRuntime?.mpeInput),
    });
    if (previousRouteKey !== nextRouteKey) this.allnotesOff();
    if (nextRuntime) {
      this.inputRuntime = nextRuntime;
      if (this.coordResolver) this.coordResolver.inputRuntime = nextRuntime;
    }
    if (nextSettings) {
      Object.assign(this.settings, nextSettings);
      if (this.inputRuntime) {
        const anchorRuntimeUpdate = {};
        if (nextSettings.midiin_anchor_note != null || nextSettings.midiin_central_degree != null) {
          anchorRuntimeUpdate.seqAnchorNote =
            nextSettings.midiin_anchor_note ?? nextSettings.midiin_central_degree;
        }
        if (nextSettings.midiin_anchor_channel != null) {
          anchorRuntimeUpdate.seqAnchorChannel = nextSettings.midiin_anchor_channel;
        }
        if (Object.keys(anchorRuntimeUpdate).length > 0) {
          Object.assign(this.inputRuntime, anchorRuntimeUpdate);
          if (this.coordResolver) this.coordResolver.inputRuntime = this.inputRuntime;
        }
      }
      if (previousMidiInputDevice !== this.settings.midiin_device) {
        InputMidiListeners.rebindMidiInput.call(this);
        return;
      }
      if (!this.midiin_data && this.settings.midiin_device !== "OFF") {
        InputMidiListeners.rebindMidiInput.call(this);
        return;
      }
      const controllerMapChanged = InputMidiListeners.rebuildControllerMap.call(this);
      if (controllerMapChanged) {
        this._syncControllerAutoColors();
      }
    }
    if (previousModulationStyle !== this.settings.modulation_style) {
      this._syncModulationStyleFromSettings({ emit: true });
    }
  };

  getSnapshot() {
    return SequencerSnapshots.captureSnapshot(this);
  }

  playSnapshot(notes) {
    this._snapshotHexes = SequencerSnapshots.playSnapshot(this, notes);
  }

  stopSnapshot() {
    SequencerSnapshots.stopSnapshot(this._snapshotHexes);
    this._snapshotHexes = [];
  }

  /**
   * Manually trigger a full Lumatone LED color sync regardless of the
   * lumatone_led_sync auto-sync setting.  Called by the "Sync now" button.
   */
  syncLumatoneLEDs = () => {
    return KeysControllerLeds.syncLumatoneLEDs.call(this);
  };

  autoSyncLumatoneLEDs = () => {
    return KeysControllerLeds.autoSyncLumatoneLEDs.call(this);
  };

  _canAutoSendLumatoneColors = () => {
    return KeysControllerLeds.canAutoSendLumatoneColors.call(this);
  };

  _canAutoSendExquisColors = () => {
    return KeysControllerLeds.canAutoSendExquisColors.call(this);
  };

  _canAutoSendLinnstrumentColors = () => {
    return KeysControllerLeds.canAutoSendLinnstrumentColors.call(this);
  };

  syncExquisLEDs = () => {
    return KeysControllerLeds.syncExquisLEDs.call(this);
  };

  syncLinnstrumentLEDs = () => {
    return KeysControllerLeds.syncLinnstrumentLEDs.call(this);
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
    return KeysControllerLeds.buildLinnstrumentColorArray.call(this);
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
    return KeysControllerLeds.sendLumatoneLayout.call(this);
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
    return KeysControllerLeds.buildLumatoneColorEntries.call(this);
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
    return KeysControllerLeds.buildExquisColorArray.call(this);
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
    return KeysControllerLeds.getLumatoneHexColor.call(this, coords);
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
    return KeysControllerLeds.getScreenHexColor.call(this, cents, reducedSteps);
  }

  deconstruct = () => {
    if (this._retuneGlideTimer != null) {
      clearTimeout(this._retuneGlideTimer);
      this._retuneGlideTimer = null;
    }
    if (this._gridRedrawRaf != null) {
      cancelAnimationFrame(this._gridRedrawRaf);
      this._gridRedrawRaf = null;
    }
    this._staticGridCanvas = null;
    this._staticGridContext = null;
    this._staticGridUsable = false;
    this._staticGridValid = false;
    this._resetWheelInputState(true);
    if (this._deferredBulkMapTimer != null) {
      clearTimeout(this._deferredBulkMapTimer);
      this._deferredBulkMapTimer = null;
    }
    for (const timeoutId of this._recentlyReleasedHexes.values()) {
      clearTimeout(timeoutId);
    }
    this._recentlyReleasedHexes.clear();
    if (this._pendingRasterAutoReleases) {
      for (const channelEntries of this._pendingRasterAutoReleases.values()) {
        for (const entry of channelEntries) {
          clearTimeout(entry.timeoutId);
        }
      }
      this._pendingRasterAutoReleases.clear();
    }
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
    this._hakenMpeBend21ByChannel.clear();
    this._hakenMpePlusLsbByChannel.clear();
    this._scaleModePreBend21.clear();
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
    if (this._gridRedrawRaf != null) {
      cancelAnimationFrame(this._gridRedrawRaf);
      this._gridRedrawRaf = null;
    }
    if (this._gridRedrawTimer != null) {
      clearTimeout(this._gridRedrawTimer);
      this._gridRedrawTimer = null;
    }

    InputMidiListeners.teardownMidiInput.call(this);

    if (this.midiout_data) {
      this.midiout_data = null;
    }
  };

  mtsSendMap = (midiOutput, protectHeld = true, protectRecentReleased = true) => {
    return MtsOutputRuntime.mtsSendMap.call(this, midiOutput, protectHeld, protectRecentReleased);
  };

  // Helper: if latch is active and coords is already sustained, toggle it off.
  // Returns true if the note was toggled off (caller should return/continue).
  _midiLatchToggle(coords, releaseVelocity = 0) {
    return LiveHexRuntime.midiLatchToggle(this, coords, releaseVelocity);
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

  hasSoundingNotes = () => this._hasSoundingNotes();

  _markSoundActivity() {
    this._lastSoundActivityTime = performance.now();
  }

  _isSoundInteractionIdle(quietMs = 175) {
    if (this._hasSoundingNotes()) return false;
    return performance.now() - this._lastSoundActivityTime >= quietMs;
  }

  isSoundInteractionIdle = () => this._isSoundInteractionIdle();

  _hasRecentReleasedBulkTargets() {
    return MtsOutputRuntime.hasRecentReleasedBulkTargets.call(this);
  }

  _collectProtectedBulkHexes(includeRecentReleased = true) {
    return MtsOutputRuntime.collectProtectedBulkHexes.call(this, includeRecentReleased);
  }

  _hasDeferredBulkTargets() {
    return MtsOutputRuntime.hasDeferredBulkTargets.call(this);
  }

  _sendBulkDumpOctaveRefresh(protectHeld = true, protectRecentReleased = true) {
    return MtsOutputRuntime.sendBulkDumpOctaveRefresh.call(
      this,
      protectHeld,
      protectRecentReleased,
    );
  }

  _scheduleDeferredBulkRefresh() {
    return MtsOutputRuntime.scheduleDeferredBulkRefresh.call(this);
  }

  _trackRecentlyReleasedHex(hex) {
    return MtsOutputRuntime.trackRecentlyReleasedHex.call(this, hex);
  }

  // Apply channel step offset to a base coordinate.
  // Gets the raw steps at baseCoords, adds channelToStepsOffset(channel),
  // then returns the best visible coord for those combined steps.
  // If stepsPerChannel is effectively zero (single-channel device or
  // stepsPerChannel === 0) returns baseCoords unchanged.
  _applyChannelOffset(baseCoords, channel) {
    return KeysMidiInput.applyChannelOffset.call(this, baseCoords, channel);
  }

  _acceptsMpeInputChannel(channel) {
    return KeysMidiInput.acceptsMpeInputChannel.call(this, channel);
  }

  _normalizeInputAddress(channel, note) {
    return KeysMidiInput.normalizeInputAddress.call(this, channel, note);
  }

  _resolveScaleInputPitchCents(channel, note, fallbackPitchHz) {
    return KeysMidiInput.resolveScaleInputPitchCents.call(this, channel, note, fallbackPitchHz);
  }

  midinoteOn = (e) => {
    return KeysMidiInput.midinoteOn.call(this, e);
  };

  midinoteOff = (e) => {
    return KeysMidiInput.midinoteOff.call(this, e);
  };

  allnotesOff = () => {
    return KeysMidiInput.allnotesOff.call(this);
  };

  _hakenRasterBend(entry, channel, bend14, scaleMode) {
  return KeysMidiInput.hakenRasterBend.call(this, entry, channel, bend14, scaleMode);
  };

  _refreshHakenGlideModeForActiveNotes() {
    if (this.controller?.id !== "hakenaudio" || !this.inputRuntime.mpeInput) return;
    for (const [channel, entry] of this.state.activeMidiByChannel) {
      const bend14 = this._mpeInputBendByChannel.get(channel);
      if (!entry?.hex || entry.hex.release || bend14 == null) continue;
      this._applyMpePitchBend(entry, channel, bend14);
    }
  }

  _setHakenSpaceGlideFlip(active) {
    if (this.controller?.id !== "hakenaudio" || !this.inputRuntime.mpeInput) {
      this.inputRuntime.hakenSpaceGlideFlip = active;
      return;
    }
    const previousMode = InputExpressionRuntime.resolveHakenXGlideMode(this.inputRuntime);
    this.inputRuntime.hakenSpaceGlideFlip = active;
    const nextMode = InputExpressionRuntime.resolveHakenXGlideMode(this.inputRuntime);
    if (
      previousMode === "raster_to_notes" &&
      nextMode !== "raster_to_notes"
    ) {
      for (const [channel, entry] of this.state.activeMidiByChannel) {
        const bend14 = this._mpeInputBendByChannel.get(channel);
        if (!entry?.hex || entry.hex.release || bend14 == null || !entry.hex.coords) continue;
        const [, , currentSteps] = this.hexCoordsToCents(entry.hex.coords);
        entry.hex._continuumPitchAnchor14 = bend14;
        entry.hex._continuumPitchAnchorSteps = currentSteps;
        entry.hex._continuumPitchAnchorCents = entry.hex.cents;
        if (this.inputRuntime.target === "scale") {
        entry.hex._scaleModeBendAnchor14 = bend14;
        }
      }
    }
    this._refreshHakenGlideModeForActiveNotes();
  }

  panic = () => {
    return PanicRuntime.panic(this);
  };

  releaseAllKeyboardNotes = () => {
    return PanicRuntime.releaseAllKeyboardNotes(this);
  };

  resetLatch = () => {
    return PanicRuntime.resetLatch(this);
  };

  hexOn(coords, note_played, velocity_played, bend, options = null) {
    return LiveHexRuntime.hexOn(this, coords, note_played, velocity_played, bend, options);
  }

  hexOff(coords) {
    return LiveHexRuntime.hexOff(this, coords);
  }

  noteOff(hex, release_velocity) {
    return LiveHexRuntime.noteOff(this, hex, release_velocity);
  }

  sustainOff(force = false) {
    return LiveHexRuntime.sustainOff(this, force);
  }

  sustainOn() {
    return LiveHexRuntime.sustainOn(this);
  }

  latchToggle() {
    return LiveHexRuntime.latchToggle(this);
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
    const nextSignature = [
      newWidth,
      newHeight,
      this.settings.rotation,
      this.settings.hexSize,
      this.settings.hexWidth,
      this.settings.hexVert,
      this.settings.centerHexOffset?.x ?? 0,
      this.settings.centerHexOffset?.y ?? 0,
      this.settings.runtime_display_offset_x ?? 0,
      this.settings.runtime_display_offset_y ?? 0,
    ].join(":");
    if (nextSignature === this._lastResizeSignature) return;
    this._lastResizeSignature = nextSignature;

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
    this._canvasTransform = m;
    this.state.context.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    this._rebuildVisibleGridGeometry();
    this._resizeStaticGridCanvas(newWidth, newHeight, m);

    // Redraw Grid
    this.drawGrid();

    // Rebuild the steps→coords lookup table now that centerpoint and grid range
    // are up to date. Must come after drawGrid() so centerpoint is already set.
    this.coordResolver.buildStepsTable();
  };

  inputIsFocused = () => {
    return KeysBrowserInput.inputIsFocused.call(this);
  };

  onKeyDown = (e) => {
    return KeysBrowserInput.onKeyDown.call(this, e);
  };

  onKeyUp = (e) => {
    return KeysBrowserInput.onKeyUp.call(this, e);
  };

  mouseUp = (_e) => {
    return KeysBrowserInput.mouseUp.call(this, _e);
  };

  mouseDown = (e) => {
    return KeysBrowserInput.mouseDown.call(this, e);
  };

  mouseActive = (e) => {
    return KeysBrowserInput.mouseActive.call(this, e);
  };

  getPointerPosition(e) {
    return KeysBrowserInput.getPointerPosition.call(this, e);
  }

  getPosition(element) {
    return KeysBrowserInput.getPosition.call(this, element);
  }

  handleTouch = (e) => {
    return KeysBrowserInput.handleTouch.call(this, e);
  };

  // Helper: start a touch note at coords for the given touch identifier.
  // Handles latch-toggle (if the coord is already sustained, toggle it off
  // instead of playing a new note). Otherwise plays and stores in activeTouch.
  _touchStartOnCoords(id, coords) {
    return KeysBrowserInput.touchStartOnCoords.call(this, id, coords);
  }

  // Handle touchcancel — when the browser cancels a touch (e.g. gesture, notification).
  // This prevents notes from getting stuck on mobile.
  handleTouchCancel = (_e) => {
    return KeysBrowserInput.handleTouchCancel.call(this, _e);
  };

  /**************** Rendering ****************/

  scheduleGridRedraw() {
    return KeysRenderer.scheduleGridRedraw.call(this);
  }

  scheduleImmediateGridRedraw() {
    return KeysRenderer.scheduleImmediateGridRedraw.call(this);
  }

  _coordKey(coords) {
    return KeysRenderer.coordKey.call(this, coords);
  }

  _buildHexGeometry(hex) {
    return KeysRenderer.buildHexGeometry.call(this, hex);
  }

  _rebuildVisibleGridGeometry() {
    return KeysRenderer.rebuildVisibleGridGeometry.call(this);
  }

  _resizeStaticGridCanvas(width, height, transform) {
    return KeysRenderer.resizeStaticGridCanvas.call(this, width, height, transform);
  }

  _drawStaticHex(coords, context = this.state.context) {
    return KeysRenderer.drawStaticHex.call(this, coords, context);
  }

  _ensureStaticGrid() {
    return KeysRenderer.ensureStaticGrid.call(this);
  }

  _withMainIdentityTransform(draw) {
    return KeysRenderer.withMainIdentityTransform.call(this, draw);
  }

  _copyStaticGridToMain() {
    return KeysRenderer.copyStaticGridToMain.call(this);
  }

  _restoreHexStaticBackground(coords) {
    return KeysRenderer.restoreHexStaticBackground.call(this, coords);
  }

  _transformCanvasPoint(x, y) {
    return KeysRenderer.transformCanvasPoint.call(this, x, y);
  }

  _hexPixelBounds(geometry, pad = 0) {
    return KeysRenderer.hexPixelBounds.call(this, geometry, pad);
  }

  _redrawSoundingHexes() {
    return KeysRenderer.redrawSoundingHexes.call(this);
  }

  _redrawSoundingHexesInBounds(bounds) {
    return KeysRenderer.redrawSoundingHexesInBounds.call(this, bounds);
  }

  _drawSoundingHex(hex) {
    return KeysRenderer.drawSoundingHex.call(this, hex);
  }

  drawGrid() {
    return KeysRenderer.drawGrid.call(this);
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
    return InputExpressionRuntime.passthroughCC.call(this, cc, value);
  }

  _passthroughChannelPressure(value) {
    return InputExpressionRuntime.passthroughChannelPressure.call(this, value);
  }

  // Send a pitch-bend message to all active outputs.
  // val14: 0–16383 (centre 8192).  Converted to WebMidi's −1…+1 float.
  // For MPE output we send on the manager channel (zone-wide per MPE spec).
  // Individual MPE voice-channel bends are handled by the hex's retune() call —
  // we do not also send on the manager channel when in MPE input mode, since
  // that would double-apply the bend.
  _passthroughPitchBend(val14) {
    return InputExpressionRuntime.passthroughPitchBend.call(this, val14);
  }

  _getControllerState() {
    return InputExpressionRuntime.getControllerState.call(this);
  }

  _pushControllerStateToSynth() {
    return InputExpressionRuntime.pushControllerStateToSynth.call(this);
  }

  _rememberControllerStateInSynth() {
    return InputExpressionRuntime.rememberControllerStateInSynth.call(this);
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
    return InputExpressionRuntime.handleWheelBend.call(this, val14);
  }

  _handleIncomingWheelBend(val14) {
    return InputExpressionRuntime.handleIncomingWheelBend.call(this, val14);
  }

  _applyWheelInputNow(val14) {
    return InputExpressionRuntime.applyWheelInputNow.call(this, val14);
  }

  _resetWheelInputState(resetToCurrent = false) {
    return InputExpressionRuntime.resetWheelInputState.call(this, resetToCurrent);
  }

  _resolveRecencyWheelTarget(target, val14 = this._wheelValue14) {
    return InputExpressionRuntime.resolveRecencyWheelTarget.call(this, target, val14);
  }

  _applyCurrentWheelToHex(hex) {
    return InputExpressionRuntime.applyCurrentWheelToHex.call(this, hex);
  }

  _reapplyCurrentWheelBend() {
    return InputExpressionRuntime.reapplyCurrentWheelBend.call(this);
  }

  _retuneHexFromBase(hex, baseCents, bendOnly = false) {
    return InputExpressionRuntime.retuneHexFromBase.call(this, hex, baseCents, bendOnly);
  }

  _queueRetuneGlide(hex, targetBase, bendOnly = false) {
    return InputExpressionRuntime.queueRetuneGlide.call(this, hex, targetBase, bendOnly);
  }

  _kickRetuneGlides() {
    return InputExpressionRuntime.kickRetuneGlides.call(this);
  }

  _tickRetuneGlides = () => {
    return InputExpressionRuntime.tickRetuneGlides.call(this);
  };

  _reapplyCurrentInputBends() {
    return InputExpressionRuntime.reapplyCurrentInputBends.call(this);
  }

  _refreshSoundingHexNeighbors() {
    return InputExpressionRuntime.refreshSoundingHexNeighbors.call(this);
  }

  // Called whenever the recency stack changes.  If the front note has changed,
  // redirects bend to the new front while leaving the old target frozen at its
  // last sounded pitch.
  _updateWheelTarget(smoothReturn = false) {
    return InputExpressionRuntime.updateWheelTarget.call(this, smoothReturn);
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
    return KeysRenderer.hexCoordsToScreen.call(this, hex);
  }

  drawHex(p, c, current_text_color, context = this.state.context, options = {}) {
    return KeysRenderer.drawHex.call(this, p, c, current_text_color, context, options);
  }

  centsToColor(cents, pressed, pressed_interval) {
    return KeysRenderer.centsToColor.call(this, cents, pressed, pressed_interval);
  }

  roundTowardZero(val) {
    if (val < 0) {
      return Math.ceil(val);
    }
    return Math.floor(val);
  }

  _effectivePreviewScale() {
    return getEffectiveScaleRuntime(this._previewSource(), this._tuningPreviewState).scale;
  }

  _effectivePreviewEquivInterval() {
    return getEffectiveScaleRuntime(this._previewSource(), this._tuningPreviewState).equivInterval;
  }

  _previewSource(frame = this._activeFrame()) {
    return {
      scale: this.tuning.scale,
      equivInterval: this.tuning.equivInterval,
      referenceDegree: this.settings.reference_degree ?? 0,
      fundamental: frame?.effectiveFundamental ?? this.settings.fundamental,
    };
  }

  _deriveHexPitch(
    coords,
    includeFundamentalPreview = false,
    frame = this._activeFrame(),
    geometryMode = this._modulationState?.geometryMode,
  ) {
    let distance = coords.x * this.settings.rSteps + coords.y * this.settings.drSteps;
    const previewRuntime = this._effectiveScaleRuntimeForFrame(frame);
    const scale = previewRuntime.scale;
    const scaleLength = scale.length || 1;
    let octs = this.roundTowardZero(distance / scaleLength);
    let octs_prev = this.roundTowardZero((distance - 1) / scaleLength);
    let octs_next = this.roundTowardZero((distance + 1) / scaleLength);
    let reducedSteps = distance % scaleLength;
    let reducedSteps_prev = (distance - 1) % scaleLength;
    let reducedSteps_next = (distance + 1) % scaleLength;
    if (reducedSteps < 0) {
      reducedSteps += scaleLength;
      octs -= 1;
    }
    if (reducedSteps_prev < 0) {
      reducedSteps_prev += scaleLength;
      octs_prev -= 1;
    }
    if (reducedSteps_next < 0) {
      reducedSteps_next += scaleLength;
      octs_next -= 1;
    }
    const live = deriveLiveHexPitch({
      reducedSteps,
      reducedStepsPrev: reducedSteps_prev,
      reducedStepsNext: reducedSteps_next,
      distance,
      octs,
      octsPrev: octs_prev,
      octsNext: octs_next,
    }, {
      scale,
      scaleLength,
      equivSteps: this.tuning.equivSteps,
      equivInterval: previewRuntime.equivInterval,
      octaveOffset: this.settings.octave_offset || 0,
      frame,
      geometryMode,
    });
    const previewFundamentalDelta = getFundamentalPreviewDeltaCents(this._tuningPreviewState);
    if (includeFundamentalPreview && Math.abs(previewFundamentalDelta) > 0.000001) {
      live.cents += previewFundamentalDelta;
      live.centsPrev += previewFundamentalDelta;
      live.centsNext += previewFundamentalDelta;
    }
    return live;
  }

  hexCoordsToCents(coords) {
    const live = this._deriveHexPitch(coords, false);
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
      live.cents,
      live.liveReducedSteps,
      live.distance,
      live.octs,
      live.equivSteps,
      live.centsPrev,
      live.centsNext,
    ];
  }

  hexCoordsToLiveCents(coords) {
    const live = this._deriveHexPitch(coords, true);
    return [
      live.cents,
      live.liveReducedSteps,
      live.distance,
      live.octs,
      live.equivSteps,
      live.centsPrev,
      live.centsNext,
    ];
  }

  _liveCentsForHex(hex, includeFundamentalPreview = true) {
    const live = this._deriveHexPitch(
      hex?.coords,
      includeFundamentalPreview,
      this._frameForSoundingHex(hex),
      this._geometryModeForSoundingHex(hex),
    );
    return [
      live.cents,
      live.liveReducedSteps,
      live.distance,
      live.octs,
      live.equivSteps,
      live.centsPrev,
      live.centsNext,
    ];
  }

  getHexCoordsAt(coords) {
    return KeysRenderer.getHexCoordsAt.call(this, coords);
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
