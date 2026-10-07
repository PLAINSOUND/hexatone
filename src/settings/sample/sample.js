/**
 * Built-in instrument and volume controls backed by sample_synth/instruments.js.
 * Reports selections and live volume changes to the parent; it does not instantiate
 * an AudioContext or release sounding voices itself.
 */

import { useState } from "preact/hooks";
import PropTypes from "prop-types";
import CustomRangeSlider from "../shared/range-slider.jsx";
import { readSampleVolume } from "../../audio/sample-volume.js";

const Sample = (props) => {
  const [volume, setVolume] = useState(readSampleVolume);

  const handleVolume = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    localStorage.setItem("synth_volume", val);
    if (props.onVolumeChange) props.onVolumeChange(val, false);
  };
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
      <label>
        <span>Volume</span>
        <span class="sidebar-input settings-form__range-row">
          <CustomRangeSlider
            ariaLabel="Volume"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onInputValue={(nextValue) => {
              handleVolume({ target: { value: String(nextValue) } });
            }}
            onCommitValue={(nextValue) => {
              handleVolume({ target: { value: String(nextValue) } });
            }}
          />
          <span class="settings-form__range-value">
            {Number.isInteger(volume) ? volume.toFixed(0) : volume.toFixed(2)}
          </span>
        </span>
      </label>
    </>
  );
};

Sample.propTypes = {
  onChange: PropTypes.func.isRequired,
  onVolumeChange: PropTypes.func,
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
