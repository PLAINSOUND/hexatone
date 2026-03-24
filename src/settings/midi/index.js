import { h } from 'preact';
import PropTypes from 'prop-types';
import { detectController } from '../../controllers/registry.js';

const MIDIio = (props) => {
  // props.midiTick is unused directly — its presence as a changing prop forces
  // re-render when MIDI devices connect/disconnect, refreshing the inputs list.
  const connectedDevice = props.midi && props.settings.midiin_device &&
    props.settings.midiin_device !== 'OFF'
    ? Array.from(props.midi.inputs.values())
      .find(m => m.id === props.settings.midiin_device)
    : null;
  const deviceName = connectedDevice?.name?.toLowerCase() ?? '';
  // Detect 2D controller (null when device is disconnected or unrecognised).
  const ctrl = detectController(deviceName);

  // midiin_central_degree is stored as the raw physical MIDI note number.
  const center_degree = props.settings.center_degree || 0;
  const centralNote = props.settings.midiin_central_degree ?? 60;

  // Channel transposition mode derived from midiin_steps_per_channel:
  //   null  → 'equave'  (one equave per channel, default)
  //   0     → 'none'    (all channels untransposed)
  //   N > 0 → 'custom'  (N scale degrees per channel)
  const spc = props.settings.midiin_steps_per_channel;
  const stepsMode = (spc === null || spc === undefined) ? 'equave' : spc === 0 ? 'none' : 'custom';

  const setStepsMode = (mode) => {
    if (mode === 'none') {
      props.onChange('midiin_steps_per_channel', 0);
      sessionStorage.setItem('midiin_steps_per_channel', '0');
    } else if (mode === 'equave') {
      props.onChange('midiin_steps_per_channel', null);
      sessionStorage.removeItem('midiin_steps_per_channel');
    } else if (mode === 'custom') {
      // Seed with equivSteps so the user has a sensible starting value.
      const initial = props.settings.equivSteps ?? 12;
      props.onChange('midiin_steps_per_channel', initial);
      sessionStorage.setItem('midiin_steps_per_channel', String(initial));
    }
  };

  // Channel Transposition is shown when the 2D controller map is NOT active:
  //   - unknown / no device connected
  //   - known 2D controller with Bypass Key Mapping enabled
  const using2DMap = ctrl && !props.settings.midi_passthrough;

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
          {/* ── Known 2D controller ── */}
          {ctrl ? (
            <>
              <label style={{ fontStyle: 'italic', color: '#996666' }}>
                {ctrl.name}
                <span class="sidebar-input" style={{ textAlign: 'right', fontSize: '0.85em', lineHeight: 1, marginBottom: 6 }}>
                  {ctrl.description}
                </span>
              </label>
              {/* Anchor: the physical key whose MIDI note maps to the central screen degree.
                  Used in both 2D-map mode and bypass mode. */}
              <label>
                Anchor Key → Central Degree ({center_degree})
                <span class="sidebar-input" style={{ display: 'flex', gap: '4px', alignItems: 'center', textAlign: 'left' }}>
                  <button type="button"
                    onClick={() => props.onChange('midiLearnAnchor', !props.midiLearnActive)}
                    style={{ fontSize: '0.8em', whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0 }}>
                    {props.midiLearnActive ? '● Listening…' : 'Learn'}
                  </button>
                  <input name="midiin_central_degree" type="text" inputMode="numeric"
                    style={{ flex: 1, minWidth: 0, width: 'auto', textAlign: 'right', height: '1.5em', boxSizing: 'border-box', background: '#faf9f8', border: '1px solid #c8b8b8', borderRadius: '3px' }}
                    key={props.settings.midiin_central_degree}
                    defaultValue={centralNote}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val >= 0 && val <= 127) {
                        props.onChange('midiin_central_degree', val);
                        sessionStorage.setItem('midiin_central_degree', val);
                      } else {
                        e.target.value = centralNote;
                      }
                    }}
                  />
                </span>
              </label>
              <label>
                Sequential mode (bypass 2D geometry)
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
              {props.settings.midi_passthrough && (
                <p><em style={{ color: '#996666' }}>
                  2D geometry bypassed — notes mapped sequentially, channel transposition active below.
                </em></p>
              )}
            </>
          ) : (
            /* ── Unknown / sequential controller ── */
            <>
              <label>
                MIDI Note → Central Degree ({center_degree})
                <span class="sidebar-input" style={{ display: 'flex', gap: '4px', alignItems: 'center', textAlign: 'left' }}>
                  <button type="button"
                    onClick={() => props.onChange('midiLearnAnchor', !props.midiLearnActive)}
                    style={{ fontSize: '0.8em', whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0 }}>
                    {props.midiLearnActive ? '● Listening…' : 'Learn'}
                  </button>
                  <input name="midiin_central_degree" type="text" inputMode="numeric"
                    style={{ flex: 1, minWidth: 0, width: 'auto', textAlign: 'right', height: '1.5em', boxSizing: 'border-box', background: '#faf9f8', border: '1px solid #c8b8b8', borderRadius: '3px' }}
                    key={props.settings.midiin_central_degree}
                    defaultValue={centralNote}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val >= 0 && val <= 127) {
                        props.onChange('midiin_central_degree', val);
                        sessionStorage.setItem('midiin_central_degree', val);
                      } else {
                        e.target.value = centralNote;
                      }
                    }}
                  />
                </span>
              </label>
              <p><em>
                Controller not recognised as 2D isomorphic — using sequential mapping.{' '}<br />
                <a href="https://github.com/PLAINSOUND/hexatone/issues/new?title=Controller+geometry+request&body=Controller+name:+" target="_blank">
                  Request geometry integration
                </a>
              </em></p>
            </>
          )}

          {/* ── Channel Transposition — for sequential path only (not 2D map mode) ── */}
          {!using2DMap && (
            <>
              <label>
                Channel Transposition
                <select class="sidebar-input" value={stepsMode}
                  onChange={(e) => setStepsMode(e.target.value)}>
                  <option value="equave">Channels → equaves ({props.settings.equivSteps ?? '…'} steps each)</option>
                  <option value="none">No transposition</option>
                  <option value="custom">Custom…</option>
                </select>
              </label>
              {stepsMode === 'custom' && (
                <label>
                  Degrees per channel
                  <input type="text" inputMode="numeric" class="sidebar-input"
                    key={props.settings.midiin_steps_per_channel}
                    defaultValue={props.settings.midiin_steps_per_channel ?? ''}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value.trim());
                      if (!isNaN(val) && val >= 1) {
                        props.onChange('midiin_steps_per_channel', val);
                        sessionStorage.setItem('midiin_steps_per_channel', String(val));
                      } else {
                        e.target.value = props.settings.midiin_steps_per_channel ?? '';
                      }
                    }}
                  />
                </label>
              )}
            </>
          )}

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
    midiin_central_degree: PropTypes.number,
    midiin_steps_per_channel: PropTypes.number,
    midi_passthrough: PropTypes.bool,
    wheel_to_recent: PropTypes.bool,
    center_degree: PropTypes.number,
    equivSteps: PropTypes.number,
  }).isRequired,
  midi: PropTypes.object,
  midiLearnActive: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
};

export default MIDIio;