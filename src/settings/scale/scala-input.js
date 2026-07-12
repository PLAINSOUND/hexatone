import { useState, useEffect, useRef } from "preact/hooks";
import { normaliseDegree, parseScalaInterval } from "./parse-scale.js";

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
 *  inputClass    {string}             CSS class for the <input>.
 *  wrapperStyle  {object}             Extra style for the outer <span> wrapper.
 *  wrapperClass  {string}             CSS class for the outer <span> wrapper.
 *  showCents     {boolean}            Show ¢ preview. Default true.
 *  showCanonicalOnCommit {boolean}    Replace typed display with committed canonical value.
 *  allowNegative {boolean}            Accept signed intervals without marking invalid.
 *  commitNegative {boolean}           Commit negative values while keeping warning styling.
 *  ...rest       Passed to <input> (name, aria-label, disabled, etc.).
 */
const ScalaInput = ({
  value,
  onChange,
  onAnyChange,
  context = "degree",
  inputMode,
  style,
  inputClass,
  wrapperStyle,
  wrapperClass,
  showCents = true,
  showCanonicalOnCommit = false,
  allowNegative = false,
  commitNegative = false,
  ...rest
}) => {
  const parseDraftValue = (str) => {
    if (!allowNegative || typeof str !== "string") {
      return parseScalaInterval(str, context);
    }
    const trimmed = str.trim();
    if (!trimmed.startsWith("-")) {
      return parseScalaInterval(trimmed, context);
    }
    const unsigned = trimmed.slice(1).trim();
    const parsed = parseScalaInterval(unsigned, context);
    if (!parsed.valid) return parsed;
    return {
      cents: parsed.cents == null ? parsed.cents : -parsed.cents,
      valid: true,
      error: null,
    };
  };

  // Local draft while the user is typing.
  const [draft, setDraft] = useState(value ?? "");
  const lastCommittedRef = useRef({ canonical: null, display: null });

  // Sync draft when the controlled value changes from outside (e.g. preset load).
  useEffect(() => {
    const nextValue = value ?? "";
    if (lastCommittedRef.current.canonical != null && nextValue === lastCommittedRef.current.canonical) {
      setDraft(lastCommittedRef.current.display ?? nextValue);
      return;
    }
    setDraft(nextValue);
  }, [value]);

  const parsedDraft = parseDraftValue(draft);
  const { cents, valid, error } = parsedDraft;

  const previewText = Number.isFinite(cents)
    ? `${Math.round(cents)}¢`
    : (error ?? "");

  const inputStyle = {
    ...style,
    border: valid || draft === "" ? (style?.border ?? "1px solid #c8b8b8") : "1.5px solid #c0392b",
  };
  const resolvedInputMode = inputMode ?? "text";
  const shouldShowCents = showCents || !String(draft).includes(".") || !valid;

  const handleChange = (e) => {
    const s = e.target.value;
    setDraft(s);
    if (onAnyChange) onAnyChange(s);
  };

  const handleBlur = () => {
    let displayStr = draft.trim();
    if (displayStr.endsWith(".")) displayStr = `${displayStr}0`;
    const typedBareInteger = displayStr !== "" && !(/[/.\\]/).test(displayStr);

    // Coerce bare zero entries to canonical "0." in degree context, but preserve
    // explicit Scala forms such as 1/1 or 0\12 in the display layer.
    let finalStr = displayStr;
    if (context === "degree") {
      const { cents: c } = parseScalaInterval(displayStr, "degree");
      if (c === 0 && /^0(?:\.0+)?$/.test(displayStr)) {
        finalStr = "0.";
        displayStr = "0.0";
      } else if (displayStr !== "") {
        finalStr = normaliseDegree(displayStr);
      }
    } else if (displayStr !== "" && !(/[/.\\]/).test(displayStr)) {
      // In interval context, bare integers should still commit back as ratios.
      finalStr = normaliseDegree(displayStr);
    }

    const result = parseDraftValue(displayStr);
    if (result.valid || (commitNegative && result.error === "negative")) {
      const committedDisplay = (showCanonicalOnCommit || typedBareInteger) ? finalStr : displayStr;
      setDraft(committedDisplay);
      lastCommittedRef.current = { canonical: finalStr, display: committedDisplay };
      onChange(finalStr);
    } else {
      // Keep invalid but parseable entries visible so the user can correct them.
      setDraft(displayStr);
    }
  };

  const resolvedWrapperClass = ["scala-input__wrapper", wrapperClass].filter(Boolean).join(" ");

  return (
    <span
      class={resolvedWrapperClass}
      style={wrapperStyle}
    >
      <input
        type="text"
        class={inputClass}
        inputMode={resolvedInputMode}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={draft}
        onInput={handleChange}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
        }}
        style={inputStyle}
        {...rest}
      />
      {shouldShowCents && (
        <span class={`scala-input__cents${valid ? "" : " scala-input__cents--error"}`}>
          {previewText}
        </span>
      )}
    </span>
  );
};

export default ScalaInput;
