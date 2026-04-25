import { createRef } from "preact";
import { useRef } from "preact/hooks";

// Normalise a hex string to the form #rrggbb.
// Accepts:  #rgb  #rrggbb  rgb  rrggbb
// Returns the normalised string, or null if invalid.
export const normaliseHex = (raw) => {
  if (!raw) return null;
  const s = raw.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    const [r, g, b] = s;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) {
    return `#${s}`;
  }
  return null;
};

// A colour cell: a clickable swatch that opens a colour picker,
// alongside a hex text input that accepts typed or pasted values.
const ColorCell = ({ name, value, disabled, onChange }) => {
  const safe = normaliseHex(value || "#ffffff") || "#ffffff";
  const pickerRef = createRef();
  const textRef = createRef();
  const swatchRef = createRef();
  const lastFire = useRef(0);
  const lastEventTime = useRef(0);

  // Clicking the swatch triggers the hidden color picker
  const handleSwatchClick = () => {
    if (!disabled && pickerRef.current) {
      pickerRef.current.click();
    }
  };

  // onInput: velocity-adaptive throttling
  // Fast movement → fewer updates (coarser, ~100ms gap)
  // Slow movement → more updates (finer, ~16ms gap = 60fps)
  const handlePickerInput = (e) => {
    const hex = e.target.value;
    const now = Date.now();

    // Always update local UI immediately (no perceived lag)
    if (textRef.current) textRef.current.value = hex;
    if (swatchRef.current) swatchRef.current.style.backgroundColor = hex;

    // Measure event frequency as proxy for drag speed
    const timeSinceLastEvent = now - lastEventTime.current;
    lastEventTime.current = now;

    // Adaptive throttle: fast drag (small gap) → longer throttle
    // 0ms gap (very fast) → 100ms throttle
    // 80ms+ gap (slow) → 16ms throttle (60fps)
    const speedFactor = Math.max(0, Math.min(1, (80 - timeSinceLastEvent) / 80));
    const throttle = 16 + speedFactor * 84; // 16-100ms range

    if (now - lastFire.current >= throttle) {
      lastFire.current = now;
      onChange({ target: { name, value: hex } });
    }
  };

  // onChange: always fires on picker close to commit the final value
  const handlePickerChange = (e) => {
    const hex = e.target.value;
    if (textRef.current) textRef.current.value = hex;
    if (swatchRef.current) swatchRef.current.style.backgroundColor = hex;
    lastFire.current = 0; // reset throttle so final value always commits
    onChange({ target: { name, value: hex } });
  };

  // Text input — update swatch live while typing
  const handleTextInput = (e) => {
    const hex = normaliseHex(e.target.value);
    if (hex) {
      if (swatchRef.current) swatchRef.current.style.backgroundColor = hex;
      if (pickerRef.current) pickerRef.current.value = hex;
    }
  };

  // Text input blur — validate and commit, or revert
  const handleTextBlur = (e) => {
    const hex = normaliseHex(e.target.value);
    if (hex) {
      onChange({ target: { name, value: hex } });
    } else {
      e.target.value = safe;
      if (swatchRef.current) swatchRef.current.style.backgroundColor = safe;
      if (pickerRef.current) pickerRef.current.value = safe;
    }
  };

  return (
    <div class="color-cell">
      {/* Visible swatch — clicking opens the hidden picker */}
      <span class="color-swatch-hitbox">
        <span
          ref={swatchRef}
          class={`color-swatch${disabled ? " color-swatch--disabled" : ""}`}
          style={{ backgroundColor: safe }}
          onClick={handleSwatchClick}
          title={disabled ? undefined : "Click to open colour picker"}
          role={disabled ? undefined : "button"}
          aria-label={disabled ? undefined : `open colour picker for ${name}`}
        />

        {/* Hidden native color picker — provides the HSL picker UI */}
        <input
          ref={pickerRef}
          type="color"
          class="color-picker-hidden"
          value={safe}
          disabled={disabled}
          onInput={handlePickerInput}
          onChange={handlePickerChange}
          tabIndex={-1}
          aria-hidden="true"
        />
      </span>

      {/* Editable hex text input */}
      <input
        ref={textRef}
        type="text"
        class="color-input"
        name={name}
        defaultValue={safe}
        key={safe}
        disabled={disabled}
        maxLength={7}
        placeholder="#rrggbb"
        onInput={handleTextInput}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
        }}
        onBlur={handleTextBlur}
        aria-label={`hex colour for ${name}`}
      />
    </div>
  );
};

export default ColorCell;
