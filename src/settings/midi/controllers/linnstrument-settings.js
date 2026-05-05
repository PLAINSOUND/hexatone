import PropTypes from "prop-types";
import ScalaInput from "../../scale/scala-input.js";
import OutputPortPicker from "../output-port-picker.js";
import MpeInputSettings from "../mpe-input-settings.js";

function LinnUserFirmwareStatus({ active }) {
  return (
    <label class="controller-inline-row controller-status-row">
      User Firmware Mode
      <span
        class="sidebar-input controller-status-value"
        style={{
          color: active ? "#669966" : "#888",
        }}
      >
        {active ? "active" : "disabled"}
      </span>
    </label>
  );
}

LinnUserFirmwareStatus.propTypes = {
  active: PropTypes.bool.isRequired,
};

// This module owns the LinnStrument-specific sections of MIDI Input after the
// shared anchor row: bypass channel-allocation choices, MPE zone details for
// LinnStrument bypass mode, User Firmware LED/output controls, User Firmware
// row-glide controls, and LinnStrument-specific pitch-bending interval UI. It
// does not render the shared controller anchor row or global non-controller-
// specific wheel/bend settings.
const LinnstrumentSettings = ({
  ctrl,
  settings,
  scaleMode,
  userFirmwareEligible,
  userFirmwareActiveUi,
  channelAllocation,
  rawPorts,
  midiOutputs,
  keysRef,
  onChange,
  onChannelAllocationChange,
  saveControllerPref,
  pitchBendMode,
  pitchBendShape,
  xSpikeReduction,
  xInputSmoothing,
  showStatusBlock,
  showModeBlock,
  showUserFirmwareBlock,
  showPitchBlock,
}) => (
  <>
    {showStatusBlock && !userFirmwareEligible && (
      <LinnUserFirmwareStatus active={false} />
    )}

    {showModeBlock && !scaleMode && !userFirmwareActiveUi && (
      <>
        <label title="How the LinnStrument allocates MIDI channels in bypass mode. Single Channel uses one channel for all notes. Channel Per Row uses one channel per row with Hexatone's sequential channel arithmetic. Channel Per Note uses MPE input.">
          Channel Allocation
          <select
            class="sidebar-input"
            value={channelAllocation}
            onChange={(e) => onChannelAllocationChange(e.target.value)}
          >
            <option value="single_channel">Single Channel</option>
            <option value="channel_per_row">Channel Per Row</option>
            <option value="channel_per_note">Channel Per Note (MPE)</option>
          </select>
        </label>

        {channelAllocation === "single_channel" && (
          <label title="Single Channel mode keeps all notes on one MIDI channel. Pitch bend here is mainly useful for monophonic playing, and the user can configure the device bend behaviour as preferred.">
            Pitch Bend
            <span class="sidebar-input" style={{ color: "#888", fontStyle: "italic" }}>
              Monophonic response
            </span>
          </label>
        )}

        {channelAllocation === "channel_per_note" && (
          <MpeInputSettings
            settings={settings}
            memberChannels={Array.from({ length: 15 }, (_, i) => i + 2)}
            defaultLo={2}
            defaultHi={8}
            onChange={onChange}
          />
        )}
      </>
    )}

    {showStatusBlock && userFirmwareEligible && (
      <>
        <LinnUserFirmwareStatus active={true} />
        <OutputPortPicker
          label="MIDI Output"
          rawPorts={rawPorts}
          outputs={midiOutputs}
          overridePortId={settings.linnstrument_out_port ?? null}
          onChange={(id) => {
            onChange("linnstrument_out_port", id);
            sessionStorage.setItem("linnstrument_out_port", id ?? "");
          }}
        />
        <label style={{ marginTop: "0.3em" }}>
          Auto Send Colours
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginLeft: "auto",
              marginTop: "4px",
            }}
          >
            <input
              name="linnstrument_led_sync"
              type="checkbox"
              checked={!!settings.linnstrument_led_sync}
              onChange={(e) => {
                onChange("linnstrument_led_sync", e.target.checked);
                localStorage.setItem("linnstrument_led_sync", e.target.checked);
                const keys = keysRef?.current;
                if (keys) keys.settings.linnstrument_led_sync = e.target.checked;
                if (e.target.checked) keys?.syncLinnstrumentLEDs?.();
              }}
            />
            <button
              type="button"
              class="preset-action-btn"
              onClick={() => keysRef?.current?.syncLinnstrumentLEDs?.()}
            >
              Send Now
            </button>
            <button
              type="button"
              class="preset-action-btn"
              onClick={() => keysRef?.current?.linnstrumentLEDs?.clearColors?.()}
            >
              Clear
            </button>
          </span>
        </label>
      </>
    )}

    {showUserFirmwareBlock && userFirmwareActiveUi && (
      <>
        <label title="LinnStrument User Firmware pitch bend mode. Off ignores UF X-position bend data. Follow Scale/Geometry uses the current row-wise glide path.">
          LinnStrument Row Glide
          <select
            class="sidebar-input"
            value={pitchBendMode}
            onChange={(e) => {
              onChange("linnstrument_pitch_bend_mode", e.target.value);
              saveControllerPref(ctrl, "linnstrument_pitch_bend_mode", e.target.value, settings, {
                linnstrument_pitch_bend_mode: e.target.value,
              });
            }}
          >
            <option value="off">Off</option>
            <option value="follow_scale_geometry">Follow Scale/Geometry</option>
          </select>
        </label>

        <label
          title="Controls how continuous LinnStrument row glide feels. 0 is linear glide across the pad. 100 keeps most of the pad on the current note, with fast near-stepped transitions and a small shared seam pitch near pad boundaries."
          style={pitchBendMode === "follow_scale_geometry" ? undefined : { opacity: 0.55 }}
        >
          Row Glide Shaping
          <span
            class="sidebar-input"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              justifyContent: "flex-end",
            }}
          >
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={pitchBendShape}
              disabled={pitchBendMode !== "follow_scale_geometry"}
              style={{ width: "100%" }}
              onInput={(e) => {
                const parsed = parseInt(e.target.value, 10);
                const v = Math.max(0, Math.min(100, Number.isNaN(parsed) ? 50 : parsed));
                onChange("linnstrument_pitch_bend_shape", v);
                saveControllerPref(
                  ctrl,
                  "linnstrument_pitch_bend_shape",
                  v,
                  settings,
                  { linnstrument_pitch_bend_shape: v },
                );
              }}
            />
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                minWidth: "2.5em",
                textAlign: "right",
                fontSize: "0.85em",
              }}
            >
              {pitchBendShape}
            </span>
          </span>
        </label>

        <label
          title="Rejects noisy LinnStrument User Firmware X-position spikes before they become pitch warble. 0 leaves the raw X data untouched; 100 all but ignores the UF X LSB, effectively holding X to its coarse MSB bucket."
          style={pitchBendMode === "follow_scale_geometry" ? undefined : { opacity: 0.55 }}
        >
          X Spike Reduction
          <span
            class="sidebar-input"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              justifyContent: "flex-end",
            }}
          >
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={xSpikeReduction}
              disabled={pitchBendMode !== "follow_scale_geometry"}
              style={{ width: "100%" }}
              onInput={(e) => {
                const parsed = parseInt(e.target.value, 10);
                const v = Math.max(0, Math.min(100, Number.isNaN(parsed) ? 50 : parsed));
                onChange("linnstrument_x_spike_reduction", v);
                saveControllerPref(
                  ctrl,
                  "linnstrument_x_spike_reduction",
                  v,
                  settings,
                  { linnstrument_x_spike_reduction: v },
                );
              }}
            />
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                minWidth: "2.5em",
                textAlign: "right",
                fontSize: "0.85em",
              }}
            >
              {xSpikeReduction}
            </span>
          </span>
        </label>

        <label
          title="Applies event-driven smoothing to accepted LinnStrument User Firmware X input after spike rejection. 0 is raw accepted X. Higher values average successive accepted X samples more heavily without relying on timers or animation frames."
          style={pitchBendMode === "follow_scale_geometry" ? undefined : { opacity: 0.55 }}
        >
          X Input Smoothing
          <span
            class="sidebar-input"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              justifyContent: "flex-end",
            }}
          >
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={xInputSmoothing}
              disabled={pitchBendMode !== "follow_scale_geometry"}
              style={{ width: "100%" }}
              onInput={(e) => {
                const parsed = parseInt(e.target.value, 10);
                const v = Math.max(0, Math.min(100, Number.isNaN(parsed) ? 0 : parsed));
                onChange("linnstrument_x_input_smoothing", v);
                saveControllerPref(
                  ctrl,
                  "linnstrument_x_input_smoothing",
                  v,
                  settings,
                  { linnstrument_x_input_smoothing: v },
                );
              }}
            />
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                minWidth: "2.5em",
                textAlign: "right",
                fontSize: "0.85em",
              }}
            >
              {xInputSmoothing}
            </span>
          </span>
        </label>
      </>
    )}

    {showPitchBlock && !userFirmwareActiveUi && (
      <>
        {settings.midiin_mpe_input ? (
          <label title="Per-note MPE pitch bending interval for LinnStrument bypass mode. The chosen Scala interval or cents span is spread across the full signed bend range.">
            Pitch Bending Interval (Scala)
            <ScalaInput
              context="interval"
              value={settings.midiin_bend_range ?? "64/63"}
              onChange={(str) => {
                onChange("midiin_bend_range", str);
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
          channelAllocation !== "channel_per_note" ? (
            <label title={channelAllocation === "channel_per_row"
              ? "Channel-per-row LinnStrument pitch bending interval. The chosen Scala interval or cents span is spread across the full signed bend range for each active row channel."
              : "Single-channel LinnStrument pitch bending interval. The chosen Scala interval or cents span is spread across the full signed bend range. Polyphonic playing will share that bend stream, so the musical result depends on the user's sound design."}>
              Pitch Bending Interval (Scala)
              <ScalaInput
                context="interval"
                value={settings.midiin_bend_range ?? "64/63"}
                onChange={(str) => {
                  onChange("midiin_bend_range", str);
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
            <label title="Standard pitch wheel range in semitones. With LinnStrument User Firmware off, Hexatone treats bend as generic passthrough behavior and relies on the user's hardware setup. This is most useful with monophonic synth response.">
              Pitch Wheel Range (Semitones)
              <input
                type="number"
                min="0"
                max="48"
                style={{ width: "3.5em" }}
                value={settings.midi_wheel_semitones ?? 2}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value, 10);
                  const v = Math.max(0, Math.min(48, Number.isNaN(parsed) ? 2 : parsed));
                  onChange("midi_wheel_semitones", v);
                  sessionStorage.setItem("midi_wheel_semitones", v);
                }}
              />
            </label>
          )
        )}
      </>
    )}
  </>
);

LinnstrumentSettings.propTypes = {
  ctrl: PropTypes.object,
  settings: PropTypes.object.isRequired,
  scaleMode: PropTypes.bool.isRequired,
  userFirmwareEligible: PropTypes.bool.isRequired,
  userFirmwareActiveUi: PropTypes.bool.isRequired,
  channelAllocation: PropTypes.string,
  rawPorts: PropTypes.object,
  midiOutputs: PropTypes.object,
  keysRef: PropTypes.object,
  onChange: PropTypes.func.isRequired,
  onChannelAllocationChange: PropTypes.func.isRequired,
  saveControllerPref: PropTypes.func.isRequired,
  pitchBendMode: PropTypes.string.isRequired,
  pitchBendShape: PropTypes.number.isRequired,
  xSpikeReduction: PropTypes.number.isRequired,
  xInputSmoothing: PropTypes.number.isRequired,
  showStatusBlock: PropTypes.bool,
  showModeBlock: PropTypes.bool,
  showUserFirmwareBlock: PropTypes.bool,
  showPitchBlock: PropTypes.bool,
};

export default LinnstrumentSettings;
