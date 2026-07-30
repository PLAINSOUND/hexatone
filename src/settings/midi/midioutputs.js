import { useEffect, useState } from "preact/hooks";
import { WebMidi } from "webmidi";
import PropTypes from "prop-types";
import { buildAutoSelectInputProps } from "../../ui/input-selection.js";
import { resolveBulkDumpName, sanitizeBulkDumpName } from "../../tuning/mts-format.js";
import {
  clampMidiCc,
  EAGAN_BRIGHTNESS_EVENT,
  EAGAN_MATRIX_CONTROLS,
} from "../../mpe_synth/eagan-matrix.js";
import { sendMpeZonePitchBendRange } from "../../midi/rpn.js";
import CustomRangeSlider from "../shared/range-slider.jsx";
import OutputPortPicker from "./output-port-picker.js";

const voiceChannels = (masterCh) => {
  if (masterCh === "1") return Array.from({ length: 15 }, (_, i) => i + 2);
  if (masterCh === "16") return Array.from({ length: 15 }, (_, i) => i + 1);
  return Array.from({ length: 16 }, (_, i) => i + 1);
};

const save = (name, value, onChange) => {
  onChange(name, value);
  sessionStorage.setItem(name, value);
};

const clampOscVolume = (value) => Math.max(0, Math.min(1, value));
const clampOscQuickRelease = (value) => Math.max(0, Math.min(1, value));
const clampOscQuickReleaseTime = (value) => Math.max(0.001, Math.min(1, value));

const readOscVolume = (name, fallback = 0.5) => {
  const local = parseFloat(localStorage.getItem(name) ?? "");
  if (Number.isFinite(local)) return clampOscVolume(local);
  return clampOscVolume(fallback);
};

const readOscQuickRelease = (name, fallback = 0) => {
  const local = parseFloat(localStorage.getItem(name) ?? "");
  if (Number.isFinite(local)) return clampOscQuickRelease(local);
  return clampOscQuickRelease(fallback);
};

const readOscQuickReleaseTime = (name, fallback = 0.1) => {
  const local = parseFloat(localStorage.getItem(name) ?? "");
  if (Number.isFinite(local)) return clampOscQuickReleaseTime(local);
  return clampOscQuickReleaseTime(fallback);
};

const saveOscVolume = (name, value) => {
  localStorage.setItem(name, String(value));
  sessionStorage.setItem(name, String(value));
};

const readEaganCc = (name, fallback = 64) => {
  const stored = parseInt(sessionStorage.getItem(name) ?? "", 10);
  return clampMidiCc(Number.isFinite(stored) ? stored : fallback);
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

  const masterChNum = masterCh != null && masterCh !== "none" ? parseInt(masterCh) - 1 : null;
  const actualBendRange = mpeMode === "Ableton_workaround" ? 48 : bendRange || 48;
  const managerBendRange = mpeMode === "Ableton_workaround" ? 2 : bendRangeManager || 2;

  sendMpeZonePitchBendRange(output, {
    managerChannel0: masterChNum ?? -1,
    memberChannels0: Array.from(
      { length: hiCh - loCh + 1 },
      (_, index) => loCh - 1 + index,
    ),
    memberBendRange: actualBendRange,
    managerBendRange,
  });
};

