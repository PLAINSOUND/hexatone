import { useState } from "preact/hooks";
import PropTypes from "prop-types";
import {
  detectController,
  getControllerById,
  getTonalPlexusInputMode,
} from "../../controllers/registry.js";
import { saveControllerPref } from "../../input/controller-anchor.js";
import {
  deactivateLinnstrumentUserFirmware,
  isLinnstrumentUserFirmwareEligible,
} from "../../controllers/linnstrument-user-firmware.js";
import ScalaInput from "../scale/scala-input.js";
import GeneralInputSettings from "./general-input-settings.js";
import ScaleInputSettings from "./scale-input-settings.js";
import MpeInputSettings from "./mpe-input-settings.js";
import GenericKeyboardSettings from "./controllers/generic-keyboard-settings.js";
import TonalPlexusSettings from "./controllers/tonal-plexus-settings.js";
import LinnstrumentSettings from "./controllers/linnstrument-settings.js";
import LumatoneSettings from "./controllers/lumatone-settings.js";
import ExquisSettings from "./controllers/exquis-settings.js";
import HakenContinuumSettings from "./controllers/haken-continuum-settings.js";

const MANUAL_CONTROLLER_OPTIONS = [
  { id: "axis49",          label: "AXIS-49" },
  { id: "exquis",          label: "Exquis" },
  { id: "generic",         label: "Generic Keyboard" },
  { id: "hakenaudio",      label: "Haken Continuum" },
  { id: "linnstrument", label: "LinnStrument" },
  { id: "lumatone",        label: "Lumatone" },
  { id: "tonalplexus",     label: "Tonal Plexus" },
  { id: "ts41",            label: "TS41" },
];

function resolveControllerSelection(overrideId, detectedController) {
  if (overrideId && overrideId !== "auto") {
    return getControllerById(overrideId);
  }
  return detectedController;
}

