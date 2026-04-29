import Presets from "./presets";
import CustomPresets from "./custom-presets";
import Info from "./info";
import Scale from "./scale";
import Layout from "./layout";
import SampleSynth from "./sample";
import MidiOutputs from "./midi/midioutputs";
import MIDIio from "./midi";
import WebMIDISettings from "./midi/webmidi-settings.jsx";
import "./settings.css";
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
  heji_names,
  heji_names_table,
  heji_anchor_label_eff,
  heji_anchor_ratio_eff,
  heji_supported,
  heji_warning,
  onVolumeChange,
  onOscLayerVolumeChange,
  midiLearnActive,
  lumatoneRawPorts,
  exquisRawPorts,
  linnstrumentRawPorts,
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
      heji_names={heji_names}
      heji_names_table={heji_names_table}
      heji_anchor_label_eff={heji_anchor_label_eff}
      heji_anchor_ratio_eff={heji_anchor_ratio_eff}
      heji_supported={heji_supported}
      heji_warning={heji_warning}
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
      linnstrumentRawPorts={linnstrumentRawPorts}
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
