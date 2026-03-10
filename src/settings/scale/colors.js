import { h, createRef } from 'preact';
import { Fragment } from 'preact/compat';
import { useRef } from 'preact/hooks';
import PropTypes from 'prop-types';

export const colorProp = function(props, propName, componentName) {
  const value = props[propName];
  if (value !== undefined && !/#[a-zA-Z0-9]{6}/.test(props[propName])) {
    return new Error(
      'Invalid hex color for prop `' + propName + '` supplied to' +
        ' `' + componentName + '`. Validation failed.'
    );
  }
};

const normaliseHex = (raw) => {
  if (!raw) return null;
  const s = raw.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    const [r, g, b] = s;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) {
    return `#${s}`;
  }
  return null;
};

const Colors = (props) => {
  const pickerRef = createRef();
  const textRef = createRef();
  const swatchRef = createRef();

  const safe = normaliseHex(props.settings.fundamental_color || '#f2e3e3') || '#f2e3e3';

  const handleSwatchClick = () => {
    if (pickerRef.current) pickerRef.current.click();
  };

  const lastFire = useRef(0);

  const handlePickerInput = (e) => {
    const hex = e.target.value;
    if (textRef.current) textRef.current.value = hex;
    if (swatchRef.current) swatchRef.current.style.backgroundColor = hex;
    const now = Date.now();
    if (now - lastFire.current >= 60) {
      lastFire.current = now;
      props.onChange('fundamental_color', hex);
    }
  };

  const handlePickerChange = (e) => {
    const hex = e.target.value;
    if (textRef.current) textRef.current.value = hex;
    if (swatchRef.current) swatchRef.current.style.backgroundColor = hex;
    lastFire.current = 0;
    props.onChange('fundamental_color', hex);
  };

  const handleTextInput = (e) => {
    const hex = normaliseHex(e.target.value);
    if (hex) {
      if (swatchRef.current) swatchRef.current.style.backgroundColor = hex;
      if (pickerRef.current) pickerRef.current.value = hex;
    }
  };

  const handleTextBlur = (e) => {
    const hex = normaliseHex(e.target.value);
    if (hex) {
      props.onChange('fundamental_color', hex);
    } else {
      e.target.value = safe;
      if (swatchRef.current) swatchRef.current.style.backgroundColor = safe;
      if (pickerRef.current) pickerRef.current.value = safe;
    }
  };

  return (
    <>
      <label>
        Use Spectrum Colors
        <input name="spectrum_colors" type="checkbox"
               checked={props.settings.spectrum_colors}
               onChange={(e) => props.onChange(e.target.name, e.target.checked)} />
      </label>
      {props.settings.spectrum_colors && (
        <label>
          Choose Central Hue
            <div style={{ display: 'flex', justifyContent: 'flex-end', width: '24em' }}>
            <div class="color-cell">
            <span
              ref={swatchRef}
              class="color-swatch"
              style={{ backgroundColor: safe }}
              onClick={handleSwatchClick}
              title="Click to open colour picker"
              role="button"
              aria-label="open colour picker for central hue"
            />
            <input
              ref={pickerRef}
              type="color"
              class="color-picker-hidden"
              value={safe}
              onInput={handlePickerInput}
              onChange={handlePickerChange}
              tabIndex={-1}
              aria-hidden="true"
            />
            <input
              ref={textRef}
              type="text"
              class="color-input"
              defaultValue={safe}
              key={safe}
              maxLength={7}
              placeholder="#rrggbb"
              onInput={handleTextInput}
              onBlur={handleTextBlur}
              aria-label="hex colour for central hue"
            />
          </div>
          </div>
        </label>
      )}
    </>
  );
};

Colors.propTypes = {
  onChange: PropTypes.func.isRequired,
  settings: PropTypes.shape({
    spectrum_colors: PropTypes.bool,
    fundamental_color: colorProp,
  }),
};

export default Colors;