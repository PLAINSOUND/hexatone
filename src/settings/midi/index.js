import { h } from 'preact';
import { Fragment } from 'preact/compat';
import PropTypes from 'prop-types';

const MIDIio = (props) => {
  // Detect whether the connected device is an AXIS-49 (name includes 'axis').
  const isAxis49 = props.midi &&
    props.settings.midiin_device &&
    props.settings.midiin_device !== 'OFF' &&
    (() => {
      const dev = Array.from(props.midi.inputs.values())
        .find(m => m.id === props.settings.midiin_device);
      return dev?.name?.toLowerCase().includes('axis-4') ?? false;
    })();
  // midiin_central_degree is the MIDI note that triggers step 0 (degree 0) internally.
  // We expose it to the user as the note that plays the *central* degree, so:
  //   displayed value  = midiin_central_degree + center_degree
  //   stored value     = entered value  − center_degree
  const center_degree = props.settings.center_degree || 0;
  const centralNote = (props.settings.midiin_central_degree || 60) + center_degree;

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

      {props.settings.midiin_device && props.settings.midiin_device !== 'OFF' && (
        <>
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
          {isAxis49 ? (
            <label>
              AXIS-49 Centre Key (1–98)
              <input
                name="axis49_center_note"
                type="text"
                inputMode="numeric"
                class="sidebar-input"
                key={props.settings.axis49_center_note}
                defaultValue={props.settings.axis49_center_note ?? 49}
                onBlur={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val) && val >= 1 && val <= 98) {
                    props.onChange('axis49_center_note', val);
                    sessionStorage.setItem('axis49_center_note', val);
                  } else {
                    e.target.value = props.settings.axis49_center_note ?? 49;
                  }
                }}
              />
            </label>
          ) : (
            <label>
              MIDI Note assigned to Central Scale Degree ({center_degree})
              <input name="midiin_central_degree" type="text" inputMode="numeric"
                class="sidebar-input"
                key={`${props.settings.midiin_central_degree}-${center_degree}`}
                defaultValue={centralNote}
                onBlur={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val) && val >= 0 && val <= 127) {
                    props.onChange('midiin_central_degree', val - center_degree);
                  } else {
                    e.target.value = centralNote;
                  }
                }}
              />
            </label>
          )}
          <br />
          <em>{isAxis49
            ? 'Choose a a physical key (1–98 in selfless mode) to map to the central scale degree on screen.'
            : 'Input is received on all channels. Notes on the Central Input Channel remain untransposed. Other channels are transposed by multiples of the selected scale\u2019s interval of repetition (usually an octave, but it may be any value). Multichannel controllers like the Lumatone are automatically mapped onto transpositions of the selected scale (up to 128 pitches per channel/equave).'
          }</em>

          <br /><br />
        </>
      )}

    </fieldset>
  );
};

MIDIio.propTypes = {
  settings: PropTypes.shape({
    midiin_device: PropTypes.string,
    midiin_channel: PropTypes.number,
    midiin_central_degree: PropTypes.number,
    axis49_center_note: PropTypes.number,
    center_degree: PropTypes.number,
  }).isRequired,
  midi: PropTypes.object,
  onChange: PropTypes.func.isRequired,
};

export default MIDIio;