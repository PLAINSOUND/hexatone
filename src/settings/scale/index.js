import { h } from 'preact';
import { useState } from 'preact/hooks';
import { Fragment } from 'preact/compat';
import PropTypes from 'prop-types';
import Colors, { colorProp } from './colors';
import KeyLabels from './key-labels';
import ScaleTable from './scale-table';
import ScalaImport from './scala-import';
import { settingsToHexatonScala } from './parse-scale';

const Scale = (props) => {
  const [importing,  setImporting]  = useState(false);
  const [collapsed,  setCollapsed]  = useState(() => sessionStorage.getItem('hexatone_scale_collapsed') === 'true');

  const doImport = () => {
    props.onImport();
    setImporting(false);
  };
  const cancelImport = () => setImporting(false);
  const startImporting = () => {
    // Generate Scala content from current scale table settings
    const scalaContent = settingsToHexatonScala(props.settings);
    props.onChange('scale_import', scalaContent);
    setImporting(true);
  };

  const handleToggle = (c) => {
    sessionStorage.setItem('hexatone_scale_collapsed', c);
    setCollapsed(c);
  };

  return (
  <fieldset>
      <legend>
        <b>Scale</b>
        <button
          type="button"
          onClick={() => handleToggle(!collapsed)}
          title={collapsed ? 'Expand scale settings' : 'Collapse scale settings'}
          style={{ marginLeft: '0.6em', padding: '0 0.4em', fontSize: '0.8em',
                   lineHeight: '1.4', verticalAlign: 'middle', cursor: 'pointer' }}
        >{collapsed ? '▶' : '▼'}</button>
      </legend>
      <label>
        Reference Frequency (Hz)
        <input name="fundamental" type="text" inputMode="decimal"
               class="sidebar-input"
               key={props.settings.fundamental}
               defaultValue={props.settings.fundamental}
               step="0.000001" min="0.015625" max="16384"
               onBlur={(e) => {
                 const val = parseFloat(e.target.value);
                 if (!isNaN(val) && val >= 0.015625 && val <= 16384) {
                   props.onChange('fundamental', val);
                 } else {
                   e.target.value = props.settings.fundamental;
                 }
               }}
        />
      </label>
      <label>
        Assigned Scale Degree
        <input name="reference_degree" type="text" inputMode="numeric"
               class="sidebar-input"
               key={props.settings.reference_degree}
               defaultValue={props.settings.reference_degree}
               step="1" min="0" max={props.settings.equivSteps - 1}
               onBlur={(e) => {
                 const val = parseInt(e.target.value);
                 const max = props.settings.equivSteps - 1;
                 if (!isNaN(val) && val >= 0 && val <= max) {
                   props.onChange('reference_degree', val);
                 } else {
                   e.target.value = props.settings.reference_degree;
                 }
                }}
        />
      </label>
      <label>
        Scale Size
        <input name="equivSteps" type="text" inputMode="numeric"
               class="sidebar-input"
               value={props.settings.equivSteps}
               step="1" min="1" max="2048"
               onChange={(e) => {
                 const val = parseInt(e.target.value);
                 if (!isNaN(val) && val >= 1 && val <= 2048) {
                   props.onChange('equivSteps', val);
                 }
               }}
        />
      </label>
      {!collapsed && (<>
      <p>
      <em>To obtain the desired absolute frequencies when using MIDI output with MTS (MIDI Tuning) or MPE messages, keep the global tuning of receiving instruments at default value, A4 = 440 Hz. Setting the Reference Frequency and Assigned Scale Degree in PLAINSOUND HEXATONE will automatically transpose built-in and external sounds accordingly.</em>
      </p>
      <p>
      <em>
      Use the table below to edit the scale degrees, their note names, and colours. The icon to the left of the Degree display allows the pitch to be dynamically retuned, compared, saved, or reverted.</em>
      </p>
      <Colors {...props} />
      <KeyLabels {...props} />
      <br />
      <ScaleTable key={props.settings.scale?.length} {...props} importCount={props.importCount} />
      <br />
      </>)}
      {importing
       ?(<div style={collapsed ? { marginTop: '1rem' } : {}}>
          <ScalaImport {...props}
                      onImport={doImport}
                      onCancel={cancelImport}/>
        </div>)
        : (<>
          <button type="button" onClick={() => {
            const n = props.settings.equivSteps || 12;
            let equaveStr = (props.settings.scale && props.settings.scale[n - 1]) 
              ? props.settings.scale[n - 1] 
              : String(n * 100);
            
            let equaveCents;
            
            // Check for ratio format: m/n (e.g., "3/2")
            if (equaveStr.includes('/') && !equaveStr.includes('\\')) {
              const parts = equaveStr.split('/');
              const num = parseFloat(parts[0]);
              const den = parseFloat(parts[1]);
              equaveCents = 1200 * Math.log2(num / den);
            }
            // Check for EDO format: m\n (e.g., "3\2")
            else if (equaveStr.includes('\\')) {
              const parts = equaveStr.split('\\');
              const m = parseFloat(parts[0]);
              const n_edo = parseFloat(parts[1]);
              equaveCents = 1200 * m / n_edo;
            }
            // Check if it's only digits (no decimal) - treat as ratio like "3" meaning "3/1"
            else if (!equaveStr.includes('.') && /^[\d]+$/.test(equaveStr.trim())) {
              const num = parseFloat(equaveStr);
              equaveCents = 1200 * Math.log2(num / 1);
            }
            // Otherwise treat as cents (has decimal point)
            else {
              equaveCents = parseFloat(equaveStr);
            }
            
            // Handle NaN or invalid values
            if (isNaN(equaveCents)) {
              equaveCents = n * 100;
            }
            
            const step = equaveCents / n;
            const newScale = [];
            for (let i = 1; i <= n; i++) {
              newScale.push(String((i * step).toFixed(1)));
            }
            props.onChange('scale_divide', newScale);
          }} style={{ marginTop: '0.2rem', marginLeft: '0.2rem' }}>
            Divide Equave into {props.settings.equivSteps} Equal Parts
          </button>
          <button type="button" onClick={() => {
            const n = props.settings.equivSteps || 12;
            const step = 1200 / n;
            const newScale = [];
            for (let i = 1; i <= n; i++) {
              newScale.push(String((i * step).toFixed(1)));
            }
            props.onChange('scale_divide', newScale);
          }} style={{ marginTop: '0.2rem', marginLeft: '0.2rem' }}>
            Divide Octave into {props.settings.equivSteps} Equal Parts
          </button>
          <button type="button" onClick={startImporting}
            style={collapsed ? { marginTop: '1rem', marginLeft: '0.2rem' } : { marginTop: '1rem', marginLeft: '0.2rem' }}>
            Edit Scala File
          </button>
        </>)
      }
  </fieldset>
  );
};

Scale.propTypes = {
  onImport: PropTypes.func.isRequired,
  onChange: PropTypes.func.isRequired,
};

export default Scale;
