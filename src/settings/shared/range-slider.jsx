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
  onInputValue,
  onCommitValue,
}) {
  const trackRef = useRef(null);
  const draggingRef = useRef(false);
  const pointerIdRef = useRef(null);
  const lockRef = useRef(false);
  const [isActive, setIsActive] = useState(false);

  const safeMin = Number(min);
  const safeMax = Number(max);
  const safeStep = Number(step);
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

  const valueFromClientX = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0) return clampedValue;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const raw = safeMin + ratio * (safeMax - safeMin);
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
    setIsActive(true);
    lockRef.current = Number.isFinite(defaultValue) &&
      Math.abs(clampedValue - defaultValue) <= (safeMax - safeMin) * 0.01;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    commitNumericValue(valueFromClientX(event.clientX));
  };

  const moveDrag = (event) => {
    if (!draggingRef.current || disabled) return;
    if (pointerIdRef.current != null && event.pointerId !== pointerIdRef.current) return;
    commitNumericValue(valueFromClientX(event.clientX));
  };

  const endDrag = (event) => {
    if (!draggingRef.current) return;
    if (pointerIdRef.current != null && event.pointerId !== pointerIdRef.current) return;
    const nextValue = disabled
      ? clampedValue
      : commitNumericValue(valueFromClientX(event.clientX), true);
    draggingRef.current = false;
    pointerIdRef.current = null;
    setIsActive(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    return nextValue;
  };

  const handleKeyDown = (event) => {
    if (disabled) return;
    let nextValue = clampedValue;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") nextValue -= safeStep || 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") nextValue += safeStep || 1;
    else if (event.key === "Home") nextValue = safeMin;
    else if (event.key === "End") nextValue = safeMax;
    else return;

    event.preventDefault();
    commitNumericValue(nextValue, true);
  };

  const percent = ((clampedValue - safeMin) / (safeMax - safeMin)) * 100;

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
  step: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  value: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  disabled: PropTypes.bool,
  defaultValue: PropTypes.number,
  onInputValue: PropTypes.func,
  onCommitValue: PropTypes.func,
};
