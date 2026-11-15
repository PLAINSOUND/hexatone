/** Optional performance capture controls for remote Safari and desktop testing. */
import { useState } from "preact/hooks";
import { setFluidSynthAudioTest } from "../fluidsynth_synth/index.js";

export default function AudioDiagnostics() {
  const [enabled, setEnabled] = useState(false);
  const [testStatus, setTestStatus] = useState("");
  const suite = globalThis.__hexatoneAudioDiagnostics;
  return <fieldset>
    <legend>Audio Diagnostics</legend>
    <p>FluidSynth carrier-reuse test: 30 seconds at 16 notes per second, always reusing MIDI carrier 60. Before every attack it is retuned via real-time MTS to a random pitch from 48 to 72 (+/- 50 cents), with continuous pitch bending. Uses the normal main-thread MIDI queue and loaded preset; works with capture off. Do not play during the test. Afterwards, test carriers are reset to 12-EDO and pitch bend to centre.</p>
    <p>
      <button type="button" onClick={async () => {
        try {
          await setFluidSynthAudioTest(true, { replay: true });
          setTestStatus("Pre-tuning rotating carriers once, then replaying the same carrier note events without MTS during playback. Reused carriers keep their initial tuning, so later pitches differ. Stops after about 17 seconds and resets carriers to 12-EDO; live playing is unchanged.");
        } catch (error) { setTestStatus(error.message); }
      }}>Replay canvas MIDI excerpt</button>{" "}
      <button type="button" onClick={async () => {
        try {
          await setFluidSynthAudioTest(true);
          setTestStatus("Test started; stops automatically after 30 seconds.");
        } catch (error) { setTestStatus(error.message); }
      }}>Start FluidSynth audio test</button>{" "}
      <button type="button" onClick={() => {
        setFluidSynthAudioTest(false);
        setTestStatus("Test stopped.");
      }}>Stop audio test</button>
    </p>
    {testStatus && <p role="status">{testStatus}</p>}
    <label class="settings-form__checkbox-row">
      <input type="checkbox" checked={enabled} onChange={event => {
        const next = event.target.checked;
        if (next) suite?.start(); else suite?.stop(false);
        setEnabled(next);
      }} />Enable performance capture
    </label>
    {enabled && <p>FluidSynth records the last 5 seconds of rendered audio when you mark a failure. Save report also downloads WAV clips (up to 8). Allow multiple downloads if prompted.</p>}
    {enabled && <p>
      <button type="button" onClick={() => suite?.mark()}>Mark audible failure</button>{" "}
      <button type="button" onClick={() => { suite?.stop(); setEnabled(false); }}>Save report</button>
    </p>}
  </fieldset>;
}
