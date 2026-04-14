import Presets from "./presets";
import CustomPresets from "./custom-presets";
import Info from "./info";
import Scale from "./scale";
import Layout from "./layout";
import SampleSynth from "./sample";
import MidiOutputs from "./midi/midioutputs";
import MIDIio from "./midi";
// eslint-disable-next-line no-unused-vars
import Snapshots from "./snapshots.jsx";
import "./settings.css";

const persistWebMidiIntent = (key, value, onChange) => {
  onChange?.(key, value);
  sessionStorage.setItem(key, String(value));
};

const WebMIDISettings = ({
  settings,
  onChange,
  midiAccessError,
  enableWebMidi,
  disableWebMidi,
}) => {
  const midiEnabled = !!settings.webmidi_enabled;
  const sysexEnabled = !!settings.webmidi_sysex_enabled;

  return (
    <fieldset>
      <legend>
        <b>WebMIDI</b>
      </legend>
      <label>
        Enable MIDI
        <input
          type="checkbox"
          checked={midiEnabled}
          onChange={(e) => {
            const checked = e.target.checked;
            if (!checked) {
              persistWebMidiIntent("webmidi_enabled", false, onChange);
              persistWebMidiIntent("webmidi_sysex_enabled", false, onChange);
              disableWebMidi?.();
              return;
            }
            persistWebMidiIntent("webmidi_enabled", true, onChange);
            enableWebMidi?.({ sysex: false });
          }}
        />
      </label>
      <label>
        Enable Sysex
        <input
          type="checkbox"
          checked={sysexEnabled}
          onChange={(e) => {
            const checked = e.target.checked;
            if (!checked) {
              persistWebMidiIntent("webmidi_enabled", false, onChange);
              persistWebMidiIntent("webmidi_sysex_enabled", false, onChange);
              disableWebMidi?.();
              return;
            }
            persistWebMidiIntent("webmidi_enabled", true, onChange);
            persistWebMidiIntent("webmidi_sysex_enabled", true, onChange);
            enableWebMidi?.({ sysex: true });
          }}
        />
      </label>
      {midiAccessError && (
        <p style={{ color: "#996666", fontSize: "0.85em", margin: "0.4em 0 0" }}>
          <em>{midiAccessError}</em>
        </p>
      )}
    </fieldset>
  );
};
const Settings = ({
  presetChanged,
  presets,
  settings,
  onChange,
  onAtomicChange,
  onImport,
  importCount,
  onLoadCustomPreset,
  onClearUserPresets,
  activeSource,
  activePresetName,
  isPresetDirty,
  persistOnReload,
  setPersistOnReload,
  onRevertBuiltin,
  onRevertUser,
  midi,
  midiAccess,
  midiAccessError,
  enableWebMidi,
  disableWebMidi,
  midiTick,
  instruments,
  keysRef,
  onVolumeChange,
  onOscLayerVolumeChange,
  midiLearnActive,
  lumatoneRawPorts,
  exquisRawPorts,
  exquisLedStatus,
}) => (
  <div autoComplete="off" role="group" aria-label="Hexatone settings">
    <fieldset style={{ marginTop: "1em" }}>
      <legend>
        <b>Built-in Tunings</b>
      </legend>
      <label class="preset-selector-row">
        <Presets
          onChange={presetChanged}
          presets={presets}
          isActive={activeSource === "builtin"}
          activePresetName={activeSource === "builtin" ? activePresetName : null}
        />
        {activeSource === "builtin" && onRevertBuiltin && (
          <button type="button" class="preset-refresh-btn" onClick={onRevertBuiltin}>
            <span class="preset-refresh-glyph">⟳</span>
          </button>
        )}
      </label>
      <label style={{ justifyContent: "flex-start", gap: "0.5em", marginTop: "0.4em" }}>
        <input
          type="checkbox"
          checked={persistOnReload}
          onChange={(e) => setPersistOnReload(e.target.checked)}
        />
        <em style={{ color: "#996666" }}>Restore preset on reload</em>
      </label>
    </fieldset>
    <CustomPresets
      settings={settings}
      onLoad={onLoadCustomPreset}
      onClear={onClearUserPresets}
      isActive={activeSource === "user"}
      activeSource={activeSource}
      activePresetName={activePresetName}
      isPresetDirty={isPresetDirty}
      onRevert={onRevertUser}
    />
    <Info onChange={onChange} settings={settings} />
    <Scale
      onChange={onChange}
      onAtomicChange={onAtomicChange}
      settings={settings}
      onImport={onImport}
      importCount={importCount}
      keysRef={keysRef}
    />
    <Layout onChange={onChange} settings={settings} />
    <SampleSynth
      onChange={onChange}
      settings={settings}
      instruments={instruments}
      onVolumeChange={onVolumeChange}
    />
    <WebMIDISettings
      settings={settings}
      onChange={onChange}
      midiAccessError={midiAccessError}
      enableWebMidi={enableWebMidi}
      disableWebMidi={disableWebMidi}
    />
    <MIDIio
      onChange={onChange}
      settings={settings}
      midi={midi}
      midiAccess={midiAccess}
      midiAccessError={midiAccessError}
      ensureMidiAccess={enableWebMidi}
      midiTick={midiTick}
      midiLearnActive={midiLearnActive}
      lumatoneRawPorts={lumatoneRawPorts}
      exquisRawPorts={exquisRawPorts}
      exquisLedStatus={exquisLedStatus}
      keysRef={keysRef}
    />
    <MidiOutputs
      onChange={onChange}
      onOscLayerVolumeChange={onOscLayerVolumeChange}
      settings={settings}
      midi={midi}
      midiAccess={midiAccess}
      midiAccessError={midiAccessError}
      ensureMidiAccess={enableWebMidi}
      midiTick={midiTick}
      keysRef={keysRef}
    />
  </div>
);
export default Settings;
