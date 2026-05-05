import PropTypes from "prop-types";
import OutputPortPicker from "../output-port-picker.js";

// This module owns the Lumatone-specific LED and layout-send controls inside
// MIDI Input. It renders the output port picker plus the blank-layout and LED
// colour sync actions used in 2D geometry mode. It does not own the shared
// Lumatone anchor row or any generic channel/pitch settings.
const LumatoneSettings = ({
  settings,
  rawPorts,
  midiOutputs,
  keysRef,
  hasSysexMidi,
  onChange,
}) => (
  <>
    {!settings.midi_passthrough && (
      <>
        <OutputPortPicker
          label="LED Output"
          rawPorts={rawPorts}
          outputs={midiOutputs}
          overridePortId={settings.lumatone_out_port ?? null}
          onChange={(id) => {
            onChange("lumatone_out_port", id);
            sessionStorage.setItem("lumatone_out_port", id ?? "");
          }}
        />
        {rawPorts && (
          <label>
            Send Blank Key Layout (Notes 0-55 on Ch 1-5)
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginLeft: "auto",
                marginTop: "4px",
              }}
            >
              <button
                type="button"
                class="preset-action-btn"
                disabled={!hasSysexMidi}
                title="Send notes + blank layout to Lumatone via sysex (~10-15 s, one-time setup)"
                onClick={() => keysRef?.current?.sendLumatoneLayout?.()}
              >
                Send Blank Key Layout
              </button>
            </span>
          </label>
        )}
        {rawPorts && (
          <label>
            Automatically Send LED Colours
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginLeft: "auto",
                marginTop: "4px",
              }}
            >
              <input
                name="lumatone_led_sync"
                type="checkbox"
                checked={!!settings.lumatone_led_sync}
                disabled={!hasSysexMidi}
                onChange={(e) => {
                  onChange("lumatone_led_sync", e.target.checked);
                  localStorage.setItem("lumatone_led_sync", e.target.checked);
                  const keys = keysRef?.current;
                  if (keys) keys.settings.lumatone_led_sync = e.target.checked;
                  if (e.target.checked) keys?.autoSyncLumatoneLEDs?.();
                }}
              />
              <button
                type="button"
                class="preset-action-btn"
                disabled={!hasSysexMidi}
                onClick={() => keysRef?.current?.syncLumatoneLEDs?.()}
              >
                Send Colours
              </button>
            </span>
          </label>
        )}
      </>
    )}
  </>
);

LumatoneSettings.propTypes = {
  settings: PropTypes.object.isRequired,
  rawPorts: PropTypes.object,
  midiOutputs: PropTypes.object,
  keysRef: PropTypes.object,
  hasSysexMidi: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
};

export default LumatoneSettings;
