import { useState } from "preact/hooks";
import { getTouchInputMode, setTouchInputMode } from "../keyboard/touch-input-mode.js";
import { getLatencyMeasurementEnabled, setLatencyMeasurementEnabled } from "../audio/runtime-diagnostics.js";

export default function AudioDiagnostics({ keysRef, onSaveReport }) {
  const [mode, setMode] = useState(getTouchInputMode);
  const [measureLatency, setMeasureLatency] = useState(getLatencyMeasurementEnabled);
  const [collapsed, setCollapsed] = useState(true);
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
    }} /> Measure audio latency</label>
    <p class="settings-form__helper-text">Off by default; resets on reload. Enable only while testing. Disabling stops timing capture and timer probes and clears measurements. Engine recovery diagnostics remain bounded and active. Reports do not measure speaker onset.</p>
    <button type="button" onClick={onSaveReport}>Save audio report</button>
    </>}
  </fieldset>;
}
