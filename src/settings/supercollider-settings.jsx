/**
 * Browser-local SuperCollider routing options: OSC bridge or in-browser
 * SuperSonic, including the existing layer, sustain and release controls.
 */

import { useEffect, useState } from "preact/hooks";
import PropTypes from "prop-types";
import CustomRangeSlider from "./shared/range-slider.jsx";

const clampVolume = (value) => Math.max(0, Math.min(1, value));
const clampRelease = (value) => Math.max(0, Math.min(1, value));
const clampReleaseTime = (value) => Math.max(0.001, Math.min(2, value));

const readNumber = (key, fallback, clamp) => {
  const stored = parseFloat(localStorage.getItem(key) ?? "");
  return clamp(Number.isFinite(stored) ? stored : fallback);
};

const save = (key, value, onChange) => {
  onChange(key, value);
  sessionStorage.setItem(key, String(value));
};

const SuperColliderSettings = ({
  settings,
  onChange,
  onOscLayerVolumeChange,
  oscBrightness = 0.2,
  onOscBrightnessChange,
  onOscQuickReleaseChange,
  onOscQuickReleaseTimeChange,
  onOscQuickReleaseRasterOnlyChange,
}) => {
  const [layerVolumes, setLayerVolumes] = useState(() => ({
    osc_volume_pluck: readNumber("osc_volume_pluck", settings.osc_volume_pluck ?? 0.5, clampVolume),
    osc_volume_buzz: readNumber("osc_volume_buzz", settings.osc_volume_buzz ?? 0.5, clampVolume),
    osc_volume_formant: readNumber(
      "osc_volume_formant",
      settings.osc_volume_formant ?? 0.5,
      clampVolume,
    ),
    osc_volume_saw: readNumber("osc_volume_saw", settings.osc_volume_saw ?? 0.5, clampVolume),
  }));
  const [release, setRelease] = useState(() =>
    readNumber("osc_quick_release", settings.osc_quick_release ?? 0.5, clampRelease),
  );
  const [releaseTime, setReleaseTime] = useState(() =>
    readNumber("osc_quick_release_time", settings.osc_quick_release_time ?? 0.25, clampReleaseTime),
  );

  useEffect(() => {
    setLayerVolumes({
      osc_volume_pluck: readNumber(
        "osc_volume_pluck",
        settings.osc_volume_pluck ?? 0.5,
        clampVolume,
      ),
      osc_volume_buzz: readNumber("osc_volume_buzz", settings.osc_volume_buzz ?? 0.5, clampVolume),
      osc_volume_formant: readNumber(
        "osc_volume_formant",
        settings.osc_volume_formant ?? 0.5,
        clampVolume,
      ),
      osc_volume_saw: readNumber("osc_volume_saw", settings.osc_volume_saw ?? 0.5, clampVolume),
    });
  }, [
    settings.osc_volume_pluck,
    settings.osc_volume_buzz,
    settings.osc_volume_formant,
    settings.osc_volume_saw,
  ]);

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
      </legend>
      <label>
        Use SuperCollider Sounds
        <input
          name="output_osc"
          type="checkbox"
          checked={!!settings.output_osc}
          onChange={(event) => save(event.target.name, event.target.checked, onChange)}
        />
      </label>

      {settings.output_osc && (
        <>
          <label class="settings-form__checkbox-row">
            <input
              type="checkbox"
              name="osc_local"
              checked={!!settings.osc_local}
              onChange={(event) => save(event.target.name, event.target.checked, onChange)}
            />
            SuperSonic 0.88
          </label>
          <p class="settings-form__intro-copy">
            <em>
              {settings.osc_local
                ? "SynthDefs run directly in the browser; no OSC bridge to a local server required."
                : 'OSC is sent to SuperCollider via a local WebSocket→OSC bridge. Run "yarn osc-bridge" in a locally cloned repo and use the Synths/SuperCollider-OSC folder to initialise the synths and servers.'}
            </em>
          </p>
          {!settings.osc_local && (
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
          )}

          {[
            ["osc_volume_pluck", "Pluck"],
            ["osc_volume_buzz", "Buzz"],
            ["osc_volume_formant", "Formant"],
            ["osc_volume_saw", "Saw"],
          ].map(([key, label], index) => (
            <label key={key}>
              {label}
              <span class="sidebar-input settings-form__range-row">
                <CustomRangeSlider
                  ariaLabel={`${label} volume`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={layerVolumes[key] ?? 0.5}
                  onInputValue={(nextValue) => {
                    const next = clampVolume(parseFloat(nextValue));
                    setLayerVolumes((current) => ({ ...current, [key]: next }));
                    onOscLayerVolumeChange?.(index, next);
                  }}
                  onCommitValue={(nextValue) => {
                    const next = clampVolume(parseFloat(nextValue));
                    localStorage.setItem(key, String(next));
                    sessionStorage.setItem(key, String(next));
                  }}
                />
                <span class="settings-form__range-value">
                  {(layerVolumes[key] ?? 0.5).toFixed(2)}
                </span>
              </span>
            </label>
          ))}

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
            <em class="settings-form__helper-text">Retrigger Buzz + Formant while held</em>
          </label>

          <label>
            Brightness
            <span class="sidebar-input settings-form__range-row">
              <CustomRangeSlider
                ariaLabel="Brightness"
                min={0}
                max={1}
                step={1 / 127}
                value={oscBrightness}
                onInputValue={(value) => onOscBrightnessChange?.(Number(value))}
              />
              <span class="settings-form__range-value">{Math.round(oscBrightness * 100)}%</span>
            </span>
          </label>

          <label>
            Release Envelope
            <span class="sidebar-input settings-form__range-row">
              <CustomRangeSlider
                ariaLabel="Release Override Amount"
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
            <em class="settings-form__helper-text">
              Apply release envelope to Rastered Glissando only
            </em>
          </label>

          <label>
            Release Time
            <span class="sidebar-input settings-form__range-row">
              <CustomRangeSlider
                ariaLabel="Release Time"
                min={0.01}
                max={2}
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
        </>
      )}
    </fieldset>
  );
};

SuperColliderSettings.propTypes = {
  settings: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  onOscLayerVolumeChange: PropTypes.func,
  oscBrightness: PropTypes.number,
  onOscBrightnessChange: PropTypes.func,
  onOscQuickReleaseChange: PropTypes.func,
  onOscQuickReleaseTimeChange: PropTypes.func,
  onOscQuickReleaseRasterOnlyChange: PropTypes.func,
};

export default SuperColliderSettings;
