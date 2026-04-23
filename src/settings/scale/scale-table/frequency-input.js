const formatFrequencyHz = (value) => {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(1);
};

const formatEditableFrequencyHz = (value) => {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(6);
};

const FrequencyInput = ({
  ariaLabel,
  value,
  onCommit,
  disabled = false,
  deviationCents = null,
  comparing = false,
}) => {
  const display = formatFrequencyHz(value);
  const editableDisplay = formatEditableFrequencyHz(value);
  const isDirty = deviationCents !== null && Math.abs(deviationCents) > 0.001;
  // Match the tune-delta / tune-comparing colour scheme
  const color = isDirty ? (comparing ? "#660000" : "#990000") : undefined;
  const fontStyle = comparing ? "italic" : undefined;
  return (
    <input
      id="centered"
      type="text"
      inputMode="decimal"
      disabled={disabled}
      class="frequency-input"
      key={display}
      defaultValue={display}
      aria-label={ariaLabel}
      style={color ? { color, WebkitTextFillColor: color, fontStyle } : undefined}
      onFocus={(e) => {
        if (!disabled) e.target.value = editableDisplay;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.target.blur();
      }}
      onBlur={(e) => {
        const next = parseFloat(e.target.value);
        if (!Number.isFinite(next) || next <= 0 || disabled) {
          e.target.value = display;
          return;
        }
        if (Math.abs(next - value) < 0.0000005) {
          e.target.value = display;
          return;
        }
        onCommit(next);
        e.target.value = formatFrequencyHz(next);
      }}
    />
  );
};

export default FrequencyInput;