const MIDIio = (props) => {
  // props.midiTick is unused directly — its presence as a changing prop forces
  // re-render when MIDI devices connect/disconnect, refreshing the inputs list.
  const connectedDevice =
    props.midi && props.settings.midiin_device && props.settings.midiin_device !== "OFF"
      ? Array.from(props.midi.inputs.values()).find((m) => m.id === props.settings.midiin_device)
      : null;
  const deviceName = connectedDevice?.name?.toLowerCase() ?? "";
  const controllerOverrideId = props.settings.midiin_controller_override || "auto";
  const autoDetectActive = controllerOverrideId === "auto";
  // Detect 2D controller (null when device is disconnected or unrecognised).
  const detectedController = detectController(deviceName);
  const ctrl = resolveControllerSelection(controllerOverrideId, detectedController);
  const tonalPlexus41Mode =
    ctrl?.id === "tonalplexus" && getTonalPlexusInputMode(props.settings) === "blocks_41";
  const tonalPlexus205Mode =
    ctrl?.id === "tonalplexus" && getTonalPlexusInputMode(props.settings) === "layout_205";

  // midiin_anchor_note is the raw physical MIDI note number at the input anchor.
  const center_degree = props.settings.center_degree || 0;
  const centralNote = props.settings.midiin_anchor_note ?? 60;
  const anchorNoteRange = ctrl?.learnConstraints?.noteRange ?? { min: 0, max: 127 };
  const anchorChannelRange = ctrl?.learnConstraints?.channelRange ?? { min: 1, max: 16 };
  const anchorChannel =
    props.settings.midiin_anchor_channel ?? ctrl?.anchorChannelDefault ?? null;
  const controllerAnchorNote =
    props.settings.midiin_anchor_note ?? ctrl?.anchorDefault ?? anchorNoteRange.min;
  const seqAnchorChannel = props.settings.midiin_anchor_channel ?? 1;

  // Channel transposition mode derived from midiin_steps_per_channel:
  //   null  → 'equave'  (one equave per channel, default)
  //   0     → 'none'    (all channels untransposed)
  //   N > 0 → 'custom'  (N scale degrees per channel)
  const spc = props.settings.midiin_steps_per_channel;
  const stepsMode = spc === null || spc === undefined ? "equave" : spc === 0 ? "none" : "custom";

  const setStepsMode = (mode) => {
    if (mode === "none") {
      props.onChange("midiin_steps_per_channel", 0);
      sessionStorage.setItem("midiin_steps_per_channel", "0");
    } else if (mode === "equave") {
      props.onChange("midiin_steps_per_channel", null);
      sessionStorage.removeItem("midiin_steps_per_channel");
    } else if (mode === "custom") {
      // Seed with the current equave size so the user has a sensible starting value.
      const initial = props.settings.equivSteps ?? 12;
      props.onChange("midiin_steps_per_channel", initial);
      sessionStorage.setItem("midiin_steps_per_channel", String(initial));
    }
  };

  // Channel Transposition is shown when sequential arithmetic is meaningful:
  //   - not in active 2D geometry mode
  //   - AND not a multichannel controller (Lumatone, LinnStrument, TonalPlexus —
  //     their channels encode layout geometry, not keyboard splits)
  const scaleMode = (props.settings.midiin_mapping_target || "hex_layout") === "scale";
  const using2DMap =
    ctrl &&
    !tonalPlexus41Mode &&
    !ctrl.supportsSequentialChannelOffset &&
    !props.settings.midi_passthrough;
  // Channel Transposition is shown when sequential channel-offset arithmetic is meaningful:
  //   - not in active 2D geometry mode
  //   - not when MPE is on (channels carry per-voice expression, not splits)
  //   - not for single-channel known controllers (AXIS-49, TS41, Push, Launchpad, Exquis)
  //     — they only ever send on one channel so transposition has no effect
  //   - shown for unknown controllers (may be a multichannel keyboard split)
  //   - shown for multichannel non-MPE controllers in sequential/bypass mode (Lumatone)
  //   - hidden in scale mode (pitch is mapped directly; geometry/channel layout irrelevant)
  const isMultiChannelSequential =
    !ctrl || ctrl.multiChannel || ctrl.supportsSequentialChannelOffset;
  const isLinnstrument = ctrl?.id === "linnstrument";
  const isHakenContinuum = ctrl?.id === "hakenaudio";
  const linnstrumentUserFirmwareEligible = isLinnstrumentUserFirmwareEligible({
    controllerId: ctrl?.id ?? null,
    scaleMode,
    midiPassthrough: !!props.settings.midi_passthrough,
    midiinDevice: props.settings.midiin_device,
  });
  const linnstrumentChannelAllocation = isLinnstrument
    ? (props.settings.linnstrument_channel_allocation ||
      (props.settings.midiin_mpe_input
        ? "channel_per_note"
        : "single_channel"))
    : null;
  const showChannelTransposeLinnstrumentOverride =
    isLinnstrument && linnstrumentChannelAllocation === "channel_per_row";
  const showChannelTranspose =
    !scaleMode &&
    !using2DMap &&
    !props.settings.midiin_mpe_input &&
    isMultiChannelSequential &&
    (!isLinnstrument || showChannelTransposeLinnstrumentOverride || stepsMode !== "none");
  const linnstrumentUserFirmwareActiveUi = linnstrumentUserFirmwareEligible;
  const showMpeInputControls = !isLinnstrument && (!ctrl || ctrl.mpe);
  const mpeInputPrefsController = ctrl;
  const linnstrumentBypassNonMpeUi =
    isLinnstrument &&
    !scaleMode &&
    !linnstrumentUserFirmwareActiveUi &&
    linnstrumentChannelAllocation !== "channel_per_note";
  const linnstrumentBypassMpeUi =
    isLinnstrument &&
    !scaleMode &&
    !linnstrumentUserFirmwareActiveUi &&
    linnstrumentChannelAllocation === "channel_per_note";
  const showLegacyChannelWrap = !tonalPlexus41Mode && ctrl?.id !== "linnstrument";
  const linnstrumentPitchBendMode = props.settings.linnstrument_pitch_bend_mode || "off";
  const linnstrumentPitchBendShape = props.settings.linnstrument_pitch_bend_shape ?? 60;
  const linnstrumentXSpikeReduction = props.settings.linnstrument_x_spike_reduction ?? 25;
  const linnstrumentXInputSmoothing = props.settings.linnstrument_x_input_smoothing ?? 80;
  const showExquisBendControls = !(ctrl?.id === "exquis" && !props.settings.midiin_mpe_input);
  const showWheelToRecent = !(ctrl?.id === "exquis" && !props.settings.midiin_mpe_input) && !isLinnstrument;
  const showHakenContinuumUi = isHakenContinuum;
  const genericBypassesGeometry = ctrl?.id === "generic";
  const mpeMemberChannelBounds = ctrl?.mpeMemberChannelBounds ?? null;
  const configurableMpeMemberChannelBounds = ctrl?.mpeVoiceChannels
    ? null
    : (mpeMemberChannelBounds ?? {
      min: 2,
      max: 16,
      defaultLo: 2,
      defaultHi: 8,
    });
  const configurableMpeMemberChannels = configurableMpeMemberChannelBounds
    ? Array.from(
      {
        length:
          configurableMpeMemberChannelBounds.max - configurableMpeMemberChannelBounds.min + 1,
      },
      (_, i) => i + configurableMpeMemberChannelBounds.min,
    )
    : [];
  const configurableMpeDefaultLo = configurableMpeMemberChannelBounds?.defaultLo ?? 2;
  const configurableMpeDefaultHi = configurableMpeMemberChannelBounds?.defaultHi ?? 8;
  const autoDetectStatus = !autoDetectActive
    ? null
    : connectedDevice
      ? detectedController
        ? `Detected: ${detectedController.name}`
        : "No known geometry detected"
      : "Waiting for MIDI input";
  const LINN_BEND_RANGE_SINGLE_DEFAULT = "1/1";
  const LINN_BEND_RANGE_MULTI_DEFAULT = "28/27";
  const seedLinnstrumentBendRange = (target) => {
    const current = props.settings.midiin_bend_range;
    if (target === LINN_BEND_RANGE_SINGLE_DEFAULT) {
      if (!current || current === LINN_BEND_RANGE_MULTI_DEFAULT) {
        props.onChange("midiin_bend_range", LINN_BEND_RANGE_SINGLE_DEFAULT);
        saveControllerPref(null, "midiin_bend_range", LINN_BEND_RANGE_SINGLE_DEFAULT);
      }
      return;
    }
    if (!current || current === LINN_BEND_RANGE_SINGLE_DEFAULT) {
      props.onChange("midiin_bend_range", LINN_BEND_RANGE_MULTI_DEFAULT);
      saveControllerPref(null, "midiin_bend_range", LINN_BEND_RANGE_MULTI_DEFAULT);
    }
  };
  const applyLinnstrumentMpeDefaults = () => {
    const currentLo = props.settings.midiin_mpe_lo_ch;
    const currentHi = props.settings.midiin_mpe_hi_ch;
    const currentManager = props.settings.midiin_mpe_manager_ch;
    if (!Number.isFinite(currentLo)) {
      props.onChange("midiin_mpe_lo_ch", 2);
      sessionStorage.setItem("midiin_mpe_lo_ch", "2");
    }
    if (!Number.isFinite(currentHi) || currentHi === 15) {
      props.onChange("midiin_mpe_hi_ch", 8);
      sessionStorage.setItem("midiin_mpe_hi_ch", "8");
    }
    if (!currentManager) {
      props.onChange("midiin_mpe_manager_ch", "1");
      sessionStorage.setItem("midiin_mpe_manager_ch", "1");
    }
    seedLinnstrumentBendRange(LINN_BEND_RANGE_MULTI_DEFAULT);
  };
  const applyLinnstrumentBypassNonMpeDefaults = () => {
    props.onChange("midiin_steps_per_channel", 0);
    sessionStorage.setItem("midiin_steps_per_channel", "0");
    props.onChange("midiin_channel_legacy", false);
    sessionStorage.setItem("midiin_channel_legacy", "false");
    props.onChange("wheel_to_recent", false);
    sessionStorage.setItem("wheel_to_recent", "false");
    seedLinnstrumentBendRange(LINN_BEND_RANGE_SINGLE_DEFAULT);
  };
  const applyLinnstrumentBypassRowDefaults = () => {
    props.onChange("midiin_steps_per_channel", 0);
    sessionStorage.setItem("midiin_steps_per_channel", "0");
    props.onChange("midiin_channel_legacy", false);
    sessionStorage.setItem("midiin_channel_legacy", "false");
    props.onChange("wheel_to_recent", false);
    sessionStorage.setItem("wheel_to_recent", "false");
    if (!Number.isFinite(props.settings.midiin_anchor_channel)) {
      props.onChange("midiin_anchor_channel", 1);
      sessionStorage.setItem("midiin_anchor_channel", "1");
    }
    seedLinnstrumentBendRange(LINN_BEND_RANGE_MULTI_DEFAULT);
  };
  const applyConfigurableMpeDefaults = () => {
    const currentLo = props.settings.midiin_mpe_lo_ch;
    const currentHi = props.settings.midiin_mpe_hi_ch;
    const currentManager = props.settings.midiin_mpe_manager_ch;
    const shouldSeedGenericHi =
      !mpeMemberChannelBounds &&
      (currentHi === undefined || currentHi === null || currentHi === 15);
    if (!Number.isFinite(currentLo)) {
      props.onChange("midiin_mpe_lo_ch", configurableMpeDefaultLo);
      sessionStorage.setItem("midiin_mpe_lo_ch", String(configurableMpeDefaultLo));
    }
    if (!Number.isFinite(currentHi) || shouldSeedGenericHi) {
      props.onChange("midiin_mpe_hi_ch", configurableMpeDefaultHi);
      sessionStorage.setItem("midiin_mpe_hi_ch", String(configurableMpeDefaultHi));
    }
    if (!currentManager) {
      props.onChange("midiin_mpe_manager_ch", "1");
      sessionStorage.setItem("midiin_mpe_manager_ch", "1");
    }
  };
  const onLinnstrumentChannelAllocationChange = (nextMode) => {
    const mpeEnabled = nextMode === "channel_per_note";
    props.onChange("linnstrument_channel_allocation", nextMode);
    saveControllerPref(
      ctrl,
      "linnstrument_channel_allocation",
      nextMode,
      props.settings,
      { linnstrument_channel_allocation: nextMode },
    );
    props.onChange("midiin_mpe_input", mpeEnabled);
    saveControllerPref(
      mpeInputPrefsController,
      "midiin_mpe_input",
      mpeEnabled,
      props.settings,
      { midiin_mpe_input: mpeEnabled },
    );
    if (nextMode === "single_channel") {
      applyLinnstrumentBypassNonMpeDefaults();
      return;
    }
    if (nextMode === "channel_per_row") {
      applyLinnstrumentBypassRowDefaults();
      return;
    }
    applyLinnstrumentMpeDefaults();
  };

  // mpeSetupOpen removed — MPE options are shown flat when MPE is enabled.

  // Exquis dev mode test panel state
  const [exquisDevOpen, setExquisDevOpen] = useState(false);
  const [devMaskBits, setDevMaskBits] = useState(0x01); // bitmask built from checkboxes
  const [devZone, setDevZone] = useState("100"); // button/encoder CC id (ch 16)
  const [devValue, setDevValue] = useState("127"); // value to send
  const [devPadId, setDevPadId] = useState("0"); // pad ID for CMD 04 color test (0–60)
  const hasBasicMidi = !!props.midi;
  const hasSysexMidi = props.midiAccess === "sysex";

  const deactivateLinnstrumentUserFirmwareNow = () => {
    deactivateLinnstrumentUserFirmware(
      props.linnstrumentRawPorts?.output ?? null,
      props.keysRef?.current ?? null,
    );
  };

  return (
    <fieldset>
      <legend>
        <b>MIDI Input</b>
      </legend>
      <GeneralInputSettings
        hasBasicMidi={hasBasicMidi}
        midi={props.midi}
        settings={props.settings}
        controller={ctrl}
        controllerOverrideId={controllerOverrideId}
        autoDetectStatus={autoDetectStatus}
        detectedController={detectedController}
        manualControllerOptions={MANUAL_CONTROLLER_OPTIONS}
        linnstrumentUserFirmwareEligible={linnstrumentUserFirmwareEligible}
        deactivateLinnstrumentUserFirmwareNow={deactivateLinnstrumentUserFirmwareNow}
        resolveControllerSelection={resolveControllerSelection}
        isLinnstrumentUserFirmwareEligible={isLinnstrumentUserFirmwareEligible}
        scaleMode={scaleMode}
        saveControllerPref={saveControllerPref}
        onChange={props.onChange}
      />

      {ctrl?.id === "tonalplexus" && (
        <TonalPlexusSettings
          value={getTonalPlexusInputMode(props.settings)}
          controller={ctrl}
          settings={props.settings}
          onChange={props.onChange}
          saveControllerPref={saveControllerPref}
        />
      )}

      {scaleMode && (
        <ScaleInputSettings
          settings={props.settings}
          onChange={props.onChange}
        />
      )}

      {props.settings.midiin_device && props.settings.midiin_device !== "OFF" && (
        <>
          {/* ── MPE / Poly-AT Input ─────────────────────────────────────────────
              Shown first — MPE mode changes the meaning of all controls below it.
              Shown for MPE-capable controllers and unknown controllers.
              See claude-context/midi-input-ux.md for the full visibility spec. */}
          {showMpeInputControls && (
            <>
              <label>
                Enable MPE Input
                <input
                  name="midiin_mpe_input"
                  type="checkbox"
                  checked={!!props.settings.midiin_mpe_input}
                  onChange={(e) => {
                    props.onChange("midiin_mpe_input", e.target.checked);
                    if (
                      e.target.checked &&
                      !linnstrumentBypassMpeUi &&
                      !ctrl?.mpeVoiceChannels
                    ) {
                      applyConfigurableMpeDefaults();
                    }
                    if (
                      ctrl?.id === "linnstrument" &&
                      props.settings.midi_passthrough &&
                      e.target.checked
                    ) {
                      applyLinnstrumentMpeDefaults();
                    }
                    if (
                      ctrl?.id === "linnstrument" &&
                      props.settings.midi_passthrough &&
                      !e.target.checked
                    ) {
                      applyLinnstrumentBypassNonMpeDefaults();
                    }
                    saveControllerPref(
                      mpeInputPrefsController,
                      "midiin_mpe_input",
                      e.target.checked,
                      props.settings,
                      { midiin_mpe_input: e.target.checked },
                    );
                  }}
                />
              </label>

              {linnstrumentBypassMpeUi && (
                <MpeInputSettings
                  settings={props.settings}
                  memberChannels={Array.from({ length: 15 }, (_, i) => i + 2)}
                  defaultLo={2}
                  defaultHi={8}
                  onChange={props.onChange}
                />
              )}

              {props.settings.midiin_mpe_input &&
                !linnstrumentBypassMpeUi &&
                !!configurableMpeMemberChannelBounds && (
                <MpeInputSettings
                  settings={props.settings}
                  memberChannels={configurableMpeMemberChannels}
                  defaultLo={configurableMpeDefaultLo}
                  defaultHi={configurableMpeDefaultHi}
                  onChange={props.onChange}
                />
              )}
              {/* MPE currently listens on all channels; range display is informational. */}
              {props.settings.midiin_mpe_input &&
                !linnstrumentBypassMpeUi &&
                !ctrl?.mpeVoiceChannels &&
                !configurableMpeMemberChannelBounds && (
                <label title="Hexatone currently accepts MPE voice data on all channels.">
                  Voice channels
                  <span class="sidebar-input" style={{ color: "#888", fontStyle: "italic" }}>
                    all channels
                  </span>
                </label>
              )}
              {props.settings.midiin_mpe_input && !linnstrumentBypassMpeUi && ctrl?.mpeVoiceChannels && (
                <label title="Controller range is informational; Hexatone currently accepts MPE voice data on all channels.">
                  Voice channels
                  <span class="sidebar-input" style={{ color: "#888", fontStyle: "italic" }}>
                    {ctrl.mpeVoiceChannels.lo}–{ctrl.mpeVoiceChannels.hi} typical; listening on all
                  </span>
                </label>
              )}
            </>
          )}

          {/* ── Controller description in scale mode ── */}
          {scaleMode && ctrl?.descriptionScale && (
            <label style={{ fontStyle: "italic", color: "#996666", marginBottom: "0.5em" }}>
              {ctrl.name}
              <span
                class="sidebar-input"
                style={{ textAlign: "right", fontSize: "0.85em", lineHeight: 1 }}
              >
                {ctrl.descriptionScale}
              </span>
            </label>
          )}
          {/* ── Known 2D controller / sequential anchor ── hidden in scale mode */}
          {!scaleMode &&
            (ctrl ? (
              ctrl?.id === "generic" ? (
                <GenericKeyboardSettings
                  controllerName={ctrl.name}
                  controllerDescription={ctrl.description}
                  centerDegree={center_degree}
                  centralNote={centralNote}
                  centralDegreeSetting={props.settings.midiin_anchor_note}
                  midiLearnActive={props.midiLearnActive}
                  onChange={props.onChange}
                />
              ) : (
                <>
                <label style={{ fontStyle: "italic", color: "#996666", marginBottom: "0.5em" }}>
                  {ctrl.name}
                  <span
                    class="sidebar-input"
                    style={{ textAlign: "right", fontSize: "0.85em", lineHeight: 1 }}
                  >
                    {ctrl.description}
                  </span>
                </label>
                {/* Anchor: the physical key whose MIDI note (and channel, for multi-channel
                  controllers like Lumatone) maps to the central screen degree.
                  Used in both 2D-map mode and bypass mode. */}
                <label class="center-degree-row center-degree-label">
                  Anchor Key → Central Degree ({center_degree})
                  <span
                    class="sidebar-input"
                    style={{ display: "flex", gap: "4px", alignItems: "center", textAlign: "left" }}
                  >
                    <button
                      type="button"
                      class="preset-action-btn"
                      onClick={() => props.onChange("midiLearnAnchor", !props.midiLearnActive)}
                      disabled={tonalPlexus205Mode}
                      style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                    >
                      {tonalPlexus205Mode
                        ? "Fixed"
                        : props.midiLearnActive
                          ? "● Listening…"
                          : "Learn"}
                    </button>
                    {/* Channel field — shown for all known controllers except MPE ones in MPE
                      mode (channels are per-voice, not layout-encoding in that case).
                      Editable for multi-channel controllers (e.g. Lumatone);
                      greyed-out fixed "1" for single-channel controllers (e.g. AXIS-49). */}
                    {ctrl && !linnstrumentBypassMpeUi && !(ctrl.mpe && props.settings.midiin_mpe_input) &&
                      (ctrl.anchorChannelDefault != null ? (
                        <input
                        name="midiin_anchor_channel"
                          type="text"
                          inputMode="numeric"
                          title={`${tonalPlexus41Mode ? "Block" : "MIDI channel"} of anchor key (${anchorChannelRange.min}–${anchorChannelRange.max})`}
                          style={{
                            width: "2.2em",
                            textAlign: "center",
                            height: "1.5em",
                            boxSizing: "border-box",
                            background: tonalPlexus205Mode ? "#f0eded" : "#faf9f8",
                            border: "1px solid #c8b8b8",
                            borderRadius: "3px",
                            flexShrink: 0,
                            color: tonalPlexus205Mode ? "#999" : undefined,
                            cursor: tonalPlexus205Mode ? "default" : undefined,
                          }}
                          key={`anchor-channel-${anchorChannel}`}
                          defaultValue={anchorChannel}
                          disabled={tonalPlexus205Mode}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.target.blur();
                          }}
                          onBlur={(e) => {
                            const val = parseInt(e.target.value);
                            if (
                              !isNaN(val) &&
                              val >= anchorChannelRange.min &&
                              val <= anchorChannelRange.max
                            ) {
                              props.onChange("midiin_anchor_channel", val);
                              sessionStorage.setItem("midiin_anchor_channel", val);
                            } else {
                              e.target.value = anchorChannel;
                            }
                          }}
                        />
                      ) : (
                        <input
                          type="text"
                          value="1"
                          disabled
                          title="Single-channel controller (ch 1)"
                          style={{
                            width: "2.2em",
                            textAlign: "center",
                            height: "1.5em",
                            boxSizing: "border-box",
                            background: "#f0eded",
                            border: "1px solid #c8b8b8",
                            borderRadius: "3px",
                            flexShrink: 0,
                            color: "#999",
                            cursor: "default",
                          }}
                        />
                      ))}
                    {/* Multi-channel 2D controllers interpret the shared anchor
                      note within their local note range. Single-channel /
                      sequential path uses the same midiin_anchor_note field
                      across the full 0–127 range. */}
                    {ctrl?.multiChannel ? (
                      <input
                        name="midiin_anchor_note"
                        type="text"
                        inputMode="numeric"
                        title={`${tonalPlexus41Mode ? "Slot" : "Note number"} within anchor ${tonalPlexus41Mode ? "block" : "block"} (${anchorNoteRange.min}–${anchorNoteRange.max})`}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          width: "auto",
                          textAlign: "right",
                          height: "1.5em",
                          boxSizing: "border-box",
                          background: tonalPlexus205Mode ? "#f0eded" : "#faf9f8",
                          border: "1px solid #c8b8b8",
                          borderRadius: "3px",
                          color: tonalPlexus205Mode ? "#999" : undefined,
                          cursor: tonalPlexus205Mode ? "default" : undefined,
                        }}
                        key={`anchor-note-${controllerAnchorNote}`}
                        defaultValue={controllerAnchorNote}
                        disabled={tonalPlexus205Mode}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.target.blur();
                        }}
                        onBlur={(e) => {
                          const val = parseInt(e.target.value);
                          if (
                            !isNaN(val) &&
                            val >= anchorNoteRange.min &&
                            val <= anchorNoteRange.max
                          ) {
                            props.onChange("midiin_anchor_note", val);
                            sessionStorage.setItem("midiin_anchor_note", String(val));
                          } else {
                            e.target.value = controllerAnchorNote;
                          }
                        }}
                      />
                    ) : (
                      <input
                        name="midiin_anchor_note"
                        type="text"
                        inputMode="numeric"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          width: "auto",
                          textAlign: "right",
                          height: "1.5em",
                          boxSizing: "border-box",
                          background: "#faf9f8",
                          border: "1px solid #c8b8b8",
                          borderRadius: "3px",
                        }}
                        key={`central-degree-${props.settings.midiin_anchor_note}`}
                        defaultValue={centralNote}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.target.blur();
                        }}
                        onBlur={(e) => {
                          const val = parseInt(e.target.value);
                          if (!isNaN(val) && val >= 0 && val <= 127) {
                            props.onChange("midiin_anchor_note", val);
                            sessionStorage.setItem("midiin_anchor_note", val);
                          } else {
                            e.target.value = centralNote;
                          }
                        }}
                      />
                    )}
                  </span>
                </label>
                {genericBypassesGeometry ? (
                  <label>
                    2D Geometry
                    <span class="sidebar-input" style={{ color: "#888", fontStyle: "italic" }}>
                      2D geometry is bypassed
                    </span>
                  </label>
                ) : tonalPlexus41Mode ? (
                  <label>
                    2D Geometry
                    <span class="sidebar-input" style={{ color: "#888", fontStyle: "italic" }}>
                      41 notes per block mode uses grouped block-slot translation
                    </span>
                  </label>
                ) : (
                  <label>
                    Sequential mode (bypass 2D geometry)
                    <input
                      name="midi_passthrough"
                      type="checkbox"
                      checked={!!props.settings.midi_passthrough}
                      onChange={(e) => {
                        if (linnstrumentUserFirmwareEligible && e.target.checked) {
                          deactivateLinnstrumentUserFirmwareNow();
                        }
                        if (ctrl?.id === "linnstrument" && e.target.checked && !props.settings.midiin_mpe_input) {
                          applyLinnstrumentBypassNonMpeDefaults();
                        }
                        if (ctrl?.id === "linnstrument" && e.target.checked && props.settings.midiin_mpe_input) {
                          applyLinnstrumentMpeDefaults();
                        }
                        props.onChange("midi_passthrough", e.target.checked);
                        sessionStorage.setItem("midi_passthrough", e.target.checked);
                        saveControllerPref(
                          ctrl,
                          "midi_passthrough",
                          e.target.checked,
                          props.settings,
                          { midi_passthrough: e.target.checked },
                        );
                      }}
                    />
                  </label>
                )}

                {isLinnstrument && (
                  <LinnstrumentSettings
                    ctrl={ctrl}
                    settings={props.settings}
                    scaleMode={scaleMode}
                    userFirmwareEligible={linnstrumentUserFirmwareEligible}
                    userFirmwareActiveUi={linnstrumentUserFirmwareActiveUi}
                    channelAllocation={linnstrumentChannelAllocation}
                    rawPorts={props.linnstrumentRawPorts}
                    midiOutputs={props.midi?.outputs}
                    keysRef={props.keysRef}
                    onChange={props.onChange}
                    onChannelAllocationChange={onLinnstrumentChannelAllocationChange}
                    saveControllerPref={saveControllerPref}
                    pitchBendMode={linnstrumentPitchBendMode}
                    pitchBendShape={linnstrumentPitchBendShape}
                    xSpikeReduction={linnstrumentXSpikeReduction}
                    xInputSmoothing={linnstrumentXInputSmoothing}
                    showStatusBlock={true}
                  />
                )}

                {ctrl?.id === "lumatone" && (
                  <LumatoneSettings
                    settings={props.settings}
                    rawPorts={props.lumatoneRawPorts}
                    midiOutputs={props.midi?.outputs}
                    keysRef={props.keysRef}
                    hasSysexMidi={hasSysexMidi}
                    onChange={props.onChange}
                  />
                )}

                {ctrl?.id === "exquis" && !scaleMode && (
                  <ExquisSettings
                    settings={props.settings}
                    rawPorts={props.exquisRawPorts}
                    ledStatus={props.exquisLedStatus}
                    midiOutputs={props.midi?.outputs}
                    keysRef={props.keysRef}
                    hasSysexMidi={hasSysexMidi}
                    onChange={props.onChange}
                  />
                )}

                {/* ── Exquis Dev Mode test panel ── disabled: dev mode takes over pads,
                  leaving only note-on ch16 (no MPE expression). Left here for future
                  firmware update that may expose LED control without dev mode takeover. */}
                {false && ctrl?.id === "exquis" && props.exquisRawPorts && (
                  <>
                    <label
                      style={{ marginTop: "0.6em", cursor: "pointer", userSelect: "none" }}
                      onClick={() => setExquisDevOpen((o) => !o)}
                    >
                      {exquisDevOpen ? "▾" : "▸"} Dev Mode Test
                      <span class="sidebar-input" />
                    </label>

                    {exquisDevOpen &&
                      (() => {
                        const out = props.exquisRawPorts.output;
                        const DUALO = [0xf0, 0x00, 0x21, 0x7e, 0x7f];
                        return (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "4px",
                              marginTop: "2px",
                            }}
                          >
                            {/* Enter / Exit dev mode — zone bitmask via checkboxes */}
                            {[
                              { bit: 0x01, label: "Pads" },
                              { bit: 0x02, label: "Encoders" },
                              { bit: 0x04, label: "Slider" },
                              { bit: 0x08, label: "Up/Down buttons" },
                              { bit: 0x10, label: "Settings/Sound buttons" },
                              { bit: 0x20, label: "All other buttons" },
                            ].map(({ bit, label }) => (
                              <label key={bit}>
                                {label}
                                <input
                                  type="checkbox"
                                  checked={!!(devMaskBits & bit)}
                                  onChange={(e) =>
                                    setDevMaskBits((b) => (e.target.checked ? b | bit : b & ~bit))
                                  }
                                />
                              </label>
                            ))}
                            <label>
                              Dev mode (mask:{" "}
                              {devMaskBits.toString(16).toUpperCase().padStart(2, "0")})
                              <span
                                class="sidebar-input"
                                style={{ display: "flex", gap: "4px", justifyContent: "flex-end" }}
                              >
                                <button
                                  type="button"
                                  style={{ fontSize: "0.85em" }}
                                  onClick={() => out.send([...DUALO, 0x00, devMaskBits, 0xf7])}
                                >
                                  Enter
                                </button>
                                <button
                                  type="button"
                                  style={{ fontSize: "0.85em" }}
                                  onClick={() => out.send([...DUALO, 0x00, 0x00, 0xf7])}
                                >
                                  Exit
                                </button>
                              </span>
                            </label>

                            {/* CMD 04 — direct RGB (in dev mode) */}
                            <label
                              style={{ marginTop: "0.4em" }}
                              title="CMD 04: set pad color directly. Device must be in dev mode."
                            >
                              Pad color test
                              <span
                                class="sidebar-input"
                                style={{
                                  display: "flex",
                                  gap: "4px",
                                  alignItems: "center",
                                  justifyContent: "flex-end",
                                }}
                              >
                                <span style={{ fontSize: "0.85em", color: "#666" }}>pad</span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={devPadId}
                                  onChange={(e) => setDevPadId(e.target.value)}
                                  style={{
                                    width: "2.5em",
                                    textAlign: "center",
                                    height: "1.5em",
                                    boxSizing: "border-box",
                                    background: "#faf9f8",
                                    border: "1px solid #c8b8b8",
                                    borderRadius: "3px",
                                  }}
                                />
                                <button
                                  type="button"
                                  style={{
                                    fontSize: "0.85em",
                                    background: "#c00",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: "3px",
                                    padding: "0 6px",
                                    cursor: "pointer",
                                  }}
                                  onClick={() => {
                                    const id = parseInt(devPadId);
                                    if (isNaN(id) || id < 0 || id > 60) return;
                                    out.send([...DUALO, 0x04, id, 127, 0, 0, 0x00, 0xf7]);
                                  }}
                                >
                                  Red
                                </button>
                                <button
                                  type="button"
                                  style={{ fontSize: "0.85em" }}
                                  onClick={() => {
                                    const payload = [...DUALO, 0x04, 0x00];
                                    for (let i = 0; i < 61; i++) payload.push(127, 0, 0, 0x00);
                                    payload.push(0xf7);
                                    out.send(payload);
                                  }}
                                >
                                  All red
                                </button>
                              </span>
                            </label>

                            {/* CMD 02 — palette write + CC ch16 trigger (outside dev mode) */}
                            <label
                              style={{ marginTop: "0.4em" }}
                              title="CMD 02: write bright red into palette slot 0, then trigger it via CC ch16. Tests whether palette colors work outside dev mode."
                            >
                              Palette test
                              <span
                                class="sidebar-input"
                                style={{
                                  display: "flex",
                                  gap: "4px",
                                  alignItems: "center",
                                  justifyContent: "flex-end",
                                }}
                              >
                                <span style={{ fontSize: "0.85em", color: "#666" }}>pad</span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={devPadId}
                                  onChange={(e) => setDevPadId(e.target.value)}
                                  style={{
                                    width: "2.5em",
                                    textAlign: "center",
                                    height: "1.5em",
                                    boxSizing: "border-box",
                                    background: "#faf9f8",
                                    border: "1px solid #c8b8b8",
                                    borderRadius: "3px",
                                  }}
                                />
                                <button
                                  type="button"
                                  style={{ fontSize: "0.85em" }}
                                  title="Write red into palette slot 0 via CMD 02 (works in or out of dev mode)"
                                  onClick={() => {
                                    // CMD 02: write 1 color at index 0 — bright red (127, 0, 0)
                                    out.send([...DUALO, 0x02, 0x00, 127, 0, 0, 0xf7]);
                                  }}
                                >
                                  Write palette
                                </button>
                                <button
                                  type="button"
                                  style={{ fontSize: "0.85em" }}
                                  title="Trigger palette slot 0 on this pad via CC ch16 (BF pad 0x00)"
                                  onClick={() => {
                                    const id = parseInt(devPadId);
                                    if (isNaN(id) || id < 0 || id > 60) return;
                                    // BF = CC on ch 16; id = pad/control ID; value = palette index
                                    out.send([0xbf, id & 0x7f, 0x00]);
                                  }}
                                >
                                  Trigger CC
                                </button>
                              </span>
                            </label>

                            {/* Send CC on ch 16 — button/encoder raw test */}
                            <label style={{ marginTop: "0.3em" }}>
                              Ch 16 CC id
                              <span
                                class="sidebar-input"
                                style={{
                                  display: "flex",
                                  gap: "4px",
                                  alignItems: "center",
                                  justifyContent: "flex-end",
                                }}
                              >
                                <select
                                  value={devZone}
                                  onChange={(e) => setDevZone(e.target.value)}
                                  style={{
                                    height: "1.5em",
                                    fontSize: "0.9em",
                                    background: "#faf9f8",
                                    border: "1px solid #c8b8b8",
                                    borderRadius: "3px",
                                  }}
                                >
                                  <optgroup label="Settings buttons">
                                    <option value="100">100 — Settings (1)</option>
                                    <option value="101">101 — Sound / Settings (2)</option>
                                  </optgroup>
                                  <optgroup label="Transport buttons">
                                    <option value="102">102 — Record</option>
                                    <option value="103">103 — Loop</option>
                                    <option value="104">104 — Clips</option>
                                    <option value="105">105 — Play/Stop</option>
                                    <option value="106">106 — Down</option>
                                    <option value="107">107 — Up</option>
                                    <option value="108">108 — Undo</option>
                                    <option value="109">109 — Redo</option>
                                  </optgroup>
                                  <optgroup label="Encoders (turn: value = 64+delta)">
                                    <option value="110">110 — Encoder 1</option>
                                    <option value="111">111 — Encoder 2</option>
                                    <option value="112">112 — Encoder 3</option>
                                    <option value="113">113 — Encoder 4</option>
                                  </optgroup>
                                </select>
                              </span>
                            </label>
                            <label title="7F=press/on, 00=release/off; encoder turn: 65=+1 CW, 63=-1 CCW">
                              Value
                              <span
                                class="sidebar-input"
                                style={{
                                  display: "flex",
                                  gap: "4px",
                                  alignItems: "center",
                                  justifyContent: "flex-end",
                                }}
                              >
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={devValue}
                                  onChange={(e) => setDevValue(e.target.value)}
                                  style={{
                                    width: "3em",
                                    textAlign: "center",
                                    height: "1.5em",
                                    boxSizing: "border-box",
                                    background: "#faf9f8",
                                    border: "1px solid #c8b8b8",
                                    borderRadius: "3px",
                                  }}
                                />
                                <button
                                  type="button"
                                  style={{ fontSize: "0.85em" }}
                                  onClick={() => {
                                    const cc = parseInt(devZone);
                                    const val = parseInt(devValue);
                                    if (isNaN(cc) || isNaN(val)) return;
                                    out.send([0xbf, cc & 0x7f, val & 0x7f]);
                                  }}
                                >
                                  CC
                                </button>
                                <button
                                  type="button"
                                  style={{ fontSize: "0.85em" }}
                                  onClick={() => {
                                    const note = parseInt(devZone);
                                    const vel = parseInt(devValue);
                                    if (isNaN(note) || isNaN(vel)) return;
                                    out.send([0x9f, note & 0x7f, vel & 0x7f]);
                                  }}
                                >
                                  Note
                                </button>
                              </span>
                            </label>
                          </div>
                        );
                      })()}
                  </>
                )}

                </>
              )
            ) : (
              /* ── Unknown / sequential controller ── */
              <>
                <label class="center-degree-row center-degree-label">
                  Anchor Note → Central Degree ({center_degree})
                  <span
                    class="sidebar-input"
                    style={{ display: "flex", gap: "4px", alignItems: "center", textAlign: "left" }}
                  >
                    <button
                      type="button"
                      class="preset-action-btn"
                      onClick={() => props.onChange("midiLearnAnchor", !props.midiLearnActive)}
                      style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                    >
                      {props.midiLearnActive ? "● Listening…" : "Learn"}
                    </button>
                    {!props.settings.midiin_mpe_input && !linnstrumentBypassMpeUi && (
                      <input
                        name="midiin_anchor_channel"
                        type="text"
                        inputMode="numeric"
                        title="MIDI channel of anchor note (other channels shift by stepsPerChannel)"
                        style={{
                          width: "2.2em",
                          textAlign: "center",
                          height: "1.5em",
                          boxSizing: "border-box",
                          background: "#faf9f8",
                          border: "1px solid #c8b8b8",
                          borderRadius: "3px",
                          flexShrink: 0,
                        }}
                        key={`seq-anchor-channel-${seqAnchorChannel}`}
                        defaultValue={seqAnchorChannel}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.target.blur();
                        }}
                        onBlur={(e) => {
                          const val = parseInt(e.target.value);
                          if (!isNaN(val) && val >= 1 && val <= 16) {
                            props.onChange("midiin_anchor_channel", val);
                            sessionStorage.setItem("midiin_anchor_channel", val);
                          } else {
                            e.target.value = seqAnchorChannel;
                          }
                        }}
                      />
                    )}
                    <input
                      name="midiin_anchor_note"
                      type="text"
                      inputMode="numeric"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        width: "auto",
                        textAlign: "right",
                        height: "1.5em",
                        boxSizing: "border-box",
                        background: "#faf9f8",
                        border: "1px solid #c8b8b8",
                        borderRadius: "3px",
                      }}
                      key={`seq-central-degree-${props.settings.midiin_anchor_note}`}
                      defaultValue={centralNote}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.target.blur();
                      }}
                      onBlur={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val) && val >= 0 && val <= 127) {
                          props.onChange("midiin_anchor_note", val);
                          sessionStorage.setItem("midiin_anchor_note", val);
                        } else {
                          e.target.value = centralNote;
                        }
                      }}
                    />
                  </span>
                </label>
                {!props.settings.midiin_mpe_input && showWheelToRecent && (
                  <label>
                    Pitch Wheel → Most Recent Note
                    <input
                      name="wheel_to_recent"
                      type="checkbox"
                      checked={!!props.settings.wheel_to_recent}
                      onChange={(e) => {
                        props.onChange("wheel_to_recent", e.target.checked);
                        sessionStorage.setItem("wheel_to_recent", e.target.checked);
                      }}
                    />
                  </label>
                )}
              </>
            ))}

          {isLinnstrument && (
            <LinnstrumentSettings
              ctrl={ctrl}
              settings={props.settings}
              scaleMode={scaleMode}
              userFirmwareEligible={linnstrumentUserFirmwareEligible}
              userFirmwareActiveUi={linnstrumentUserFirmwareActiveUi}
              channelAllocation={linnstrumentChannelAllocation}
              rawPorts={props.linnstrumentRawPorts}
              midiOutputs={props.midi?.outputs}
              keysRef={props.keysRef}
              onChange={props.onChange}
              onChannelAllocationChange={onLinnstrumentChannelAllocationChange}
              saveControllerPref={saveControllerPref}
              pitchBendMode={linnstrumentPitchBendMode}
              pitchBendShape={linnstrumentPitchBendShape}
              xSpikeReduction={linnstrumentXSpikeReduction}
              xInputSmoothing={linnstrumentXInputSmoothing}
              showModeBlock={true}
            />
          )}

          {/* ── Channel Transposition — sequential single-channel path only.
              Hidden for active 2D geometry mode AND for multichannel controllers
              (Lumatone, LinnStrument, TonalPlexus — channels encode layout, not splits). */}
          {showChannelTranspose && (
            <>
              <label>
                {tonalPlexus41Mode ? "Block Transposition" : "Channel Transposition"}
                <select
                  class="sidebar-input"
                  value={stepsMode}
                  onChange={(e) => setStepsMode(e.target.value)}
                >
                  <option value="equave">
                    {tonalPlexus41Mode
                      ? `Blocks → equaves (${props.settings.equivSteps ?? "…"} steps each)`
                      : `Channels → equaves (${props.settings.equivSteps ?? "…"} steps each)`}
                  </option>
                  <option value="none">No transposition</option>
                  <option value="custom">Custom…</option>
                </select>
              </label>
              {stepsMode === "custom" && (
                <label>
                  {tonalPlexus41Mode ? "Degrees per block" : "Degrees per channel"}
                  <input
                    type="text"
                    inputMode="numeric"
                    class="sidebar-input"
                    key={`steps-per-channel-${props.settings.midiin_steps_per_channel ?? ""}`}
                    defaultValue={props.settings.midiin_steps_per_channel ?? ""}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.target.blur();
                    }}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value.trim());
                      if (!isNaN(val) && val >= 1) {
                        props.onChange("midiin_steps_per_channel", val);
                        sessionStorage.setItem("midiin_steps_per_channel", String(val));
                      } else {
                        e.target.value = props.settings.midiin_steps_per_channel ?? "";
                      }
                    }}
                  />
                </label>
              )}
              {showLegacyChannelWrap && (
                <label title="Wrap channels 9–16 to 1–8 before computing transposition offset. Enable for Lumatone mappings that use channels 9–13.">
                  Channels mod 8 (legacy)
                  <input
                    name="midiin_channel_legacy"
                    type="checkbox"
                    checked={!!props.settings.midiin_channel_legacy}
                    onChange={(e) => {
                      props.onChange("midiin_channel_legacy", e.target.checked);
                      sessionStorage.setItem("midiin_channel_legacy", e.target.checked);
                    }}
                  />
                </label>
              )}
            </>
          )}

          {/* Pitch Wheel → Most Recent Note — shown only when MPE is off */}
          {ctrl && !props.settings.midiin_mpe_input && showWheelToRecent && (
            <label>
              Pitch Wheel → Most Recent Note
              <input
                name="wheel_to_recent"
                type="checkbox"
                checked={!!props.settings.wheel_to_recent}
                onChange={(e) => {
                  props.onChange("wheel_to_recent", e.target.checked);
                  sessionStorage.setItem("wheel_to_recent", e.target.checked);
                }}
              />
            </label>
          )}

          {/* ── Pitch Bending Interval ───────────────────────────────────────────
              Form A (Scala): LinnStrument, MPE on, or wheel-to-recent on.
                midiin_bend_range — ±full deflection maps to this interval.
                Set hardware to max range (e.g. Exquis encoder2=48) for resolution.
              Form B (12edo semitones): MPE off AND wheel-to-recent off AND not LinnStrument.
                midi_wheel_semitones — raw PB passthrough; sample synth retuned directly.
              See claude-context/midi-input-ux.md for full spec. */}
          {isLinnstrument && (
            <LinnstrumentSettings
              ctrl={ctrl}
              settings={props.settings}
              scaleMode={scaleMode}
              userFirmwareEligible={linnstrumentUserFirmwareEligible}
              userFirmwareActiveUi={linnstrumentUserFirmwareActiveUi}
              channelAllocation={linnstrumentChannelAllocation}
              rawPorts={props.linnstrumentRawPorts}
              midiOutputs={props.midi?.outputs}
              keysRef={props.keysRef}
              onChange={props.onChange}
              onChannelAllocationChange={onLinnstrumentChannelAllocationChange}
              saveControllerPref={saveControllerPref}
              pitchBendMode={linnstrumentPitchBendMode}
              pitchBendShape={linnstrumentPitchBendShape}
              xSpikeReduction={linnstrumentXSpikeReduction}
              xInputSmoothing={linnstrumentXInputSmoothing}
              showUserFirmwareBlock={true}
            />
          )}

          {showExquisBendControls && !showHakenContinuumUi &&
            (isLinnstrument ? (
              <LinnstrumentSettings
                ctrl={ctrl}
                settings={props.settings}
              scaleMode={scaleMode}
              userFirmwareEligible={linnstrumentUserFirmwareEligible}
              userFirmwareActiveUi={linnstrumentUserFirmwareActiveUi}
              channelAllocation={linnstrumentChannelAllocation}
              rawPorts={props.linnstrumentRawPorts}
                midiOutputs={props.midi?.outputs}
                keysRef={props.keysRef}
                onChange={props.onChange}
                onChannelAllocationChange={onLinnstrumentChannelAllocationChange}
                saveControllerPref={saveControllerPref}
                pitchBendMode={linnstrumentPitchBendMode}
                pitchBendShape={linnstrumentPitchBendShape}
                xSpikeReduction={linnstrumentXSpikeReduction}
                xInputSmoothing={linnstrumentXInputSmoothing}
                showPitchBlock={true}
              />
            ) : (props.settings.midiin_mpe_input || props.settings.wheel_to_recent ? (
              <label title="Pitch Bending Interval: the musical interval that ±full deflection maps to. Set hardware to max range for best resolution.">
                Pitch Bending Interval (Scala)
                <ScalaInput
                  context="interval"
                  value={props.settings.midiin_bend_range ?? "28/27"}
                  onChange={(str) => {
                    props.onChange("midiin_bend_range", str);
                    saveControllerPref(null, "midiin_bend_range", str);
                  }}
                  wrapperClass="sidebar-input"
                  style={{
                    width: "5em",
                    textAlign: "center",
                    height: "1.5em",
                    boxSizing: "border-box",
                    background: "#faf9f8",
                    borderRadius: "3px",
                  }}
                />
              </label>
            ) : (
              <label title="Standard wheel range in 12-edo semitones. Raw pitch bend passes through to all MIDI outputs; user adjusts range to match in their synth.">
                Pitch Bending Interval (12edo semitones)
                <input
                  type="number"
                  min="0"
                  max="24"
                  style={{ width: "3.5em" }}
                  value={props.settings.midi_wheel_semitones ?? 2}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value);
                    const v = Math.max(0, Math.min(24, isNaN(parsed) ? 2 : parsed));
                    props.onChange("midi_wheel_semitones", v);
                    sessionStorage.setItem("midi_wheel_semitones", v);
                  }}
                />
              </label>
            )))}

          {/* Reverse Bend Direction — hidden for LinnStrument User Firmware row-glide mode */}
          {showExquisBendControls && !showHakenContinuumUi && !linnstrumentUserFirmwareActiveUi && !linnstrumentBypassNonMpeUi && (
            <label title="Reverse pitch bend direction — useful when the controller surface is oriented so that sliding towards higher pitch sends negative bend values.">
              Reverse Bend Direction
              <input
                type="checkbox"
                checked={!!props.settings.midiin_bend_flip}
                onChange={(e) => {
                  props.onChange("midiin_bend_flip", e.target.checked);
                  saveControllerPref(ctrl, "midiin_bend_flip", e.target.checked, props.settings);
                }}
              />
            </label>
          )}

          {showHakenContinuumUi && (
            <HakenContinuumSettings
              ctrl={ctrl}
              settings={props.settings}
              scaleMode={scaleMode}
              onChange={props.onChange}
              saveControllerPref={saveControllerPref}
            />
          )}
        </>
      )}
    </fieldset>
  );
};

