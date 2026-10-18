import PropTypes from "prop-types";

// Keep the displayed order separate from the device's pattern IDs.
export const EXQUIS_ARPEGGIATOR_PATTERNS = [
  "Order",
  "Up",
  "Down",
  "Convergent",
  "Divergent",
  "Note Repeat",
];
const EXQUIS_ARPEGGIATOR_PATTERN_IDS = [1, 2, 3, 4, 5, 0];

export default function ExquisArpeggiator({ settings, disabled, keysRef, onChange }) {
  return (
    <label>
      Arpeggiator
      <select
        class="sidebar-input"
        name="exquis_arpeggiator_pattern"
        value={Math.max(0, Math.min(5, Math.round(settings.exquis_arpeggiator_pattern ?? 1)))}
        disabled={disabled}
        onChange={(event) => {
          const value = Number(event.target.value);
          onChange("exquis_arpeggiator_pattern", value);
          localStorage.setItem("exquis_arpeggiator_pattern", String(value));
          keysRef?.current?.exquisLEDs?.setArpeggiatorPattern(value);
        }}
      >
        {EXQUIS_ARPEGGIATOR_PATTERNS.map((name, index) => (
          <option key={name} value={EXQUIS_ARPEGGIATOR_PATTERN_IDS[index]}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

ExquisArpeggiator.propTypes = {
  settings: PropTypes.object.isRequired,
  disabled: PropTypes.bool,
  keysRef: PropTypes.object,
  onChange: PropTypes.func.isRequired,
};
