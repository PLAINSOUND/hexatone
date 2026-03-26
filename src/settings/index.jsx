import { h } from "preact";
import Presets from "./presets";
import CustomPresets from "./custom-presets";
import Info from "./info";
import Scale from "./scale";
import Layout from "./layout";
import SampleSynth from "./sample";
import MidiOutputs from "./midi/midioutputs";
import MIDIio from "./midi";
import Snapshots from "./snapshots.jsx";
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
  midiTick,
  instruments,
  keysRef,
  onVolumeChange,
  midiLearnActive,
  lumatoneRawPorts,
  snapshots,
  playingSnapshotId,
  onPlaySnapshot,
  onDeleteSnapshot,
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
          <button
            type="button"
            onClick={onRevertBuiltin}
            style={{
              fontSize: "1.3rem",
              lineHeight: "0.86",
              overflow: "visible",
              alignSelf: "center",
              marginTop: "0em",
            }}
          >
            ⟳
          </button>
        )}
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: "0.4em", marginTop: "0.4em", fontSize: "0.85em" }}>
        <input
          type="checkbox"
          checked={persistOnReload}
          onChange={(e) => setPersistOnReload(e.target.checked)}
        />
        Restore last preset on page reload
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
    <MIDIio
      onChange={onChange}
      settings={settings}
      midi={midi}
      midiTick={midiTick}
      midiLearnActive={midiLearnActive}
      lumatoneRawPorts={lumatoneRawPorts}
      keysRef={keysRef}
    />
    <MidiOutputs
      onChange={onChange}
      settings={settings}
      midi={midi}
      midiTick={midiTick}
      keysRef={keysRef}
    />
  </form>
);
export default Settings;
