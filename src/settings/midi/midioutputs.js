import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import { WebMidi } from "webmidi";
import PropTypes from "prop-types";

const voiceChannels = (masterCh) => {
  if (masterCh === "1") return Array.from({ length: 15 }, (_, i) => i + 2);
  if (masterCh === "16") return Array.from({ length: 15 }, (_, i) => i + 1);
  return Array.from({ length: 16 }, (_, i) => i + 1);
};

const save = (name, value, onChange) => {
  onChange(name, value);
  sessionStorage.setItem(name, value);
};

// Send MPE pitch bend range RPN to all voice channels
const sendMpePitchBendRange = (
  output,
  masterCh,
  loCh,
  hiCh,
  bendRange = 48,
  bendRangeManager = 2,
  mpeMode,
) => {
  if (!output) return;

  const masterChNum =
    masterCh != null && masterCh !== "none" ? parseInt(masterCh) - 1 : null;
  const actualBendRange =
    mpeMode === "Ableton_workaround" ? 48 : bendRange || 48;
  const managerBendRange = mpeMode === 'Ableton_workaround' ? 2 : bendRangeManager || 2;

  // Send MPE zone configuration RPN on master channel
  if (masterChNum !== null) {
    const numVoices = hiCh - loCh + 1;
    // RPN 0x0006 (MPE config) = number of member channels
    output.send([0xb0 + masterChNum, 101, 0]); // RPN MSB = 0
    output.send([0xb0 + masterChNum, 100, 6]); // RPN LSB = 6
    output.send([0xb0 + masterChNum, 6, numVoices]); // data entry MSB
    output.send([0xb0 + masterChNum, 101, 0]); // RPN MSB = 0
    output.send([0xb0 + masterChNum, 100, 0]); // RPN LSB = 0
    output.send([0xb0 + masterChNum, 6, managerBendRange]); // data entry MSB
  }

  // Send pitch bend range RPN on all voice channels
  // RPN 0x0000 (pitch bend range)
  for (let ch = loCh; ch <= hiCh; ch++) {
    const c = ch - 1; // 0-based
    output.send([0xb0 + c, 101, 0]); // RPN MSB = 0
    output.send([0xb0 + c, 100, 0]); // RPN LSB = 0
    output.send([0xb0 + c, 6, actualBendRange]); // data entry MSB (semitones)
    
  }
};

