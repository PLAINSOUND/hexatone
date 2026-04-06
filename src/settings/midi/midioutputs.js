import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import { WebMidi } from "webmidi";
import PropTypes from "prop-types";
import {
  resolveBulkDumpName,
  sanitizeBulkDumpName,
} from "../../keyboard/mts-helpers.js";

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
  const [fsVolume, setFsVolume] = useState(parseInt(localStorage.getItem("fluidsynth_volume_pref") ?? "100"));
  const masterCh = settings.mpe_manager_ch || "1";
  const available = voiceChannels(masterCh);
  const loCh = available.includes(settings.mpe_lo_ch)
    ? settings.mpe_lo_ch
    : available[0];
  const hiCh = available.includes(settings.mpe_hi_ch)
    ? settings.mpe_hi_ch
    : Math.min(available[available.length - 1], loCh + 6);

  const outputs = midi ? Array.from(midi.outputs.values()) : [];
  const directTuningMapName = resolveBulkDumpName(
    settings.direct_tuning_map_name,
    settings.short_description,
    settings.name,
  );

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

      {/* ── FluidSynth mirror — shown only when MTS Real-Time is on ── */}
      {settings.output_mts && (() => {
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
                  marginBottom:3, marginTop:10
                }}
                onClick={() => {
                  if (fsConnected) {
                    save("fluidsynth_device", "", onChange);
                    save("fluidsynth_channel", -1, onChange);
                  } else {
                    if (!fluidsynthOutput) return;
                    save("fluidsynth_device", fluidsynthOutput.id, onChange);
                    const saved = parseInt(localStorage.getItem("fluidsynth_channel_pref"));
                    const ch = !isNaN(saved) && saved >= 0 ? saved
                      : settings.midi_channel >= 0 ? settings.midi_channel : 0;
                    save("fluidsynth_channel", ch, onChange);
                    const vol = parseInt(localStorage.getItem("fluidsynth_volume_pref") ?? "100");
                    fluidsynthOutput.send([0xB0 | ch, 7, vol]);
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
                    onChange={(e) => {
                      const ch = parseInt(e.target.value);
                      localStorage.setItem("fluidsynth_channel_pref", ch);
                      save(e.target.name, ch, onChange);
                    }}
                  >
                    {[...Array(16).keys()].map(i => (
                      <option key={i} value={i}>{i + 1}</option>
                    ))}
                  </select>
                </label>
                <label>
                  FluidSynth Volume
                  <span class="sidebar-input" style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                    <input type="range" min="0" max="127" step="1"
                      style={{ width: '100%' }}
                      defaultValue={parseInt(localStorage.getItem("fluidsynth_volume_pref") ?? "100")}
                      onInput={(e) => {
                        const v = parseInt(e.target.value);
                        localStorage.setItem("fluidsynth_volume_pref", v);
                        setFsVolume(v);
                        if (fluidsynthOutput && settings.fluidsynth_channel >= 0) {
                          fluidsynthOutput.send([0xB0 | settings.fluidsynth_channel, 7, v]);
                        }
                      }}
                    />
                    <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: '2.5em', textAlign: 'right', fontSize: '0.85em' }}>
                      {fsVolume}
                    </span>
                  </span>
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
        <b>MTS Bulk Dump Tuning Maps</b>
        <input
          name="output_direct"
          type="checkbox"
          checked={!!settings.output_direct}
          onChange={(e) => save(e.target.name, e.target.checked, onChange)}
        />
      </label>

      <p style={{ marginTop: 0.5 }}><em>
        Old-school non-real-time 128 note mapping. Two modes are available: Dynamic emulates real-time MTS by sending a new map before each note on, performance depends on synth. Static is the classic approach: send a map (automatically or manually) and then play on one channel.
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
                Mode
                <select
                  name="direct_mode"
                  class="sidebar-input"
                  value={settings.direct_mode || "dynamic"}
                  onChange={(e) => {
                    const nextMode = e.target.value;
                    save(e.target.name, nextMode, onChange);
                    // Static bulk dump only initializes after a map push, so
                    // enable auto-send when the user switches into static mode.
                    if (nextMode === "static" && !settings.direct_sysex_auto) {
                      save("direct_sysex_auto", true, onChange);
                    }
                  }}
                >
                  <option value="dynamic">Dynamic Bulk Dump</option>
                  <option value="static">Static Bulk Dump</option>
                </select>
              </label>

              <label>
                Channel
                <select
                  name="direct_channel"
                  class="sidebar-input"
                  value={settings.direct_channel ?? -1}
                  onChange={(e) => save(e.target.name, parseInt(e.target.value), onChange)}
                >
                  <option value="-1">OFF</option>
                  {[...Array(16).keys()].map((i) => (
                    <option key={i} value={i}>{i + 1}</option>
                  ))}
                </select>
              </label>

              {settings.direct_mode === "static" && (
                <label>
                  Auto-Send Static Map
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
                    >Send Static Map</button>
                  </span>
                </label>
              )}

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
                Tuning Map Name
                <input
                  name="direct_tuning_map_name"
                  type="text"
                  class="sidebar-input"
                  maxLength={16}
                  value={directTuningMapName}
                  onInput={(e) => {
                    const next = sanitizeBulkDumpName(e.target.value);
                    if (e.target.value !== next) e.target.value = next;
                    save("direct_tuning_map_name", next, onChange);
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
                  name="mpe_manager_ch"
                  class="sidebar-input"
                  value={masterCh}
                  onChange={(e) =>
                    save(e.target.name, e.target.value, onChange)
                  }
                >
                  <option value="1">Channel 1</option>
                  <option value="16">Channel 16</option>
                  <option value="-1">None</option>
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
                          settings.mpe_manager_ch,
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
      <br />

      {/* ── OSC → SuperCollider ─────────────────────────────────────────── */}

      <label>
        <b>OSC → SuperCollider</b>
        <input
          name="output_osc"
          type="checkbox"
          checked={!!settings.output_osc}
          onChange={(e) => save(e.target.name, e.target.checked, onChange)}
        />
      </label>

      <p style={{ marginTop: 0.5 }}><em>
        Sends notes directly to SuperCollider via a local WebSocket→OSC bridge.{/*/<br />
        Run </em> (&nbsp;<code>yarn osc-bridge</code>&nbsp;) <em> locally and load SC patch with
        OSCResponders.scd.*/}
      </em></p>

      {settings.output_osc && (
        <label>
          Bridge URL
          <input
            name="osc_bridge_url"
            type="text"
            class="sidebar-input"
            key={settings.osc_bridge_url}
            defaultValue={settings.osc_bridge_url || "ws://localhost:8089"}
            onBlur={(e) => {
              const val = e.target.value.trim();
              if (val) save("osc_bridge_url", val, onChange);
              else e.target.value = settings.osc_bridge_url || "ws://localhost:8089";
            }}
          />
        </label>
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
    center_degree: PropTypes.number,
    output_mpe: PropTypes.bool,
    output_direct: PropTypes.bool,
    fluidsynth_device: PropTypes.string,
    fluidsynth_channel: PropTypes.number,
    direct_device: PropTypes.string,
    direct_mode: PropTypes.string,
    direct_channel: PropTypes.number,
    direct_sysex_auto: PropTypes.bool,
    direct_device_id: PropTypes.number,
    direct_tuning_map_number: PropTypes.number,
    direct_tuning_map_name: PropTypes.string,
    short_description: PropTypes.string,
    name: PropTypes.string,
    mpe_device: PropTypes.string,
    mpe_manager_ch: PropTypes.string,
    mpe_lo_ch: PropTypes.number,
    mpe_hi_ch: PropTypes.number,
    mpe_mode: PropTypes.string,
    mpe_pitchbend_range: PropTypes.number,
    mpe_pitchbend_range_manager: PropTypes.number,
    output_osc: PropTypes.bool,
    osc_bridge_url: PropTypes.string,
  }).isRequired,
  midi: PropTypes.object,
  onChange: PropTypes.func.isRequired,
  keysRef: PropTypes.object,
};

export default MidiOutputs;
