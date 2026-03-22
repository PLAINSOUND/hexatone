import { h } from 'preact';
import { Fragment } from 'preact/compat';
import PropTypes from 'prop-types';

const MIDIio = (props) => {
  // Detect connected controller type by device name.
  const connectedDevice = props.midi && props.settings.midiin_device &&
    props.settings.midiin_device !== 'OFF'
    ? Array.from(props.midi.inputs.values())
      .find(m => m.id === props.settings.midiin_device)
    : null;
  const deviceName = connectedDevice?.name?.toLowerCase() ?? '';
  const isAxis49 = deviceName.includes('axis-4');
  const isLumatone = deviceName.includes('lumatone');
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
              AXIS-49 Key Mapping
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
          ) : isLumatone ? (
            <>
              <label>
                Lumatone Centre Block (channel 1–5)
                <input
                  name="lumatone_center_channel"
                  type="text"
                  inputMode="numeric"
                  class="sidebar-input"
                  key={props.settings.lumatone_center_channel}
                  defaultValue={props.settings.lumatone_center_channel ?? 3}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val) && val >= 1 && val <= 5) {
                      props.onChange('lumatone_center_channel', val);
                      sessionStorage.setItem('lumatone_center_channel', val);
                    } else {
                      e.target.value = props.settings.lumatone_center_channel ?? 3;
                    }
                  }}
                />
              </label>
              <label>
                Lumatone Centre Key in block (0–55)
                <input
                  name="lumatone_center_note"
                  type="text"
                  inputMode="numeric"
                  class="sidebar-input"
                  key={props.settings.lumatone_center_note}
                  defaultValue={props.settings.lumatone_center_note ?? 27}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val) && val >= 0 && val <= 55) {
                      props.onChange('lumatone_center_note', val);
                      sessionStorage.setItem('lumatone_center_note', val);
                    } else {
                      e.target.value = props.settings.lumatone_center_note ?? 27;
                    }
                  }}
                />
              </label>
            </>
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

          <p>
            <em>{isAxis49
              ? 'Choose a physical key on the AXIS-49 (note numbers 1\u201398 in selfless mode) to map to the central scale degree on screen.'
              : isLumatone
                ? 'Block (channel 1\u20135) and key within that block (0\u201355) that maps to the centre of the screen. The mapping shifts automatically to maximise on-screen coverage.'
                : 'Input is received on all channels. Notes on the Central Input Channel remain untransposed. Other channels are transposed by multiples of the selected scale\u2019s interval of repetition (usually an octave, but it may be any value). Multichannel controllers like the Lumatone are automatically mapped onto transpositions of the selected scale (up to 128 pitches per channel/equave).'
            }</em></p>

          <label>
            Pitch Wheel → Most Recent Note
            <input
              name="wheel_to_recent"
              type="checkbox"
              checked={!!props.settings.wheel_to_recent}
              onChange={(e) => {
                props.onChange('wheel_to_recent', e.target.checked);
                sessionStorage.setItem('wheel_to_recent', e.target.checked);
              }}
            />
          </label>
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
    lumatone_center_channel: PropTypes.number,
    lumatone_center_note: PropTypes.number,
    wheel_to_recent: PropTypes.bool,
    center_degree: PropTypes.number,
  }).isRequired,
  midi: PropTypes.object,
  onChange: PropTypes.func.isRequired,
};

export default MIDIio;