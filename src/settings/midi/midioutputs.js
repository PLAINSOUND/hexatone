import { h } from 'preact';
import { WebMidi } from 'webmidi';
import PropTypes from 'prop-types';

const voiceChannels = (masterCh) => {
  if (masterCh === '1')  return Array.from({ length: 15 }, (_, i) => i + 2);
  if (masterCh === '16') return Array.from({ length: 15 }, (_, i) => i + 1);
  return Array.from({ length: 16 }, (_, i) => i + 1);
};

const save = (name, value, onChange) => {
  onChange(name, value);
  sessionStorage.setItem(name, value);
};

const MidiOutputs = (props) => {
  const { settings, onChange, midi } = props;
  // Central MIDI note: defaults to the same note used for MIDI input (midiin_central_degree + center_degree).
  const center_degree   = settings.center_degree  || 0;
  const centralMidiNote = (settings.midiin_central_degree != null ? settings.midiin_central_degree : 60) + center_degree;
  const tuningMapNote   = settings.tuning_map_degree0 != null ? settings.tuning_map_degree0 : centralMidiNote;
  const masterCh  = settings.mpe_master_ch || '1';
  const available = voiceChannels(masterCh);
  const loCh = available.includes(settings.mpe_lo_ch) ? settings.mpe_lo_ch : available[0];
  const hiCh = available.includes(settings.mpe_hi_ch) ? settings.mpe_hi_ch : Math.min(available[available.length - 1], loCh + 6);

  const outputs = midi ? Array.from(midi.outputs.values()) : [];

  return (
    <fieldset>
      <legend><b>MIDI Outputs</b></legend>

      {/* ── MTS ────────────────────────────────────────────────────────── */}
      <label>
        MTS
        <input name="output_mts" type="checkbox"
          checked={!!settings.output_mts}
          onChange={(e) => save(e.target.name, e.target.checked, onChange)} />
      </label>

      {settings.output_mts && (
        <>
          <label>
            MTS Output Port
            <select name="midi_device" class="sidebar-input"
              value={settings.midi_device || 'OFF'}
              onChange={(e) => save(e.target.name, e.target.value, onChange)}>
              <option value="OFF">OFF</option>
              {outputs.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>

          {settings.midi_device && settings.midi_device !== 'OFF' && (
            <>
              <label>
                MIDI Output Style
                <select name="midi_mapping" class="sidebar-input"
                  value={settings.midi_mapping}
                  onChange={(e) => save(e.target.name, e.target.value, onChange)}>
                  <option>---choose how notes are sent---</option>
                  <option value="MTS1">128-note-polyphonic + real-time MTS</option>
                  <option value="MTS2">Pianoteq-range-polyphonic + real-time MTS</option>
                  <option value="DIRECT">128 MIDI notes follow hex-layout</option>
                </select>
              </label>

              <label>
                Output Channel
                <select name="midi_channel" class="sidebar-input"
                  value={settings.midi_channel}
                  onChange={(e) => save(e.target.name, parseInt(e.target.value), onChange)}>
                  <option value="-1">---place the scale fundamental (1/1 = C4 = note 60)---</option>
                  {[...Array(16).keys()].map(i => <option key={i} value={i}>{i + 1}</option>)}
                </select>
              </label>

              <label>
                Auto-Send 128-note Sysex Map
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
                  <input name="sysex_auto" type="checkbox"
                    checked={!!settings.sysex_auto}
                    onChange={(e) => save(e.target.name, e.target.checked, onChange)} />
                  <button type="button"
                    style={{ fontSize: '0.85em' }}
                    onClick={() => {
                      const output = WebMidi.getOutputById(settings.midi_device);
                      if (output && props.keysRef && props.keysRef.current) {
                        props.keysRef.current.mtsSendMap(output);
                      }
                    }}>
                    Send Map
                  </button>
                </span>
              </label>

              <label>
                Sysex Tuning Map Format
                <select name="sysex_type" class="sidebar-input"
                  value={String(settings.sysex_type)}
                  onChange={(e) => save(e.target.name, parseInt(e.target.value), onChange)}>
                  <option value="127">real-time (127)</option>
                  <option value="126">non-real-time (126)</option>
                </select>
              </label>

              <label>
                Device ID (127 = all)
                <input name="device_id" type="text" inputMode="numeric"
                  class="sidebar-input"
                  key={settings.device_id}
                  defaultValue={settings.device_id}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val) && val >= 0 && val <= 127) save('device_id', val, onChange);
                    else e.target.value = settings.device_id;
                  }} />
              </label>

              <label>
                Tuning Map Number
                <input name="tuning_map_number" type="text" inputMode="numeric"
                  class="sidebar-input"
                  key={settings.tuning_map_number}
                  defaultValue={settings.tuning_map_number}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val) && val >= 0 && val <= 127) save('tuning_map_number', val, onChange);
                    else e.target.value = settings.tuning_map_number;
                  }} />
              </label>

              <label>
                Central MIDI Note
                <input name="tuning_map_degree0" type="text" inputMode="numeric"
                  class="sidebar-input"
                  key={tuningMapNote}
                  defaultValue={tuningMapNote}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val) && val >= 0 && val <= 127) save('tuning_map_degree0', val, onChange);
                    else e.target.value = tuningMapNote;
                  }} />
              </label>

              <p><em>The <a href="/midituning.html">MIDI Tuning Standard</a> allows external synthesizers to receive sysex messages modifying the tuning of each MIDI note. The free <a href="https://oddsound.com/mtsespmini.php">Oddsound MTS-ESP Mini</a> VST plug-in translates MTS data to retune supported client software synths.</em></p>
            </>
          )}
        </>
      )}

      {/* ── MPE ────────────────────────────────────────────────────────── */}
      <label>
        MPE
        <input name="output_mpe" type="checkbox"
          checked={!!settings.output_mpe}
          onChange={(e) => save(e.target.name, e.target.checked, onChange)} />
      </label>

      {settings.output_mpe && (
        <>
          <label>
            MPE Output Port
            <select name="mpe_device" class="sidebar-input"
              value={settings.mpe_device || 'OFF'}
              onChange={(e) => save(e.target.name, e.target.value, onChange)}>
              <option value="OFF">OFF</option>
              {outputs.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>

          {settings.mpe_device && settings.mpe_device !== 'OFF' && (
            <>
              <label>
                Master Channel
                <select name="mpe_master_ch" class="sidebar-input"
                  value={masterCh}
                  onChange={(e) => save(e.target.name, e.target.value, onChange)}>
                  <option value="1">Channel 1</option>
                  <option value="16">Channel 16</option>
                  <option value="none">None</option>
                </select>
              </label>

              <label>
                Voice Low Channel
                <select name="mpe_lo_ch" class="sidebar-input"
                  value={loCh}
                  onChange={(e) => save(e.target.name, parseInt(e.target.value), onChange)}>
                  {available.map(ch => <option key={ch} value={ch} disabled={ch > hiCh}>{ch}</option>)}
                </select>
              </label>

              <label>
                Voice High Channel
                <select name="mpe_hi_ch" class="sidebar-input"
                  value={hiCh}
                  onChange={(e) => save(e.target.name, parseInt(e.target.value), onChange)}>
                  {available.map(ch => <option key={ch} value={ch} disabled={ch < loCh}>{ch}</option>)}
                </select>
              </label>

              <label>
                Active voices
                <span class="sidebar-input" style={{ textAlign: 'right', color: '#996666', fontSize: '0.9em' }}>
                  {loCh}–{hiCh} ({hiCh - loCh + 1} voices)
                </span>
              </label>

              <label>
                Mode
                <select name="mpe_mode" class="sidebar-input"
                  value={settings.mpe_mode || "Ableton_workaround"}
                  onChange={(e) => save(e.target.name, e.target.value, onChange)}>
                  <option value="Ableton_workaround">Ableton workaround (fixed 48)</option>
                  <option value="Full_MPE">Full MPE (user range)</option>
                </select>
              </label>

              {settings.mpe_mode === "Full_MPE" && (
                <label>
                  Pitch Bend Range (semitones)
                  <input name="mpe_pitchbend_range" type="text" inputMode="numeric"
                    class="sidebar-input"
                    key={settings.mpe_pitchbend_range}
                    defaultValue={settings.mpe_pitchbend_range ?? 48}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val >= 1 && val <= 96) save('mpe_pitchbend_range', val, onChange);
                      else e.target.value = settings.mpe_pitchbend_range ?? 48;
                    }} />
                </label>
              )}
              <p>
                <em><a href="https://midi.org/mpe-midi-polyphonic-expression">MIDI Polyphonic Expression</a> is a standard allowing per-note independent modulation of MIDI notes. PLEASE NOTE this feature is under construction and not yet fully functional!</em>
              </p>
            </>
          )}
        </>
      )}
    </fieldset>
  );
};

MidiOutputs.propTypes = {
  settings: PropTypes.shape({
    output_mts:         PropTypes.bool,
    midi_device:        PropTypes.string,
    midi_mapping:       PropTypes.string,
    midi_channel:       PropTypes.number,
    sysex_auto:         PropTypes.bool,
    sysex_type:         PropTypes.number,
    device_id:          PropTypes.number,
    tuning_map_number:  PropTypes.number,
    tuning_map_degree0: PropTypes.number,
    midiin_central_degree:     PropTypes.number,
    center_degree:      PropTypes.number,
    output_mpe:         PropTypes.bool,
    mpe_device:         PropTypes.string,
    mpe_master_ch:      PropTypes.string,
    mpe_lo_ch:          PropTypes.number,
    mpe_hi_ch:          PropTypes.number,
    mpe_mode:           PropTypes.string,
    mpe_pitchbend_range: PropTypes.number,
  }).isRequired,
  midi:     PropTypes.object,
  onChange: PropTypes.func.isRequired,
  keysRef:  PropTypes.object,
};

export default MidiOutputs;
