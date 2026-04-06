import { h } from 'preact';
import { useState } from 'preact/hooks';
import PropTypes from 'prop-types';
import { detectController } from '../../controllers/registry.js';
import { saveControllerPref } from '../../input/controller-anchor.js';
import ScalaInput from '../scale/scala-input.js';

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

  // Channel Transposition is shown when sequential arithmetic is meaningful:
  //   - not in active 2D geometry mode
  //   - AND not a multichannel controller (Lumatone, LinnStrument, TonalPlexus —
  //     their channels encode layout geometry, not keyboard splits)
  const scaleMode = (props.settings.midiin_mapping_target || 'hex_layout') === 'scale';
  const using2DMap = ctrl && !props.settings.midi_passthrough;
  // Channel Transposition is shown when sequential channel-offset arithmetic is meaningful:
  //   - not in active 2D geometry mode
  //   - not when MPE is on (channels carry per-voice expression, not splits)
  //   - not for single-channel known controllers (AXIS-49, TS41, Push, Launchpad, Exquis)
  //     — they only ever send on one channel so transposition has no effect
  //   - shown for unknown controllers (may be a multichannel keyboard split)
  //   - shown for multichannel non-MPE controllers in sequential/bypass mode (Lumatone)
  //   - hidden in scale mode (pitch is mapped directly; geometry/channel layout irrelevant)
  const isMultiChannelSequential = !ctrl || ctrl.multiChannel;
  const showChannelTranspose = !scaleMode && !using2DMap && !props.settings.midiin_mpe_input && isMultiChannelSequential;
  const showExquisBendControls = !(ctrl?.id === 'exquis' && !props.settings.midiin_mpe_input);
  const showWheelToRecent = !(ctrl?.id === 'exquis' && !props.settings.midiin_mpe_input);

  // mpeSetupOpen removed — MPE options are shown flat when MPE is enabled.

  // Exquis dev mode test panel state
  const [exquisDevOpen, setExquisDevOpen] = useState(false);
  const [devMaskBits, setDevMaskBits] = useState(0x01); // bitmask built from checkboxes
  const [devZone, setDevZone] = useState('100');   // button/encoder CC id (ch 16)
  const [devValue, setDevValue] = useState('127');  // value to send
  const [devPadId, setDevPadId] = useState('0');   // pad ID for CMD 04 color test (0–60)

  return (
    <fieldset>
      <legend><b>MIDI In from Controller</b></legend>
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
        Input Mode
        <select
          class="sidebar-input"
          value={props.settings.midiin_mapping_target || 'hex_layout'}
          onChange={(e) => {
            props.onChange('midiin_mapping_target', e.target.value);
            sessionStorage.setItem('midiin_mapping_target', e.target.value);
          }}
        >
          <option value="hex_layout">MIDI to Hex Layout</option>
          <option value="scale">MIDI to Nearest Scale Degree</option>
        </select>
      </label>

      {(props.settings.midiin_mapping_target || 'hex_layout') === 'scale' && (
        <>
          <label title="Maximum distance in cents before a note is considered out of tolerance">
            Tolerance (cents)
            <input
              type="text"
              inputMode="numeric"
              class="sidebar-input"
              key={props.settings.midiin_scale_tolerance ?? 25}
              defaultValue={props.settings.midiin_scale_tolerance ?? 25}
              onBlur={(e) => {
                const v = parseInt(e.target.value);
                if (!isNaN(v) && v >= 0) {
                  props.onChange('midiin_scale_tolerance', v);
                  sessionStorage.setItem('midiin_scale_tolerance', String(v));
                } else {
                  e.target.value = props.settings.midiin_scale_tolerance ?? 25;
                }
              }}
            />
          </label>
          <label title="What to do when no scale degree is within tolerance">
            Out of tolerance
            <select
              class="sidebar-input"
              value={props.settings.midiin_scale_fallback || 'accept'}
              onChange={(e) => {
                props.onChange('midiin_scale_fallback', e.target.value);
                sessionStorage.setItem('midiin_scale_fallback', e.target.value);
              }}
            >
              <option value="discard">Discard</option>
              <option value="accept">Accept Best</option>
            </select>
          </label>
        </>
      )}

      {props.settings.midiin_device && props.settings.midiin_device !== 'OFF' && (
        <>
          {/* ── MPE / Poly-AT Input ─────────────────────────────────────────────
              Shown first — MPE mode changes the meaning of all controls below it.
              Shown for MPE-capable controllers and unknown controllers.
              See claude-context/midi-input-ux.md for the full visibility spec. */}
          {(!ctrl || ctrl.mpe) && (
            <>
              <label>
                Enable MPE Input
                <input
                  name="midiin_mpe_input"
                  type="checkbox"
                  checked={!!props.settings.midiin_mpe_input}
                  onChange={(e) => {
                    props.onChange('midiin_mpe_input', e.target.checked);
                    saveControllerPref(
                      ctrl,
                      'midiin_mpe_input',
                      e.target.checked,
                      props.settings,
                      { midiin_mpe_input: e.target.checked },
                    );
                  }}
                />
              </label>

              {/* Voice channel range — shown when MPE is on */}
              {props.settings.midiin_mpe_input && !ctrl?.mpeVoiceChannels && (
                <label title="Voice data channels (ch 1 and 16 are typically MPE manager/global channels)">
                  Voice channels {props.settings.midiin_mpe_lo_ch ?? 2}–{props.settings.midiin_mpe_hi_ch ?? 15}
                  <span class="sidebar-input" style={{ display: 'flex', gap: '4px', alignItems: 'center', justifyContent: 'flex-end' }}>
                    <input
                      type="text"
                      inputMode="numeric"
                      key={props.settings.midiin_mpe_lo_ch ?? 2}
                      defaultValue={props.settings.midiin_mpe_lo_ch ?? 2}
                      style={{ width: '2.2em', textAlign: 'center', height: '1.5em', boxSizing: 'border-box', background: '#faf9f8', border: '1px solid #c8b8b8', borderRadius: '3px', flexShrink: 0 }}
                      onBlur={(e) => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v) && v >= 1 && v <= 16) {
                          props.onChange('midiin_mpe_lo_ch', v);
                          sessionStorage.setItem('midiin_mpe_lo_ch', String(v));
                        } else {
                          e.target.value = props.settings.midiin_mpe_lo_ch ?? 2;
                        }
                      }}
                    />
                    <span>–</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      key={props.settings.midiin_mpe_hi_ch ?? 15}
                      defaultValue={props.settings.midiin_mpe_hi_ch ?? 15}
                      style={{ width: '2.2em', textAlign: 'center', height: '1.5em', boxSizing: 'border-box', background: '#faf9f8', border: '1px solid #c8b8b8', borderRadius: '3px', flexShrink: 0 }}
                      onBlur={(e) => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v) && v >= 1 && v <= 16) {
                          props.onChange('midiin_mpe_hi_ch', v);
                          sessionStorage.setItem('midiin_mpe_hi_ch', String(v));
                        } else {
                          e.target.value = props.settings.midiin_mpe_hi_ch ?? 15;
                        }
                      }}
                    />
                  </span>
                </label>
              )}
              {props.settings.midiin_mpe_input && ctrl?.mpeVoiceChannels && (
                <label title="Voice channel range is fixed by this controller's hardware configuration">
                  Voice channels
                  <span class="sidebar-input" style={{ color: '#888', fontStyle: 'italic' }}>
                    {ctrl.mpeVoiceChannels.lo}–{ctrl.mpeVoiceChannels.hi} (fixed)
                  </span>
                </label>
              )}
            </>
          )}

          {/* ── Controller description in scale mode ── */}
          {scaleMode && ctrl?.descriptionScale && (
            <label style={{ fontStyle: 'italic', color: '#996666', marginBottom: '0.5em' }}>
              {ctrl.name}
              <span class="sidebar-input" style={{ textAlign: 'right', fontSize: '0.85em', lineHeight: 1 }}>
                {ctrl.descriptionScale}
              </span>
            </label>
          )}
          {/* ── Known 2D controller / sequential anchor ── hidden in scale mode */}
          {!scaleMode && (ctrl ? (
            <>
              <label style={{ fontStyle: 'italic', color: '#996666', marginBottom: '0.5em' }}>
                {ctrl.name}
                <span class="sidebar-input" style={{ textAlign: 'right', fontSize: '0.85em', lineHeight: 1 }}>
                  {ctrl.description}
                </span>
              </label>
              {/* Anchor: the physical key whose MIDI note (and channel, for multi-channel
                  controllers like Lumatone) maps to the central screen degree.
                  Used in both 2D-map mode and bypass mode. */}
              <label class="center-degree-row center-degree-label">
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
                    saveControllerPref(
                      ctrl,
                      'midi_passthrough',
                      e.target.checked,
                      props.settings,
                      { midi_passthrough: e.target.checked },
                    );
                  }}
                />
              </label>

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
                          Auto Send Colours
                          <span style={{ display: 'flex', alignItems: 'center',
                                         gap: '8px', marginLeft: 'auto', marginTop: '4px' }}>
                            <input
                              name="lumatone_led_sync"
                              type="checkbox"
                              checked={!!props.settings.lumatone_led_sync}
                              onChange={(e) => {
                                props.onChange('lumatone_led_sync', e.target.checked);
                                localStorage.setItem('lumatone_led_sync', e.target.checked);
                                const keys = props.keysRef?.current;
                                if (keys) keys.settings.lumatone_led_sync = e.target.checked;
                                if (e.target.checked) keys?.syncLumatoneLEDs?.();
                              }}
                            />
                            <button type="button" style={{ fontSize: '0.85em' }}
                              onClick={() => props.keysRef?.current?.syncLumatoneLEDs?.()}
                            >Send Now</button>
                          </span>
                        </label>
                      )}
                    </>
                  )}
                  {/* Layout file (.ltn) — TODO: reimplement export using registry geometry */}
                  {!props.settings.midi_passthrough && props.lumatoneRawPorts && (
                    <label>
                      Send to Lumatone
                      <span style={{ display: 'flex', alignItems: 'center',
                                     gap: '8px', marginLeft: 'auto', marginTop: '4px' }}>
                        <button
                          type="button"
                          style={{ fontSize: '0.85em' }}
                          title="Send notes + colours to Lumatone via sysex (~10–15 s, one-time setup)"
                          onClick={() => props.keysRef?.current?.sendLumatoneLayout?.()}
                        >
                          Send Now
                        </button>
                      </span>
                    </label>
                  )}
                </>
              )}

              {/* ── Exquis LED colour sync — App Mode (pad_remote=0), hex layout only ── */}
              {ctrl?.id === 'exquis' && !scaleMode && (() => {
                const ledStatus = props.exquisLedStatus; // null | { ok: true } | { ok: false, reason }
                const portConnected = !!props.exquisRawPorts;
                // Colour and status text for the LED Output line:
                //   no port       → red,   "Not found (output port unavailable)"
                //   port, pending → green, "Connected — <name>"
                //   port, ok      → green, "Connected — <name>"
                //   port, failed  → red,   "Firmware x found: please update to use key colours"
                const isFailed = portConnected && ledStatus && !ledStatus.ok;
                const labelColor = (!portConnected || isFailed) ? '#996666' : '#669966';
                const statusText = !portConnected
                  ? 'Not found (output port unavailable)'
                  : isFailed
                    ? `Firmware ${ledStatus.reason} found: please update to use key colours`
                    : `Connected — ${props.exquisRawPorts.output.name}`;
                return (
                  <>
                    <label style={{ fontStyle: 'italic', color: labelColor, marginTop: '0.5em' }}>
                      LED Output
                      <span class="sidebar-input" style={{ textAlign: 'right', fontSize: '0.85em' }}>
                        {statusText}
                      </span>
                    </label>
                    {portConnected && !isFailed && (
                      <>
                        <label>
                          Auto Send Colours
                          <span style={{ display: 'flex', alignItems: 'center',
                                         gap: '8px', marginLeft: 'auto', marginTop: '4px' }}>
                            <input
                              name="exquis_led_sync"
                              type="checkbox"
                              checked={!!props.settings.exquis_led_sync}
                              onChange={(e) => {
                                props.onChange('exquis_led_sync', e.target.checked);
                                localStorage.setItem('exquis_led_sync', e.target.checked);
                                const keys = props.keysRef?.current;
                                if (keys) keys.settings.exquis_led_sync = e.target.checked;
                                if (e.target.checked) keys?.syncExquisLEDs?.();
                                else keys?.exquisLEDs?.clearColors?.();
                              }}
                            />
                            <button type="button" style={{ fontSize: '0.85em' }}
                              onClick={() => props.keysRef?.current?.syncExquisLEDs?.()}
                            >Send Now</button>
                            <button type="button" style={{ fontSize: '0.85em' }}
                              onClick={() => props.keysRef?.current?.exquisLEDs?.clearColors?.()}
                            >Clear</button>
                          </span>
                        </label>
                        <label>
                          LED Brightness
                          <span class="sidebar-input" style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                            <input
                              type="range"
                              min="0" max="100" step="1"
                              value={props.settings.exquis_led_luminosity ?? 15}
                              style={{ width: '100%' }}
                              onInput={(e) => {
                                const v = parseInt(e.target.value);
                                props.onChange('exquis_led_luminosity', v);
                                localStorage.setItem('exquis_led_luminosity', String(v));
                                props.keysRef?.current?.exquisLEDs?.setLuminosity(v);
                              }}
                            />
                            <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: '2.5em', textAlign: 'right', fontSize: '0.85em' }}>
                              {props.settings.exquis_led_luminosity ?? 15}
                            </span>
                          </span>
                        </label>
                        <label>
                          LED Saturation
                          <span class="sidebar-input" style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                            <input
                              type="range"
                              min="0.75" max="2.5" step="0.01"
                              value={props.settings.exquis_led_saturation ?? 1.3}
                              style={{ width: '100%' }}
                              onInput={(e) => {
                                const v = parseFloat(e.target.value);
                                props.onChange('exquis_led_saturation', v);
                                localStorage.setItem('exquis_led_saturation', String(v));
                                props.keysRef?.current?.exquisLEDs?.setSaturation(v);
                              }}
                            />
                            <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: '2.5em', textAlign: 'right', fontSize: '0.85em' }}>
                              {(() => { const v = props.settings.exquis_led_saturation ?? 1.3; return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2); })()}
                            </span>
                          </span>
                        </label>
                      </>
                    )}
                  </>
                );
              })()}

              {/* ── Exquis Dev Mode test panel ── disabled: dev mode takes over pads,
                  leaving only note-on ch16 (no MPE expression). Left here for future
                  firmware update that may expose LED control without dev mode takeover. */}
              {false && ctrl?.id === 'exquis' && props.exquisRawPorts && (
                <>
                  <label style={{ marginTop: '0.6em', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setExquisDevOpen(o => !o)}>
                    {exquisDevOpen ? '▾' : '▸'} Dev Mode Test
                    <span class="sidebar-input" />
                  </label>

                  {exquisDevOpen && (() => {
                    const out = props.exquisRawPorts.output;
                    const DUALO = [0xF0, 0x00, 0x21, 0x7E, 0x7F];
                    return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>

                      {/* Enter / Exit dev mode — zone bitmask via checkboxes */}
                      {[
                        { bit: 0x01, label: 'Pads' },
                        { bit: 0x02, label: 'Encoders' },
                        { bit: 0x04, label: 'Slider' },
                        { bit: 0x08, label: 'Up/Down buttons' },
                        { bit: 0x10, label: 'Settings/Sound buttons' },
                        { bit: 0x20, label: 'All other buttons' },
                      ].map(({ bit, label }) => (
                        <label key={bit}>
                          {label}
                          <input type="checkbox"
                            checked={!!(devMaskBits & bit)}
                            onChange={e => setDevMaskBits(b => e.target.checked ? b | bit : b & ~bit)}
                          />
                        </label>
                      ))}
                      <label>
                        Dev mode (mask: {devMaskBits.toString(16).toUpperCase().padStart(2, '0')})
                        <span class="sidebar-input" style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                          <button type="button" style={{ fontSize: '0.85em' }}
                            onClick={() => out.send([...DUALO, 0x00, devMaskBits, 0xF7])}>
                            Enter</button>
                          <button type="button" style={{ fontSize: '0.85em' }}
                            onClick={() => out.send([...DUALO, 0x00, 0x00, 0xF7])}>
                            Exit</button>
                        </span>
                      </label>

                      {/* CMD 04 — direct RGB (in dev mode) */}
                      <label style={{ marginTop: '0.4em' }} title="CMD 04: set pad color directly. Device must be in dev mode.">
                        Pad color test
                        <span class="sidebar-input" style={{ display: 'flex', gap: '4px', alignItems: 'center', justifyContent: 'flex-end' }}>
                          <span style={{ fontSize: '0.85em', color: '#666' }}>pad</span>
                          <input type="text" inputMode="numeric"
                            value={devPadId}
                            onChange={e => setDevPadId(e.target.value)}
                            style={{ width: '2.5em', textAlign: 'center', height: '1.5em', boxSizing: 'border-box', background: '#faf9f8', border: '1px solid #c8b8b8', borderRadius: '3px' }}
                          />
                          <button type="button" style={{ fontSize: '0.85em', background: '#c00', color: '#fff', border: 'none', borderRadius: '3px', padding: '0 6px', cursor: 'pointer' }}
                            onClick={() => {
                              const id = parseInt(devPadId);
                              if (isNaN(id) || id < 0 || id > 60) return;
                              out.send([...DUALO, 0x04, id, 127, 0, 0, 0x00, 0xF7]);
                            }}>Red</button>
                          <button type="button" style={{ fontSize: '0.85em' }}
                            onClick={() => {
                              const payload = [...DUALO, 0x04, 0x00];
                              for (let i = 0; i < 61; i++) payload.push(127, 0, 0, 0x00);
                              payload.push(0xF7);
                              out.send(payload);
                            }}>All red</button>
                        </span>
                      </label>

                      {/* CMD 02 — palette write + CC ch16 trigger (outside dev mode) */}
                      <label style={{ marginTop: '0.4em' }} title="CMD 02: write bright red into palette slot 0, then trigger it via CC ch16. Tests whether palette colors work outside dev mode.">
                        Palette test
                        <span class="sidebar-input" style={{ display: 'flex', gap: '4px', alignItems: 'center', justifyContent: 'flex-end' }}>
                          <span style={{ fontSize: '0.85em', color: '#666' }}>pad</span>
                          <input type="text" inputMode="numeric"
                            value={devPadId}
                            onChange={e => setDevPadId(e.target.value)}
                            style={{ width: '2.5em', textAlign: 'center', height: '1.5em', boxSizing: 'border-box', background: '#faf9f8', border: '1px solid #c8b8b8', borderRadius: '3px' }}
                          />
                          <button type="button" style={{ fontSize: '0.85em' }}
                            title="Write red into palette slot 0 via CMD 02 (works in or out of dev mode)"
                            onClick={() => {
                              // CMD 02: write 1 color at index 0 — bright red (127, 0, 0)
                              out.send([...DUALO, 0x02, 0x00, 127, 0, 0, 0xF7]);
                            }}>Write palette</button>
                          <button type="button" style={{ fontSize: '0.85em' }}
                            title="Trigger palette slot 0 on this pad via CC ch16 (BF pad 0x00)"
                            onClick={() => {
                              const id = parseInt(devPadId);
                              if (isNaN(id) || id < 0 || id > 60) return;
                              // BF = CC on ch 16; id = pad/control ID; value = palette index
                              out.send([0xBF, id & 0x7F, 0x00]);
                            }}>Trigger CC</button>
                        </span>
                      </label>

                      {/* Send CC on ch 16 — button/encoder raw test */}
                      <label style={{ marginTop: '0.3em' }}>
                        Ch 16 CC id
                        <span class="sidebar-input" style={{ display: 'flex', gap: '4px', alignItems: 'center', justifyContent: 'flex-end' }}>
                          <select value={devZone} onChange={e => setDevZone(e.target.value)}
                            style={{ height: '1.5em', fontSize: '0.9em', background: '#faf9f8', border: '1px solid #c8b8b8', borderRadius: '3px' }}>
                            <optgroup label="Settings buttons">
                              <option value="100">100 — Settings (1)</option>
                              <option value="101">101 — Sound / Settings (2)</option>
                            </optgroup>
                            <optgroup label="Transport buttons">
                              <option value="102">102 — Record</option>
                              <option value="103">103 — Loop</option>
                              <option value="104">104 — Clips</option>
                              <option value="105">105 — Play/Stop</option>
                              <option value="106">106 — Down</option>
                              <option value="107">107 — Up</option>
                              <option value="108">108 — Undo</option>
                              <option value="109">109 — Redo</option>
                            </optgroup>
                            <optgroup label="Encoders (turn: value = 64+delta)">
                              <option value="110">110 — Encoder 1</option>
                              <option value="111">111 — Encoder 2</option>
                              <option value="112">112 — Encoder 3</option>
                              <option value="113">113 — Encoder 4</option>
                            </optgroup>
                          </select>
                        </span>
                      </label>
                      <label title="7F=press/on, 00=release/off; encoder turn: 65=+1 CW, 63=-1 CCW">
                        Value
                        <span class="sidebar-input" style={{ display: 'flex', gap: '4px', alignItems: 'center', justifyContent: 'flex-end' }}>
                          <input type="text" inputMode="numeric"
                            value={devValue}
                            onChange={e => setDevValue(e.target.value)}
                            style={{ width: '3em', textAlign: 'center', height: '1.5em', boxSizing: 'border-box', background: '#faf9f8', border: '1px solid #c8b8b8', borderRadius: '3px' }}
                          />
                          <button type="button" style={{ fontSize: '0.85em' }}
                            onClick={() => {
                              const cc = parseInt(devZone);
                              const val = parseInt(devValue);
                              if (isNaN(cc) || isNaN(val)) return;
                              out.send([0xBF, cc & 0x7F, val & 0x7F]);
                            }}>CC</button>
                          <button type="button" style={{ fontSize: '0.85em' }}
                            onClick={() => {
                              const note = parseInt(devZone);
                              const vel = parseInt(devValue);
                              if (isNaN(note) || isNaN(vel)) return;
                              out.send([0x9F, note & 0x7F, vel & 0x7F]);
                            }}>Note</button>
                        </span>
                      </label>
                    </div>
                    );
                  })()}
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
            </>
          ))}

          {/* ── Channel Transposition — sequential single-channel path only.
              Hidden for active 2D geometry mode AND for multichannel controllers
              (Lumatone, LinnStrument, TonalPlexus — channels encode layout, not splits). */}
          {showChannelTranspose && (
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

          {/* Pitch Wheel → Most Recent Note — shown only when MPE is off */}
          {!props.settings.midiin_mpe_input && showWheelToRecent && (
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
          )}

          {/* ── Pitch Bend Interval ──────────────────────────────────────────────
              Form A (Scala): MPE on OR wheel-to-recent on.
                midiin_bend_range — ±full deflection maps to this interval.
                Set hardware to max range (e.g. Exquis encoder2=48) for resolution.
              Form B (12edo semitones): MPE off AND wheel-to-recent off.
                midi_wheel_semitones — raw PB passthrough; sample synth retuned directly.
              See claude-context/midi-input-ux.md for full spec. */}
          {showExquisBendControls && ((props.settings.midiin_mpe_input || props.settings.wheel_to_recent) ? (
            <label title="Pitch Bend Interval: the musical interval that ±full deflection maps to. Set hardware to max range for best resolution.">
              Pitch Bend Interval (Scala)
              <ScalaInput
                context="interval"
                value={props.settings.midiin_bend_range ?? '64/63'}
                onChange={(str) => {
                  props.onChange('midiin_bend_range', str);
                  saveControllerPref(null, 'midiin_bend_range', str);
                }}
                wrapperClass="sidebar-input"
                style={{ width: '5em', textAlign: 'center', height: '1.5em', boxSizing: 'border-box', background: '#faf9f8', borderRadius: '3px' }}
              />
            </label>
          ) : (
            <label title="Standard wheel range in 12-edo semitones. Raw pitch bend passes through to all MIDI outputs; user adjusts range to match in their synth.">
              Pitch Bend Interval (12edo semitones)
              <input
                type="number"
                min="0"
                max="24"
                style={{ width: '3.5em' }}
                value={props.settings.midi_wheel_semitones ?? 2}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value);
                  const v = Math.max(0, Math.min(24, isNaN(parsed) ? 2 : parsed));
                  props.onChange('midi_wheel_semitones', v);
                  sessionStorage.setItem('midi_wheel_semitones', v);
                }}
              />
            </label>
          ))}

          {/* Reverse Bend Direction — always shown when device is connected */}
          {showExquisBendControls && <label title="Reverse pitch bend direction — useful when the controller surface is oriented so that sliding towards higher pitch sends negative bend values.">
            Reverse Bend Direction
            <input
              type="checkbox"
              checked={!!props.settings.midiin_bend_flip}
              onChange={(e) => {
                props.onChange('midiin_bend_flip', e.target.checked);
                saveControllerPref(ctrl, 'midiin_bend_flip', e.target.checked, props.settings);
              }}
            />
          </label>}
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
    midi_wheel_semitones: PropTypes.number,
    wheel_scale_aware: PropTypes.bool,
    midiin_mpe_input: PropTypes.bool,
    midiin_mpe_lo_ch: PropTypes.number,
    midiin_mpe_hi_ch: PropTypes.number,
    midiin_bend_range: PropTypes.string,
    midiin_bend_flip: PropTypes.bool,
    center_degree: PropTypes.number,
    equivSteps: PropTypes.number,
    name: PropTypes.string,
  }).isRequired,
  midi: PropTypes.object,
  midiLearnActive: PropTypes.bool,
  lumatoneRawPorts: PropTypes.object,
  exquisRawOutput: PropTypes.object,
  keysRef: PropTypes.object,
  onChange: PropTypes.func.isRequired,
};

export default MIDIio;
