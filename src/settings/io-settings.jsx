import SampleSynth from "./sample";
import MidiOutputs from "./midi/midioutputs";
import MIDIio from "./midi";
import WebMIDISettings from "./midi/webmidi-settings.jsx";

const IOSettings = ({
  settings,
  onChange,
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
  onSendLumatoneColors,
  onProbeLumatoneConnection,
  lumatoneDriverReady,
}) => (
  <div autoComplete="off" role="group" aria-label="Input and output settings">
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
      onSendLumatoneColors={onSendLumatoneColors}
      onProbeLumatoneConnection={onProbeLumatoneConnection}
      lumatoneDriverReady={lumatoneDriverReady}
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

export default IOSettings;
