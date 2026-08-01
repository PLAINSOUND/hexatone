import { useMemo, useState } from "preact/hooks";
import Info from "./scale/info";
import Scale from "./scale";
import Layout from "./layout";
import SampleSynth from "./sample";
import MidiOutputs from "./midi/midioutputs";
import MIDIio from "./midi";
import WebMIDISettings from "./midi/webmidi-settings.jsx";
import { normalizeColors } from "./normalize-settings.js";
import { presetTuningGroups } from "../hexatone/preset-tunings/index.js";
import TuningLibrary from "../hexatone/tuning-library.jsx";

const Settings = ({
  onLoadBuiltinPreset,
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
  tuningRuntime,
  onEnableLumatoneAutoSync,
}) => {
  const [tuningSaveActionState, setTuningSaveActionState] = useState({
    visible: false,
    label: "",
    action: null,
  });
  const [primaryTuningSaveVisible, setPrimaryTuningSaveVisible] = useState(false);
  const effectiveScaleSettings = useMemo(
    () => ({
      ...settings,
      ...normalizeColors(settings),
    }),
    [settings],
  );
  const effectiveTuningLibrarySettings = useMemo(() => {
    if (settings.key_labels !== "heji" || !Array.isArray(heji_names) || !heji_names.length) {
      return settings;
    }
    // In HEJI mode the visible labels are derived from the current anchor and
    // scale. Persist those effective labels rather than an unrelated, stale
    // note_names array left over from an earlier spelling frame.
    return { ...settings, note_names: [...heji_names] };
  }, [heji_names, settings]);

  return (
    <div autoComplete="off" role="group" aria-label="Hexatone settings">
      <TuningLibrary
        presetGroups={presetTuningGroups}
        settings={effectiveTuningLibrarySettings}
        currentModulationLibrary={currentModulationLibrary}
        activeSource={activeSource}
        activePresetName={activePresetName}
        isPresetDirty={isPresetDirty}
        onLoadBuiltinTuning={onLoadBuiltinPreset}
        onLoadUserTuning={onLoadCustomPreset}
        onClearWorkspace={onClearUserPresets}
        persistOnReload={persistOnReload}
        setPersistOnReload={setPersistOnReload}
        showActivateAudioContext={showActivateAudioContext}
        activateAudioContext={activateAudioContext}
        activatePendingPreset={activatePendingPreset}
        onRevertBuiltin={onRevertBuiltin}
        onRevertUser={onRevertUser}
        canCommitModulation={canCommitModulation}
        onCommitCurrentModulation={onCommitCurrentModulation}
        onSaveActionStateChange={setTuningSaveActionState}
        onPrimarySaveVisibilityChange={setPrimaryTuningSaveVisible}
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
        tuningSaveActionState={tuningSaveActionState}
        primaryTuningSaveVisible={primaryTuningSaveVisible}
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
        tuningRuntime={tuningRuntime}
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
