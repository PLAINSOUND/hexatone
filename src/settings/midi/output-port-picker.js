import { useState } from "preact/hooks";
import PropTypes from "prop-types";

// This shared UI helper owns the "click to choose a MIDI output port" pattern
// used by controller-specific LED/output controls. It does not know anything
// about controller semantics; callers provide the detected raw port, the full
// output list, and the persistence callback for the chosen override id.
function OutputPortPicker({
  label,
  rawPorts,
  portName: explicitPortName,
  outputs,
  overridePortId,
  onChange,
  inline = false,
}) {
  const [picking, setPicking] = useState(false);
  const portName = explicitPortName ?? rawPorts?.output?.name ?? null;
  const connected = !!portName;
  const isOverride = !!overridePortId;

  if (picking) {
    if (inline) {
      return (
        <span class="settings-form__inline-label">
          <span class="settings-form__label-nowrap">{label}</span>
          <select
            class="settings-form__value--compact settings-form__value--grow"
            value={overridePortId ?? "__auto__"}
            onChange={(event) => {
              const value = event.target.value === "__auto__" ? null : event.target.value;
              onChange(value);
              setPicking(false);
            }}
            onBlur={() => setPicking(false)}
            ref={(element) => element && setTimeout(() => element.focus(), 0)}
          >
            <option value="__auto__">Auto detect</option>
            {outputs &&
              Array.from(outputs.values()).map((output) => (
                <option key={output.id} value={output.id}>
                  {output.name}
                </option>
              ))}
          </select>
        </span>
      );
    }
    return (
      <label class="controller-inline-row controller-output-row">
        {label}
        <select
          class="sidebar-input settings-form__value--compact"
          value={overridePortId ?? "__auto__"}
          onChange={(e) => {
            const val = e.target.value === "__auto__" ? null : e.target.value;
            onChange(val);
            setPicking(false);
          }}
          onBlur={() => setPicking(false)}
          ref={(el) => el && setTimeout(() => el.focus(), 0)}
        >
          <option value="__auto__">Auto detect</option>
          {outputs &&
            Array.from(outputs.values()).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </select>
      </label>
    );
  }

  if (inline) {
    return (
      <span
        class="settings-form__picker-inline settings-form__picker-row"
        title="Click to choose a different output port"
        onClick={() => setPicking(true)}
      >
        <span>{label}</span>
        <span
          class={`settings-form__status-value ${
            connected
              ? "settings-form__status-value--connected"
              : "settings-form__status-value--missing"
          }`}
        >
          {connected ? `${isOverride ? "▸ " : ""}${portName}` : "Not found — click to choose"}
        </span>
      </span>
    );
  }

  return (
    <label
      class="controller-inline-row controller-output-row settings-form__picker-row"
      title="Click to choose a different output port"
      onClick={() => setPicking(true)}
    >
      {label}
      <span
        class={`sidebar-input settings-form__status-value ${
          connected
            ? "settings-form__status-value--connected"
            : "settings-form__status-value--missing"
        }`}
      >
        {connected ? `${isOverride ? "▸ " : ""}${portName}` : "Not found — click to choose"}
      </span>
    </label>
  );
}

OutputPortPicker.propTypes = {
  label: PropTypes.string.isRequired,
  rawPorts: PropTypes.object,
  portName: PropTypes.string,
  outputs: PropTypes.object,
  overridePortId: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  inline: PropTypes.bool,
};

export default OutputPortPicker;
