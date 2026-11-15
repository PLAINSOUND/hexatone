import PropTypes from "prop-types";
import CustomRangeSlider from "./shared/range-slider.jsx";
import { DSF_DEFAULTS, dsfControlsFromSettings, dsfEnvelopeStep } from "../dsf_synth/controls.js";

export default function DsfSettings({ settings, onChange }) {
  const controls = dsfControlsFromSettings(settings);
  const save = (key, value) => {
    (key === "output_dsf" ? sessionStorage : localStorage).setItem(key, String(value));
    onChange(key, value);
  };
  const faders = [
    ["volume", "Volume", 0, 1, 0.01, `${Math.round(controls.volume * 100)}%`],
    ["partials", "Number of harmonic partials", 1, 1024, 1, controls.partials],
    ["timbre", "Timbre", 0, 1, 0.001, `${Math.round(controls.timbre * 100)}%`],
    ["attack", "Attack", 0, 2000, dsfEnvelopeStep, `${controls.attack} ms`],
    ["release", "Release", 0, 4000, dsfEnvelopeStep, `${controls.release} ms`],
  ];
  return <fieldset class="output-routing-fieldset">
    <legend><b>Built-in DSF Synthesis</b></legend>
    <label>Use Oscillator
      <input name="output_dsf" type="checkbox" checked={!!settings.output_dsf}
        onChange={event => save("output_dsf", event.currentTarget.checked)} />
    </label>
    {settings.output_dsf && <>
      {faders.map(([key, label, min, max, step, display]) => <label key={key}>
        {label}<span class="sidebar-input settings-form__range-row">
          <CustomRangeSlider ariaLabel={`DSF ${label}`} min={min} max={max} step={step}
            exponent={key === "partials" ? 2 : 1}
            knee={key === "attack" || key === "release" ? { value: 100, position: 0.4 } : undefined}
            defaultValue={["attack", "release", "partials"].includes(key) ? undefined : DSF_DEFAULTS[key]} value={controls[key]}
            onInputValue={value => save(`dsf_${key}`, value)} />
          <span class="settings-form__range-value">{display}</span>
        </span>
      </label>)}
      <label class="settings-form__checkbox-row" title="Curved velocity response: gentle notes are softer and slower; fast notes brighter and crisper. Attack and release range from twice to one-quarter of the fader time, with MIDI 64 unchanged.">
        <input type="checkbox" name="dsf_velocity" checked={controls.velocity}
          onChange={event => save("dsf_velocity", event.currentTarget.checked)} />
        Velocity response
      </label>
      <label class="settings-form__checkbox-row" title="Pressure adds up to 12 dB, mostly toward full pressure. Light pressure adds a small timbre bite, fading along an S-curve by 30% pressure.">
        <input type="checkbox" name="dsf_pressure" checked={controls.pressure}
          onChange={event => save("dsf_pressure", event.currentTarget.checked)} />
        Pressure response (Y)
      </label>
      <label class="settings-form__checkbox-row" title="Adds up to 0.2 to the current timbre setting, limited to 1.">
        <input type="checkbox" name="dsf_timbreResponse" checked={controls.timbreResponse}
          onChange={event => save("dsf_timbreResponse", event.currentTarget.checked)} />
        Timbre response (Z/Mod/Foot)
      </label>
      <label class="settings-form__checkbox-row" title="Generate timbre and pressure from velocity and aftertouch using the Eagan Matrix output mapping. Overrides incoming timbre while enabled.">
        <input type="checkbox" name="dsf_generateYZ" checked={controls.generateYZ}
          onChange={event => save("dsf_generateYZ", event.currentTarget.checked)} />
        Generate YZ
      </label>
      <label class="settings-form__checkbox-row"
        title="Relative level compensation by note fundamental, based on the ISO 226:2023 60-phon contour with a gentle 80–200 Hz reduction. Boost is limited to 12 dB. Not calibrated SPL or a per-harmonic EQ.">
        <input type="checkbox" name="dsf_iso226" checked={controls.iso226}
          onChange={event => save("dsf_iso226", event.currentTarget.checked)} />
        ISO-226 loudness compensation
      </label>
    </>}
  </fieldset>;
}
DsfSettings.propTypes = { settings: PropTypes.object.isRequired, onChange: PropTypes.func.isRequired };
