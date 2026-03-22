import { h, createRef } from "preact";
import { useState, useRef, useCallback, useEffect } from "preact/hooks";
import PropTypes from "prop-types";
import { scalaToCents } from "./parse-scale";

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
const TuneCell = ({ scaleStr, degree, keysRef, onChange, reference_degree, fundamental, onFundamentalChange, retuning_mode }) => {
  const originalCents = useRef(scalaToCents(scaleStr));
  const [tunedCents, setTunedCents] = useState(null);
  const [comparing, setComparing] = useState(false);
  const dragStart = useRef(null);
  // Capture the Keys instance when drag starts — keysRef.current may change
  // during reconciliation, so we need the specific instance we set drag on
  const dragKeysInstance = useRef(null);

  // Keep originalCents in sync when scale string changes from outside
  useEffect(() => {
    if (tunedCents === null) {
      originalCents.current = scalaToCents(scaleStr);
    }
  }, [scaleStr]);

  // Clean up drag state on unmount — ensures setTuneDragging(false) is called
  // on the CORRECT Keys instance even if the component is removed mid-drag
  useEffect(() => {
    return () => {
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
    if (keysRef && keysRef.current && keysRef.current.updateScaleDegree) {
      keysRef.current.updateScaleDegree(degree, cents);
    }
  }, [keysRef, degree]);

  const onPointerDown = useCallback((e) => {
    // Set flag BEFORE setPointerCapture — capture triggers a spurious Escape keyup
    // which would drop sustain; the flag guards against that in keys.js.
    // Also capture the Keys instance for cleanup in case we're unmounted mid-drag.
    if (keysRef && keysRef.current && keysRef.current.setTuneDragging) {
      keysRef.current.setTuneDragging(true);
      dragKeysInstance.current = keysRef.current;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { lastX: e.clientX, accCents: currentCents };
  }, [currentCents, keysRef]);

  const onPointerMove = useCallback((e) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.lastX;
    if (dx === 0) return;
    // Velocity-sensitive: slow drags (|dx| small) → fine; fast drags → coarser.
    // sensitivity = base * speed^1.8 — superlinear so fast moves cover more ground
    const speed = Math.abs(dx);
    const sensitivity = 0.05 * Math.pow(speed, 1.5); // ~0.05¢ at 1px/event, ~1¢ at 7px/event
    const newCents = dragStart.current.accCents + Math.sign(dx) * sensitivity;
    dragStart.current.lastX = e.clientX;
    dragStart.current.accCents = newCents;
    setTunedCents(newCents);
    if (!comparing) pushToKeys(newCents);
  }, [comparing, pushToKeys]);

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
    const next = !comparing;
    setComparing(next);
    pushToKeys(next ? originalCents.current : tunedCents);
  }, [comparing, tunedCents, pushToKeys]);

  const onSave = useCallback(() => {
    const saveVal = tunedCents !== null ? tunedCents : originalCents.current;
    const str = saveVal.toFixed(6);

    if (isReferenceDegree && retuning_mode !== 'transpose_scale') {
      const delta = tunedCents - originalCents.current;
      const newFundamental = fundamental * Math.pow(2, delta / 1200.0);
      // NEW: pass both changes atomically via a combined callback
      if (onFundamentalChange) {
        onFundamentalChange(newFundamental, str);  // ← pass str along
        // Don't call onChange(str) separately — let onFundamentalChange handle it
      } else {
        onChange(str);
      }
    } else {
      onChange(str);
    }

    originalCents.current = saveVal;
    setTunedCents(null);
    setComparing(false);
  }, [tunedCents, isReferenceDegree, retuning_mode, fundamental, onFundamentalChange, onChange, degree, reference_degree]);

  const onRevert = useCallback(() => {
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
  const equiv_interval = scale.length ? scale.pop() : 0;
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

  const scaleChange = (e) => {
    const next = [...(props.settings.scale || [])];
    next[parseInt(e.target.name.replace(/scale/, ""))] = e.target.value;
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
          <td class="tonic-label">
            <span>
              1/1&nbsp;&nbsp;|&nbsp;&nbsp;0.0&nbsp;&nbsp;|&nbsp;&nbsp;0\n
            </span>
            <br />
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
                <input
                  type="text"
                  name={`scale${i}`}
                  value={freq}
                  onChange={scaleChange}
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
                    // If newStr is provided (reference degree retune), apply both atomically
                    if (newStr !== undefined) {
                      const next = [...(props.settings.scale || [])];
                      next[i] = newStr;
                      // Single setSettings call covers both — no race between two renders
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
              <input
                type="text"
                name={`scale${scale.length - 1}`}
                value={equiv_interval}
                onChange={scaleChange}
                aria-label={`pitch ${scale.length - 1}`}
              />
              <TuneCell
                key={`tune-equiv-${props.importCount}`}
                scaleStr={String(equiv_interval)}
                degree={scale.length}
                keysRef={props.keysRef}
                reference_degree={props.settings.reference_degree}
                fundamental={props.settings.fundamental}
                retuning_mode={props.settings.retuning_mode}
                onFundamentalChange={(newFreq) => props.onChange('fundamental', newFreq)}
                onChange={(newStr) => {
                  const next = [...(props.settings.scale || [])];
                  next[next.length - 1] = newStr;
                  props.onChange('scale', next);
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