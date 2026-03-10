import { h } from 'preact';
import { Fragment } from 'preact/compat';
import PropTypes from 'prop-types';
import Sample from './sample';

const SampleSynth = (props) => (
  <fieldset>
    <legend><b>Sound Synthesis</b></legend>
    <label>
      Built-In Synth / MIDI Output
      <select value={props.settings.output}
        name="output"
        class="sidebar-input"
        onChange={(e) => {
          props.onChange(e.target.name, e.target.value);
          sessionStorage.setItem(e.target.name, e.target.value);
        }}>
        <option value="OFF">OFF</option>
        <option value="sample">Built-In Synth ON</option>
        <option value="midi">MIDI Output ON</option>
      </select>
    </label>
    <label>
      Fixed velocity (touch input)
      <input name="midi_velocity" type="text" inputMode="numeric"
        class="sidebar-input"
        key={props.settings.midi_velocity}
        defaultValue={props.settings.midi_velocity}
        onBlur={(e) => {
          const val = parseInt(e.target.value);
          if (!isNaN(val) && val >= 1 && val <= 127) {
            props.onChange('midi_velocity', val);
            sessionStorage.setItem('midi_velocity', val);
          } else {
            e.target.value = props.settings.midi_velocity;
          }
        }}
      />
    </label>
    {props.settings.output === "sample" && (
      <Sample {...props}/>
    )}
  </fieldset>
);

SampleSynth.propTypes = {
  settings: PropTypes.shape({
    output: PropTypes.string,
  }).isRequired,
  midi: PropTypes.object,
  onChange: PropTypes.func.isRequired,
};

export default SampleSynth;
