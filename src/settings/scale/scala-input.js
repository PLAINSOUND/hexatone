import { useState, useEffect } from "preact/hooks";
import { parseScalaInterval } from "./parse-scale.js";

/**
 * ScalaInput — controlled text input for Scala-style interval strings.
 *
 * Behaviour:
 *  - Displays a cents preview to the right while typing.
 *  - Red border when the current value is negative, zero (interval context), or unparseable.
 *  - On blur: coerces "0", "0/1", "1/1" → "0." in 'degree' context;
 *             reverts to `value` prop if the entry is invalid.
 *  - Calls `onChange(newStr)` only when the value is syntactically valid AND
 *    passes context rules (non-negative; non-zero for 'interval').
 *    Still calls `onAnyChange(newStr)` on every keystroke (for live settings sync).
 *
 * Props:
 *  value         {string}             Current canonical value (controlled).
 *  onChange      {(str) => void}      Called with valid string on blur.
 *  onAnyChange   {(str) => void}      Called on every keystroke (optional).
 *  context       {'degree'|'interval'} Default 'degree'.
 *  style         {object}             Extra style for the <input>.
 *  wrapperStyle  {object}             Extra style for the outer <span> wrapper.
 *  wrapperClass  {string}             CSS class for the outer <span> wrapper.
 *  showCents     {boolean}            Show ¢ preview. Default true.
 *  ...rest       Passed to <input> (name, aria-label, disabled, etc.).
 */
const ScalaInput = ({
  value,
  onChange,
  onAnyChange,
  context = "degree",
  inputMode,
  style,
  wrapperStyle,
  wrapperClass,
  showCents = true,
  ...rest
}) => {
  // Local draft while the user is typing.
  const [draft, setDraft] = useState(value ?? "");

  // Sync draft when the controlled value changes from outside (e.g. preset load).
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  const { cents, valid, error } = parseScalaInterval(draft, context);

  const inputStyle = {
    ...style,
    border: valid || draft === "" ? (style?.border ?? "1px solid #c8b8b8") : "1.5px solid #c0392b",
  };
  const resolvedInputMode = inputMode ?? "decimal";

  const handleChange = (e) => {
    const s = e.target.value;
    setDraft(s);
    if (onAnyChange) onAnyChange(s);
  };

  const handleBlur = () => {
    let finalStr = draft.trim();

    // Coerce zero-equivalent entries to canonical "0." in degree context.
    if (context === "degree") {
      const { cents: c } = parseScalaInterval(finalStr, "degree");
      if (c === 0 && finalStr !== "0.") finalStr = "0.";
    }

    const result = parseScalaInterval(finalStr, context);
    if (result.valid) {
      setDraft(finalStr);
      onChange(finalStr);
    } else {
      // Revert to last known good value.
      setDraft(value ?? "");
    }
  };

  return (
    <span
      class={wrapperClass}
      style={{ display: "inline-flex", gap: "4px", alignItems: "center", ...wrapperStyle }}
    >
      <input
        type="text"
        inputMode={resolvedInputMode}
        value={draft}
        onInput={handleChange}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
        }}
        style={inputStyle}
        {...rest}
      />
      {showCents && (
        <span class={`scala-input__cents${valid ? "" : " scala-input__cents--error"}`}>
          {valid ? `${Math.round(cents)}¢` : (error ?? "")}
        </span>
      )}
    </span>
  );
};

export default ScalaInput;
