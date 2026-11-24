import { Fragment } from "preact";
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
    ["iso226", "ISO-226 compensation amount", 0, 1, 0.01, `${Math.round(controls.iso226 * 100)}%`],
    ["attack", "Attack", 0, 2000, dsfEnvelopeStep, `${controls.attack} ms`],
    ["decay", "Decay", 0, 4000, dsfEnvelopeStep, `${controls.decay} ms`],
    ["sustain", "Sustain", 0, 2, 0.01, `${Math.round(controls.sustain * 100)}%`],
    ["release", "Release", 0, 4000, dsfEnvelopeStep, `${controls.release} ms`],
    ["partials", "Number of harmonic partials", 1, 1024, 1, controls.partials],
    ["timbre", "Timbre", 0, 1, 0.001, `${Math.round(controls.timbre * 100)}%`],
    ["timbreAmount", "Timbre envelope amount", -1, 1, 0.01, `${Math.round(controls.timbreAmount * 100)}%`],
    ["timbreAttack", "Timbre attack", 0, 2000, dsfEnvelopeStep, `${controls.timbreAttack} ms`],
    ["timbreDecay", "Timbre decay", 0, 4000, dsfEnvelopeStep, `${controls.timbreDecay} ms`],
    ["timbreSustain", "Timbre sustain", 0, 2, 0.01, `${Math.round(controls.timbreSustain * 100)}%`],
    ["timbreRelease", "Timbre release", 0, 4000, dsfEnvelopeStep, `${controls.timbreRelease} ms`],
  ];
  const volumeKeys = ["attack", "decay", "sustain", "release"];
  const timbreKeys = ["timbreAmount", "timbreAttack", "timbreDecay", "timbreSustain", "timbreRelease"];
  const timeKeys = ["attack", "decay", "release", "timbreAttack", "timbreDecay", "timbreRelease"];
  const renderFader = ([key, label, min, max, step, display]) => <label
    title={key === "timbreAmount" ? "Adds an independent ADSR envelope to the base timbre. Positive amounts brighten; negative amounts darken. 0% disables the envelope. The resulting timbre is limited to 0–100%." : key === "iso226" ? "Relative level compensation by note fundamental, based on the ISO 226:2023 60-phon contour with a gentle 80–200 Hz reduction. 0% is off; 100% applies the full contour and level trim. Intermediate amounts scale the adjustment in decibels. Not calibrated SPL or a per-harmonic EQ." : timeKeys.includes(key) ? "Hold Shift while dragging for fine adjustment." : undefined}>
    {label}<span class="sidebar-input settings-form__range-row">
      <CustomRangeSlider ariaLabel={`DSF ${label}`} min={min} max={max} step={step}
        exponent={key === "partials" ? 2 : 1}
        fineDrag={timeKeys.includes(key)}
        knee={timeKeys.includes(key) ? { value: 100, position: 0.4, exponent: 2 } : undefined}
        defaultValue={["attack", "decay", "release", "timbreAttack", "timbreDecay", "timbreRelease", "partials"].includes(key) ? undefined : DSF_DEFAULTS[key]} value={controls[key]}
        onInputValue={value => save(`dsf_${key}`, value)} />
      <span class="settings-form__range-value">{display}</span>
    </span>
  </label>;
  const envelopeToggle = (key, label) => <label class="settings-form__checkbox-row">
    <input type="checkbox" name={`dsf_${key}`} checked={controls[key]}
      aria-label={key === "volumeEnvelope" ? "Volume Envelope" : "Timbre ADSR"}
      onChange={event => save(`dsf_${key}`, event.currentTarget.checked)} />
    {label}
  </label>;
  return <fieldset class="output-routing-fieldset">
    <legend><b>Built-in DSF Synthesis</b></legend>
    <label>Use Oscillator
      <input name="output_dsf" type="checkbox" checked={!!settings.output_dsf}
        onChange={event => save("output_dsf", event.currentTarget.checked)} />
    </label>
    {settings.output_dsf && <>
      {faders.filter(([key]) => (!volumeKeys.includes(key) || controls.volumeEnvelope) &&
        (!timbreKeys.includes(key) || controls.timbreEnvelope)).map(fader => <Fragment key={fader[0]}>
        {renderFader(fader)}
        {["release", "timbreRelease"].includes(fader[0]) && <hr class="dsf-envelope-divider" />}
        {fader[0] === "iso226" && envelopeToggle("volumeEnvelope", "ADSR")}
        {fader[0] === "timbre" && envelopeToggle("timbreEnvelope", "ADSR")}
        {((fader[0] === "iso226" && !controls.volumeEnvelope) ||
          (fader[0] === "timbre" && !controls.timbreEnvelope)) && <hr class="dsf-envelope-divider" />}
      </Fragment>)}
      <label class="settings-form__checkbox-row" title="Note-on velocity changes volume and timbre. Volume attack ranges from twice to one-quarter of the fader time, with MIDI 64 unchanged.">
        <input type="checkbox" name="dsf_velocity" checked={controls.velocity}
          onChange={event => save("dsf_velocity", event.currentTarget.checked)} />
        Velocity
      </label>
      <label class="settings-form__checkbox-row" title="Release velocity scales volume release from four times to one-quarter of its fader time, and timbre release from twice to 0.025 times. MIDI 64 leaves both unchanged. When off, both use their fader times.">
        <input type="checkbox" name="dsf_releaseVelocity" checked={controls.releaseVelocity}
          onChange={event => save("dsf_releaseVelocity", event.currentTarget.checked)} />
        Release Velocity
      </label>
      <label class="settings-form__checkbox-row" title="Pressure adds up to 12 dB, mostly toward full pressure. Light pressure adds up to 6 percentage points of timbre bite, fading along an S-curve by 30% pressure.">
        <input type="checkbox" name="dsf_pressure" checked={controls.pressure}
          onChange={event => save("dsf_pressure", event.currentTarget.checked)} />
        Pressure (Z)
      </label>
      <label class="settings-form__checkbox-row" title="Expression Y shifts timbre by −5 percentage points at minimum, 0 at halfway and +10 at maximum. The total is limited to 0–100%.">
        <input type="checkbox" name="dsf_timbreResponse" checked={controls.timbreResponse}
          onChange={event => save("dsf_timbreResponse", event.currentTarget.checked)} />
        Expression (Y)
      </label>
      <label class={`settings-form__checkbox-row${!controls.velocity || !controls.pressure ? " settings-form__dimmed" : ""}`} title="Requires Velocity and Pressure. Generates timbre and pressure from velocity and aftertouch using the Eagan Matrix output mapping. Overrides incoming timbre while enabled.">
        <input type="checkbox" name="dsf_generateYZ" checked={controls.generateYZ}
          disabled={!controls.velocity || !controls.pressure}
          onChange={event => save("dsf_generateYZ", event.currentTarget.checked)} />
        Generate YZ
      </label>

    </>}
  </fieldset>;
}
DsfSettings.propTypes = { settings: PropTypes.object.isRequired, onChange: PropTypes.func.isRequired };
