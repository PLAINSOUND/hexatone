/**
 * Browser-local SuperCollider routing options: OSC bridge or in-browser
 * SuperSonic, including the existing layer, sustain and release controls.
 */

import { useEffect, useState } from "preact/hooks";
import PropTypes from "prop-types";
import CustomRangeSlider from "./shared/range-slider.jsx";
import { getBridgeToken, setBridgeToken } from "../osc_synth/bridge-auth.js";

import MixerFader from "./mixer-fader.jsx";
import { OSC_LAYER_KEYS } from "../audio/sound-mixer.js";
const clampRelease = (value) => Math.max(0, Math.min(1, value));
const clampReleaseTime = (value) => Math.max(0.001, Math.min(4, value));

const readNumber = (key, fallback, clamp) => {
  const stored = parseFloat(localStorage.getItem(key) ?? "");
  return clamp(Number.isFinite(stored) ? stored : fallback);
};

const save = (key, value, onChange) => {
  onChange(key, value);
  sessionStorage.setItem(key, String(value));
};

function BrightnessControl({ brightness, onInputValue }) {
  const [live, setLive] = useState(() => brightness.value ?? brightness);
  useEffect(() => {
    const update = () => setLive(brightness.value ?? brightness);
    brightness.changes?.addEventListener("change", update);
    update();
    return () => brightness.changes?.removeEventListener("change", update);
  }, [brightness]);
  return <label>
    Brightness
    <span class="sidebar-input settings-form__range-row">
      <CustomRangeSlider
        ariaLabel="Brightness"
        defaultValue={0.2}
        min={0}
        max={1}
        step={1 / 127}
        value={live}
        onInputValue={value => onInputValue?.(Number(value))}
      />
      <span class="settings-form__range-value">{Math.round(live * 100)}%</span>
    </span>
  </label>;
}

