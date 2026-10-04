import { useEffect, useState } from "preact/hooks";
import { startWindowsCapture, stopWindowsCapture, saveWindowsCapture,
  markWindowsSilence, markWindowsRecovery } from "../dev/windows-performance.js";

export default function WindowsDiagnostics({ settings }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => () => stopWindowsCapture(), []);
  return <fieldset>
    <legend>Windows performance diagnostics</legend>
    <label>
      Enable temporary capture
      <input type="checkbox" checked={enabled} onChange={event => {
        const next = event.currentTarget.checked;
        if (next) startWindowsCapture({ layers: settings.osc_synth_names,
          volumes: [settings.osc_volume_pluck, settings.osc_volume_buzz, settings.osc_volume_formant, settings.osc_volume_saw],
          release: settings.osc_quick_release_time, localSuperSonic: settings.osc_local });
        else stopWindowsCapture();
        setEnabled(next);
      }} />
    </label>
    {enabled && <>
      <p>Play until silence occurs. Mark silence (Shift+F8) and recovery (Shift+F9), then save the report.
        Canvas contact cancellation is also captured. No audio is recorded; capture retains the last five minutes of engine samples.</p>
      <button type="button" onClick={markWindowsSilence}>Mark silence</button>{" "}
      <button type="button" onClick={markWindowsRecovery}>Mark recovery</button>{" "}
      <button type="button" onClick={() => { saveWindowsCapture(); setEnabled(false); }}>Save diagnostic report</button>
    </>}
  </fieldset>;
}
