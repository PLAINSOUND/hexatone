// CustomRangeSlider provides the shared sidebar fader primitive.
// It replaces browser-native range thumbs so Hexatone and Sequencer sliders
// share the same hover, drag, and keyboard behavior across browsers.

import { useMemo, useRef, useState } from "preact/hooks";
import PropTypes from "prop-types";
import { deriveStickyCenterValue } from "./sticky-center.js";

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function snapToStep(value, min, step) {
  if (typeof step === "function") step = step(value);
  if (!Number.isFinite(step) || step <= 0) return value;
  const steps = Math.round((value - min) / step);
  return min + steps * step;
}

export default function CustomRangeSlider({
  ariaLabel,
  min,
  max,
  step,
  value,
  disabled = false,
  defaultValue,
  exponent = 1,
  knee,
  fineDrag = false,
  onInputValue,
  onCommitValue,
}) {
  const trackRef = useRef(null);
  const draggingRef = useRef(false);
  const pointerIdRef = useRef(null);
  const dragPositionRef = useRef(null);
  const lockRef = useRef(false);
  const [isActive, setIsActive] = useState(false);

  const safeMin = Number(min);
  const safeMax = Number(max);
  const safeStep = typeof step === "function" ? step : Number(step);
  const safeExponent = Number.isFinite(exponent) && exponent > 0 ? exponent : 1;
  const hasKnee = knee && knee.value > safeMin && knee.value < safeMax &&
    knee.position > 0 && knee.position < 1;
  const kneeExponent = Number.isFinite(knee?.exponent) && knee.exponent > 0 ? knee.exponent : 1;
  const clampedValue = useMemo(
    () => clamp(Number.isFinite(defaultValue) && Number(value) === defaultValue
      ? defaultValue : snapToStep(Number(value), safeMin, safeStep), safeMin, safeMax),
    [value, safeMin, safeMax, safeStep, defaultValue],
  );

  const commitNumericValue = (nextValue, commit = false) => {
    const snappedValue = Number.isFinite(defaultValue) && nextValue === defaultValue
      ? clamp(defaultValue, safeMin, safeMax)
      : clamp(snapToStep(Number(nextValue), safeMin, safeStep), safeMin, safeMax);
    onInputValue?.(snappedValue);
    if (commit) onCommitValue?.(snappedValue);
    return snappedValue;
  };

  const valueFromClientX = (clientX, shiftKey = false) => {
    const rect = trackRef.current?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0) return clampedValue;
    let ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    if (fineDrag && draggingRef.current) {
      const previous = dragPositionRef.current;
      ratio = previous
        ? clamp(previous.ratio + (clientX - previous.clientX) / rect.width * (shiftKey ? 0.1 : 1), 0, 1)
        : shiftKey ? position : ratio;
      dragPositionRef.current = { clientX, ratio };
    }
    const raw = hasKnee
      ? ratio <= knee.position
        ? safeMin + ratio / knee.position * (knee.value - safeMin)
        : knee.value + ((ratio - knee.position) / (1 - knee.position)) ** kneeExponent * (safeMax - knee.value)
      : safeMin + ratio ** safeExponent * (safeMax - safeMin);
    if (!Number.isFinite(defaultValue)) return raw;
    const offset = raw - defaultValue;
    const extent = offset < 0 ? defaultValue - safeMin : safeMax - defaultValue;
    return defaultValue + deriveStickyCenterValue(offset, {
      lockRef, engageThreshold: (safeMax - safeMin) * 0.01,
      releaseThreshold: (safeMax - safeMin) * (52 / 2400),
      maxAbs: extent, outputMaxAbs: extent,
    }).outputValue;
  };

  const beginDrag = (event) => {
    if (disabled) return;
    event.preventDefault();
    draggingRef.current = true;
    pointerIdRef.current = event.pointerId;
    dragPositionRef.current = null;
    setIsActive(true);
    lockRef.current = Number.isFinite(defaultValue) &&
      Math.abs(clampedValue - defaultValue) <= (safeMax - safeMin) * 0.01;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    commitNumericValue(valueFromClientX(event.clientX, event.shiftKey));
  };

  const moveDrag = (event) => {
    if (!draggingRef.current || disabled) return;
    if (pointerIdRef.current != null && event.pointerId !== pointerIdRef.current) return;
    commitNumericValue(valueFromClientX(event.clientX, event.shiftKey));
  };

  const endDrag = (event) => {
    if (!draggingRef.current) return;
    if (pointerIdRef.current != null && event.pointerId !== pointerIdRef.current) return;
    const nextValue = disabled
      ? clampedValue
      : commitNumericValue(valueFromClientX(event.clientX, event.shiftKey), true);
    draggingRef.current = false;
    pointerIdRef.current = null;
    dragPositionRef.current = null;
    setIsActive(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    return nextValue;
  };

  const handleKeyDown = (event) => {
    if (disabled) return;
    let nextValue = clampedValue;
    const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
    const keyStep = typeof safeStep === "function" ? safeStep(clampedValue + direction * 1e-6) : safeStep;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") nextValue -= keyStep || 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") nextValue += keyStep || 1;
    else if (event.key === "Home") nextValue = safeMin;
    else if (event.key === "End") nextValue = safeMax;
    else return;

    event.preventDefault();
    commitNumericValue(nextValue, true);
  };

  const position = hasKnee
    ? clampedValue <= knee.value
      ? (clampedValue - safeMin) / (knee.value - safeMin) * knee.position
      : knee.position + ((clampedValue - knee.value) / (safeMax - knee.value)) ** (1 / kneeExponent) * (1 - knee.position)
    : ((clampedValue - safeMin) / (safeMax - safeMin)) ** (1 / safeExponent);
  const percent = position * 100;

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-disabled={disabled ? "true" : "false"}
      aria-valuemin={safeMin}
      aria-valuemax={safeMax}
      aria-valuenow={clampedValue}
      class={`settings-range-slider${isActive ? " settings-range-slider--active" : ""}${disabled ? " settings-range-slider--disabled" : ""}`}
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
    >
      <span class="settings-range-slider__track" aria-hidden="true" />
      <span
        class="settings-range-slider__thumb"
        aria-hidden="true"
        style={{ left: `${percent}%` }}
      />
    </div>
  );
}

CustomRangeSlider.propTypes = {
  ariaLabel: PropTypes.string,
  min: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  max: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  step: PropTypes.oneOfType([PropTypes.number, PropTypes.string, PropTypes.func]),
  value: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  disabled: PropTypes.bool,
  defaultValue: PropTypes.number,
  exponent: PropTypes.number,
  fineDrag: PropTypes.bool,
  knee: PropTypes.shape({ value: PropTypes.number.isRequired, position: PropTypes.number.isRequired, exponent: PropTypes.number }),
  onInputValue: PropTypes.func,
  onCommitValue: PropTypes.func,
};
