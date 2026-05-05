import PropTypes from "prop-types";

// This module owns the Haken Continuum-specific MIDI Input controls that only
// make sense in Nearest Scale Degree mode. It does not render generic MPE
// channel settings; it only exposes post-snap bend shaping for the Continuum's
// X dimension once a scale note has been selected.

const HakenContinuumSettings = ({
  ctrl,
  settings,
  scaleMode,
  onChange,
  saveControllerPref,
}) => {
  if (!scaleMode) return null;

  const scaleFactor = Math.max(
    0.25,
    Math.min(4, Number(settings.hakenaudio_scale_bend_factor ?? 1) || 1),
  );
  const xGlideShaping = Math.max(
    0,
    Math.min(100, Number(settings.hakenaudio_x_glide_shaping ?? 0) || 0),
  );
  const displayedShaping = ((xGlideShaping / 100) * 12).toFixed(1);

  return (
    <>
      <label title="Scales post-snap Continuum X bending after the nearest scale note has been chosen. 1 is the default response. Lower values require more finger travel; higher values exaggerate the post-snap bend response.">
        Pitch Bending Scale Factor
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
            min="0.25"
            max="4"
            step="0.01"
            value={scaleFactor}
            style={{ width: "100%" }}
            onInput={(e) => {
              const parsed = parseFloat(e.target.value);
              const v = Math.max(0.25, Math.min(4, Number.isNaN(parsed) ? 1 : parsed));
              onChange("hakenaudio_scale_bend_factor", v);
              saveControllerPref(ctrl, "hakenaudio_scale_bend_factor", v, settings, {
                hakenaudio_scale_bend_factor: v,
              });
            }}
          />
          <span
            style={{
              fontVariantNumeric: "tabular-nums",
              minWidth: "2.8em",
              textAlign: "right",
              fontSize: "0.85em",
            }}
          >
            {scaleFactor.toFixed(2)}
          </span>
        </span>
      </label>

      <label title="Shapes post-snap Continuum X bending around the selected scale note. 0 is linear. The full slider travel maps to an effective shaping span of 0–12, giving subtler control near the playable range.">
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
              onChange("hakenaudio_x_glide_shaping", v);
              saveControllerPref(ctrl, "hakenaudio_x_glide_shaping", v, settings, {
                hakenaudio_x_glide_shaping: v,
              });
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
            {displayedShaping}
          </span>
        </span>
      </label>
    </>
  );
};

HakenContinuumSettings.propTypes = {
  ctrl: PropTypes.object.isRequired,
  settings: PropTypes.object.isRequired,
  scaleMode: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
  saveControllerPref: PropTypes.func.isRequired,
};

export default HakenContinuumSettings;
