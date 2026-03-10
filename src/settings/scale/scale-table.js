import { h, createRef } from 'preact';
import { useRef } from 'preact/hooks';
import PropTypes from 'prop-types';

// Normalise a hex string to the form #rrggbb.
// Accepts:  #rgb  #rrggbb  rgb  rrggbb
// Returns the normalised string, or null if invalid.
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

// A colour cell: a clickable swatch that opens a colour picker,
// alongside a hex text input that accepts typed or pasted values.
const ColorCell = ({ name, value, disabled, onChange }) => {
  const safe = normaliseHex(value || '#ffffff') || '#ffffff';
  const pickerRef = createRef();
  const textRef = createRef();
  const swatchRef = createRef();
  const lastFire = useRef(0);

  // Clicking the swatch triggers the hidden color picker
  const handleSwatchClick = () => {
    if (!disabled && pickerRef.current) {
      pickerRef.current.click();
    }
  };

  // onInput: throttled to ~60ms so the hex grid updates smoothly without lag
  const handlePickerInput = (e) => {
    const hex = e.target.value;
    if (textRef.current) textRef.current.value = hex;
    if (swatchRef.current) swatchRef.current.style.backgroundColor = hex;
    const now = Date.now();
    if (now - lastFire.current >= 60) {
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
        class={`color-swatch${disabled ? ' color-swatch--disabled' : ''}`}
        style={{ backgroundColor: safe }}
        onClick={handleSwatchClick}
        title={disabled ? undefined : 'Click to open colour picker'}
        role={disabled ? undefined : 'button'}
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

  const rows = scale.map((x, i) => [x, degrees[i], note_names[i] || '', colors[i] || '#ffffff']);


  const scaleChange = e => {
    const next = [...(props.settings.scale || [])];
    next[parseInt(e.target.name.replace(/scale/, ''))] = e.target.value;
    props.onChange('scale', next);
  };

  const colorChange = e => {
    const next = [...(props.settings.note_colors || [])];
    next[parseInt(e.target.name.replace(/color/, ''))] = e.target.value;
    props.onChange('note_colors', next);
  };

  const nameChange = e => {
    const next = [...(props.settings.note_names || [])];
    next[parseInt(e.target.name.replace(/name/, ''))] = e.target.value;
    props.onChange('note_names', next);
  };

  const editable_labels = props.settings.key_labels !== 'note_names';
  const editable_colors = props.settings.spectrum_colors;

  return (
    <table>
      <thead>
        <tr>
          <th class="wide" id="leftaligned">Frequency Ratio&nbsp;&nbsp;|&nbsp;&nbsp;Cents&nbsp;&nbsp;|&nbsp;&nbsp;EDO-steps</th>
          <th>Degree</th>
          <th>Name</th>
          <th>Colour</th>
        </tr>
      </thead>
      <tbody>
        <tr key={`0-${props.importCount}`}>
          <td><em>1/1</em>&nbsp;&nbsp;&nbsp;=&nbsp;<em>0.0 cents</em>&nbsp;&nbsp;&nbsp;=&nbsp;&nbsp;0</td>
          <td>
            <input id="centered" type="text" disabled={editable_labels}
                   name="degree0" value={degrees[0]} onChange={nameChange}
                   aria-label="pitch degree 0"
            />
          </td>
          <td>
            <input id="centered" type="text" disabled={editable_labels}
                   name="name0" value={note_names[0] || ''} onChange={nameChange}
                   aria-label="pitch name 0"
            />
          </td>
          <td>
            <ColorCell name="color0" value={colors[0] || '#ffffff'}
                       disabled={editable_colors} onChange={colorChange} />
          </td>
        </tr>
        {rows.slice(1).map(([freq, degree, name, color], i) => (
          <tr key={`${i + 1}-${props.importCount}`}>
            <td>
              <input type="text" name={`scale${i}`}
                     value={freq} onChange={scaleChange}
                     aria-label={`pitch value ${i}`}
              />
            </td>
            <td>
              <input id="centered" type="text"
                     name={`degree${i + 1}`} value={degree}
                     aria-label={`pitch degree ${i}`}
              />
            </td>
            <td>
              <input id="centered" type="text" disabled={editable_labels}
                     name={`name${i + 1}`} value={name}
                     onChange={nameChange}
                     aria-label={`pitch name ${i}`}
              />
            </td>
            <td>
              <ColorCell name={`color${i + 1}`} value={color}
                         disabled={editable_colors} onChange={colorChange} />
            </td>
          </tr>
        ))}
        <tr key={`equiv-${props.importCount}`}>
          <td>
            <input type="text"
                   name={`scale${scale.length - 1}`}
                   value={equiv_interval} onChange={scaleChange}
                   aria-label={`pitch ${scale.length - 1}`}
            />
          </td>
          <td>
            <input id="centered" type="text" value={scale.length} />
          </td>
          <td id="centered"><em>{note_names[0]}&nbsp;&nbsp;&nbsp;</em></td>
          <td>
            <ColorCell name="color_equiv" value={colors[0]}
                       disabled={true} onChange={() => {}} />
          </td>
        </tr>
      </tbody>
    </table>
  );
};

ScaleTable.propTypes = {
  onChange: PropTypes.func.isRequired,
  settings: PropTypes.shape({
    scale: PropTypes.arrayOf(PropTypes.string),
    key_labels: PropTypes.string,
    spectrum_colors: PropTypes.bool,
    fundamental_color: PropTypes.string,
    note_colors: PropTypes.arrayOf(PropTypes.string),
    note_names: PropTypes.arrayOf(PropTypes.string),
  }),
};

export default ScaleTable;