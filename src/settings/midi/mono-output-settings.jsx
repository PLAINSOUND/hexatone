/**
 * Monophonic output settings, rendered as a fragment to preserve sidebar geometry
 * and cascade. Parent owns persistence; only the explicit RPN button sends MIDI.
 * Playback, carrier selection and smoothing belong to mono_synth, not this view.
 */
import { buildAutoSelectInputProps } from "../../ui/input-selection.js";
import { sendRpn } from "../../midi/rpn.js";
import { SLIDE_CC_OPTIONS, normaliseSlideCc } from "../../midi/slide-cc-options.js";
import CustomRangeSlider from "../shared/range-slider.jsx";

export default function MonoOutputSettings({ settings, midi, outputs, onSettingChange }) {
  return (
    <>
      <label>
        <b>Monophonic Single-Channel MIDI</b>
        <input
          type="checkbox"
          name="output_mono"
          checked={!!settings.output_mono}
          onChange={(e) => onSettingChange(e.target.name, e.target.checked)}
        />
      </label>
      <p class="settings-form__intro-copy">
        <em>
          Uses standard MIDI messages on a single channel to retune monophonically. For polyphonic
          microtonal playing use the MTS or MPE options below.
        </em>
      </p>
      {settings.output_mono && (
        <>
          <label>
            Port
            <select
              class="sidebar-input"
              aria-label="Monophonic MIDI Port"
              value={settings.mono_device || "OFF"}
              onChange={(e) => onSettingChange("mono_device", e.target.value)}
            >
              <option value="OFF">OFF</option>
              {outputs.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Channel
            <select
              class="sidebar-input"
              aria-label="Monophonic MIDI Channel"
              value={settings.mono_channel ?? 0}
              onChange={(e) => onSettingChange("mono_channel", Number(e.target.value))}
            >
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i} value={i}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <label>
            PB Range (semitones)
            <input
              class="sidebar-input"
              type="text"
              inputMode="numeric"
              aria-label="Monophonic MIDI PB Range"
              {...buildAutoSelectInputProps()}
              value={settings.mono_bend_range ?? 2}
              onChange={(e) =>
                onSettingChange(
                  "mono_bend_range",
                  Math.max(1, Math.min(96, Math.round(Number(e.target.value) || 2))),
                )
              }
            />
          </label>
          <label>
            PB Configuration (RPN)
            <span class="sidebar-input settings-form__activate-row">
              <button
                type="button"
                class="preset-action-btn"
                disabled={!midi?.outputs.get(settings.mono_device)}
                aria-label="Send Pitch Bend Range"
                onClick={() => {
                  const output = midi?.outputs.get(settings.mono_device);
                  const channel = Math.max(0, Math.min(15, Number(settings.mono_channel) || 0));
                  const range = Math.max(
                    1,
                    Math.min(96, Math.round(Number(settings.mono_bend_range) || 2)),
                  );
                  sendRpn(output, channel, 0, 0, range);
                }}
              >
                Send Pitch Bend Range
              </button>
            </span>
          </label>
          <label>
            Portamento
            <input
              type="checkbox"
              checked={!!settings.mono_portamento}
              onChange={(e) => onSettingChange("mono_portamento", e.target.checked)}
            />
          </label>
          <label>
            Map MPE Slide (CC74) to
            <select
              class="sidebar-input"
              aria-label="Map MPE Slide (CC74) to"
              value={normaliseSlideCc(settings.mono_slide_cc)}
              onChange={(e) => onSettingChange("mono_slide_cc", Number(e.target.value))}
            >
              {SLIDE_CC_OPTIONS.map(({ cc, label }) => (
                <option key={cc} value={cc}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Portamento Time
            <span class="sidebar-input settings-form__range-row">
              <CustomRangeSlider
                ariaLabel="Monophonic MIDI Portamento Time"
                min={0}
                max={500}
                step={1}
                disabled={!settings.mono_portamento}
                value={settings.mono_portamento_time ?? 80}
                onInputValue={(v) => onSettingChange("mono_portamento_time", Number(v))}
              />
              <span class="settings-form__range-value">
                {(settings.mono_portamento_time ?? 80) === 0
                  ? "off"
                  : `${settings.mono_portamento_time ?? 80} ms`}
              </span>
            </span>
          </label>
          <p class="settings-form__intro-copy">
            <em>
              Match the instrument's pitch-bend range; not all synths honour RPN setup. Use a
              separate port/channel from other outputs. Slide uses the selected CC (default 74) and
              pressure becomes channel pressure; the instrument must support these controls.
            </em>
          </p>
        </>
      )}
      <br />
    </>
  );
}
