import { h } from 'preact';
import { Fragment } from 'preact/compat';
import PropTypes from 'prop-types';

const MIDIio = (props) => {
  // midiin_degree0 is the MIDI note that triggers step 0 (degree 0) internally.
  // We expose it to the user as the note that plays the *central* degree, so:
  //   displayed value  = midiin_degree0 + center_degree
  //   stored value     = entered value  − center_degree
  const center_degree = props.settings.center_degree || 0;
  const centralNote = (props.settings.midiin_degree0 || 60) + center_degree;

  return (
  <fieldset>
    <legend><b>MIDI Inputs</b></legend>
    <label>
      Input Port
      <select value={props.settings.midiin_device}
        name="midiin_device"
        class="sidebar-input"
        onChange={(e) => {
          props.onChange(e.target.name, e.target.value);
          sessionStorage.setItem(e.target.name, e.target.value);
        }}>
        <option value="OFF">OFF</option>
        {props.midi && Array.from(props.midi.inputs.values()).map(m => (
          <option value={m.id}>{m.name}</option>
        ))}
      </select>
    </label>
    <label>
      Central Input Channel
      <select value={props.settings.midiin_channel}
        name="midiin_channel"
        class="sidebar-input"
        onChange={(e) => {
          props.onChange(e.target.name, parseInt(e.target.value));
          sessionStorage.setItem(e.target.name, e.target.value);
        }}>
        <option value="-1">---choose a channel on which input is untransposed---</option>
        {[...Array(16).keys()].map(i => <option value={i}>{i + 1}</option>)}
      </select>
    </label>
    <label>
      MIDI Note assigned to play Central Scale Degree ({center_degree})
      <input name="midiin_degree0" type="text" inputMode="numeric"
        class="sidebar-input"
        key={`${props.settings.midiin_degree0}-${center_degree}`}
        defaultValue={centralNote}
        onBlur={(e) => {
          const val = parseInt(e.target.value);
          if (!isNaN(val) && val >= 0 && val <= 127) {
            props.onChange('midiin_degree0', val - center_degree);
          } else {
            e.target.value = centralNote;
          }
        }}
      />
    </label>
    <br />
    <em>Input is received on all channels. Notes on the Central Input Channel remain untransposed. Other channels are transposed by multiples of the selected scale&rsquo;s interval of repetition (usually an octave, but it may be any value). Thus, multichannel controllers are automatically mapped onto transpositions of the selected scale (up to 128 pitches per channel).</em>
    <br /><br />


  </fieldset>
  );
};

MIDIio.propTypes = {
  settings: PropTypes.shape({
    midiin_device: PropTypes.string,
    midiin_channel: PropTypes.number,
    midiin_degree0: PropTypes.number,
    center_degree: PropTypes.number,

  }).isRequired,
  midi: PropTypes.object,
  onChange: PropTypes.func.isRequired,
};

export default MIDIio;
