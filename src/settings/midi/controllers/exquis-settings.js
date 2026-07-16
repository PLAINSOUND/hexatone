import PropTypes from "prop-types";
import OutputPortPicker from "../output-port-picker.js";
import CustomRangeSlider from "../../shared/range-slider.jsx";

function ExquisAppModeStatus() {
  return (
    <label class="controller-inline-row controller-status-row">
      App Mode
      <span class="sidebar-input controller-status-value settings-form__status-value settings-form__status-value--inactive">
        disabled
      </span>
    </label>
  );
}

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
  appModeEnabled,
  onChange,
}) => {
  if (!appModeEnabled) {
    return <ExquisAppModeStatus />;
  }

  const portConnected = !!rawPorts;
  const versionResponseTooOld =
    portConnected &&
    ledStatus &&
    !ledStatus.ok &&
    typeof ledStatus.reason === "string" &&
    /^firmware /i.test(ledStatus.reason);
  const appModeUnavailable = portConnected && ledStatus && !ledStatus.ok;

  return (
    <>
      <OutputPortPicker
        label="LED Output (App Mode)"
        rawPorts={rawPorts}
        outputs={midiOutputs}
        overridePortId={settings.exquis_out_port ?? null}
        onChange={(id) => {
          onChange("exquis_out_port", id);
          sessionStorage.setItem("exquis_out_port", id ?? "");
        }}
      />
      {versionResponseTooOld && (
        <span class="settings-form__status-value settings-form__status-value--missing settings-form__status-value--warning-tight">
          Please update the firmware on your Exquis
        </span>
      )}
      {portConnected && !appModeUnavailable && (
        <>
          <label>
            Auto Send Colours
            <span class="settings-form__control-row settings-form__control-row--compact">
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
            <p class="settings-form__stacked-helper">
              <em>Allow SysEx to sync Exquis key colours.</em>
            </p>
          )}
          <label>
            LED Brightness
            <span class="sidebar-input settings-form__range-row">
              <CustomRangeSlider
                ariaLabel="LED Brightness"
                min={0}
                max={100}
                step={1}
                value={settings.exquis_led_luminosity ?? 15}
                onInputValue={(nextValue) => {
                  const v = parseInt(nextValue, 10);
                  onChange("exquis_led_luminosity", v);
                  localStorage.setItem("exquis_led_luminosity", String(v));
                  keysRef?.current?.exquisLEDs?.setLuminosity(v);
                }}
              />
              <span class="settings-form__range-value settings-form__range-value--short settings-form__exquis-slider-output">
                {settings.exquis_led_luminosity ?? 15}
              </span>
            </span>
          </label>
          <label>
            LED Saturation
            <span class="sidebar-input settings-form__range-row">
              <CustomRangeSlider
                ariaLabel="LED Saturation"
                min={0.75}
                max={2.5}
                step={0.01}
                value={settings.exquis_led_saturation ?? 1.3}
                onInputValue={(nextValue) => {
                  const v = parseFloat(nextValue);
                  onChange("exquis_led_saturation", v);
                  localStorage.setItem("exquis_led_saturation", String(v));
                  keysRef?.current?.exquisLEDs?.setSaturation(v);
                }}
              />
              <span class="settings-form__range-value settings-form__range-value--short settings-form__exquis-slider-output">
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
  appModeEnabled: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
};

export default ExquisSettings;
