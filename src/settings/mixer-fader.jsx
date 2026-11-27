import { useMixerValue } from "../hooks/use-sound-session.js";
import { readMixerValue } from "../audio/sound-mixer.js";
import CustomRangeSlider from "./shared/range-slider.jsx";

export default function MixerFader({ session, parameter, label, ariaLabel = label, max = 1,
  defaultValue = 0.5, disabled, layer = false }) {
  const value = useMixerValue(session, parameter) ?? readMixerValue(parameter);
  const layerClass = value === 0 ? "scsynth-layer-label scsynth-layer-label--muted" : "scsynth-layer-label";
  return <label>
    <span class={layer ? layerClass : undefined}>{label}</span>
    <span class="sidebar-input settings-form__range-row">
      <CustomRangeSlider ariaLabel={ariaLabel} min={0} max={max} step={max === 1 ? 0.01 : 1}
        value={value} defaultValue={defaultValue} disabled={disabled}
        onInputValue={next => session.setParameter(parameter, next)} />
      <span class="settings-form__range-value">
        {layer || !Number.isInteger(value) ? value.toFixed(2) : value}
      </span>
    </span>
  </label>;
}
