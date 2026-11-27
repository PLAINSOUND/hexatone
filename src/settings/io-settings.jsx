/**
 * IO workspace composition: restore preference, permissions, controllers, outputs,
 * optional shared sequencer transport and built-in sounds. App/use-synth-wiring
 * own connection and playback state so changing tabs does not recreate the transport.
 */

import UserSounds from "./user-sounds.jsx";
import { peekFluidSynthEngine } from "../fluidsynth_synth/index.js";
import { REVERB_KEY } from "../fluidsynth_synth/reverb.js";
import { SMOOTHING_KEY } from "../fluidsynth_synth/smoothing.js";
import DsfSettings from "./dsf-settings.jsx";
import SampleSynth from "./sample";
import { useState } from "preact/hooks";
import { SOUND_RESTORE_KEY, MIDI_RESTORE_KEY, restoreSoundOnReload, restoreMidiOnReload } from "../persistence/io-reload-policy.js";
import MidiOutputs from "./midi/midioutputs";
import MIDIio from "./midi";
import WebMIDISettings from "./midi/webmidi-settings.jsx";
import SuperColliderSettings from "./supercollider-settings.jsx";
import FluidSynthSettings from "./fluidsynth-settings.jsx";
import AudioDiagnostics from "./audio-diagnostics.jsx";

const IOSettings = ({
  panel = "sounds",
  showActivateAudioContext,
  activateAudioContext,
  settings,
  onChange,
  onAtomicChange,
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
  const [soundRevision, setSoundRevision] = useState(0);
  const [soundRecall, setSoundRecall] = useState(null);
  const [, setWorkingSoundRevision] = useState(0);
  const refreshWorkingSound = () => setWorkingSoundRevision(value => value + 1);
  const [restoreSounds, setRestoreSounds] = useState(() => restoreSoundOnReload());
  const [restoreMidi, setRestoreMidi] = useState(() => restoreMidiOnReload());
  return (
    <div class={`io-settings${snapshots?.length ? " io-settings--with-transport" : ""}`} data-canvas-keyboard-controls autoComplete="off" role="group" aria-label={panel === "midi" ? "MIDI settings" : "Sound settings"}>
      <div class="settings-form__reload-row settings-form__checkbox-row--sm io-settings__reload-row">
        <label class="settings-form__checkbox-row settings-form__reload-checkbox">
          <input
            type="checkbox"
            checked={panel === "midi" ? restoreMidi : restoreSounds}
            onChange={(event) => {
              const enabled = event.target.checked;
              const midiPanel = panel === "midi";
              localStorage.setItem(midiPanel ? MIDI_RESTORE_KEY : SOUND_RESTORE_KEY, String(enabled));
              if (midiPanel) setRestoreMidi(enabled);
              else setRestoreSounds(enabled);
            }}
          />
          <em class="settings-form__helper-text">{panel === "midi" ? "Restore MIDI settings on reload" : "Restore SOUND settings on reload"}</em>
        </label>
      </div>
      <div hidden={panel !== "sounds"}>
      {/* Pages is a production-optimised preview build, so DEV alone is false.
          Opt in at build time only; normal production builds keep this hidden. */}
      {panel === "sounds" && (import.meta.env.DEV || import.meta.env.VITE_AUDIO_DIAGNOSTICS === "true") && <AudioDiagnostics keysRef={keysRef} onSaveReport={onSaveAudioReport} onRecreateContexts={onRecreateAudioContexts} onCycleContexts={onCycleAudioContexts} onRestartFluidSynthWorklet={onRestartFluidSynthWorklet} />}
      <UserSounds settings={settings} onApply={sound => {
        const updates = { ...sound.settings, fluidsynth_preset: sound.soundfont.preset };
        for (const [key, value] of Object.entries(updates)) {
          sessionStorage.setItem(key, String(value));
          if (key.startsWith("dsf_") || key.startsWith("osc_")) localStorage.setItem(key, String(value));
        }
        localStorage.setItem("synth_volume", String(sound.sampleVolume));
        localStorage.setItem("fluidsynth_internal_volume", String(sound.soundfont.volume));
        localStorage.setItem(REVERB_KEY, String(sound.soundfont.reverb));
        localStorage.setItem(SMOOTHING_KEY, JSON.stringify(sound.soundfont.smoothing));
        onVolumeChange?.(sound.sampleVolume);
        ["pluck", "buzz", "formant", "saw"].forEach((name, index) =>
          onOscLayerVolumeChange?.(index, updates[`osc_volume_${name}`]));
        onOscBrightnessChange?.(updates.osc_brightness);
        onOscQuickReleaseChange?.(updates.osc_quick_release);
        onOscQuickReleaseTimeChange?.(updates.osc_quick_release_time);
        onOscQuickReleaseRasterOnlyChange?.(updates.osc_quick_release_raster_only);
        const engine = peekFluidSynthEngine();
        engine?.setVolume?.(sound.soundfont.volume);
        engine?.setReverb?.(sound.soundfont.reverb);
        engine?.setSmoothing?.(sound.soundfont.smoothing);
        onAtomicChange(updates);
        setSoundRecall({ ...sound.soundfont });
        setSoundRevision(value => value + 1);
      }} />
      <DsfSettings settings={settings} onChange={onChange} />
      <SampleSynth key={`sample-${soundRevision}`}
        showActivateAudioContext={showActivateAudioContext}
        activateAudioContext={activateAudioContext}
        onChange={onChange}
        settings={settings}
        instruments={instruments}
        onVolumeChange={value => { onVolumeChange?.(value); refreshWorkingSound(); }}
      />
      <FluidSynthSettings settings={settings} onChange={onChange} soundRecall={soundRecall} onWorkingChange={refreshWorkingSound} />
      <SuperColliderSettings key={`scsynth-${soundRevision}`}
        settings={settings}
        onChange={onChange}
        onOscLayerVolumeChange={(...args) => { onOscLayerVolumeChange?.(...args); refreshWorkingSound(); }}
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
      />
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
