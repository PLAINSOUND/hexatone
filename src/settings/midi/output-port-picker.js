import { useState } from "preact/hooks";
import PropTypes from "prop-types";

// This shared UI helper owns the "click to choose a MIDI output port" pattern
// used by controller-specific LED/output controls. It does not know anything
// about controller semantics; callers provide the detected raw port, the full
// output list, and the persistence callback for the chosen override id.
function OutputPortPicker({ label, rawPorts, outputs, overridePortId, onChange }) {
  const [picking, setPicking] = useState(false);
  const connected = !!rawPorts;
  const portName = rawPorts?.output?.name ?? null;
  const isOverride = !!overridePortId;

  if (picking) {
    return (
      <label class="controller-inline-row controller-output-row">
        {label}
        <select
          class="sidebar-input"
          style={{ fontSize: "0.85em" }}
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
          {outputs && Array.from(outputs.values()).map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label
      class="controller-inline-row controller-output-row"
      style={{ cursor: "pointer" }}
      title="Click to choose a different output port"
      onClick={() => setPicking(true)}
    >
      {label}
      <span
        class="sidebar-input"
        style={{
          textAlign: "right",
          fontSize: "0.85em",
          fontStyle: "italic",
          color: connected ? "#669966" : "#996666",
        }}
      >
        {connected
          ? `${isOverride ? "▸ " : ""}${portName}`
          : "Not found — click to choose"}
      </span>
    </label>
  );
}

OutputPortPicker.propTypes = {
  label: PropTypes.string.isRequired,
  rawPorts: PropTypes.object,
  outputs: PropTypes.object,
  overridePortId: PropTypes.string,
  onChange: PropTypes.func.isRequired,
};

export default OutputPortPicker;
