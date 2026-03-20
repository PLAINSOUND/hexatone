import { h } from "preact";
import Presets from "./presets";
import CustomPresets from "./custom-presets";
import Info from "./info";
import Scale from "./scale";
import Layout from "./layout";
import SampleSynth from "./sample";
import MidiOutputs from "./midi/midioutputs";
import MIDIio from "./midi";
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
  onRevertBuiltin,
  onRevertUser,
  midi,
  instruments,
  keysRef,
  onVolumeChange,
}) => (
  <form onSubmit={(e) => e.preventDefault()}>
    <fieldset>
      <legend>
        <b>Built-in Tunings</b>
      </legend>
      <label class="preset-selector-row">
        <Presets
          onChange={presetChanged}
          presets={presets}
          isActive={activeSource === "builtin"}
          activePresetName={
            activeSource === "builtin" ? activePresetName : null
          }
        />
        {activeSource === "builtin" && onRevertBuiltin && (
          <button type="button" onClick={onRevertBuiltin}>
            Reload saved
          </button>
        )}
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
    <MIDIio onChange={onChange} settings={settings} midi={midi} />
    <MidiOutputs
      onChange={onChange}
      settings={settings}
      midi={midi}
      keysRef={keysRef}
    />
  </form>
);
export default Settings;
