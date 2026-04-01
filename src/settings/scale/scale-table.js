import { h, createRef } from "preact";
import { useState, useRef, useCallback, useEffect } from "preact/hooks";
import PropTypes from "prop-types";
import { scalaToCents } from "./parse-scale";
import ScalaInput from './scala-input.js';

// Normalise a hex string to the form #rrggbb.
// Accepts:  #rgb  #rrggbb  rgb  rrggbb
// Returns the normalised string, or null if invalid.
const normaliseHex = (raw) => {
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
    const speedFactor = Math.max(
      0,
      Math.min(1, (80 - timeSinceLastEvent) / 80),
    );
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
        onBlur={handleTextBlur}
        aria-label={`hex colour for ${name}`}
      />
    </div>
  );
};

/**
 * TuneCell — drag-to-tune control for a single scale degree.
 * Drag left/right to retune; A/B compare; save or revert.
 * 
 * When retuning the reference_degree, behavior depends on retuning_mode:
 * - 'recalculate_reference' (default): Keep current sound, recalculate Reference Frequency
 * - 'transpose_scale': Transpose entire scale, preserve Reference Frequency
 */
const TuneCell = ({ scaleStr, degree, keysRef, onChange, onDegree0Save, reference_degree, fundamental, onFundamentalChange, retuning_mode }) => {
  const originalCents = useRef(scalaToCents(scaleStr));
  const [tunedCents, setTunedCents] = useState(null);
  const [comparing, setComparing] = useState(false);
  const dragStart = useRef(null);
  // Capture the Keys instance when drag starts — keysRef.current may change
  // during reconciliation, so we need the specific instance we set drag on
  const dragKeysInstance = useRef(null);
  // Glide state for velocity-scaled pitch interpolation.
  // Uses frame-delta exponential decay so there is never a mismatch between
  // performance.now() (pointer events) and rAF timestamps. Only two values
  // matter: what is currently playing and where we are headed.
  const glideRef = useRef({ rafId: null, playingCents: null, targetCents: null, lastFrameTime: 0 });

  // Keep originalCents in sync when scale string changes from outside
  useEffect(() => {
    if (tunedCents === null) {
      originalCents.current = scalaToCents(scaleStr);
    }
  }, [scaleStr]);

  // Clean up drag state and any in-flight glide on unmount.
  useEffect(() => {
    return () => {
      const g = glideRef.current;
      if (g.rafId) { cancelAnimationFrame(g.rafId); g.rafId = null; }
      // Use the captured instance from when drag started, not keysRef.current
      // which may now point to a new Keys instance after reconstruction
      if (dragKeysInstance.current && dragKeysInstance.current.setTuneDragging) {
        dragKeysInstance.current.setTuneDragging(false);
      }
    };
  }, []);

  const currentCents = tunedCents !== null ? tunedCents : originalCents.current;
  const isDirty = tunedCents !== null && Math.abs(tunedCents - originalCents.current) > 0.001;
  const isReferenceDegree = degree === reference_degree;

  const pushToKeys = useCallback((cents) => {
    if (!keysRef || !keysRef.current) return;
    if (degree === 0) {
      // Only retune degree-0 notes; all other notes stay at their pitch.
      // cents is the absolute offset from 0 (the drag value from originalCents=0).
      if (keysRef.current.previewDegree0) keysRef.current.previewDegree0(cents);
    } else if (keysRef.current.updateScaleDegree) {
      keysRef.current.updateScaleDegree(degree, cents);
    }
  }, [keysRef, degree]);

  // Smoothly move the playing pitch toward targetCents using per-frame exponential
  // decay (tau = 20 ms). Because dt is always measured between consecutive rAF
  // timestamps, there is no performance.now() / rAF-timestamp mismatch that
  // would cause the direction-flip glitch. Retargeting simply updates g.targetCents;
  // the single running loop tracks it automatically — no lag accumulates.
  // Deltas under 0.5¢ snap immediately so fine tuning stays perfectly responsive.
  const glideTo = useCallback((targetCents) => {
    const g = glideRef.current;

    // Before the first drag, playingCents is null — snap to anchor immediately.
    if (g.playingCents === null) {
      g.targetCents = targetCents;
      g.playingCents = targetCents;
      pushToKeys(targetCents);
      return;
    }

    g.targetCents = targetCents;

    const delta = Math.abs(targetCents - g.playingCents);
    if (delta < 0.5) {
      if (g.rafId) { cancelAnimationFrame(g.rafId); g.rafId = null; }
      g.playingCents = targetCents;
      pushToKeys(targetCents);
      return;
    }

    if (!g.rafId) {
      // Seed lastFrameTime one nominal frame in the past so the first tick
      // gets a sensible dt without mixing performance.now() into the rAF domain.
      g.lastFrameTime = performance.now() - 16;
      const tick = (now) => {
        const dt = Math.min(Math.max(now - g.lastFrameTime, 0), 50); // clamp: guard against tab-switch pauses
        g.lastFrameTime = now;
        const factor = 1 - Math.exp(-dt / 20); // tau = 20 ms → ~95 % covered in 60 ms
        g.playingCents = g.playingCents + (g.targetCents - g.playingCents) * factor;
        if (Math.abs(g.targetCents - g.playingCents) < 0.5) {
          g.playingCents = g.targetCents;
          pushToKeys(g.targetCents);
          g.rafId = null;
        } else {
          pushToKeys(g.playingCents);
          g.rafId = requestAnimationFrame(tick);
        }
      };
      g.rafId = requestAnimationFrame(tick);
    }
    // else: running loop will track updated g.targetCents on the next tick
  }, [pushToKeys]);

  const onPointerDown = useCallback((e) => {
    // Set flag BEFORE setPointerCapture — capture triggers a spurious Escape keyup
    // which would drop sustain; the flag guards against that in keys.js.
    // Also capture the Keys instance for cleanup in case we're unmounted mid-drag.
    if (keysRef && keysRef.current && keysRef.current.setTuneDragging) {
      keysRef.current.setTuneDragging(true);
      dragKeysInstance.current = keysRef.current;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    // Cancel any in-flight glide and anchor playingCents to the current displayed
    // value. This prevents a stale playingCents from a previous drag causing an
    // audible jump on the first glideTo call of the new drag.
    const g = glideRef.current;
    if (g.rafId) { cancelAnimationFrame(g.rafId); g.rafId = null; }
    g.playingCents = currentCents;
    g.targetCents = currentCents;
    dragStart.current = { lastX: e.clientX, accCents: currentCents };
  }, [currentCents, keysRef]);

  const onPointerMove = useCallback((e) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.lastX;
    if (dx === 0) return;
    // Velocity-sensitive: slow drags (|dx| small) → fine; fast drags → coarser.
    // sensitivity = base * speed^1.5 — superlinear so fast moves cover more ground
    const speed = Math.abs(dx);
    const sensitivity = 0.05 * Math.pow(speed, 1.5); // ~0.05¢ at 1px/event, ~1¢ at 7px/event
    const newCents = dragStart.current.accCents + Math.sign(dx) * sensitivity;
    dragStart.current.lastX = e.clientX;
    dragStart.current.accCents = newCents;
    setTunedCents(newCents);
    // Use glideTo so fast swipes interpolate smoothly rather than jumping.
    // While comparing, the original pitch is playing — don't update the preview.
    if (!comparing) glideTo(newCents);
  }, [comparing, glideTo]);

  const onPointerUp = useCallback(() => {
    dragStart.current = null;
    if (keysRef && keysRef.current && keysRef.current.setTuneDragging) {
      keysRef.current.setTuneDragging(false);
      // If Escape is still physically held, re-engage sustain now drag is done
      if (keysRef.current.state && keysRef.current.state.escHeld) {
        keysRef.current.sustainOn();
      }
    }
  }, [keysRef]);

  const onCompare = useCallback(() => {
    const g = glideRef.current;
    if (g.rafId) { cancelAnimationFrame(g.rafId); g.rafId = null; }
    g.playingCents = null;
    g.targetCents = null;
    const next = !comparing;
    setComparing(next);
    pushToKeys(next ? originalCents.current : tunedCents);
  }, [comparing, tunedCents, pushToKeys]);

  const onSave = useCallback(() => {
    const g = glideRef.current;
    if (g.rafId) { cancelAnimationFrame(g.rafId); g.rafId = null; }
    g.playingCents = null;
    g.targetCents = null;
    const saveVal = tunedCents !== null ? tunedCents : originalCents.current;
    const str = saveVal.toFixed(6);

    if (degree === 0) {
      // Degree 0 retuning: shift all other scale degrees by -delta so that
      // all notes except degree 0 remain at the same absolute pitch.
      // onDegree0Save receives the delta in cents.
      if (onDegree0Save) onDegree0Save(saveVal); // saveVal === delta (originalCents is 0)
    } else if (isReferenceDegree && retuning_mode !== 'transpose_scale') {
      const delta = tunedCents - originalCents.current;
      const newFundamental = fundamental * Math.pow(2, delta / 1200.0);
      if (onFundamentalChange) {
        onFundamentalChange(newFundamental, str);
      } else {
        onChange(str);
      }
    } else {
      onChange(str);
    }

    // For degree 0 the scale value is always 0 after save — the delta was
    // baked into the other scale degrees / fundamental on save, so the next
    // drag must start from 0, not from saveVal.
    originalCents.current = degree === 0 ? 0 : saveVal;
    setTunedCents(null);
    setComparing(false);
    // Restore live preview to 0 so held degree-0 notes return to base pitch
    if (degree === 0) pushToKeys(0);
  }, [tunedCents, degree, isReferenceDegree, retuning_mode, fundamental,
      onFundamentalChange, onDegree0Save, onChange, pushToKeys]);

  const onRevert = useCallback(() => {
    const g = glideRef.current;
    if (g.rafId) { cancelAnimationFrame(g.rafId); g.rafId = null; }
    g.playingCents = null;
    g.targetCents = null;
    setTunedCents(null);
    setComparing(false);
    pushToKeys(originalCents.current);
  }, [pushToKeys]);

  const delta = isDirty ? (tunedCents - originalCents.current) : 0;
  const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}c` : `${delta.toFixed(1)}c`;

  return (
    <div class="tune-cell">
      {isDirty && (
        <span class={`tune-delta${comparing ? ' tune-comparing' : ''}`}>
          {comparing ? 'orig' : deltaStr}
        </span>
      )}
      {isDirty && <button type="button" class={`tune-btn${comparing ? ' tune-btn--active' : ''}`}
        onClick={onCompare} title="A/B compare with original"><span class="tune-btn-compare" style={{ display: 'block', marginTop: '-4px' }}>↺</span></button>}
      {isDirty && <button type="button" class="tune-btn tune-btn--save"
        onClick={onSave} title="Save tuning">✓</button>}
      {isDirty && <button type="button" class="tune-btn tune-btn--revert"
        onClick={onRevert} title="Revert to original">✕</button>}
      <span
        class="tune-handle"
        title="Drag left/right to tune — slow for fine, fast for coarse"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ paddingBottom: '6px' }}
      >⟺</span>
    </div>
  );
};

// sidebar display of the scala file, degrees, note names, colors in an html table format
const ScaleTable = (props) => {
  const scale = [...(props.settings.scale || [])];
  const equiv_interval = scale.length ? scale.pop() : "2/1";
  scale.unshift(0);

  const degrees = [...Array(scale.length).keys()];
  const note_names = props.settings.note_names || [];

  let colors;
  if (props.settings.spectrum_colors) {
    colors = Array(scale.length).fill(props.settings.fundamental_color);
  } else {
    colors = props.settings.note_colors || [];
  }

  const rows = scale.map((x, i) => [
    x,
    degrees[i],
    note_names[i] || "",
    colors[i] || "#ffffff",
  ]);

  const scaleChangeAt = (i, str) => {
    const next = [...(props.settings.scale || [])];
    next[i] = str;
    props.onChange("scale", next);
  };

  const colorChange = (e) => {
    const next = [...(props.settings.note_colors || [])];
    next[parseInt(e.target.name.replace(/color/, ""))] = e.target.value;
    props.onChange("note_colors", next);
  };

  const nameChange = (e) => {
    const next = [...(props.settings.note_names || [])];
    next[parseInt(e.target.name.replace(/name/, ""))] = e.target.value;
    props.onChange("note_names", next);
  };

  const editable_labels = props.settings.key_labels !== "note_names";
  const editable_colors = props.settings.spectrum_colors;

  return (
    <table>
      <thead>
        <tr>
          <th class="wide" id="leftaligned">
            Ratio&nbsp;&nbsp;|&nbsp;&nbsp;Cents&nbsp;&nbsp;|&nbsp;&nbsp;EDO
          </th>
          <th>Degree</th>
          <th>Name</th>
          <th>Colour</th>
        </tr>
      </thead>
      <tbody>
        <tr
          key={`0-${props.importCount}`}
          class={
            props.settings.reference_degree === 0
              ? "reference-degree-row"
              : undefined
          }
        >
          <td>
            <div class="freq-cell">
              <input
                type="text"
                disabled
                value="1/1  |  0.0  |  0\n"
                aria-label="pitch value root"
              />
              <TuneCell
                key={`tune0-${props.importCount}`}
                scaleStr="0.0"
                degree={0}
                keysRef={props.keysRef}
                reference_degree={props.settings.reference_degree}
                fundamental={props.settings.fundamental}
                retuning_mode={props.settings.retuning_mode}
                onDegree0Save={(delta) => {
                  // delta: cents degree 0 moved up.
                  // The equave is never touched — it is a period ratio, not a pitch.
                  const oldScale = [...(props.settings.scale || [])];
                  const equave = oldScale[oldScale.length - 1]; // preserve as-is
                  // Subtract delta from every degree except the equave so all
                  // other notes stay at the same absolute Hz.
                  const newScale = oldScale.map((str, idx) => {
                    if (idx === oldScale.length - 1) return str; // equave unchanged
                    const cents = scalaToCents(String(str));
                    return (cents - delta).toFixed(6);
                  });
                  const ref = props.settings.reference_degree;
                  if (ref === 0) {
                    // Degree 0 is the reference: fundamental shifts up by delta.
                    // Scale degrees (excl. equave) shift down by delta to keep
                    // all other notes at the same Hz.
                    const newFundamental = props.settings.fundamental
                      * Math.pow(2, delta / 1200.0);
                    props.onAtomicChange({ scale: newScale, fundamental: newFundamental });
                  } else {
                    // Another degree is the reference: fundamental stays.
                    // Subtracting delta from all non-equave scale degrees keeps
                    // every other note at the same Hz and shifts degree 0 up.
                    props.onChange('scale', newScale);
                  }
                }}
              />
            </div>
          </td>
          <td>
            <input
              id="centered"
              type="text"
              disabled
              class="equiv-cell"
              value={degrees[0]}
              aria-label="pitch degree 0"
            />
          </td>
          <td>
            <input
              id="centered"
              type="text"
              disabled={editable_labels}
              name="name0"
              value={note_names[0] || ""}
              onChange={nameChange}
              aria-label="pitch name 0"
            />
          </td>
          <td>
            <ColorCell
              name="color0"
              value={colors[0] || "#ffffff"}
              disabled={editable_colors}
              onChange={colorChange}
            />
          </td>
        </tr>
        {rows.slice(1).map(([freq, degree, name, color], i) => (
          <tr
            key={`${i + 1}-${props.importCount}`}
            class={
              props.settings.reference_degree === i + 1
                ? "reference-degree-row"
                : undefined
            }
          >
            <td>
              <div class="freq-cell">
                <ScalaInput
                  context="degree"
                  name={`scale${i}`}
                  value={freq}
                  onAnyChange={(str) => scaleChangeAt(i, str)}
                  onChange={(str) => scaleChangeAt(i, str)}
                  showCents={false}
                  aria-label={`pitch value ${i}`}
                />
                <TuneCell
                  key={`tune${i + 1}-${props.importCount}`}
                  scaleStr={(props.settings.scale || [])[i] || String(freq)}
                  degree={i + 1}
                  keysRef={props.keysRef}
                  reference_degree={props.settings.reference_degree}
                  fundamental={props.settings.fundamental}
                  retuning_mode={props.settings.retuning_mode}
                  onChange={(newStr) => {
                    const next = [...(props.settings.scale || [])];
                    next[i] = newStr;
                    props.onChange('scale', next);
                  }}
                  onFundamentalChange={(newFreq, newStr) => {
                    if (newStr !== undefined) {
                      const next = [...(props.settings.scale || [])];
                      next[i] = newStr;
                      props.onAtomicChange({ fundamental: newFreq, scale: next });
                    } else {
                      props.onChange('fundamental', newFreq);
                    }
                  }}
                />
              </div>
            </td>
            <td>
              <input
                id="centered"
                type="text"
                disabled
                class="equiv-cell"
                value={degree}
                aria-label={`pitch degree ${i}`}
              />
            </td>
            <td>
              <input
                id="centered"
                type="text"
                disabled={editable_labels}
                name={`name${i + 1}`}
                value={name}
                onChange={nameChange}
                aria-label={`pitch name ${i + 1}`}
              />
            </td>
            <td>
              <ColorCell
                name={`color${i + 1}`}
                value={color}
                disabled={editable_colors}
                onChange={colorChange}
              />
            </td>
          </tr>
        ))}
        <tr
          key={`equiv-${props.importCount}`}
          class={
            props.settings.reference_degree === 0
              ? "reference-degree-row"
              : undefined
          }
        >
          <td>
            <div class="freq-cell">
              <ScalaInput
                context="interval"
                name={`scale${scale.length - 1}`}
                value={equiv_interval}
                onAnyChange={(str) => scaleChangeAt(scale.length - 1, str)}
                onChange={(str) => scaleChangeAt(scale.length - 1, str)}
                showCents={false}
                aria-label={`pitch ${scale.length - 1}`}
              />
              <div class="tune-cell-spacer" aria-hidden="true" />
            </div>
          </td>
          <td>
            <input
              id="centered"
              type="text"
              disabled
              class="equiv-cell"
              value={scale.length}
              aria-label="equave degree"
            />
          </td>
          <td>
            <input
              id="centered"
              type="text"
              disabled
              class="equiv-cell"
              value={note_names[0] || ""}
              aria-label="pitch name equave"
            />
          </td>
          <td>
            <span
              style={{
                fontWeight: "bold",
                display: "block",
                textAlign: "center",
                marginTop: "0.25em",
              }}
            >
              Equave
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  );
};

ScaleTable.propTypes = {
  keysRef: PropTypes.object,
  onChange: PropTypes.func.isRequired,
  onAtomicChange: PropTypes.func,
  importCount: PropTypes.number,
  settings: PropTypes.shape({
    scale: PropTypes.arrayOf(PropTypes.string),
    key_labels: PropTypes.string,
    spectrum_colors: PropTypes.bool,
    fundamental_color: PropTypes.string,
    note_colors: PropTypes.arrayOf(PropTypes.string),
    note_names: PropTypes.arrayOf(PropTypes.string),
    reference_degree: PropTypes.number,
    fundamental: PropTypes.number,
    retuning_mode: PropTypes.string,
  }),
};

export default ScaleTable;