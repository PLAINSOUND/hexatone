/**
 * IO workspace composition: restore preference, permissions, controllers, outputs,
 * optional shared sequencer transport and built-in sounds. App/use-synth-wiring
 * own connection and playback state so changing tabs does not recreate the transport.
 */

import SampleSynth from "./sample";
import { useState } from "preact/hooks";
import { IO_RESTORE_KEY, restoreIOOnReload } from "../persistence/io-reload-policy.js";
import MidiOutputs from "./midi/midioutputs";
import MIDIio from "./midi";
import WebMIDISettings from "./midi/webmidi-settings.jsx";

const IOSettings = ({
  showActivateAudioContext,
  activateAudioContext,
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
}) => {
  const [restoreIO, setRestoreIO] = useState(() => restoreIOOnReload());
  return (
    <div class="io-settings" autoComplete="off" role="group" aria-label="Input and output settings">
      <div class="settings-form__reload-row settings-form__checkbox-row--sm io-settings__reload-row">
        <label class="settings-form__checkbox-row settings-form__reload-checkbox">
          <input
            type="checkbox"
            checked={restoreIO}
            onChange={(event) => {
              const enabled = event.target.checked;
              localStorage.setItem(IO_RESTORE_KEY, String(enabled));
              setRestoreIO(enabled);
            }}
          />
          <em class="settings-form__helper-text">Restore I/O settings on reload</em>
        </label>
      </div>
      <SampleSynth
        showActivateAudioContext={showActivateAudioContext}
        activateAudioContext={activateAudioContext}
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
};

export default IOSettings;
