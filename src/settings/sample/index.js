import PropTypes from "prop-types";
import Sample from "./sample";

const SampleSynth = (props) => (
  <fieldset>
    <legend>
      <b>Built-in Sounds</b>
    </legend>
    <label>
      Use Internal Synth
      <input
        name="output_sample"
        type="checkbox"
        checked={!!props.settings.output_sample}
        onChange={(e) => {
          props.onChange(e.target.name, e.target.checked);
          sessionStorage.setItem(e.target.name, e.target.checked);
        }}
      />
    </label>
    {props.settings.output_sample && <Sample {...props} onVolumeChange={props.onVolumeChange} />}
    {/* Fixed velocity hard-coded to 72; midi_velocity UI hidden */}
  </fieldset>
);

SampleSynth.propTypes = {
  settings: PropTypes.shape({
    output_sample: PropTypes.bool,
    output_mts: PropTypes.bool,
    output_mpe: PropTypes.bool,
  }).isRequired,
  midi: PropTypes.object,
  onChange: PropTypes.func.isRequired,
};

export default SampleSynth;
