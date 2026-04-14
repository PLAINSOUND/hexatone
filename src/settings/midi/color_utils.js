import PropTypes from "prop-types";

const MidiOutputs = (props) => (
  <fieldset>
    <legend>
      <b>MIDI Outputs</b>
    </legend>
    <label>
      MTS MIDI Output
      <input
        name="output_mts"
        type="checkbox"
        checked={!!props.settings.output_mts}
        onChange={(e) => {
          props.onChange(e.target.name, e.target.checked);
          sessionStorage.setItem(e.target.name, e.target.checked);
        }}
      />
    </label>
    <label>
      MPE MIDI Output
      <input
        name="output_mpe"
        type="checkbox"
        checked={!!props.settings.output_mpe}
        onChange={(e) => {
          props.onChange(e.target.name, e.target.checked);
          sessionStorage.setItem(e.target.name, e.target.checked);
        }}
      />
    </label>
  </fieldset>
);

MidiOutputs.propTypes = {
  settings: PropTypes.shape({
    output_mts: PropTypes.bool,
    output_mpe: PropTypes.bool,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
};

export default MidiOutputs;
