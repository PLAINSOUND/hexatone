import { h } from 'preact';
import PropTypes from 'prop-types';
import { detectController } from '../../controllers/registry.js';
import { downloadLtn, DEFAULT_CENTRAL_BOARD, DEFAULT_CENTRAL_KEY, DEFAULT_CENTRAL_CHANNEL, DEFAULT_CENTRAL_NOTE } from '../scale/lumatone-export.js';
import { scalaToCents } from '../scale/parse-scale.js';

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
  // anchorChannel for the 2D controller map (Lumatone): stored in lumatone_center_channel.
  const anchorChannel = props.settings.lumatone_center_channel ?? ctrl?.anchorChannelDefault ?? null;
  // For multi-channel 2D controllers (Lumatone), the anchor note within the block is
  // stored in lumatone_center_note (0–55), not midiin_central_degree (0–127).
  const lumatoneAnchorNote = props.settings.lumatone_center_note ?? ctrl?.anchorDefault ?? 26;
  // anchorChannel for sequential / step-arithmetic path: stored in midiin_anchor_channel.
  const seqAnchorChannel = props.settings.midiin_anchor_channel ?? 1;

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
              {/* Anchor: the physical key whose MIDI note (and channel, for multi-channel
                  controllers like Lumatone) maps to the central screen degree.
                  Used in both 2D-map mode and bypass mode. */}
              <label>
                Anchor Key → Central Degree ({center_degree})
                <span class="sidebar-input" style={{ display: 'flex', gap: '4px', alignItems: 'center', textAlign: 'left' }}>
                  <button type="button"
                    onClick={() => props.onChange('midiLearnAnchor', !props.midiLearnActive)}
                    style={{ fontSize: '0.8em', whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0 }}>
                    {props.midiLearnActive ? '● Listening…' : 'Learn'}
                  </button>
                  {/* Channel field — shown for all known controllers.
                      Editable for multi-channel controllers (e.g. Lumatone);
                      greyed-out fixed "1" for single-channel controllers (e.g. AXIS-49). */}
                  {ctrl && (
                    ctrl.anchorChannelDefault != null ? (
                      <input name="lumatone_center_channel" type="text" inputMode="numeric"
                        title="MIDI channel of anchor key (1–5 for Lumatone)"
                        style={{ width: '2.2em', textAlign: 'center', height: '1.5em', boxSizing: 'border-box', background: '#faf9f8', border: '1px solid #c8b8b8', borderRadius: '3px', flexShrink: 0 }}
                        key={anchorChannel}
                        defaultValue={anchorChannel}
                        onBlur={(e) => {
                          const val = parseInt(e.target.value);
                          if (!isNaN(val) && val >= 1 && val <= 16) {
                            props.onChange('lumatone_center_channel', val);
                            sessionStorage.setItem('lumatone_center_channel', val);
                            // Keep midiin_anchor_channel in sync so sequential/passthrough
                            // mode uses the same anchor channel as the 2D map.
                            props.onChange('midiin_anchor_channel', val);
                            sessionStorage.setItem('midiin_anchor_channel', val);
                          } else {
                            e.target.value = anchorChannel;
                          }
                        }}
                      />
                    ) : (
                      <input type="text" value="1" disabled
                        title="Single-channel controller (ch 1)"
                        style={{ width: '2.2em', textAlign: 'center', height: '1.5em', boxSizing: 'border-box', background: '#f0eded', border: '1px solid #c8b8b8', borderRadius: '3px', flexShrink: 0, color: '#999', cursor: 'default' }}
                      />
                    )
                  )}
                  {/* Multi-channel 2D controllers (Lumatone) store the anchor block-note
                      in lumatone_center_note (0–55). Single-channel / sequential path
                      uses midiin_central_degree (0–127). */}
                  {ctrl?.multiChannel ? (
                    <input name="lumatone_center_note" type="text" inputMode="numeric"
                      title="Note number within anchor block (0–55)"
                      style={{ flex: 1, minWidth: 0, width: 'auto', textAlign: 'right', height: '1.5em', boxSizing: 'border-box', background: '#faf9f8', border: '1px solid #c8b8b8', borderRadius: '3px' }}
                      key={lumatoneAnchorNote}
                      defaultValue={lumatoneAnchorNote}
                      onBlur={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val) && val >= 0 && val <= 55) {
                          props.onChange('lumatone_center_note', val);
                          sessionStorage.setItem('lumatone_center_note', String(val));
                        } else {
                          e.target.value = lumatoneAnchorNote;
                        }
                      }}
                    />
                  ) : (
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
                  )}
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

              {/* ── Lumatone LED colour sync + layout ── */}
              {ctrl?.id === 'lumatone' && (
                <>
                  {/* LED sync only makes sense in 2D geometry mode */}
                  {!props.settings.midi_passthrough && (
                    <>
                      <label style={{ fontStyle: 'italic', color: props.lumatoneRawPorts ? '#669966' : '#996666', marginTop: '0.5em' }}>
                        LED Output
                        <span class="sidebar-input" style={{ textAlign: 'right', fontSize: '0.85em' }}>
                          {props.lumatoneRawPorts
                            ? `Connected — ${props.lumatoneRawPorts.output.name}`
                            : 'Not found (output port unavailable)'}
                        </span>
                      </label>
                      {props.lumatoneRawPorts && (
                        <label>
                          Auto-Send Colors
                          <span style={{ display: 'flex', alignItems: 'center',
                                         gap: '8px', marginLeft: 'auto', marginTop: '4px' }}>
                            <input
                              name="lumatone_led_sync"
                              type="checkbox"
                              checked={!!props.settings.lumatone_led_sync}
                              onChange={(e) => {
                                props.onChange('lumatone_led_sync', e.target.checked);
                                sessionStorage.setItem('lumatone_led_sync', e.target.checked);
                                if (e.target.checked) props.keysRef?.current?.syncLumatoneLEDs?.();
                              }}
                            />
                            <button type="button" style={{ fontSize: '0.85em' }}
                              onClick={() => props.keysRef?.current?.syncLumatoneLEDs?.()}
                            >Sync now</button>
                          </span>
                        </label>
                      )}
                    </>
                  )}
                  <label>
                    {props.settings.midi_passthrough ? 'Layout file for sequential mode' : 'Layout file (.ltn)'}
                    <span style={{ display: 'flex', alignItems: 'center',
                                   gap: '8px', marginLeft: 'auto', marginTop: '4px' }}>
                      {props.lumatoneRawPorts && (
                        <button
                          type="button"
                          style={{ fontSize: '0.85em' }}
                          title="Send notes + colours to Lumatone via sysex (~10–15 s, one-time setup)"
                          onClick={() => props.keysRef?.current?.sendLumatoneLayout?.()}
                        >
                          Send to Lumatone
                        </button>
                      )}
                      <button
                        type="button"
                        style={{ fontSize: '0.85em' }}
                        title="Download as .ltn file for Lumatone Editor"
                        onClick={() => {
                          const ch0  = props.settings.lumatone_center_channel != null
                            ? props.settings.lumatone_center_channel - 1
                            : DEFAULT_CENTRAL_CHANNEL;
                          const note = props.settings.lumatone_center_note  != null
                            ? props.settings.lumatone_center_note
                            : DEFAULT_CENTRAL_NOTE;
                          const safeName = (props.settings.name || 'hexatone')
                            .replace(/[^a-zA-Z0-9_-]/g, '_');
                          downloadLtn(props.settings, {
                            centralBoard:    DEFAULT_CENTRAL_BOARD,
                            centralKeyIndex: DEFAULT_CENTRAL_KEY,
                            centralChannel:  ch0,
                            centralNote:     note,
                          }, `${safeName}.ltn`);
                        }}
                      >
                        Download
                      </button>
                    </span>
                  </label>
                </>
              )}
            </>
          ) : (
            /* ── Unknown / sequential controller ── */
            <>
              <label>
                Anchor Note → Central Degree ({center_degree})
                <span class="sidebar-input" style={{ display: 'flex', gap: '4px', alignItems: 'center', textAlign: 'left' }}>
                  <button type="button"
                    onClick={() => props.onChange('midiLearnAnchor', !props.midiLearnActive)}
                    style={{ fontSize: '0.8em', whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0 }}>
                    {props.midiLearnActive ? '● Listening…' : 'Learn'}
                  </button>
                  {/* Anchor channel — editable so keyboard splits / multi-channel devices
                      can set which channel is the reference for transposition. */}
                  <input name="midiin_anchor_channel" type="text" inputMode="numeric"
                    title="MIDI channel of anchor note (other channels shift by stepsPerChannel)"
                    style={{ width: '2.2em', textAlign: 'center', height: '1.5em', boxSizing: 'border-box', background: '#faf9f8', border: '1px solid #c8b8b8', borderRadius: '3px', flexShrink: 0 }}
                    key={seqAnchorChannel}
                    defaultValue={seqAnchorChannel}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val >= 1 && val <= 16) {
                        props.onChange('midiin_anchor_channel', val);
                        sessionStorage.setItem('midiin_anchor_channel', val);
                      } else {
                        e.target.value = seqAnchorChannel;
                      }
                    }}
                  />
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
              <label title="Wrap channels 9–16 to 1–8 before computing transposition offset. Enable for Lumatone mappings that use channels 9–13.">
                Channels mod 8 (legacy)
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
            </>
          )}

          <label style={{ marginTop: '0.8em' }}>
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

          {props.settings.wheel_to_recent && (
            <>
              <label style={{ opacity: props.settings.wheel_scale_aware ? 0.4 : 1 }}>
                Wheel range (Scala)
                <input
                  type="text"
                  style={{ width: '5em' }}
                  disabled={!!props.settings.wheel_scale_aware}
                  value={props.settings.midi_wheel_range ?? '9/8'}
                  onChange={(e) => {
                    props.onChange('midi_wheel_range', e.target.value);
                    sessionStorage.setItem('midi_wheel_range', e.target.value);
                  }}
                />
                <span style={{ marginLeft: '0.5em', color: '#666', fontSize: '0.85em' }}>
                  {(() => {
                    try {
                      const c = scalaToCents(props.settings.midi_wheel_range ?? '9/8');
                      return isFinite(c) ? `${c.toFixed(1)} ¢` : '';
                    } catch { return ''; }
                  })()}
                </span>
              </label>

              {/*
              <label>
                Scale-aware (asymmetric)
                <input
                  name="wheel_scale_aware"
                  type="checkbox"
                  checked={!!props.settings.wheel_scale_aware}
                  onChange={(e) => {
                    props.onChange('wheel_scale_aware', e.target.checked);
                    sessionStorage.setItem('wheel_scale_aware', e.target.checked);
                  }}
                />
              </label>*/}
            </>
          )}
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
    midiin_channel_legacy: PropTypes.bool,
    lumatone_center_channel: PropTypes.number,
    lumatone_center_note: PropTypes.number,
    lumatone_led_sync: PropTypes.bool,
    wheel_to_recent: PropTypes.bool,
    midi_wheel_range: PropTypes.string,
    wheel_scale_aware: PropTypes.bool,
    center_degree: PropTypes.number,
    equivSteps: PropTypes.number,
    name: PropTypes.string,
  }).isRequired,
  midi: PropTypes.object,
  midiLearnActive: PropTypes.bool,
  lumatoneRawPorts: PropTypes.object,
  keysRef: PropTypes.object,
  onChange: PropTypes.func.isRequired,
};

export default MIDIio;