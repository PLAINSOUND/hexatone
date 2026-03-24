import { h } from 'preact';
import { Fragment } from 'preact/compat';
import PropTypes from 'prop-types';

const MidiTuning = (props) => (
  <>
    <legend><b>MIDI Tuning Map Output</b></legend>
    <br />
    <label>
      Send Sysex
      <input name="sysex_auto" type="checkbox"
        checked={props.settings.sysex_auto}
        onChange={(e) => {
          props.onChange(e.target.name, e.target.checked);
          sessionStorage.setItem(e.target.name, e.target.checked);
        }} />
    </label>
    <label>
      Type of Sysex Message(s)
      <select value={String(props.settings.sysex_type)}
        name="sysex_type"
        onChange={(e) => {
          props.onChange(e.target.name, parseInt(e.target.value));
          sessionStorage.setItem(e.target.name, e.target.value);
        }}>
        <option value="127">real-time (127)</option>
        <option value="126">non-real-time (126)</option>
      </select>
    </label>
    <label>
      Device ID (127 = "all devices")
      <input name="device_id" type="text" inputMode="numeric"
        key={props.settings.device_id}
        defaultValue={props.settings.device_id}
        onBlur={(e) => {
          const val = parseInt(e.target.value);
          if (!isNaN(val) && val >= 0 && val <= 127) {
            props.onChange('device_id', val);
            sessionStorage.setItem('device_id', val);
          } else {
            e.target.value = props.settings.device_id;
          }
        }}
      />
    </label>
    <label>
      Tuning Map Number
      <input name="tuning_map_number" type="text" inputMode="numeric"
        key={props.settings.tuning_map_number}
        defaultValue={props.settings.tuning_map_number}
        onBlur={(e) => {
          const val = parseInt(e.target.value);
          if (!isNaN(val) && val >= 0 && val <= 127) {
            props.onChange('tuning_map_number', val);
            sessionStorage.setItem('tuning_map_number', val);
          } else {
            e.target.value = props.settings.tuning_map_number;
          }
        }}
      />
    </label>


    <p>
    <em>The <a href="/midituning.html">MIDI Tuning Standard</a>, described in detail at <a href="https://midi.org/midi-tuning-updated-specification">midi.org</a>, allows external synthesizers to receive data modifying the tuning of each MIDI note. This is done by system exclusive messages: either a non-real-time "Bulk Tuning Dump" or 128 real-time "Single-Note Tuning Changes". The receiving synth will need to be set to receive sysex into the specified Tuning Map slot. Using the free <a href="https://oddsound.com/mtsespmini.php">Oddsound MTS-ESP Mini</a> plug-in, it is possible to translate MTS data to retune softsynths using other protocols (MPE or multichannel pitchbend).</em>
    </p>
  </>
);

MidiTuning.propTypes = {
  settings: PropTypes.shape({
    sysex_auto: PropTypes.bool,
    sysex_type: PropTypes.number,
    device_id: PropTypes.number,
    tuning_map_number: PropTypes.number,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
};

export default MidiTuning;