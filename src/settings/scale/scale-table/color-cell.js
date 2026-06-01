import { createRef } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

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
const ColorCell = ({
  name,
  value,
  disabled,
  onChange,
  suggestedColor = null,
  suggestedLabel = "",
  onApplySuggestion = null,
  onPreviewColor = null,
}) => {
  const safe = normaliseHex(value || "#ffffff") || "#ffffff";
  const suggested = normaliseHex(suggestedColor);
  const [draft, setDraft] = useState(safe);
  const [comparing, setComparing] = useState(false);
  const showSuggestion = !!suggested && suggested.toLowerCase() !== safe.toLowerCase() && !disabled;
  const isDirty = draft.toLowerCase() !== safe.toLowerCase();
  const visibleColor = comparing ? safe : draft;
  const pickerRef = createRef();
  const textRef = createRef();
  const swatchRef = createRef();
  const lastFire = useRef(0);
  const lastEventTime = useRef(0);
  const safeRef = useRef(safe);
  const draftRef = useRef(safe);
  const comparingRef = useRef(false);

  useEffect(() => {
    safeRef.current = safe;
    setDraft(safe);
    setComparing(false);
    draftRef.current = safe;
    comparingRef.current = false;
  }, [safe]);

  useEffect(() => {
    if (textRef.current) textRef.current.value = visibleColor;
    if (pickerRef.current) pickerRef.current.value = visibleColor;
    if (swatchRef.current) swatchRef.current.style.backgroundColor = visibleColor;
  }, [visibleColor, pickerRef, swatchRef, textRef]);

  const applyDraft = (hex) => {
    const normalized = normaliseHex(hex);
    if (!normalized) return;
    draftRef.current = normalized;
    setDraft(normalized);
    setComparing(false);
    comparingRef.current = false;
  };

  const commitDraft = () => {
    const currentSafe = safeRef.current;
    const currentDraft = draftRef.current;
    const currentComparing = comparingRef.current;
    const dirty = currentDraft.toLowerCase() !== currentSafe.toLowerCase();
    const currentVisible = currentComparing ? currentSafe : currentDraft;

    if (!dirty) return;
    if (currentVisible.toLowerCase() === currentSafe.toLowerCase()) {
      draftRef.current = currentSafe;
      comparingRef.current = false;
      setDraft(currentSafe);
      setComparing(false);
      onPreviewColor?.(currentSafe);
      onChange({ target: { name, value: currentSafe } });
      return;
    }
    onChange({ target: { name, value: currentVisible } });
  };

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
    applyDraft(hex);
    onPreviewColor?.(hex);

    // Measure event frequency as proxy for drag speed
    const timeSinceLastEvent = now - lastEventTime.current;
    lastEventTime.current = now;

    // Adaptive throttle: fast drag (small gap) → longer throttle
    // 0ms gap (very fast) → 100ms throttle
    // 80ms+ gap (slow) → 16ms throttle (60fps)
    const speedFactor = Math.max(0, Math.min(1, (80 - timeSinceLastEvent) / 80));
    const throttle = 16 + speedFactor * 84; // 16-100ms range

    if (now - lastFire.current >= throttle) lastFire.current = now;
  };

  // onChange: update preview on picker close; explicit save commits
  const handlePickerChange = (e) => {
    const hex = e.target.value;
    applyDraft(hex);
    onPreviewColor?.(hex);
    lastFire.current = 0; // reset throttle so final value always commits
  };

  // Text input — update swatch live while typing
  const handleTextInput = (e) => {
    const hex = normaliseHex(e.target.value);
    if (hex) {
      applyDraft(hex);
      onPreviewColor?.(hex);
    }
  };

  // Text input blur — validate locally, explicit save commits
  const handleTextBlur = (e) => {
    const hex = normaliseHex(e.target.value);
    if (hex) {
      applyDraft(hex);
      onPreviewColor?.(hex);
    } else {
      e.target.value = visibleColor;
    }
  };

  return (
    <div class="color-cell">
      {/* Visible swatch — clicking opens the hidden picker */}
      <span class="color-swatch-hitbox">
        <span
          ref={swatchRef}
          class={`color-swatch${disabled ? " color-swatch--disabled" : ""}`}
          style={{ backgroundColor: visibleColor }}
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
          value={visibleColor}
          disabled={disabled}
          onInput={handlePickerInput}
          onChange={handlePickerChange}
          tabIndex={-1}
        />
      </span>

      {/* Editable hex text input */}
      <input
        ref={textRef}
        type="text"
        class="color-input"
        name={name}
        defaultValue={visibleColor}
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
      {isDirty && (
        <button
          type="button"
          class={`color-cell-btn${comparing ? " color-cell-btn--active" : ""}`}
          onClick={() =>
            setComparing((prev) => {
              const nextComparing = !prev;
              comparingRef.current = nextComparing;
              onPreviewColor?.(nextComparing ? safeRef.current : draftRef.current);
              return nextComparing;
            })}
          title="Compare with original colour"
          aria-label={`compare original colour for ${name}`}
        >
          ↺
        </button>
      )}
      {isDirty && (
        <button
          type="button"
          class="color-cell-btn color-cell-btn--save"
          onClick={commitDraft}
          title="Commit current colour"
          aria-label={`save colour for ${name}`}
        >
          ✓
        </button>
      )}
      {showSuggestion && (
        <button
          type="button"
          class="color-suggestion-btn"
          onClick={() => {
            applyDraft(suggested);
            onPreviewColor?.(suggested);
            onApplySuggestion?.(suggested);
          }}
          title={suggestedLabel ? `Apply suggested colour: ${suggestedLabel}` : `Apply suggested colour ${suggested}`}
          aria-label={`apply suggested colour for ${name}`}
        >
          <span
            class="color-suggestion-btn__swatch"
            style={{ backgroundColor: suggested }}
            aria-hidden="true"
          />
          <span class="color-suggestion-btn__label">Auto</span>
          <span
            class="color-suggestion-btn__preview"
            style={{ backgroundColor: suggested }}
            aria-hidden="true"
          />
        </button>
      )}
    </div>
  );
};

export default ColorCell;
