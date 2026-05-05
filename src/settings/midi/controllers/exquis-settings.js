import PropTypes from "prop-types";
import OutputPortPicker from "../output-port-picker.js";

// This module owns the active Exquis controller-output UI in MIDI Input:
// output-port status, auto-send controls, and LED brightness/saturation. It
// does not own the dormant dev-mode test panel, which remains in index.js
// until that diagnostic path is either removed or intentionally revived.
const ExquisSettings = ({
  settings,
  rawPorts,
  ledStatus,
  midiOutputs,
  keysRef,
  hasSysexMidi,
  onChange,
}) => {
  const portConnected = !!rawPorts;
  const isFailed = portConnected && ledStatus && !ledStatus.ok;
  const statusText = !portConnected
    ? "Not found (output port unavailable)"
    : isFailed
      ? `Firmware ${ledStatus.reason} found: please update to use key colours`
      : `Connected — ${rawPorts.output.name}`;

  return (
    <>
      <OutputPortPicker
        label="LED Output"
        rawPorts={isFailed ? null : rawPorts}
        outputs={midiOutputs}
        overridePortId={settings.exquis_out_port ?? null}
        onChange={(id) => {
          onChange("exquis_out_port", id);
          sessionStorage.setItem("exquis_out_port", id ?? "");
        }}
      />
      {isFailed && (
        <span style={{ color: "#996666", fontSize: "0.85em", fontStyle: "italic" }}>
          {statusText}
        </span>
      )}
      {portConnected && !isFailed && (
        <>
          <label>
            Auto Send Colours
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
                name="exquis_led_sync"
                type="checkbox"
                checked={!!settings.exquis_led_sync}
                disabled={!hasSysexMidi}
                onChange={(e) => {
                  onChange("exquis_led_sync", e.target.checked);
                  localStorage.setItem("exquis_led_sync", e.target.checked);
                  const keys = keysRef?.current;
                  if (keys) keys.settings.exquis_led_sync = e.target.checked;
                  if (e.target.checked) keys?.syncExquisLEDs?.();
                  else keys?.exquisLEDs?.clearColors?.();
                }}
              />
              <button
                type="button"
                class="preset-action-btn"
                disabled={!hasSysexMidi}
                onClick={() => keysRef?.current?.syncExquisLEDs?.()}
              >
                Send Now
              </button>
              <button
                type="button"
                class="preset-action-btn"
                disabled={!hasSysexMidi}
                onClick={() => keysRef?.current?.exquisLEDs?.clearColors?.()}
              >
                Clear
              </button>
            </span>
          </label>
          {!hasSysexMidi && (
            <p
              style={{
                color: "#996666",
                fontSize: "0.85em",
                margin: "0.25em 0 0.5em",
              }}
            >
              <em>Allow SysEx to sync Exquis key colours.</em>
            </p>
          )}
          <label>
            LED Brightness
            <span
              class="sidebar-input"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                justifyContent: "flex-end",
              }}
            >
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={settings.exquis_led_luminosity ?? 15}
                style={{ width: "100%" }}
                onInput={(e) => {
                  const v = parseInt(e.target.value, 10);
                  onChange("exquis_led_luminosity", v);
                  localStorage.setItem("exquis_led_luminosity", String(v));
                  keysRef?.current?.exquisLEDs?.setLuminosity(v);
                }}
              />
              <span
                style={{
                  fontVariantNumeric: "tabular-nums",
                  minWidth: "2.5em",
                  textAlign: "right",
                  fontSize: "0.85em",
                }}
              >
                {settings.exquis_led_luminosity ?? 15}
              </span>
            </span>
          </label>
          <label>
            LED Saturation
            <span
              class="sidebar-input"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                justifyContent: "flex-end",
              }}
            >
              <input
                type="range"
                min="0.75"
                max="2.5"
                step="0.01"
                value={settings.exquis_led_saturation ?? 1.3}
                style={{ width: "100%" }}
                onInput={(e) => {
                  const v = parseFloat(e.target.value);
                  onChange("exquis_led_saturation", v);
                  localStorage.setItem("exquis_led_saturation", String(v));
                  keysRef?.current?.exquisLEDs?.setSaturation(v);
                }}
              />
              <span
                style={{
                  fontVariantNumeric: "tabular-nums",
                  minWidth: "2.5em",
                  textAlign: "right",
                  fontSize: "0.85em",
                }}
              >
                {(() => {
                  const v = settings.exquis_led_saturation ?? 1.3;
                  return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2);
                })()}
              </span>
            </span>
          </label>
        </>
      )}
    </>
  );
};

ExquisSettings.propTypes = {
  settings: PropTypes.object.isRequired,
  rawPorts: PropTypes.object,
  ledStatus: PropTypes.object,
  midiOutputs: PropTypes.object,
  keysRef: PropTypes.object,
  hasSysexMidi: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
};

export default ExquisSettings;
