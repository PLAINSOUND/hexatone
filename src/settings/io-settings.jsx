/**
 * IO workspace composition: restore preference, permissions, controllers, outputs,
 * optional shared sequencer transport and built-in sounds. App/use-synth-wiring
 * own connection and playback state so changing tabs does not recreate the transport.
 */

import UserSounds from "./user-sounds.jsx";
import { useSoundRecallState } from "../hooks/use-sound-session.js";
import DsfSettings from "./dsf-settings.jsx";
import SampleSynth from "./sample";
import { useState } from "preact/hooks";
import { rememberSoundSession, PATCH_REARTICULATION_KEY, SOUND_RESTORE_KEY, MIDI_RESTORE_KEY, restoreSoundOnReload, restoreMidiOnReload } from "../persistence/io-reload-policy.js";
import MidiOutputs from "./midi/midioutputs";
import MIDIio from "./midi";
import WebMIDISettings from "./midi/webmidi-settings.jsx";
import SuperColliderSettings from "./supercollider-settings.jsx";
import FluidSynthSettings from "./fluidsynth-settings.jsx";
import AudioDiagnostics from "./audio-diagnostics.jsx";

const recallRevision = state => state?.revision ?? 0;

const IOSettings = ({
  panel = "sounds",
  showActivateAudioContext,
  activateAudioContext,
  settings,
  onChange,
  soundSession,
  soundRecall,
  soundfontRestoreProgress,
  cancelStartupRestore,
  midi,
  midiAccess,
  midiAccessError,
  enableWebMidi,
  disableWebMidi,
  midiTick,
  instruments,
  keysRef,
  oscBrightness,
  onOscBrightnessChange,
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
  exquisPendingSettings,
  snapshots,
  tuningRuntime,
  onEnableLumatoneAutoSync,
  onProbeLumatoneConnection,
  lumatoneDriverReady,
  lumatoneFirmwareVersion,
  onSaveAudioReport,
  onRecreateAudioContexts,
  onCycleAudioContexts,
  onRestartFluidSynthWorklet,
}) => {
  const revision = useSoundRecallState(soundRecall, recallRevision);
  const [workingSoundChanges] = useState(() => new EventTarget());
  const refreshWorkingSound = () => workingSoundChanges.dispatchEvent(new Event("change"));
  const [rearticulate, setRearticulate] = useState(() => localStorage.getItem(PATCH_REARTICULATION_KEY) === "true");
  const [restoreSounds, setRestoreSounds] = useState(() => restoreSoundOnReload());
  const [restoreMidi, setRestoreMidi] = useState(() => restoreMidiOnReload());
  const midiPanel = panel === "midi";
  const preferences = (
    <>
      <div class="settings-form__reload-row settings-form__checkbox-row--sm settings-form__reload-row--compact">
        <label class="settings-form__checkbox-row settings-form__reload-checkbox">
          <input
            type="checkbox"
            checked={midiPanel ? restoreMidi : restoreSounds}
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              localStorage.setItem(midiPanel ? MIDI_RESTORE_KEY : SOUND_RESTORE_KEY, String(enabled));
              if (midiPanel) setRestoreMidi(enabled);
              else {
                setRestoreSounds(enabled);
                rememberSoundSession(settings);
              }
            }}
          />
          <em class="settings-form__global-preference">{midiPanel ? "Restore MIDI settings on reload" : "Restore SOUND settings on reload"}</em>
        </label>
      </div>
      <div class="settings-form__reload-row settings-form__checkbox-row--sm settings-form__reload-row--compact">
        <label class="settings-form__checkbox-row settings-form__reload-checkbox">
          <input type="checkbox" checked={rearticulate} onChange={event => {
            const enabled = event.currentTarget.checked;
            setRearticulate(enabled);
            localStorage.setItem(PATCH_REARTICULATION_KEY, String(enabled));
          }} />
          <em class="settings-form__global-preference">Change patches immediately and rearticulate</em>
        </label>
      </div>
    </>
  );
  return (
    <div class={`io-settings${snapshots?.length ? " io-settings--with-transport" : ""}`} data-canvas-keyboard-controls autoComplete="off" role="group" aria-label={midiPanel ? "MIDI settings" : "Sound settings"}>
      <div hidden={panel !== "sounds"}>
      {/* Pages is a production-optimised preview build, so DEV alone is false.
          Opt in at build time only; normal production builds keep this hidden. */}
      {panel === "sounds" && (import.meta.env.DEV || import.meta.env.VITE_AUDIO_DIAGNOSTICS === "true") && <AudioDiagnostics keysRef={keysRef} onSaveReport={onSaveAudioReport} onRecreateContexts={onRecreateAudioContexts} onCycleContexts={onCycleAudioContexts} onRestartFluidSynthWorklet={onRestartFluidSynthWorklet} />}
      <UserSounds settings={settings} soundSession={soundSession} workingSoundChanges={workingSoundChanges} soundRecall={soundRecall}>
        {panel === "sounds" && preferences}
      </UserSounds>
      <DsfSettings settings={settings} onChange={onChange} soundSession={soundSession} />
      <SampleSynth key={`sample-${revision}`}
        showActivateAudioContext={showActivateAudioContext}
        activateAudioContext={activateAudioContext}
        onChange={onChange}
        settings={settings}
        instruments={instruments}
        soundSession={soundSession}
      />
      <FluidSynthSettings soundSession={soundSession} settings={settings} onChange={onChange} soundRecall={soundRecall}
        onWorkingChange={refreshWorkingSound} keysRef={keysRef} cancelStartupRestore={cancelStartupRestore} restoreProgress={soundfontRestoreProgress} />
      <SuperColliderSettings key={`scsynth-${revision}`}
        settings={settings}
        onChange={onChange}
        soundSession={soundSession}
        oscBrightness={oscBrightness}
        onOscBrightnessChange={onOscBrightnessChange}
        onOscQuickReleaseChange={onOscQuickReleaseChange}
        onOscQuickReleaseTimeChange={onOscQuickReleaseTimeChange}
        onOscQuickReleaseRasterOnlyChange={onOscQuickReleaseRasterOnlyChange}
      />
      </div>
      <div hidden={panel !== "midi"}>
      <WebMIDISettings
        settings={settings}
        midi={midi}
        onChange={onChange}
        midiAccessError={midiAccessError}
        enableWebMidi={enableWebMidi}
        disableWebMidi={disableWebMidi}
      >
        {midiPanel && preferences}
      </WebMIDISettings>
      <MIDIio
        exquisPendingSettings={exquisPendingSettings}
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
        onProbeLumatoneConnection={onProbeLumatoneConnection}
        lumatoneDriverReady={lumatoneDriverReady}
        lumatoneFirmwareVersion={lumatoneFirmwareVersion}
      />
      <MidiOutputs
        onChange={onChange}
        settings={settings}
        midi={midi}
        midiAccess={midiAccess}
        midiAccessError={midiAccessError}
        ensureMidiAccess={enableWebMidi}
        midiTick={midiTick}
        keysRef={keysRef}
      />
      </div>
    </div>
  );
};

export default IOSettings;