const MidiOutputs = (props) => {
  // midiTick is unused directly — its presence as a changing prop forces
  // re-render when MIDI devices connect/disconnect, refreshing the outputs list.
  const { settings, onChange, midi, midiTick: _midiTick } = props;
  // Central MIDI note: defaults to the same note used for MIDI input (midiin_central_degree + center_degree).
  const center_degree = settings.center_degree || 0;
  const centralMidiNote =
    (settings.midiin_central_degree != null
      ? settings.midiin_central_degree
      : 60) + center_degree;
  const tuningMapNote =
    settings.tuning_map_degree0 != null
      ? settings.tuning_map_degree0
      : centralMidiNote;
  const masterCh = settings.mpe_master_ch || "1";
  const available = voiceChannels(masterCh);
  const loCh = available.includes(settings.mpe_lo_ch)
    ? settings.mpe_lo_ch
    : available[0];
  const hiCh = available.includes(settings.mpe_hi_ch)
    ? settings.mpe_hi_ch
    : Math.min(available[available.length - 1], loCh + 6);

  const outputs = midi ? Array.from(midi.outputs.values()) : [];

  // Auto-detect FluidSynth: any output whose name contains "fluid" (case-insensitive).
  // macOS FluidSynth creates a new port on each launch; we find it by name.
  const fluidsynthOutput = outputs.find(m => m.name.toLowerCase().includes("fluid")) ?? null;
  const fluidsynthFound  = !!fluidsynthOutput;
  // When the FluidSynth port disappears, clear the saved device so the UI
  // reflects the disconnected state. Do NOT auto-reconnect when it reappears —
  // the user explicitly presses Connect to opt in.
  useEffect(() => {
    if (!fluidsynthOutput && settings.fluidsynth_device) {
      save("fluidsynth_device", "", onChange);
      save("fluidsynth_channel", -1, onChange);
    }
  }, [fluidsynthOutput?.id]);
  // Is the user-selected main MTS port the same as FluidSynth? Warn if so.
  const mtsPortIsFluidsynth = fluidsynthOutput &&
    settings.midi_device === fluidsynthOutput.id;

  return (
    <fieldset>
      <legend>
        <b>MIDI Outputs</b>
      </legend>

      {/* ── MTS ────────────────────────────────────────────────────────── */}

      

      <label>
        <b>MTS Real-Time Tuning</b>
        <input
          name="output_mts"
          type="checkbox"
          checked={!!settings.output_mts}
          onChange={(e) => save(e.target.name, e.target.checked, onChange)}
        />
      </label>

      <p style={{ marginTop: 0.5 }}>
        <em>
          The <a href="/midituning.html">MIDI Tuning Standard</a> uses
          sysex messages to modify the tuning of each MIDI note. The free{" "}
          <a href="https://oddsound.com/mtsespmini.php">
            Oddsound MTS-ESP Mini
          </a>{" "}
          VST plug-in translates MTS data to retune supported software
          synths.{" "}
        </em>
      </p>

      {settings.output_mts && (
        <>
          <label>
            Port
            <select
              name="midi_device"
              class="sidebar-input"
              value={settings.midi_device || "OFF"}
              onChange={(e) => save(e.target.name, e.target.value, onChange)}
            >
              <option value="OFF">OFF</option>
              {outputs.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>

          {settings.midi_device && settings.midi_device !== "OFF" && (
            <>
              {settings.midi_mapping === 'DIRECT' && (
                <p style={{ fontSize: '0.85em', color: '#996666', margin: '0.25em 0' }}>
                  <em>Sends plain MIDI notes using the hex layout. Pre-sends a
                  non-real-time 128-note tuning map so synths like the Prophet&#x2011;5
                  play microtonally. Enable Auto&#x2011;Send and click Send Map once
                  after loading a preset.</em>
                </p>
              )}
              <label>
                Channel
                <select
                  name="midi_channel"
                  class="sidebar-input"
                  value={settings.midi_channel}
                  onChange={(e) =>
                    save(e.target.name, parseInt(e.target.value), onChange)
                  }
                >
                  <option value="-1">
                    ---choose a MIDI output channel---
                    </option>
                  {[...Array(16).keys()].map((i) => (
                    <option key={i} value={i}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </label>
              
              <label>
                Message Style
                <select
                  name="midi_mapping"
                  class="sidebar-input"
                  value={settings.midi_mapping}
                  onChange={(e) => {
                    save(e.target.name, e.target.value, onChange);
                    // DIRECT always uses non-real-time bulk map
                    if (e.target.value === 'DIRECT') save('sysex_type', 126, onChange);
                  }}
                >
                  <option>---choose how notes are sent---</option>
                  <option value="MTS1">
                    real-time MTS with full 128 note polyphony
                  </option>
                  <option value="MTS2">
                    real-time MTS with Pianoteq/Arturia range
                  </option>
                </select>
              </label>



            </>
          )}
        </>
      )}

      {/* ── FluidSynth mirror — shown when MTS on OR already connected ── */}
      {(settings.output_mts || !!(settings.fluidsynth_device && settings.fluidsynth_channel >= 0)) && (() => {
        const fsConnected = !!(settings.fluidsynth_device && settings.fluidsynth_channel >= 0);
        return (
          <>
            {/* Use div instead of label — button inside label causes browsers to
                fire a second synthetic click on the button (via the label's implicit
                control activation), which arrives after Preact re-renders with
                fsConnected=true and immediately triggers the Disconnect branch. */}
            <div style={{
              display: "flex", justifyContent: "space-between",
              flexWrap: "wrap", alignItems: "baseline",
              marginTop: "0.5em", lineHeight: "1.5em",
            }}>
              <span style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                <span style={{
                  display: "inline-block", width: "10px", height: "10px",
                  borderRadius: "50%",
                  background: fsConnected ? "#22cc44" : fluidsynthFound ? "#558855" : "#1a4422",
                  boxShadow: fsConnected ? "0 0 5px #22cc44" : "none",
                  flexShrink: 0,
                  alignSelf: "top",
                }} />
                <span>FluidSynth</span>
                {fluidsynthFound && (
                  <span style={{
                    fontSize: "0.85em",
                    color: "#669966",
                  }}>
                    [ {fluidsynthOutput.name} ]
                  </span>
                )}
              </span>
              <button
                type="button"
                disabled={!fluidsynthFound && !fsConnected}
                style={{
                  fontSize: "0.85em",
                  background: fsConnected ? "#22cc44" : undefined,
                  color: fsConnected ? "#003300" : undefined,
                  borderColor: fsConnected ? "#22cc44" : undefined,
                }}
                onClick={() => {
                  if (fsConnected) {
                    save("fluidsynth_device", "", onChange);
                    save("fluidsynth_channel", -1, onChange);
                  } else {
                    if (!fluidsynthOutput) return;
                    save("fluidsynth_device", fluidsynthOutput.id, onChange);
                    save("fluidsynth_channel",
                      settings.midi_channel >= 0 ? settings.midi_channel : 0, onChange);
                  }
                }}
                title={fsConnected ? "Disconnect FluidSynth mirror"
                  : fluidsynthFound ? "Connect MTS mirror to FluidSynth" : "FluidSynth not found"}
              >
                {fsConnected ? "Disconnect" : fluidsynthFound ? "Connect" : "Not found"}
              </button>
            </div>
            {fsConnected && (
              <>
                <label>
                  FluidSynth Channel
                  <select name="fluidsynth_channel" class="sidebar-input"
                    value={settings.fluidsynth_channel ?? -1}
                    onChange={(e) => save(e.target.name, parseInt(e.target.value), onChange)}
                  >
                    {[...Array(16).keys()].map(i => (
                      <option key={i} value={i}>{i + 1}</option>
                    ))}
                  </select>
                </label>
                {mtsPortIsFluidsynth && (
                  <p style={{ color: "#cc4400", fontSize: "0.85em", margin: "0.2em 0" }}>
                    ⚠ Main MTS port is FluidSynth — mirror disabled to prevent doubling.
                  </p>
                )}
              </>
            )}
          </>
        );
      })()}

      <br />

      {/* ── DIRECT ─────────────────────────────────────────────────────── */}

      

      <label>
        <b>Direct MIDI | MTS Tuning Map</b>
        <input
          name="output_direct"
          type="checkbox"
          checked={!!settings.output_direct}
          onChange={(e) => save(e.target.name, e.target.checked, onChange)}
        />
      </label>

      <p style={{ marginTop: 0.5 }}><em>
        MIDI notes follow the hex layout. 128-note non-real-time sysex tuning maps (bulk dump) permit synths like the Prophet&#x2011;5
        play microtonally.
      </em></p>

      {settings.output_direct && (
        <>
          <label>
            Port
            <select
              name="direct_device"
              class="sidebar-input"
              value={settings.direct_device || "OFF"}
              onChange={(e) => save(e.target.name, e.target.value, onChange)}
            >
              <option value="OFF">OFF</option>
              {outputs.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>

          {settings.direct_device && settings.direct_device !== "OFF" && (
            <>
              <label>
                Channel
                <select
                  name="direct_channel"
                  class="sidebar-input"
                  value={settings.direct_channel ?? -1}
                  onChange={(e) => save(e.target.name, parseInt(e.target.value), onChange)}
                >
                  <option value="-1">---choose a MIDI output channel---</option>
                  {[...Array(16).keys()].map((i) => (
                    <option key={i} value={i}>{i + 1}</option>
                  ))}
                </select>
              </label>

              <label>
                Auto-Send Tuning Map
                <span style={{ display: "flex", alignItems: "center",
                               gap: "8px", marginLeft: "auto", marginTop: "4px" }}>
                  <input
                    name="direct_sysex_auto"
                    type="checkbox"
                    checked={!!settings.direct_sysex_auto}
                    onChange={(e) => save(e.target.name, e.target.checked, onChange)}
                  />
                  <button type="button" style={{ fontSize: "0.85em" }}
                    onClick={() => {
                      const output = WebMidi.getOutputById(settings.direct_device);
                      if (output && props.keysRef?.current)
                        props.keysRef.current.mtsSendMap(output);
                    }}
                  >Send Map</button>
                </span>
              </label>

              <label>
                Device ID (127 = all)
                <input name="direct_device_id" type="text" inputMode="numeric"
                  class="sidebar-input"
                  key={settings.direct_device_id ?? 127}
                  defaultValue={settings.direct_device_id ?? 127}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val) && val >= 0 && val <= 127)
                      save("direct_device_id", val, onChange);
                    else e.target.value = settings.direct_device_id ?? 127;
                  }}
                />
              </label>

              <label>
                Tuning Map Number
                <input name="direct_tuning_map_number" type="text" inputMode="numeric"
                  class="sidebar-input"
                  key={settings.direct_tuning_map_number ?? 0}
                  defaultValue={settings.direct_tuning_map_number ?? 0}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val) && val >= 0 && val <= 127)
                      save("direct_tuning_map_number", val, onChange);
                    else e.target.value = settings.direct_tuning_map_number ?? 0;
                  }}
                />
              </label>

              <label>
                Central MIDI Note
                <input
                  name="tuning_map_degree0"
                  type="text"
                  inputMode="numeric"
                  class="sidebar-input"
                  key={tuningMapNote}
                  defaultValue={tuningMapNote}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val) && val >= 0 && val <= 127)
                      save("tuning_map_degree0", val, onChange);
                    else e.target.value = tuningMapNote;
                  }}
                />
              </label>
            </>
          )}
        </>
      )}

      <br />

      {/* ── MPE ────────────────────────────────────────────────────────── */}

      <label>
        <b>MPE</b>
        <input
          name="output_mpe"
          type="checkbox"
          checked={!!settings.output_mpe}
          onChange={(e) => save(e.target.name, e.target.checked, onChange)}
        />
      </label>

       <p style={{ marginTop: 0.5 }}>
        <em>
          <a href="https://midi.org/mpe-midi-polyphonic-expression">
            MIDI Polyphonic Expression
          </a>{" "}
          allows per-note polyphonic bend and modulation with limited polyphony.
        </em>
      </p>

      {settings.output_mpe && (
        <>
          <label>
            Port
            <select
              name="mpe_device"
              class="sidebar-input"
              value={settings.mpe_device || "OFF"}
              onChange={(e) => save(e.target.name, e.target.value, onChange)}
            >
              <option value="OFF">OFF</option>
              {outputs.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>

          {settings.mpe_device && settings.mpe_device !== "OFF" && (
            <>
              <label>
                Manager Channel
                <select
                  name="mpe_master_ch"
                  class="sidebar-input"
                  value={masterCh}
                  onChange={(e) =>
                    save(e.target.name, e.target.value, onChange)
                  }
                >
                  <option value="1">Channel 1</option>
                  <option value="16">Channel 16</option>
                  <option value="none">None</option>
                </select>
              </label>

              <label>
                Lowest Member Channel
                <select
                  name="mpe_lo_ch"
                  class="sidebar-input"
                  value={loCh}
                  onChange={(e) =>
                    save(e.target.name, parseInt(e.target.value), onChange)
                  }
                >
                  {available.map((ch) => (
                    <option key={ch} value={ch} disabled={ch > hiCh}>
                      {ch}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Highest Member Channel
                <select
                  name="mpe_hi_ch"
                  class="sidebar-input"
                  value={hiCh}
                  onChange={(e) =>
                    save(e.target.name, parseInt(e.target.value), onChange)
                  }
                >
                  {available.map((ch) => (
                    <option key={ch} value={ch} disabled={ch < loCh}>
                      {ch}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span
                  class="sidebar-input"
                  style={{
                    textAlign: "right",
                    color: "#996666",
                    fontSize: "0.85em",
                  }}
                >
                  {loCh}–{hiCh} ({hiCh - loCh + 1} voices)
                </span>
              </label>

              <label>
                Message Style
                <select
                  name="mpe_mode"
                  class="sidebar-input"
                  value={settings.mpe_mode || "Ableton_workaround"}
                  onChange={(e) =>
                    save(e.target.name, e.target.value, onChange)
                  }
                >
                  <option value="Ableton_workaround">
                    Ableton compatible: unique notes & PB 48
                  </option>
                  <option value="Full_MPE">MPE standard: nearest notes & user PB</option>
                </select>
              </label>

              {settings.mpe_mode === "Full_MPE" && (
                <>
                <label>
                  Pitch Wheel range (semitones)
                  <input
                    name="mpe_pitchbend_range_manager"
                    type="text"
                    inputMode="numeric"
                    class="sidebar-input"
                    key={settings.mpe_pitchbend_range_manager}
                    defaultValue={settings.mpe_pitchbend_range_manager ?? 2}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val >= 0 && val <= 12)
                        save("mpe_pitchbend_range_manager", val, onChange);
                      else e.target.value = settings.mpe_pitchbend_range_manager ?? 2;
                    }}
                  />
                </label>
                
                <label>
                  MPE PB Range (semitones)
                  <input
                    name="mpe_pitchbend_range"
                    type="text"
                    inputMode="numeric"
                    class="sidebar-input"
                    key={settings.mpe_pitchbend_range}
                    defaultValue={settings.mpe_pitchbend_range ?? 48}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val >= 1 && val <= 96)
                        save("mpe_pitchbend_range", val, onChange);
                      else e.target.value = settings.mpe_pitchbend_range ?? 48;
                    }}
                  />
                </label>
                </>
                )}
              <label>
                MPE Configuration (RPN)
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginLeft: "auto",
                  }}
                >
                  <button
                    type="button"
                    style={{ fontSize: "0.85em" , marginTop: "4px"}}
                    onClick={() => {
                      const output = WebMidi.getOutputById(settings.mpe_device);
                      if (output) {
                        sendMpePitchBendRange(
                          output,
                          settings.mpe_master_ch,
                          settings.mpe_lo_ch,
                          settings.mpe_hi_ch,
                          settings.mpe_pitchbend_range ?? 48,
                          settings.mpe_pitchbend_range_manager ?? 2,
                          settings.mpe_mode,
                        );
                      }
                    }}
                  >
                    Send Pitch Bend Range
                  </button>
                </span>
              </label>
            </>
          )}
        </>
      )}
    </fieldset>
  );
};