MIDIio.propTypes = {
  settings: PropTypes.shape({
    midiin_device: PropTypes.string,
    midiin_controller_override: PropTypes.string,
    midiin_anchor_note: PropTypes.number,
    midiin_steps_per_channel: PropTypes.number,
    midi_passthrough: PropTypes.bool,
    midiin_channel_legacy: PropTypes.bool,
    lumatone_led_sync: PropTypes.bool,
    lumatone_degree_filter_mode: PropTypes.string,
    lumatone_degree_filter: PropTypes.string,
    linnstrument_led_sync: PropTypes.bool,
    linnstrument_channel_allocation: PropTypes.string,
    linnstrument_pitch_bend_mode: PropTypes.string,
    linnstrument_pitch_bend_shape: PropTypes.number,
    linnstrument_x_spike_reduction: PropTypes.number,
    linnstrument_x_input_smoothing: PropTypes.number,
    wheel_to_recent: PropTypes.bool,
    midi_wheel_semitones: PropTypes.number,
    wheel_scale_aware: PropTypes.bool,
    midiin_mpe_input: PropTypes.bool,
    midiin_mpe_lo_ch: PropTypes.number,
    midiin_mpe_hi_ch: PropTypes.number,
    midiin_mpe_manager_ch: PropTypes.string,
    midiin_bend_range: PropTypes.string,
    midiin_bend_flip: PropTypes.bool,
    hakenaudio_x_glide_shaping: PropTypes.number,
    hakenaudio_x_glide_mode: PropTypes.string,
    hakenaudio_pressure_velocity: PropTypes.number,
    hakenaudio_note_off_delay: PropTypes.number,
    hakenaudio_raster_throttle_ms: PropTypes.number,
    hakenaudio_raster_stability: PropTypes.number,
    center_degree: PropTypes.number,
    equivSteps: PropTypes.number,
    name: PropTypes.string,
  }).isRequired,
  midi: PropTypes.object,
  midiAccess: PropTypes.string,
  midiAccessError: PropTypes.string,
  midiLearnActive: PropTypes.bool,
  lumatoneRawPorts: PropTypes.object,
  exquisRawPorts: PropTypes.object,
  linnstrumentRawPorts: PropTypes.object,
  keysRef: PropTypes.object,
  ensureMidiAccess: PropTypes.func,
  onChange: PropTypes.func.isRequired,
};

export default MIDIio;
