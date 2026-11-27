import { Fragment } from "preact";
import { useState } from "preact/hooks";
import PropTypes from "prop-types";
import CustomRangeSlider from "./shared/range-slider.jsx";
import { DSF_AMOUNT_ROUTES, modulationRouteDescription } from "../dsf_synth/modulation.js";
import { DSF_DEFAULTS, dsfControlsFromSettings, dsfEnvelopeStep } from "../dsf_synth/controls.js";

const FADER_HELP = Object.freeze({
  ...Object.fromEntries(DSF_AMOUNT_ROUTES.map(route => [route.control, modulationRouteDescription(route.control)])),
  pressure: modulationRouteDescription("pressure"),
  timbreResponse: modulationRouteDescription("timbreResponse"),
  timbreAmount: "Attack peak offset relative to the Timbre setting. −100% reaches 0, +100% reaches 1, and 0% stays at the base setting. Sustain is independent; release returns to base.",
  timbreSustain: "Independent sustain offset relative to the Timbre setting: −100% reaches 0, +100% reaches 1, and 0% stays at base. Can lie above or below the peak.",
  iso226: "Relative level compensation by note fundamental, based on the ISO 226:2023 60-phon contour with a gentle 80–200 Hz reduction. 0% is off; 100% applies the full contour and level trim. Intermediate amounts scale the adjustment in decibels. Not calibrated SPL or a per-harmonic EQ.",
});

export default function DsfSettings({ settings, onChange }) {
  const controls = dsfControlsFromSettings(settings);
  const [collapsed, setCollapsed] = useState(() => sessionStorage.getItem("hexatone_dsf_collapsed") !== "false");
  const save = (key, value) => {
    (key === "output_dsf" ? sessionStorage : localStorage).setItem(key, String(value));
    onChange(key, value);
  };
  const faders = [
    ["volume", "Volume", 0, 1, 0.01, controls.volume.toFixed(2)],
    ["iso226", "ISO-226 compensation amount", 0, 1, 0.01, `${Math.round(controls.iso226 * 100)}%`],
    ["attack", "Attack", 0, 2000, dsfEnvelopeStep, `${controls.attack} ms`],
    ["decay", "Decay", 0, 5000, dsfEnvelopeStep, `${controls.decay} ms`],
    ["sustain", "Sustain", 0, 2, 0.01, `${Math.round(controls.sustain * 100)}%`],
    ["release", "Release", 0, 4000, dsfEnvelopeStep, `${controls.release} ms`],
    ["partials", "Number of harmonic partials", 1, 1024, 1, controls.partials],
    ["timbre", "Timbre", 0, 1, 0.001, controls.timbre.toFixed(2)],
    ["timbreAmount", "Timbre peak offset", -1, 1, 0.01, `${Math.round(controls.timbreAmount * 100)}%`],
    ["timbreAttack", "Timbre attack", 0, 2000, dsfEnvelopeStep, `${controls.timbreAttack} ms`],
    ["timbreDecay", "Timbre decay", 0, 5000, dsfEnvelopeStep, `${controls.timbreDecay} ms`],
    ["timbreSustain", "Timbre sustain offset", -1, 1, 0.01, `${Math.round(controls.timbreSustain * 100)}%`],
    ["timbreRelease", "Timbre release", 0, 4000, dsfEnvelopeStep, `${controls.timbreRelease} ms`],
  ];
  const volumeKeys = ["attack", "decay", "sustain", "release"];
  const timbreKeys = ["timbreAmount", "timbreAttack", "timbreDecay", "timbreSustain", "timbreRelease"];
  const timeKeys = ["attack", "decay", "release", "timbreAttack", "timbreDecay", "timbreRelease"];
  const renderFader = ([key, label, min, max, step, display]) => <label
    title={FADER_HELP[key] ?? (timeKeys.includes(key) ? "Hold Shift while dragging for fine adjustment." : undefined)}>
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
    <legend><b>Built-in DSF Synthesis</b>
      <button type="button" class="section-collapse-toggle"
        aria-label={collapsed ? "Show DSF settings" : "Hide DSF settings"}
        aria-expanded={!collapsed}
        title={collapsed ? "Toggle to show DSF settings" : "Toggle to hide DSF settings"}
        onClick={() => {
          sessionStorage.setItem("hexatone_dsf_collapsed", String(!collapsed));
          setCollapsed(!collapsed);
        }}>
        <span aria-hidden="true" class={`disclosure-toggle-glyph disclosure-toggle-glyph--${collapsed ? "collapsed" : "expanded"}`} />
      </button>
    </legend>
    <label>Use Oscillator
      <input name="output_dsf" type="checkbox" checked={!!settings.output_dsf}
        onChange={event => save("output_dsf", event.currentTarget.checked)} />
    </label>
    {settings.output_dsf && <>
      {faders.filter(([key]) => (!volumeKeys.includes(key) || (!collapsed && controls.volumeEnvelope)) &&
        (!timbreKeys.includes(key) || (!collapsed && controls.timbreEnvelope))).map(fader => <Fragment key={fader[0]}>
        {renderFader(fader)}
        {["release", "timbreRelease"].includes(fader[0]) && <hr class="dsf-envelope-divider" />}
        {!collapsed && fader[0] === "iso226" && envelopeToggle("volumeEnvelope", "ADSR")}
        {!collapsed && fader[0] === "timbre" && envelopeToggle("timbreEnvelope", "ADSR")}
        {((fader[0] === "iso226" && (collapsed || !controls.volumeEnvelope)) ||
          (fader[0] === "timbre" && (collapsed || !controls.timbreEnvelope))) && <hr class="dsf-envelope-divider" />}
      </Fragment>)}
      {!collapsed && DSF_AMOUNT_ROUTES.map(({ control, label }) => <Fragment key={control}>
        {renderFader([control, label, 0, 1, 0.01, `${Math.round(controls[control] * 100)}%`])}
      </Fragment>)}
      {renderFader(["pressure", "Pressure (Z)", 0, 1, 0.01, `${Math.round(controls.pressure * 100)}%`])}
      {renderFader(["timbreResponse", "Expression (Y/Mod/Foot)", 0, 1, 0.01, `${Math.round(controls.timbreResponse * 100)}%`])}
    </>}
  </fieldset>;
}
DsfSettings.propTypes = { settings: PropTypes.object.isRequired, onChange: PropTypes.func.isRequired };