MidiOutputs.propTypes = {
  settings: PropTypes.shape({
    output_mts: PropTypes.bool,
    midi_device: PropTypes.string,
    midi_mapping: PropTypes.string,
    midi_channel: PropTypes.number,
    sysex_auto: PropTypes.bool,
    sysex_type: PropTypes.number,
    device_id: PropTypes.number,
    tuning_map_number: PropTypes.number,
    tuning_map_degree0: PropTypes.number,
    midiin_central_degree: PropTypes.number,
    center_degree: PropTypes.number,
    output_mpe: PropTypes.bool,
    output_direct: PropTypes.bool,
    fluidsynth_device: PropTypes.string,
    fluidsynth_channel: PropTypes.number,
    direct_device: PropTypes.string,
    direct_channel: PropTypes.number,
    direct_sysex_auto: PropTypes.bool,
    direct_device_id: PropTypes.number,
    direct_tuning_map_number: PropTypes.number,
    mpe_device: PropTypes.string,
    mpe_master_ch: PropTypes.string,
    mpe_lo_ch: PropTypes.number,
    mpe_hi_ch: PropTypes.number,
    mpe_mode: PropTypes.string,
    mpe_pitchbend_range: PropTypes.number,
    mpe_pitchbend_range_manager: PropTypes.number,
  }).isRequired,
  midi: PropTypes.object,
  onChange: PropTypes.func.isRequired,
  keysRef: PropTypes.object,
};

export default MidiOutputs;