const SuperColliderSettings = ({
  settings,
  onChange,
  soundSession,
  oscBrightness: brightness = 0.2,
  onOscBrightnessChange,
  onOscQuickReleaseChange,
  onOscQuickReleaseTimeChange,
  onOscQuickReleaseRasterOnlyChange,
}) => {
  const [collapsed, setCollapsed] = useState(
    () => sessionStorage.getItem("hexatone_scsynth_collapsed") !== "false"
  );
  const bridgeUrl = settings.osc_bridge_url || "ws://localhost:8089";
  const [bridgeToken, changeBridgeToken] = useState(() => getBridgeToken(bridgeUrl));
  const [bridgeError, setBridgeError] = useState("");
  useEffect(() => {
    changeBridgeToken(getBridgeToken(bridgeUrl));
    setBridgeError("");
  }, [bridgeUrl]);
  const [release, setRelease] = useState(() =>
    readNumber("osc_quick_release", settings.osc_quick_release ?? 0.5, clampRelease),
  );
  const [releaseTime, setReleaseTime] = useState(() =>
    readNumber("osc_quick_release_time", settings.osc_quick_release_time ?? 0.25, clampReleaseTime),
  );

  useEffect(() => {
    setRelease(readNumber("osc_quick_release", settings.osc_quick_release ?? 0.5, clampRelease));
  }, [settings.osc_quick_release]);

  useEffect(() => {
    setReleaseTime(
      readNumber(
        "osc_quick_release_time",
        settings.osc_quick_release_time ?? 0.25,
        clampReleaseTime,
      ),
    );
  }, [settings.osc_quick_release_time]);

  return (
    <fieldset class="output-routing-fieldset">
      <legend>
        <b>Built-in scsynth</b>
        <button type="button" class="section-collapse-toggle"
          aria-label={collapsed ? "Show scsynth settings" : "Hide scsynth settings"}
          aria-expanded={!collapsed}
          title={collapsed ? "Toggle to show scsynth settings" : "Toggle to hide scsynth settings"}
          onClick={() => {
            sessionStorage.setItem("hexatone_scsynth_collapsed", String(!collapsed));
            setCollapsed(!collapsed);
          }}>
          <span aria-hidden="true" class={`disclosure-toggle-glyph disclosure-toggle-glyph--${collapsed ? "collapsed" : "expanded"}`} />
        </button>
      </legend>
      <label>
        Use SuperCollider Sounds
        <input
          name="output_osc"
          type="checkbox"
          checked={!!settings.output_osc}
          onChange={(event) => {
            if (event.target.checked && settings.osc_server_off) save("osc_server_off", false, onChange);
            save(event.target.name, event.target.checked, onChange);
          }}
        />
      </label>

      {settings.osc_local && <div class="preset-actions preset-actions--end">
        <button type="button" class="preset-utility-btn" disabled={settings.osc_server_off}
          onClick={() => {
            save("output_osc", false, onChange);
            save("osc_server_off", true, onChange);
          }}>Shut Down SuperSonic</button>
      </div>}

      <label>
        Server
        <select class="sidebar-input" aria-label="scsynth Server"
          value={settings.osc_server_off ? "OFF" : settings.osc_local ? "supersonic" : "bridge"}
          onChange={event => {
            const value = event.currentTarget.value;
            if (value !== "OFF") save("osc_local", value === "supersonic", onChange);
            save("osc_server_off", value === "OFF", onChange);
          }}>
          <option value="OFF">OFF</option>
          <option value="supersonic">SuperSonic 0.99</option>
          <option value="bridge">Local via OSC Bridge</option>
        </select>
      </label>
      {settings.output_osc && !settings.osc_server_off && (
        <>
          <p class="settings-form__intro-copy">
            <em>
              {settings.osc_local
                ? "SynthDefs run directly in the browser; no OSC bridge to a local server required."
                : 'OSC is sent to SuperCollider via a local WebSocket→OSC bridge. Run "yarn osc-bridge" in a locally cloned repo and use the Synths/SuperCollider-OSC folder to initialise the synths and servers.'}
            </em>
          </p>
          {!settings.osc_local && (
            <>
            <label>
              Bridge URL
              <input
                name="osc_bridge_url"
                type="text"
                class="sidebar-input"
                key={settings.osc_bridge_url}
                defaultValue={settings.osc_bridge_url || "ws://localhost:8089"}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value) save("osc_bridge_url", value, onChange);
                  else event.target.value = settings.osc_bridge_url || "ws://localhost:8089";
                }}
              />
            </label>
            <label>
              Bridge pairing token
              <input type="password" class="sidebar-input" autoComplete="off" spellCheck={false}
                value={bridgeToken} placeholder="Paste the token printed by osc-bridge"
                onInput={event => changeBridgeToken(event.currentTarget.value)}
                onBlur={() => {
                  try { setBridgeToken(bridgeUrl, bridgeToken); setBridgeError(""); }
                  catch (error) { setBridgeError(error.message); }
                }} />
            </label>
            <p class="settings-form__helper-text">Stored for this tab session; excluded from presets and shared links.</p>
            {bridgeError && <p role="alert">{bridgeError}</p>}
            </>
          )}

          {["Pluck", "Buzz", "Formant", "Saw"].map((label, index) =>
            <MixerFader key={label} session={soundSession} parameter={OSC_LAYER_KEYS[index]}
              label={label} ariaLabel={label + " volume"} layer />)}

          <label class="settings-form__checkbox-row settings-form__checkbox-row--tight">
            <input
              name="osc_retrigger_buzz_formant"
              type="checkbox"
              checked={!!settings.osc_retrigger_buzz_formant}
              onChange={(event) => {
                localStorage.setItem("osc_retrigger_buzz_formant", String(event.target.checked));
                save("osc_retrigger_buzz_formant", event.target.checked, onChange);
              }}
            />
            <span class="settings-form__checkbox-label">Retrigger Buzz + Formant while held</span>
          </label>

          <BrightnessControl brightness={brightness} onInputValue={onOscBrightnessChange} />

          {!collapsed && <>
          <label>
            Release Envelope
            <span class="sidebar-input settings-form__range-row">
              <CustomRangeSlider
                ariaLabel="Release Override Amount"
                defaultValue={0.5}
                min={0}
                max={1}
                step={0.01}
                value={release}
                onInputValue={(nextValue) => {
                  const next = clampRelease(parseFloat(nextValue));
                  setRelease(next);
                  onOscQuickReleaseChange?.(next);
                }}
                onCommitValue={(nextValue) => {
                  const next = clampRelease(parseFloat(nextValue));
                  localStorage.setItem("osc_quick_release", String(next));
                  save("osc_quick_release", next, onChange);
                }}
              />
              <span class="settings-form__range-value">{Math.round(release * 100)}%</span>
            </span>
            <em class="settings-form__helper-text">
              Blend between velocity-based release and Release Time
            </em>
          </label>

          <label class="settings-form__checkbox-row settings-form__checkbox-row--tight">
            <input
              type="checkbox"
              checked={!!settings.osc_quick_release_raster_only}
              onChange={(event) => {
                localStorage.setItem("osc_quick_release_raster_only", String(event.target.checked));
                sessionStorage.setItem(
                  "osc_quick_release_raster_only",
                  String(event.target.checked),
                );
                onOscQuickReleaseRasterOnlyChange?.(event.target.checked);
                onChange("osc_quick_release_raster_only", event.target.checked);
              }}
            />
            <span class="settings-form__checkbox-label">
              Apply release envelope to Rastered Glissando only
            </span>
          </label>

          <label>
            Release Time
            <span class="sidebar-input settings-form__range-row">
              <CustomRangeSlider
                ariaLabel="Release Time"
                defaultValue={0.25}
                min={0.01}
                max={4}
                step={0.005}
                value={releaseTime}
                onInputValue={(nextValue) => {
                  const next = clampReleaseTime(parseFloat(nextValue));
                  setReleaseTime(next);
                  onOscQuickReleaseTimeChange?.(next);
                }}
                onCommitValue={(nextValue) => {
                  const next = clampReleaseTime(parseFloat(nextValue));
                  localStorage.setItem("osc_quick_release_time", String(next));
                  save("osc_quick_release_time", next, onChange);
                }}
              />
              <span class="settings-form__range-value">{Math.round(releaseTime * 1000)} ms</span>
            </span>
          </label>
          </>}
        </>
      )}
    </fieldset>
  );
};

SuperColliderSettings.propTypes = {
  settings: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  soundSession: PropTypes.object,
  oscBrightness: PropTypes.oneOfType([PropTypes.number, PropTypes.object]),
  onOscBrightnessChange: PropTypes.func,
  onOscQuickReleaseChange: PropTypes.func,
  onOscQuickReleaseTimeChange: PropTypes.func,
  onOscQuickReleaseRasterOnlyChange: PropTypes.func,
};

export default SuperColliderSettings;
