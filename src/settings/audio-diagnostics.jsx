import { useState } from "preact/hooks";
import { getTouchInputMode, setTouchInputMode } from "../keyboard/touch-input-mode.js";
import { getLatencyMeasurementEnabled, setLatencyMeasurementEnabled, markAudioTestStage } from "../audio/runtime-diagnostics.js";

export default function AudioDiagnostics({ keysRef, onSaveReport, onRecreateContexts }) {
  const [mode, setMode] = useState(getTouchInputMode);
  const [measureLatency, setMeasureLatency] = useState(getLatencyMeasurementEnabled);
  const [collapsed, setCollapsed] = useState(true);
  const [stage, setStage] = useState("");
  const [recreating, setRecreating] = useState(false);
  const [resetStatus, setResetStatus] = useState("");
  return <fieldset>
    <legend>Audio Diagnostics{" "}
      <button type="button" class="section-collapse-toggle"
        aria-label={collapsed ? "Show Audio Diagnostics settings" : "Hide Audio Diagnostics settings"}
        aria-expanded={!collapsed}
        title={collapsed ? "Toggle to show Audio Diagnostics settings" : "Toggle to hide Audio Diagnostics settings"}
        onClick={() => setCollapsed(!collapsed)}>
        <span aria-hidden="true" class={`disclosure-toggle-glyph disclosure-toggle-glyph--${collapsed ? "collapsed" : "expanded"}`} />
      </button>
    </legend>
    {!collapsed && <>
    <p class="settings-form__helper-text">Compare touchscreen input paths. Switching releases held notes. Automatic keeps Touch Events on iPhone; this override resets on reload.</p>
    <label>Touchscreen events{" "}
      <select value={mode} onChange={event => {
        const value = event.currentTarget.value;
        setTouchInputMode(value);
        keysRef.current?.configureTouchInput(value);
        setMode(value);
      }}>
        <option value="auto">Automatic</option>
        <option value="touch">Touch Events</option>
        <option value="pointer">Pointer Events (experimental)</option>
      </select>
    </label>
    <label><input type="checkbox" checked={measureLatency} onChange={event => {
      const enabled = event.currentTarget.checked;
      setLatencyMeasurementEnabled(enabled);
      setMeasureLatency(enabled);
      setStage("");
    }} /> Measure audio latency</label>
    <p class="settings-form__helper-text">Off by default; resets on reload. Enable only while testing. Disabling stops timing capture and timer probes and clears measurements. Engine recovery diagnostics remain bounded and active. Reports do not measure speaker onset.</p>
    <p class="settings-form__helper-text">Mouse clicks and drags, computer-keyboard notes, and touch input are recorded. FluidSynth reports input-to-render timing. For its first non-silent output measurement, play separate notes and let the sound fade to silence between them. This is before browser output buffering; actual speaker delay requires a loopback or microphone measurement.</p>
    <p class="settings-form__helper-text">Each attack also records browser output-latency and playback-clock estimates. Safari may report the playback clock as identical to the render clock; this cannot rule out audible output buffering.</p>
    <p class="settings-form__helper-text">Before each pass, mark its stage. Keep measurements enabled throughout and save one report after the context reset. Each stage retains up to 180 backend measurements, with 720 total for four passes.</p>
    {["Baseline", "FluidSynth loaded", "SoundFont OFF"].map(label =>
      <button key={label} type="button" disabled={!measureLatency} onClick={() => {
        markAudioTestStage(label); setStage(label);
      }}>Mark {label}</button>)}
    {stage && <p role="status">Recording stage: {stage}</p>}
    <p class="settings-form__helper-text">After SoundFont OFF, recreate audio contexts to test whether immediacy returns. This releases notes and rebuilds initialized built-in engines without clearing saved settings or cached SoundFonts. Wait for recovery to finish before playing.</p>
    <button type="button" disabled={recreating || !onRecreateContexts} onClick={async () => {
      setRecreating(true);
      setResetStatus("Recreating audio contexts…");
      try {
        await onRecreateContexts();
        if (measureLatency) { markAudioTestStage("Contexts recreated"); setStage("Contexts recreated"); }
        setResetStatus("Reset attempt finished; check the audio recovery status, then play and save the report.");
      } catch (error) {
        setResetStatus(`Context reset failed: ${error.message ?? error}`);
      } finally { setRecreating(false); }
    }}>Recreate audio contexts</button>
    {resetStatus && <p role="status">{resetStatus}</p>}
    <button type="button" onClick={onSaveReport}>Save audio report</button>
    </>}
  </fieldset>;
}
