/**
 * Built-in instrument and volume controls backed by sample_synth/instruments.js.
 * Reports selections and live volume changes to the parent; it does not instantiate
 * an AudioContext or release sounding voices itself.
 */

import MixerFader from "../mixer-fader.jsx";
import PropTypes from "prop-types";

const Sample = (props) => {
  return (
    <>
      <label>
        Instrument
        <Instruments
          value={props.settings.instrument}
          groups={props.instruments}
          onChange={props.onChange}
        />
      </label>
      <MixerFader session={props.soundSession} parameter="synth_volume" label="Volume" />
    </>
  );
};

Sample.propTypes = {
  onChange: PropTypes.func.isRequired,
  soundSession: PropTypes.object,
  instruments: PropTypes.array,
  settings: PropTypes.shape({
    instrument: PropTypes.string,
  }),
};

const Instruments = (props) => (
  <select
    name="instrument"
    class="sidebar-input"
    value={props.value}
    onChange={(e) => {
      props.onChange(e.target.name, e.target.value);
      sessionStorage.setItem(e.target.name, e.target.value);
    }}
  >
    <option value="OFF">OFF (no sound)</option>
    {props.groups.map((group) => (
      <optgroup label={group.name}>
        {group.instruments.map((instrument) => (
          <option value={instrument.fileName}>{instrument.name}</option>
        ))}
      </optgroup>
    ))}
  </select>
);

Instruments.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func,
  groups: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string.isRequired,
      instruments: PropTypes.arrayOf(
        PropTypes.shape({
          name: PropTypes.string.isRequired,
          fileName: PropTypes.string.isRequired,
        }),
      ),
    }),
  ),
};

export default Sample;
