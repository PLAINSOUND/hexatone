import { useEffect, useMemo, useState } from "preact/hooks";

export const formatFrequencyHz = (value) => {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(1);
};

export const formatEditableFrequencyHz = (value) => {
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
  liveModulated = false,
}) => {
  const display = useMemo(() => formatFrequencyHz(value), [value]);
  const editableDisplay = useMemo(() => formatEditableFrequencyHz(value), [value]);
  const [draft, setDraft] = useState(display);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(display);
  }, [display, editing]);

  const isDirty = deviationCents !== null && Math.abs(deviationCents) > 0.001;
  // Match the tune-delta / tune-comparing colour scheme
  const color = isDirty
    ? (comparing ? "#660000" : "#990000")
    : (liveModulated ? "#9a2f2f" : undefined);
  const fontStyle = comparing ? "italic" : undefined;
  return (
    <input
      id="centered"
      type="text"
      inputMode="decimal"
      disabled={disabled}
      class="frequency-input"
      value={draft}
      aria-label={ariaLabel}
      style={color ? { color, WebkitTextFillColor: color, fontStyle } : undefined}
      onFocus={(e) => {
        if (disabled) return;
        setEditing(true);
        setDraft(editableDisplay);
        e.currentTarget.select?.();
      }}
      onInput={(e) => {
        setDraft(e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.target.blur();
      }}
      onBlur={(e) => {
        const next = parseFloat(e.target.value);
        setEditing(false);
        if (!Number.isFinite(next) || next <= 0 || disabled) {
          setDraft(display);
          return;
        }
        if (Math.abs(next - value) < 0.0000005) {
          setDraft(display);
          return;
        }
        onCommit(next);
        setDraft(formatFrequencyHz(next));
      }}
    />
  );
};

export default FrequencyInput;
