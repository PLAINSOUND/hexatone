import PropTypes from "prop-types";

// This module owns the extra MIDI Input controls that appear only in
// "MIDI to Nearest Scale Degree" mode. It is intentionally small and pure:
// callers provide the current settings and change handler, and it persists the
// tolerance/fallback fields without knowing anything about controllers.
const ScaleInputSettings = ({ settings, onChange }) => (
  <>
    <label title="Maximum distance in cents before a note is considered out of tolerance">
      Tolerance (cents)
      <input
        type="text"
        inputMode="numeric"
        class="sidebar-input"
        key={settings.midiin_scale_tolerance ?? 25}
        defaultValue={settings.midiin_scale_tolerance ?? 25}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
        }}
        onBlur={(e) => {
          const v = parseInt(e.target.value);
          if (!isNaN(v) && v >= 0) {
            onChange("midiin_scale_tolerance", v);
            sessionStorage.setItem("midiin_scale_tolerance", String(v));
          } else {
            e.target.value = settings.midiin_scale_tolerance ?? 25;
          }
        }}
      />
    </label>
    <label title="What to do when no scale degree is within tolerance">
      Out of tolerance
      <select
        class="sidebar-input"
        value={settings.midiin_scale_fallback || "accept"}
        onChange={(e) => {
          onChange("midiin_scale_fallback", e.target.value);
          sessionStorage.setItem("midiin_scale_fallback", e.target.value);
        }}
      >
        <option value="discard">Discard</option>
        <option value="accept">Accept Best</option>
      </select>
    </label>
  </>
);

ScaleInputSettings.propTypes = {
  settings: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

export default ScaleInputSettings;
