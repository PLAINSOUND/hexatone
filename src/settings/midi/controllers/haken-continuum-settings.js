import PropTypes from "prop-types";
import OutputPortPicker from "../output-port-picker.js";
import { sendHakenNrpn } from "../../../controllers/hakenaudio.js";

// This module owns the Haken Continuum-specific MIDI Input controls that only
// make sense for MPE input modes. It renders the Continuum X Glide mode
// selector unconditionally when the Haken is active, and keeps the shared
// performance controls visible across both live X-glide modes so the player
// can flip between them without losing access to the paired settings.

const HakenContinuumSettings = ({
  ctrl,
  settings,
  rawPorts,
  midiOutputs,
  onChange,
  saveControllerPref,
  hakenPedalLearnActive,
}) => {
  const xGlideMode = settings.hakenaudio_x_glide_mode ?? "pitch_bending";
  const xGlideShaping = Math.max(
    0,
    Math.min(100, Number(settings.hakenaudio_x_glide_shaping ?? 100) || 0),
  );
  const pressureVelocity = Math.max(
    0,
    Math.min(127, Number(settings.hakenaudio_pressure_velocity ?? 64) || 0),
  );
  const noteOffDelay = Math.max(
    0,
    Math.min(100, Number(settings.hakenaudio_note_off_delay ?? 45) || 0),
  );
  const rasterThrottleMs = Math.max(
    0,
    Math.min(100, Number(settings.hakenaudio_raster_throttle_ms ?? 35) || 0),
  );
  const rasterStability = Math.max(
    0,
    Math.min(100, Number(settings.hakenaudio_raster_stability ?? 50) || 0),
  );
  const xLpf = Math.max(0, Math.min(127, Number(settings.hakenaudio_x_lpf ?? 60) || 0));
  const yLpf = Math.max(0, Math.min(127, Number(settings.hakenaudio_y_lpf ?? 30) || 0));
  const zLpf = Math.max(0, Math.min(127, Number(settings.hakenaudio_z_lpf ?? 125) || 0));
  const glideFlipCc = Number.isFinite(settings.hakenaudio_glide_flip_cc)
    ? Math.trunc(settings.hakenaudio_glide_flip_cc)
    : 67;
  const managerChannel = Math.max(1, Math.min(
    16,
    parseInt(settings.midiin_mpe_manager_ch ?? settings.mpe_manager_ch ?? 1, 10) || 1,
  ));
  const sendLpfNrpn = (nrpn, value) => {
    const output = rawPorts?.output ?? null;
    if (!output) return;
    sendHakenNrpn(output, managerChannel, nrpn, value);
  };
  const sliderValueStyle = {
    fontVariantNumeric: "tabular-nums",
    minWidth: "5.2em",
    textAlign: "right",
    fontSize: "0.85em",
  };
  const updateHakenPref = (key, value, extra = null) => {
    onChange(key, value);
    saveControllerPref(ctrl, key, value, settings, extra ?? { [key]: value });
  };

  return (
    <>
      <OutputPortPicker
        label="Continuum Output"
        rawPorts={rawPorts}
        outputs={midiOutputs}
        overridePortId={settings.hakenaudio_out_port ?? null}
        onChange={(id) => {
          onChange("hakenaudio_out_port", id);
          sessionStorage.setItem("hakenaudio_out_port", id ?? "");
        }}
      />

      <label title="MPE+ NRPN 100. Controls the Continuum X low-pass cutoff in 2 Hz units. Higher values preserve more detail and increase responsiveness.">
        X Detail ↔ Speed
        <span class="sidebar-input" style={{ display: "flex", alignItems: "center", gap: "6px", justifyContent: "flex-end" }}>
          <input
            type="range"
            min="0"
            max="127"
            step="1"
            value={xLpf}
            style={{ width: "100%" }}
            onInput={(e) => {
              const parsed = parseInt(e.target.value, 10);
              const v = Math.max(0, Math.min(127, Number.isNaN(parsed) ? 60 : parsed));
              updateHakenPref("hakenaudio_x_lpf", v, { hakenaudio_x_lpf: v });
              sendLpfNrpn(100, v);
            }}
          />
          <span style={sliderValueStyle}>
            {xLpf * 2} Hz
          </span>
        </span>
      </label>

      <label title="MPE+ NRPN 101. Controls the Continuum Y low-pass cutoff in 2 Hz units.">
        Y Detail ↔ Speed
        <span class="sidebar-input" style={{ display: "flex", alignItems: "center", gap: "6px", justifyContent: "flex-end" }}>
          <input
            type="range"
            min="0"
            max="127"
            step="1"
            value={yLpf}
            style={{ width: "100%" }}
            onInput={(e) => {
              const parsed = parseInt(e.target.value, 10);
              const v = Math.max(0, Math.min(127, Number.isNaN(parsed) ? 30 : parsed));
              updateHakenPref("hakenaudio_y_lpf", v, { hakenaudio_y_lpf: v });
              sendLpfNrpn(101, v);
            }}
          />
          <span style={sliderValueStyle}>
            {yLpf * 2} Hz
          </span>
        </span>
      </label>

      <label title="MPE+ NRPN 102. Controls the Continuum Z low-pass cutoff in 2 Hz units.">
        Z Detail ↔ Speed
        <span class="sidebar-input" style={{ display: "flex", alignItems: "center", gap: "6px", justifyContent: "flex-end" }}>
          <input
            type="range"
            min="0"
            max="127"
            step="1"
            value={zLpf}
            style={{ width: "100%" }}
            onInput={(e) => {
              const parsed = parseInt(e.target.value, 10);
              const v = Math.max(0, Math.min(127, Number.isNaN(parsed) ? 125 : parsed));
              updateHakenPref("hakenaudio_z_lpf", v, { hakenaudio_z_lpf: v });
              sendLpfNrpn(102, v);
            }}
          />
          <span style={sliderValueStyle}>
            {zLpf * 2} Hz
          </span>
        </span>
      </label>

      <label title="Controls how Continuum X-axis finger movement is translated. Pitch Bending applies continuous bend that follows the Hexatone scale. Raster to Notes turns the glide into a cascade of discrete note retriggering: each time the bend crosses a new note boundary a note-off and a fresh note-on are emitted.">
        Continuum X Glide
        <select
          class="sidebar-input"
          value={xGlideMode}
          onChange={(e) => {
            const v = e.target.value;
            updateHakenPref("hakenaudio_x_glide_mode", v, {
              hakenaudio_x_glide_mode: v,
            });
          }}
        >
          <option value="pitch_bending">Pitch Bending</option>
          <option value="raster_to_notes">Raster to Notes</option>
        </select>
      </label>

      <label title="Learns a foot pedal or other CC to momentarily flip between Pitch Bending and Raster to Notes, matching the current space-bar behavior. CC value 64 or above engages the flip; lower values release it.">
        Raster/Bend Pedal
        <span
          class="sidebar-input"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.45em",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontVariantNumeric: "tabular-nums", color: "#6b5a5a" }}>
            {`CC ${glideFlipCc}`}
          </span>
          <span style={{ display: "inline-flex", gap: "0.35em" }}>
            <button
              type="button"
              class="learn-btn"
              onClick={() => onChange("midiLearnHakenPedal", !hakenPedalLearnActive)}
            >
              {hakenPedalLearnActive ? "● Listening…" : "Learn"}
            </button>
            <button
              type="button"
              class="learn-btn"
              onClick={() => {
                updateHakenPref("hakenaudio_glide_flip_cc", 67, {
                  hakenaudio_glide_flip_cc: 67,
                });
              }}
            >
              Reset
            </button>
          </span>
        </span>
      </label>

      <label title="Shapes Continuum X bending around the current note. 0 is linear. Higher values create stronger pockets of stability around note centers and faster movement between them.">
        X Glide Shaping
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
            value={xGlideShaping}
            style={{ width: "100%" }}
            onInput={(e) => {
              const parsed = parseInt(e.target.value, 10);
              const v = Math.max(0, Math.min(100, Number.isNaN(parsed) ? 0 : parsed));
              updateHakenPref("hakenaudio_x_glide_shaping", v, {
                hakenaudio_x_glide_shaping: v,
              });
            }}
          />
          <span style={sliderValueStyle}>
            {xGlideShaping}
          </span>
        </span>
      </label>

      <label title="Varies Continuum Raster to Notes retrigger velocity around the original attack using current Z pressure. 0 keeps the original attack for each retrigger. 127 applies the full pressure-based deviation range to both note-on and auto-generated note-off velocities.">
        Pressure → Velocity
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
            max="127"
            step="1"
            value={pressureVelocity}
            style={{ width: "100%" }}
            onInput={(e) => {
              const parsed = parseInt(e.target.value, 10);
              const v = Math.max(0, Math.min(127, Number.isNaN(parsed) ? 0 : parsed));
              updateHakenPref("hakenaudio_pressure_velocity", v, {
                hakenaudio_pressure_velocity: v,
              });
            }}
          />
          <span style={sliderValueStyle}>
            {pressureVelocity}
          </span>
        </span>
      </label>

      <label title="Enforces a minimum lifetime for auto-generated Raster to Notes notes. Real Continuum note-off messages still release all sounding notes immediately. Uses a timer rather than requestAnimationFrame so it also works while the app is in the background.">
        Minimum Note Duration
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
            value={noteOffDelay}
            style={{ width: "100%" }}
            onInput={(e) => {
              const parsed = parseInt(e.target.value, 10);
              const v = Math.max(0, Math.min(100, Number.isNaN(parsed) ? 0 : parsed));
              updateHakenPref("hakenaudio_note_off_delay", v, {
                hakenaudio_note_off_delay: v,
              });
            }}
          />
          <span style={sliderValueStyle}>
            {noteOffDelay} ms
          </span>
        </span>
      </label>

      <label title="Sets a minimum interval between Continuum Raster to Notes retriggers. Higher values reduce event density and output overload at the cost of skipping some very fast crossings.">
        Minimum Retrigger Interval
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
            value={rasterThrottleMs}
            style={{ width: "100%" }}
            onInput={(e) => {
              const parsed = parseInt(e.target.value, 10);
              const v = Math.max(0, Math.min(100, Number.isNaN(parsed) ? 0 : parsed));
              updateHakenPref("hakenaudio_raster_throttle_ms", v, {
                hakenaudio_raster_throttle_ms: v,
              });
            }}
          />
          <span style={sliderValueStyle}>
            {rasterThrottleMs} ms
          </span>
        </span>
      </label>

      <label title="Adds hysteresis around the current Raster to Notes pitch so small back-and-forth movements near note boundaries do not immediately retrigger neighbouring notes.">
        Raster Stability
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
            value={rasterStability}
            style={{ width: "100%" }}
            onInput={(e) => {
              const parsed = parseInt(e.target.value, 10);
              const v = Math.max(0, Math.min(100, Number.isNaN(parsed) ? 0 : parsed));
              updateHakenPref("hakenaudio_raster_stability", v, {
                hakenaudio_raster_stability: v,
              });
            }}
          />
          <span style={sliderValueStyle}>
            {rasterStability}
          </span>
        </span>
      </label>
    </>
  );
};

HakenContinuumSettings.propTypes = {
  ctrl: PropTypes.object.isRequired,
  settings: PropTypes.object.isRequired,
  rawPorts: PropTypes.object,
  midiOutputs: PropTypes.object,
  onChange: PropTypes.func.isRequired,
  saveControllerPref: PropTypes.func.isRequired,
  hakenPedalLearnActive: PropTypes.bool,
};

export default HakenContinuumSettings;
