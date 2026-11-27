/**
 * Explicit Web MIDI and SysEx permission controls for the IO tab.
 * Persists user intent through App callbacks; use-synth-wiring requests browser
 * permission and handles connection discovery/restoration.
 */

import PropTypes from "prop-types";

// Persist a WebMIDI intent key both to the settings object and to sessionStorage
// so the chosen MIDI permission survives page reload within the same session.
const persistWebMidiIntent = (key, value, onChange) => {
  onChange?.(key, value);
  sessionStorage.setItem(key, String(value));
};

const WebMIDISettings = ({
  settings,
  onChange,
  midiAccessError,
  enableWebMidi,
  disableWebMidi,
  children,
}) => {
  const midiEnabled = !!settings.webmidi_enabled;
  const sysexEnabled = !!settings.webmidi_sysex_enabled;

  return (
    <fieldset>
      <legend>
        <b>MIDI Setup</b>
      </legend>
      <label>
        Enable MIDI
        <input
          type="checkbox"
          checked={midiEnabled}
          onChange={(e) => {
            const checked = e.target.checked;
            if (!checked) {
              persistWebMidiIntent("webmidi_enabled", false, onChange);
              persistWebMidiIntent("webmidi_sysex_enabled", false, onChange);
              disableWebMidi?.();
              return;
            }
            persistWebMidiIntent("webmidi_enabled", true, onChange);
            enableWebMidi?.({ sysex: false });
          }}
        />
      </label>
      <label>
        Enable Sysex
        <input
          type="checkbox"
          checked={sysexEnabled}
          onChange={(e) => {
            const checked = e.target.checked;
            if (!checked) {
              persistWebMidiIntent("webmidi_enabled", false, onChange);
              persistWebMidiIntent("webmidi_sysex_enabled", false, onChange);
              disableWebMidi?.();
              return;
            }
            persistWebMidiIntent("webmidi_enabled", true, onChange);
            persistWebMidiIntent("webmidi_sysex_enabled", true, onChange);
            enableWebMidi?.({ sysex: true });
          }}
        />
      </label>
      {midiAccessError && (
        <p class="settings-form__warning-copy">{midiAccessError}</p>
      )}
      {children}
    </fieldset>
  );
};

WebMIDISettings.propTypes = {
  settings: PropTypes.shape({
    webmidi_enabled: PropTypes.bool,
    webmidi_sysex_enabled: PropTypes.bool,
  }).isRequired,
  onChange: PropTypes.func,
  midiAccessError: PropTypes.string,
  enableWebMidi: PropTypes.func,
  disableWebMidi: PropTypes.func,
  children: PropTypes.node,
};

export default WebMIDISettings;
