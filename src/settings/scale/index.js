import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { Fragment } from 'preact/compat';
import PropTypes from 'prop-types';
import Colors, { colorProp } from './colors';
import KeyLabels from './key-labels';
import ScaleTable from './scale-table';
import ScalaImport from './scala-import';
import { settingsToHexatonScala, scalaToCents } from './parse-scale';

const Scale = (props) => {
  const [importing, setImporting] = useState(false);
  const [collapsed, setCollapsed] = useState(() => sessionStorage.getItem('hexatone_scale_collapsed') === 'true');

  // Local state for Reference Frequency input - syncs with props when changed from outside (TuneCell)
  const [fundamentalDisplay, setFundamentalDisplay] = useState(String(props.settings.fundamental ?? ''));

  // Sync display when props change from outside (e.g., TuneCell retuning recalculates fundamental)
  useEffect(() => {
    setFundamentalDisplay(String(props.settings.fundamental ?? ''));
  }, [props.settings.fundamental]);

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

  // Get current equave value from scale array
  const scale = props.settings.scale || [];
  const equaveValue = scale.length > 0 ? scale[scale.length - 1] : String((props.settings.equivSteps || 12) * 100);

  // Handle equave change - update the last element of scale array
  const handleEquaveChange = (e) => {
    const next = [...scale];
    if (next.length > 0) {
      next[next.length - 1] = e.target.value;
      props.onChange('scale', next);
    }
  };

  return (
    <fieldset>
      <legend>
        <b>Scale</b>
        <button
          type="button"
          onClick={() => handleToggle(!collapsed)}
          title={collapsed ? 'Expand scale settings' : 'Collapse scale settings'}
          style={{
            marginLeft: '0.6em', padding: '0 0.4em', fontSize: '0.8em',
            lineHeight: '1.4', verticalAlign: 'middle', cursor: 'pointer'
          }}
        >{collapsed ? '▶' : '▼'}</button>
      </legend>
      <label>
        Reference Frequency (Hz)
        <input name="fundamental" type="text" inputMode="decimal"
          class="sidebar-input"
          value={fundamentalDisplay}
          onInput={(e) => setFundamentalDisplay(e.target.value)}
          onBlur={(e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val) && val >= 0.015625 && val <= 16384) {
              props.onChange('fundamental', val);
            } else {
              // Revert to current valid value
              setFundamentalDisplay(String(props.settings.fundamental ?? ''));
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
        Scale Degree Retuning
        <select name="retuning_mode" class="sidebar-input"
          value={props.settings.retuning_mode || 'recalculate_reference'}
          onChange={(e) => props.onChange('retuning_mode', e.target.value)}>
          <option value="recalculate_reference">Auto-Recalculate Reference</option>
          <option value="transpose_scale">Preserve Reference and Transpose Scale</option>
        </select>
      </label>
      {!collapsed && (<>

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
        <label>
          Equave
          <input name="equave" type="text"
            class="sidebar-input"
            key={equaveValue}
            defaultValue={equaveValue}
            onBlur={handleEquaveChange}
          />
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', paddingTop: '0.5rem', marginBottom: '0.5rem' }}>
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
          }}>
            Divide Equave into {props.settings.equivSteps} Equal Divisions
          </button>
          <button type="button" onClick={() => {
            const n = props.settings.equivSteps || 12;
            const step = 1200 / n;
            const newScale = [];
            for (let i = 1; i <= n; i++) {
              newScale.push(String((i * step).toFixed(1)));
            }
            props.onChange('scale_divide', newScale);
          }}>
            Divide Octave into {props.settings.equivSteps} Equal Divisions
          </button>
        </div>
        <Colors {...props} />
        <KeyLabels {...props} />
        <br />
        <ScaleTable key={props.settings.scale?.length} {...props} importCount={props.importCount} />
        <br />
      </>)}
      {importing
        ? (<div>
          <ScalaImport {...props}
            onImport={doImport}
            onCancel={cancelImport} />
        </div>)
        : (<>
          <button type="button" onClick={startImporting}
            style={{ marginTop: '0.5rem', marginLeft: '0rem' }}>
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