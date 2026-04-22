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
}) => {
  const midiEnabled = !!settings.webmidi_enabled;
  const sysexEnabled = !!settings.webmidi_sysex_enabled;

  return (
    <fieldset>
      <legend>
        <b>MIDI Permissions</b>
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
        <p style={{ color: "#996666", fontSize: "0.85em", margin: "0.4em 0 0" }}>
          <em>{midiAccessError}</em>
        </p>
      )}
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
};

export default WebMIDISettings;