const MidiOutputs = (props) => {
  // midiTick is unused directly — its presence as a changing prop forces
  // re-render when MIDI devices connect/disconnect, refreshing the outputs list.
  const { settings, onChange, midi, midiTick: _midiTick } = props;
  const [fsVolume, setFsVolume] = useState(
    parseInt(localStorage.getItem("fluidsynth_volume_pref") ?? "127"),
  );
  const [oscDraftVolumes, setOscDraftVolumes] = useState({
    osc_volume_pluck: readOscVolume("osc_volume_pluck", settings.osc_volume_pluck ?? 0.5),
    osc_volume_buzz: readOscVolume("osc_volume_buzz", settings.osc_volume_buzz ?? 0.5),
    osc_volume_formant: readOscVolume("osc_volume_formant", settings.osc_volume_formant ?? 0.5),
    osc_volume_saw: readOscVolume("osc_volume_saw", settings.osc_volume_saw ?? 0.5),
  });
  const [oscQuickRelease, setOscQuickRelease] = useState(
    readOscQuickRelease("osc_quick_release", settings.osc_quick_release ?? 0.5),
  );
  const [oscQuickReleaseTime, setOscQuickReleaseTime] = useState(
    readOscQuickReleaseTime("osc_quick_release_time", settings.osc_quick_release_time ?? 0.25),
  );
  const [eaganCcDrafts, setEaganCcDrafts] = useState(() => ({
    mpe_eagan_brightness: readEaganCc(
      "mpe_eagan_brightness",
      settings.mpe_eagan_brightness ?? 64,
    ),
    mpe_eagan_tilt_eq: readEaganCc("mpe_eagan_tilt_eq", settings.mpe_eagan_tilt_eq ?? 64),
    mpe_eagan_pre_level: readEaganCc(
      "mpe_eagan_pre_level",
      settings.mpe_eagan_pre_level ?? 64,
    ),
    mpe_eagan_post_level: readEaganCc(
      "mpe_eagan_post_level",
      settings.mpe_eagan_post_level ?? 64,
    ),
  }));
  const masterCh = settings.midiin_mpe_manager_ch || "1";
  const available = voiceChannels(masterCh);
  const loCh = available.includes(settings.mpe_lo_ch) ? settings.mpe_lo_ch : available[0];
  const hiCh = available.includes(settings.mpe_hi_ch)
    ? settings.mpe_hi_ch
    : Math.min(available[available.length - 1], loCh + 6);

  const outputs = midi ? Array.from(midi.outputs.values()) : [];
  const hakenContinuumActive = settings.midiin_controller_override === "hakenaudio";
  const visibleMpeMode = settings.mpe_mode ?? (hakenContinuumActive ? "standard" : "Ableton_workaround");
  const visibleMpePitchbendRange = settings.mpe_pitchbend_range ?? (hakenContinuumActive ? 96 : 48);
  const bulkTuningMapName = resolveBulkDumpName(
    settings.mts_bulk_tuning_map_name,
    settings.short_description,
    settings.name,
  );
  const hasSysexMidi = props.midiAccess === "sysex";

  useEffect(() => {
    setOscDraftVolumes({
      osc_volume_pluck: readOscVolume("osc_volume_pluck", settings.osc_volume_pluck ?? 0.5),
      osc_volume_buzz: readOscVolume("osc_volume_buzz", settings.osc_volume_buzz ?? 0.5),
      osc_volume_formant: readOscVolume("osc_volume_formant", settings.osc_volume_formant ?? 0.5),
      osc_volume_saw: readOscVolume("osc_volume_saw", settings.osc_volume_saw ?? 0.5),
    });
  }, [
    settings.osc_volume_pluck,
    settings.osc_volume_buzz,
    settings.osc_volume_formant,
    settings.osc_volume_saw,
  ]);

  useEffect(() => {
    setOscQuickRelease(readOscQuickRelease("osc_quick_release", settings.osc_quick_release ?? 0.5));
  }, [settings.osc_quick_release]);

  useEffect(() => {
    setOscQuickReleaseTime(
      readOscQuickReleaseTime("osc_quick_release_time", settings.osc_quick_release_time ?? 0.25),
    );
  }, [settings.osc_quick_release_time]);

  useEffect(() => {
    setEaganCcDrafts({
      mpe_eagan_brightness: clampMidiCc(settings.mpe_eagan_brightness ?? 64),
      mpe_eagan_tilt_eq: clampMidiCc(settings.mpe_eagan_tilt_eq ?? 64),
      mpe_eagan_pre_level: clampMidiCc(settings.mpe_eagan_pre_level ?? 64),
      mpe_eagan_post_level: clampMidiCc(settings.mpe_eagan_post_level ?? 64),
    });
  }, [
    settings.mpe_eagan_brightness,
    settings.mpe_eagan_tilt_eq,
    settings.mpe_eagan_pre_level,
    settings.mpe_eagan_post_level,
  ]);

  useEffect(() => {
    const handleBrightness = (event) => {
      const next = clampMidiCc(event.detail?.value);
      setEaganCcDrafts((prev) => ({ ...prev, mpe_eagan_brightness: next }));
      onChange("mpe_eagan_brightness", next);
    };
    window.addEventListener(EAGAN_BRIGHTNESS_EVENT, handleBrightness);
    return () => window.removeEventListener(EAGAN_BRIGHTNESS_EVENT, handleBrightness);
  }, [onChange]);

  const sendEaganMatrixCc = (cc, value) => {
    const output =
      midi?.outputs?.get?.(settings.mpe_device) ?? WebMidi.getOutputById(settings.mpe_device);
    if (!output || typeof output.send !== "function") return;

    const managerChannel = parseInt(settings.midiin_mpe_manager_ch, 10);
    const channel0 = managerChannel >= 1 && managerChannel <= 16 ? managerChannel - 1 : 0;
    output.send([0xb0 + channel0, cc, clampMidiCc(value)]);
  };

  // Auto-detect FluidSynth: any output whose name contains "fluid" (case-insensitive).
  // If the user has manually overridden the port, use that instead.
  // macOS FluidSynth creates a new port on each launch; we find it by name.
  const fluidsynthOutput = settings.fluidsynth_out_port
    ? (outputs.find((m) => m.id === settings.fluidsynth_out_port) ?? null)
    : (outputs.find((m) => m.name.toLowerCase().includes("fluid")) ?? null);
  const fluidsynthFound = !!fluidsynthOutput;
  const fluidsynthId = fluidsynthOutput?.id ?? "";
  // When the FluidSynth port disappears, clear the saved device so the UI
  // reflects the disconnected state. Do NOT auto-reconnect when it reappears —
  // the user explicitly presses Connect to opt in.
  useEffect(() => {
    if (!fluidsynthOutput && settings.fluidsynth_device) {
      save("fluidsynth_device", "", onChange);
      save("fluidsynth_channel", -1, onChange);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on port disconnect only; onChange is stable
  }, [fluidsynthOutput?.id]);
  // Is the user-selected main MTS port the same as FluidSynth? Warn if so.
  const mtsPortIsFluidsynth = fluidsynthOutput && settings.midi_device === fluidsynthOutput.id;
  const setMtsPort = (value) => {
    save("midi_device", value, onChange);
    if (value === fluidsynthId && settings.fluidsynth_device) {
      save("fluidsynth_device", "", onChange);
      save("fluidsynth_channel", -1, onChange);
    }
  };

  return (
    <fieldset>
      <legend>
        <b>Output Routing</b>
      </legend>
      {/* ── MTS ────────────────────────────────────────────────────────── */}

      <label>
        <b>MTS Real-Time Tuning</b>
        <input
          name="output_mts"
          type="checkbox"
          checked={!!settings.output_mts}
          disabled={!hasSysexMidi}
          onChange={(e) => save(e.target.name, e.target.checked, onChange)}
        />
      </label>

      <p class="settings-form__intro-copy">
        <em>
          The <a href="/midituning.html">MIDI Tuning Standard</a> uses sysex messages to modify the
          tuning of each MIDI note. The free{" "}
          <a href="https://oddsound.com/mtsespmini.php">Oddsound MTS-ESP Mini</a> VST plug-in
          translates MTS data to retune supported software synths.{" "}
        </em>
      </p>

      {settings.output_mts && (
        <>
          {!hasSysexMidi && (
            <p class="settings-form__stacked-helper">
              <em>Choose “Allow” for SysEx to use MTS tuning messages.</em>
            </p>
          )}
          <label>
            Port
            <select
              name="midi_device"
              class="sidebar-input"
              value={settings.midi_device || "OFF"}
              onChange={(e) => setMtsPort(e.target.value)}
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
              {settings.midi_mapping === "MTS_BULK" && (
                <p class="settings-form__stacked-helper settings-form__stacked-helper--tight">
                  <em>
                    Sends plain MIDI notes using the hex layout. Pre-sends a non-real-time 128-note
                    tuning map so synths like the Prophet&#x2011;5 play microtonally. Enable
                    Auto&#x2011;Send and click Send Map once after loading a preset.
                  </em>
                </p>
              )}
              <label>
                Channel
                <select
                  name="midi_channel"
                  class="sidebar-input"
                  value={settings.midi_channel}
                  onChange={(e) => save(e.target.name, parseInt(e.target.value), onChange)}
                >
                  <option value="-1">---choose a MIDI output channel---</option>
                  {[...Array(16).keys()].map((i) => (
                    <option key={i} value={i}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Tuning Map Number
                <input
                  name="tuning_map_number"
                  type="text"
                  inputMode="numeric"
                  class="sidebar-input"
                  key={settings.tuning_map_number ?? 0}
                  defaultValue={settings.tuning_map_number ?? 0}
                  {...buildAutoSelectInputProps()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.target.blur();
                  }}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val) && val >= 0 && val <= 127)
                      save("tuning_map_number", val, onChange);
                    else e.target.value = settings.tuning_map_number ?? 0;
                  }}
                />
              </label>

              <label>
                Message Style
                <select
                  name="midi_mapping"
                  class="sidebar-input"
                  value={settings.midi_mapping}
                  onChange={(e) => {
                    save(e.target.name, e.target.value, onChange);
                    // Legacy bulk mapping marker always uses non-real-time bulk map
                    if (e.target.value === "MTS_BULK") save("sysex_type", 126, onChange);
                  }}
                >
                  <option>---choose how notes are sent---</option>
                  <option value="MTS1">real-time MTS with full 128 note polyphony</option>
                  <option value="MTS2">real-time MTS with Pianoteq/Arturia range</option>
                </select>
              </label>
            </>
          )}
        </>
      )}

      {/* ── FluidSynth mirror — shown only when MTS Real-Time is on ── */}
      {settings.output_mts &&
        (() => {
          const fsConnected = !!(settings.fluidsynth_device && settings.fluidsynth_channel >= 0);
          return (
            <>
              {/* Use div instead of label — button inside label causes browsers to
                fire a second synthetic click on the button (via the label's implicit
                control activation), which arrives after Preact re-renders with
                fsConnected=true and immediately triggers the Disconnect branch. */}
              <div class="settings-form__control-row">
                <OutputPortPicker
                  label="FluidSynth"
                  portName={fluidsynthOutput?.name ?? null}
                  outputs={props.midi?.outputs}
                  overridePortId={settings.fluidsynth_out_port ?? null}
                  onChange={(portId) => onChange("fluidsynth_out_port", portId)}
                  inline
                />
                <button
                  type="button"
                  class={fsConnected ? "preset-action-btn settings-form__state-btn--connected" : "preset-action-btn"}
                  disabled={(!fluidsynthFound && !fsConnected) || (!!fluidsynthFound && mtsPortIsFluidsynth && !fsConnected)}
                  onClick={() => {
                    if (fsConnected) {
                      save("fluidsynth_device", "", onChange);
                      save("fluidsynth_channel", -1, onChange);
                    } else {
                      if (!fluidsynthOutput || mtsPortIsFluidsynth) return;
                      save("fluidsynth_device", fluidsynthOutput.id, onChange);
                      const saved = parseInt(localStorage.getItem("fluidsynth_channel_pref"));
                      const ch =
                        !isNaN(saved) && saved >= 0
                          ? saved
                          : settings.midi_channel >= 0
                            ? settings.midi_channel
                            : 0;
                      save("fluidsynth_channel", ch, onChange);
                      const vol = parseInt(localStorage.getItem("fluidsynth_volume_pref") ?? "127");
                      fluidsynthOutput.send([0xb0 | ch, 7, vol]);
                    }
                  }}
                  title={
                    fsConnected
                      ? "Disconnect FluidSynth mirror"
                      : mtsPortIsFluidsynth
                        ? "FluidSynth is already selected as the main MTS port"
                        : fluidsynthFound
                          ? "Connect MTS mirror to FluidSynth"
                          : "FluidSynth not found"
                  }
                >
                  {fsConnected
                    ? "Disconnect"
                    : mtsPortIsFluidsynth
                      ? "In use via Port"
                      : fluidsynthFound
                        ? "Connect"
                        : "Not found"}
                </button>
              </div>
              {fsConnected && (
                <>
                  <label>
                    FluidSynth Channel
                    <select
                      name="fluidsynth_channel"
                      class="sidebar-input"
                      value={settings.fluidsynth_channel ?? -1}
                      onChange={(e) => {
                        const ch = parseInt(e.target.value);
                        localStorage.setItem("fluidsynth_channel_pref", ch);
                        save(e.target.name, ch, onChange);
                        const vol = parseInt(localStorage.getItem("fluidsynth_volume_pref") ?? "127");
                        if (fluidsynthOutput && ch >= 0) {
                          fluidsynthOutput.send([0xb0 | ch, 7, vol]);
                        }
                      }}
                    >
                      {[...Array(16).keys()].map((i) => (
                        <option key={i} value={i}>
                          {i + 1}
                        </option>
                        ))}
                    </select>
                  </label>
                  <div class="settings-form__status-caption">
                    {`Tuning Map Number = ${(settings.fluidsynth_channel ?? 0) + 1}`}
                  </div>
                  <label>
                    FluidSynth Volume
                    <span class="sidebar-input settings-form__range-row">
                      <CustomRangeSlider
                        ariaLabel="FluidSynth Volume"
                        min={0}
                        max={127}
                        step={1}
                        value={fsVolume}
                        onInputValue={(nextValue) => {
                          const v = parseInt(nextValue, 10);
                          localStorage.setItem("fluidsynth_volume_pref", v);
                          setFsVolume(v);
                          if (fluidsynthOutput && settings.fluidsynth_channel >= 0) {
                            fluidsynthOutput.send([0xb0 | settings.fluidsynth_channel, 7, v]);
                          }
                        }}
                      />
                      <span class="settings-form__range-value settings-form__range-value--short">
                        {fsVolume}
                      </span>
                    </span>
                  </label>
                  {mtsPortIsFluidsynth && (
                    <p class="settings-form__status-value settings-form__status-value--warning settings-form__status-value--warning-tight">
                      ⚠ Main MTS port is FluidSynth — mirror disabled to prevent doubling.
                    </p>
                  )}
                </>
              )}
            </>
          );
        })()}

      <br />

      {/* ── MTS BULK DUMP ──────────────────────────────────────────────── */}

      <label>
        <b>MTS Bulk Dump Tuning Maps</b>
        <input
          name="output_mts_bulk"
          type="checkbox"
          checked={!!settings.output_mts_bulk}
          disabled={!hasSysexMidi}
          onChange={(e) => save(e.target.name, e.target.checked, onChange)}
        />
      </label>

      <p class="settings-form__intro-copy">
        <em>
          Old-school non-real-time 128 note mapping. Two modes are available: Dynamic emulates
          real-time MTS by sending a new map before each note on, performance depends on synth.
          Static is the classic approach: send a map (automatically or manually) and then play on
          one channel.
        </em>
      </p>

      {settings.output_mts_bulk && (
        <>
          <label>
            Port
            <select
              name="mts_bulk_device"
              class="sidebar-input"
              value={settings.mts_bulk_device || "OFF"}
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

          {settings.mts_bulk_device && settings.mts_bulk_device !== "OFF" && (
            <>
              <label>
                Mode
                <select
                  name="mts_bulk_mode"
                  class="sidebar-input"
                  value={settings.mts_bulk_mode || "dynamic"}
                  onChange={(e) => {
                    const nextMode = e.target.value;
                    save(e.target.name, nextMode, onChange);
                    // Static bulk dump only initializes after a map push, so
                    // enable auto-send when the user switches into static mode.
                    if (nextMode === "static" && !settings.mts_bulk_sysex_auto) {
                      save("mts_bulk_sysex_auto", true, onChange);
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
                  name="mts_bulk_channel"
                  class="sidebar-input"
                  value={settings.mts_bulk_channel ?? -1}
                  onChange={(e) => save(e.target.name, parseInt(e.target.value), onChange)}
                >
                  <option value="-1">OFF</option>
                  {[...Array(16).keys()].map((i) => (
                    <option key={i} value={i}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </label>

              {settings.mts_bulk_mode === "static" && (
                <label>
                  Auto-Send Static Map
                  <span class="settings-form__checkbox-row settings-form__checkbox-row--md">
                    <input
                      name="mts_bulk_sysex_auto"
                      type="checkbox"
                      checked={!!settings.mts_bulk_sysex_auto}
                      disabled={!hasSysexMidi}
                      onChange={(e) => save(e.target.name, e.target.checked, onChange)}
                    />
                    <button
                      type="button"
                      disabled={!hasSysexMidi}
                      onClick={() => {
                        const output = WebMidi.getOutputById(settings.mts_bulk_device);
                        if (output && props.keysRef?.current)
                          props.keysRef.current.mtsSendMap(output);
                      }}
                    >
                      Send Static Map
                    </button>
                  </span>
                </label>
              )}

              <label>
                Device ID (127 = all)
                <input
                  name="mts_bulk_device_id"
                  type="text"
                  inputMode="numeric"
                  class="sidebar-input"
                  key={settings.mts_bulk_device_id ?? 127}
                  defaultValue={settings.mts_bulk_device_id ?? 127}
                  {...buildAutoSelectInputProps()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.target.blur();
                  }}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val) && val >= 0 && val <= 127)
                      save("mts_bulk_device_id", val, onChange);
                    else e.target.value = settings.mts_bulk_device_id ?? 127;
                  }}
                />
              </label>

              <label>
                Tuning Map Number
                <input
                  name="mts_bulk_tuning_map_number"
                  type="text"
                  inputMode="numeric"
                  class="sidebar-input"
                  key={settings.mts_bulk_tuning_map_number ?? 0}
                  defaultValue={settings.mts_bulk_tuning_map_number ?? 0}
                  {...buildAutoSelectInputProps()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.target.blur();
                  }}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val) && val >= 0 && val <= 127)
                      save("mts_bulk_tuning_map_number", val, onChange);
                    else e.target.value = settings.mts_bulk_tuning_map_number ?? 0;
                  }}
                />
              </label>

              <label>
                Tuning Map Name
                <input
                  name="mts_bulk_tuning_map_name"
                  type="text"
                  class="sidebar-input"
                  maxLength={16}
                  value={bulkTuningMapName}
                  onInput={(e) => {
                    const next = sanitizeBulkDumpName(e.target.value);
                    if (e.target.value !== next) e.target.value = next;
                    save("mts_bulk_tuning_map_name", next, onChange);
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

      <p class="settings-form__intro-copy">
        <em>
          <a href="https://midi.org/mpe-midi-polyphonic-expression">MIDI Polyphonic Expression</a>{" "}
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
                  name="midiin_mpe_manager_ch"
                  class="sidebar-input"
                  value={masterCh}
                  onChange={(e) => save(e.target.name, e.target.value, onChange)}
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
                  onChange={(e) => save(e.target.name, parseInt(e.target.value), onChange)}
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
                  onChange={(e) => save(e.target.name, parseInt(e.target.value), onChange)}
                >
                  {available.map((ch) => (
                    <option key={ch} value={ch} disabled={ch < loCh}>
                      {ch}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span class="sidebar-input settings-form__helper-text settings-form__description-value">
                  {loCh}–{hiCh} ({hiCh - loCh + 1} voices)
                </span>
              </label>

              <label>
                Message Style
                <select
                  name="mpe_mode"
                  class="sidebar-input"
                  value={visibleMpeMode}
                  onChange={(e) => save(e.target.name, e.target.value, onChange)}
                >
                  <option value="Ableton_workaround">
                    Ableton compatible: unique notes & PB 48
                  </option>
                  <option value="standard">MPE standard: nearest notes & user PB</option>
                </select>
              </label>

              {visibleMpeMode === "standard" && (
                <>
                  <label>
                    MPE PB Range (semitones)
                    <input
                      name="mpe_pitchbend_range"
                      type="text"
                      inputMode="numeric"
                      class="sidebar-input"
                      key={settings.mpe_pitchbend_range}
                      defaultValue={visibleMpePitchbendRange}
                      {...buildAutoSelectInputProps()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.target.blur();
                      }}
                      onBlur={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val) && val >= 1 && val <= 96)
                          save("mpe_pitchbend_range", val, onChange);
                        else e.target.value = visibleMpePitchbendRange;
                      }}
                    />
                  </label>
                </>
              )}
              <label title="When enabled, Hexatone adds MPE+ CC87 low-bit messages to outgoing pitch bend, producing 21-bit PB for compatible synths. CC74 and channel pressure retain their high-resolution CC87 data when available.">
                MPE+ PB
                <input
                  name="mpe_plus_output"
                  type="checkbox"
                  checked={!!settings.mpe_plus_output}
                  onChange={(e) => save(e.target.name, e.target.checked, onChange)}
                />
              </label>
              <fieldset class="eagan-matrix-fieldset">
                <legend>Eagan Matrix</legend>
                <label
                  class="eagan-matrix-fieldset__toggle-row"
                  title="Generate per-voice MPE Y (CC74) and Z (channel pressure) envelopes from attack velocity and subsequent polyphonic pressure. Applies to live input and stored sequences."
                >
                  <input
                    name="mpe_auto_generate_yz"
                    type="checkbox"
                    checked={!!settings.mpe_auto_generate_yz}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      save(e.target.name, enabled, onChange);
                      if (enabled) {
                        for (const { key, cc } of EAGAN_MATRIX_CONTROLS) {
                          sendEaganMatrixCc(cc, eaganCcDrafts[key] ?? 64);
                        }
                      }
                    }}
                  />
                  Auto-Generate MPE YZ
                </label>
                <label
                  class="eagan-matrix-fieldset__toggle-row"
                  title="Mirror incoming modulation-wheel CC1 values to Eagan Matrix Brightness CC13."
                >
                  <input
                    name="mpe_eagan_modwheel_brightness"
                    type="checkbox"
                    checked={!!settings.mpe_eagan_modwheel_brightness}
                    onChange={(e) => save(e.target.name, e.target.checked, onChange)}
                  />
                  Mod Wheel → Brightness
                </label>
                {EAGAN_MATRIX_CONTROLS.map(({ key, label, cc }) => (
                  <label key={key}>
                    {label}
                    <span class="sidebar-input settings-form__range-row">
                      <CustomRangeSlider
                        ariaLabel={label}
                        min={0}
                        max={127}
                        step={1}
                        value={eaganCcDrafts[key] ?? 64}
                        onInputValue={(nextValue) => {
                          const next = clampMidiCc(nextValue);
                          setEaganCcDrafts((prev) => ({ ...prev, [key]: next }));
                          sendEaganMatrixCc(cc, next);
                        }}
                        onCommitValue={(nextValue) => {
                          save(key, clampMidiCc(nextValue), onChange);
                        }}
                      />
                      <span class="settings-form__range-value">{eaganCcDrafts[key] ?? 64}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <label>
                MPE Configuration (RPN)
                <span class="sidebar-input settings-form__activate-row">
                  <button
                    type="button"
                    class="preset-action-btn"
                    onClick={() => {
                      const output = WebMidi.getOutputById(settings.mpe_device);
                      if (output) {
                        sendMpePitchBendRange(
                          output,
                          settings.midiin_mpe_manager_ch,
                          settings.mpe_lo_ch,
                          settings.mpe_hi_ch,
                          visibleMpePitchbendRange,
                          settings.mpe_pitchbend_range_manager ?? 2,
                          visibleMpeMode,
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

      <p class="settings-form__intro-copy">
        <em>
          Sends notes directly to SuperCollider via a local WebSocket→OSC bridge. Run "yarn osc-bridge" in a locally cloned repo and use the Synths/SuperCollider-OSC folder to initialise the synths and servers.
          {/*/<br />
        Run </em> (&nbsp;<code>yarn osc-bridge</code>&nbsp;) <em> locally and load SC patch with
        OSCResponders.scd.*/}
        </em>
      </p>

      {settings.output_osc && (
        <>
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

          {[
            ["osc_volume_pluck", "Pluck"],
            ["osc_volume_buzz", "Buzz"],
            ["osc_volume_formant", "Formant"],
            ["osc_volume_saw", "Saw"],
          ].map(([key, label], index) => (
            <label key={key}>
              {label}
              <span class="sidebar-input settings-form__range-row">
                <CustomRangeSlider
                  ariaLabel={`${label} volume`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={oscDraftVolumes[key] ?? 0.5}
                  onInputValue={(nextValue) => {
                    const next = clampOscVolume(parseFloat(nextValue));
                    setOscDraftVolumes((prev) => ({ ...prev, [key]: next }));
                    props.onOscLayerVolumeChange?.(index, next);
                  }}
                  onCommitValue={(nextValue) => {
                    const next = clampOscVolume(parseFloat(nextValue));
                    saveOscVolume(key, next);
                  }}
                />
                <span class="settings-form__range-value">
                  {(oscDraftVolumes[key] ?? 0.5).toFixed(2)}
                </span>
              </span>
            </label>
          ))}
          <label>
            Quick Release
            <span class="sidebar-input settings-form__range-row">
              <CustomRangeSlider
                ariaLabel="Quick Release"
                min={0}
                max={1}
                step={0.01}
                value={oscQuickRelease}
                onInputValue={(nextValue) => {
                  const next = clampOscQuickRelease(parseFloat(nextValue));
                  setOscQuickRelease(next);
                  props.onOscQuickReleaseChange?.(next);
                }}
                onCommitValue={(nextValue) => {
                  const next = clampOscQuickRelease(parseFloat(nextValue));
                  localStorage.setItem("osc_quick_release", String(next));
                  sessionStorage.setItem("osc_quick_release", String(next));
                  onChange("osc_quick_release", next);
                }}
              />
              <span class="settings-form__range-value">
                {oscQuickRelease.toFixed(2)}
              </span>
            </span>
          </label>
          <label class="settings-form__checkbox-row settings-form__checkbox-row--tight">
            <input
              type="checkbox"
              checked={!!settings.osc_quick_release_raster_only}
              onChange={(e) => {
                localStorage.setItem("osc_quick_release_raster_only", String(e.target.checked));
                sessionStorage.setItem("osc_quick_release_raster_only", String(e.target.checked));
                props.onOscQuickReleaseRasterOnlyChange?.(e.target.checked);
                onChange("osc_quick_release_raster_only", e.target.checked);
              }}
            />
            <em class="settings-form__helper-text">Quick Release on Rastered Glissando only</em>
          </label>
          <label>
            Quick Release Time
            <span class="sidebar-input settings-form__range-row">
              <CustomRangeSlider
                ariaLabel="Quick Release Time"
                min={0.01}
                max={1}
                step={0.005}
                value={oscQuickReleaseTime}
                onInputValue={(nextValue) => {
                  const next = clampOscQuickReleaseTime(parseFloat(nextValue));
                  setOscQuickReleaseTime(next);
                  props.onOscQuickReleaseTimeChange?.(next);
                }}
                onCommitValue={(nextValue) => {
                  const next = clampOscQuickReleaseTime(parseFloat(nextValue));
                  localStorage.setItem("osc_quick_release_time", String(next));
                  sessionStorage.setItem("osc_quick_release_time", String(next));
                  onChange("osc_quick_release_time", next);
                }}
              />
              <span class="settings-form__range-value">
                {Math.round(oscQuickReleaseTime * 1000)} ms
              </span>
            </span>
          </label>
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
    center_degree: PropTypes.number,
    output_mpe: PropTypes.bool,
    output_mts_bulk: PropTypes.bool,
    fluidsynth_out_port: PropTypes.string,
    fluidsynth_device: PropTypes.string,
    fluidsynth_channel: PropTypes.number,
    mts_bulk_device: PropTypes.string,
    mts_bulk_mode: PropTypes.string,
    mts_bulk_channel: PropTypes.number,
    mts_bulk_sysex_auto: PropTypes.bool,
    mts_bulk_device_id: PropTypes.number,
    mts_bulk_tuning_map_number: PropTypes.number,
    mts_bulk_tuning_map_name: PropTypes.string,
    short_description: PropTypes.string,
    name: PropTypes.string,
    mpe_device: PropTypes.string,
    midiin_mpe_manager_ch: PropTypes.string,
    mpe_lo_ch: PropTypes.number,
    mpe_hi_ch: PropTypes.number,
    mpe_mode: PropTypes.string,
    mpe_pitchbend_range: PropTypes.number,
    mpe_pitchbend_range_manager: PropTypes.number,
    mpe_plus_output: PropTypes.bool,
    mpe_auto_generate_yz: PropTypes.bool,
    mpe_eagan_modwheel_brightness: PropTypes.bool,
    mpe_eagan_brightness: PropTypes.number,
    mpe_eagan_tilt_eq: PropTypes.number,
    mpe_eagan_pre_level: PropTypes.number,
    mpe_eagan_post_level: PropTypes.number,
    output_osc: PropTypes.bool,
    osc_bridge_url: PropTypes.string,
    osc_volume_pluck: PropTypes.number,
    osc_volume_buzz: PropTypes.number,
    osc_volume_formant: PropTypes.number,
    osc_volume_saw: PropTypes.number,
    osc_quick_release: PropTypes.number,
    osc_quick_release_time: PropTypes.number,
    osc_quick_release_raster_only: PropTypes.bool,
  }).isRequired,
  midi: PropTypes.object,
  midiAccess: PropTypes.string,
  midiAccessError: PropTypes.string,
  ensureMidiAccess: PropTypes.func,
  onChange: PropTypes.func.isRequired,
  onOscLayerVolumeChange: PropTypes.func,
  onOscQuickReleaseChange: PropTypes.func,
  onOscQuickReleaseTimeChange: PropTypes.func,
  onOscQuickReleaseRasterOnlyChange: PropTypes.func,
  keysRef: PropTypes.object,
};

export default MidiOutputs;
