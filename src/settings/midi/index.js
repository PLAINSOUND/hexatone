import { h } from 'preact';
import { Fragment } from 'preact/compat';
import PropTypes from 'prop-types';
import { detectController } from '../../controllers/registry.js';

const MIDIio = (props) => {
  // props.midiTick is unused directly — its presence as a changing prop forces
  // re-render when MIDI devices connect/disconnect, refreshing the inputs list.
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
          {/* ── Dynamic controller UI from registry ── */}
          {connectedDevice && (() => {
            const ctrl = detectController(deviceName);
            if (ctrl) return (
              <>
                <label style={{ fontStyle: 'italic', color: '#996666' }}>
                  {ctrl.name}
                  <span class="sidebar-input" style={{ textAlign: 'right', fontSize: '0.85em', lineHeight: 1., marginBottom: 6 }}>
                    {ctrl.description}
                  </span>
                </label>
                {/* Universal anchor: MIDI note → central degree.
                    Bypass ON: raw notes positioned relative to this anchor.
                    Bypass OFF: controller geometry wraps around this same anchor. */}
                <label>
                  MIDI Note → Central Degree ({center_degree})
                  <input name="midiin_central_degree" type="text" inputMode="numeric"
                    class="sidebar-input"
                    key={`${props.settings.midiin_central_degree}-${center_degree}`}
                    defaultValue={centralNote}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val >= 0 && val <= 127) {
                        props.onChange('midiin_central_degree', val - center_degree);
                        sessionStorage.setItem('midiin_central_degree', val - center_degree);
                      } else {
                        e.target.value = centralNote;
                      }
                    }}
                  />
                </label>
                <label>
                  Bypass Key Mapping
                  <input
                    name="midi_passthrough"
                    type="checkbox"
                    checked={!!props.settings.midi_passthrough}
                    onChange={(e) => {
                      props.onChange('midi_passthrough', e.target.checked);
                      sessionStorage.setItem('midi_passthrough', e.target.checked);
                    }}
                  />
                </label>
              </>
            );
            // Unknown controller
            return (
              <>
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
                <p><em>
                  Controller geometry not recognised — using channel-per-octave mapping.
                  <br/>
                  <a href="https://github.com/PLAINSOUND/hexatone/issues/new?title=Controller+geometry+request&body=Controller+name:+" target="_blank">
                    Request geometry integration
                  </a>
                </em></p>
              </>
            );
          })()}

          <p>
            <em>{isAxis49
              ? 'Choose a physical key on the AXIS-49 (note numbers 1\u201398 in selfless mode) to map to the central scale degree on screen.'
              : isLumatone
                ? 'Block (channel 1\u20135) and key within that block (0\u201355) that maps to the centre of the screen. The mapping shifts automatically to maximise on-screen coverage.'
                : 'Input is received on all channels. Notes on the Central Input Channel remain untransposed. Other channels are transposed by multiples of the selected scale\u2019s interval of repetition (usually an octave, but it may be any value). Multichannel controllers like the Lumatone are automatically mapped onto transpositions of the selected scale (up to 128 pitches per channel/equave).'
            }</em></p>

          <label>
            Steps per Channel
            <input
              name="midiin_steps_per_channel"
              type="text"
              inputMode="numeric"
              class="sidebar-input"
              key={props.settings.midiin_steps_per_channel ?? 'auto'}
              defaultValue={props.settings.midiin_steps_per_channel ?? ''}
              placeholder={`automatically set to 1 equave (${props.settings.equivSteps ?? '…'} steps)`}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                if (raw === '') {
                  props.onChange('midiin_steps_per_channel', null);
                  sessionStorage.removeItem('midiin_steps_per_channel');
                } else {
                  const val = parseInt(raw);
                  if (!isNaN(val) && val >= 1) {
                    props.onChange('midiin_steps_per_channel', val);
                    sessionStorage.setItem('midiin_steps_per_channel', val);
                  } else {
                    e.target.value = props.settings.midiin_steps_per_channel ?? '';
                  }
                }
              }}
            />
          </label>
          <label>
            Legacy Channel Mode
            <input
              name="midiin_channel_legacy"
              type="checkbox"
              checked={!!props.settings.midiin_channel_legacy}
              onChange={(e) => {
                props.onChange('midiin_channel_legacy', e.target.checked);
                sessionStorage.setItem('midiin_channel_legacy', e.target.checked);
              }}
            />
          </label>
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
    controller_anchor_note: PropTypes.number,
    lumatone_center_channel: PropTypes.number,
    lumatone_center_note: PropTypes.number,
    midiin_steps_per_channel: PropTypes.number,
    midi_passthrough: PropTypes.bool,
    midiin_channel_legacy: PropTypes.bool,
    wheel_to_recent: PropTypes.bool,
    center_degree: PropTypes.number,
  }).isRequired,
  midi: PropTypes.object,
  onChange: PropTypes.func.isRequired,
};

export default MIDIio;