import Presets from "./presets/presets";
import CustomPresets from "./presets/custom-presets";
import { useMemo } from "preact/hooks";
import Info from "./scale/info";
import Scale from "./scale";
import Layout from "./layout";
import SampleSynth from "./sample";
import MidiOutputs from "./midi/midioutputs";
import MIDIio from "./midi";
import WebMIDISettings from "./midi/webmidi-settings.jsx";
import { normalizeColors } from "../normalize-settings.js";

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
  currentModulationLibrary,
  canCommitModulation,
  onCommitCurrentModulation,
  persistOnReload,
  setPersistOnReload,
  showActivateAudioContext,
  activateAudioContext,
  activatePendingPreset,
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
  keysReadyRevision,
  heji_names,
  heji_names_table,
  modulation_transposition_cents,
  modulation_display_active,
  heji_anchor_label_eff,
  heji_anchor_ratio_eff,
  heji_supported,
  heji_warning,
  onVolumeChange,
  onOscLayerVolumeChange,
  onOscQuickReleaseChange,
  onOscQuickReleaseTimeChange,
  onOscQuickReleaseRasterOnlyChange,
  midiLearnActive,
  hakenPedalLearnActive,
  lumatoneRawPorts,
  exquisRawPorts,
  linnstrumentRawPorts,
  hakenRawPorts,
  exquisLedStatus,
  snapshots,
  onEnableLumatoneAutoSync,
}) => {
  const effectiveScaleSettings = useMemo(() => ({
    ...settings,
    ...normalizeColors(settings),
  }), [settings]);

  return (
    <div autoComplete="off" role="group" aria-label="Hexatone settings">
    <fieldset class="settings-form__section-top">
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
      <div class="settings-form__reload-row settings-form__checkbox-row--sm">
        {showActivateAudioContext && (activateAudioContext || activatePendingPreset) ? (
          <button
            type="button"
            class="preset-action-btn settings-form__activate-audio-btn"
            onClick={() => void (activateAudioContext || activatePendingPreset)()}
          >
            Activate Audio Context
          </button>
        ) : (
          <label class="settings-form__checkbox-row settings-form__reload-checkbox">
            <input
              type="checkbox"
              checked={persistOnReload}
              onChange={(e) => setPersistOnReload(e.target.checked)}
            />
            <em class="settings-form__helper-text">Restore preset on reload</em>
          </label>
        )}
      </div>
    </fieldset>
    <CustomPresets
      settings={settings}
      onLoad={onLoadCustomPreset}
      onClear={onClearUserPresets}
      isActive={activeSource === "user"}
      activeSource={activeSource}
      activePresetName={activePresetName}
      isPresetDirty={isPresetDirty}
      currentModulationLibrary={currentModulationLibrary}
      canCommitModulation={canCommitModulation}
      onCommitCurrentModulation={onCommitCurrentModulation}
      onRevert={onRevertUser}
    />
    <Info onChange={onChange} settings={settings} />
    <Scale
      onChange={onChange}
      onAtomicChange={onAtomicChange}
      settings={effectiveScaleSettings}
      rawSettings={settings}
      heji_names={heji_names}
      heji_names_table={heji_names_table}
      modulation_transposition_cents={modulation_transposition_cents}
      modulation_display_active={modulation_display_active}
      heji_anchor_label_eff={heji_anchor_label_eff}
      heji_anchor_ratio_eff={heji_anchor_ratio_eff}
      heji_supported={heji_supported}
      heji_warning={heji_warning}
      onImport={onImport}
      importCount={importCount}
      keysRef={keysRef}
      keysReadyRevision={keysReadyRevision}
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
      midi={midi}
      onChange={onChange}
      midiAccessError={midiAccessError}
      enableWebMidi={enableWebMidi}
      disableWebMidi={disableWebMidi}
    />
    <MIDIio
      onChange={onChange}
      settings={settings}
      snapshots={snapshots}
      midi={midi}
      midiAccess={midiAccess}
      midiAccessError={midiAccessError}
      ensureMidiAccess={enableWebMidi}
      midiTick={midiTick}
      midiLearnActive={midiLearnActive}
      hakenPedalLearnActive={hakenPedalLearnActive}
      lumatoneRawPorts={lumatoneRawPorts}
      exquisRawPorts={exquisRawPorts}
      linnstrumentRawPorts={linnstrumentRawPorts}
      hakenRawPorts={hakenRawPorts}
      exquisLedStatus={exquisLedStatus}
      keysRef={keysRef}
      onEnableLumatoneAutoSync={onEnableLumatoneAutoSync}
    />
    <MidiOutputs
      onChange={onChange}
      onOscLayerVolumeChange={onOscLayerVolumeChange}
      onOscQuickReleaseChange={onOscQuickReleaseChange}
      onOscQuickReleaseTimeChange={onOscQuickReleaseTimeChange}
      onOscQuickReleaseRasterOnlyChange={onOscQuickReleaseRasterOnlyChange}
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
};
export default Settings;
