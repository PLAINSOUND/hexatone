import PropTypes from "prop-types";

// This module owns the Tonal Plexus-specific mode selector in MIDI Input. It
// decides how the controller's incoming note layout should be interpreted
// before the more general anchor, channel, and pitch controls render below. It
// does not own the shared anchor UI or any of the later pitch-bend settings.
const TonalPlexusSettings = ({
  value,
  controller,
  settings,
  onChange,
  saveControllerPref,
}) => (
  <label>
    Tonal Plexus Mode
    <select
      class="sidebar-input"
      value={value}
      onChange={(e) => {
        onChange("tonalplexus_input_mode", e.target.value);
        saveControllerPref(
          controller,
          "tonalplexus_input_mode",
          e.target.value,
          settings,
          { tonalplexus_input_mode: e.target.value },
        );
      }}
    >
      <option value="blocks_41">41 notes per block</option>
      <option value="layout_205">205edo to nearest scale degree</option>
    </select>
  </label>
);

TonalPlexusSettings.propTypes = {
  value: PropTypes.string.isRequired,
  controller: PropTypes.object,
  settings: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  saveControllerPref: PropTypes.func.isRequired,
};

export default TonalPlexusSettings;
