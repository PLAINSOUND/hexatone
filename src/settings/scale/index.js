import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { Fragment } from 'preact/compat';
import PropTypes from 'prop-types';
import Colors, { colorProp } from './colors';
import KeyLabels from './key-labels';
import ScaleTable from './scale-table';
import ScalaImport from './scala-import';
import { settingsToHexatonScala, parseScalaInterval } from './parse-scale';
import ScalaInput from './scala-input.js';

/**
 * Inline drag-to-tune handle for the Reference Frequency.
 * Drag shifts all sounding notes by the delta in cents.
 * On save: newFundamental = fundamental * 2^(delta/1200). Scale unchanged.
 */
const FundamentalTuneCell = ({ fundamental, keysRef, onChange, setTuneDragging }) => {
  const [deltaCents, setDeltaCents] = useState(null); // null = no drag in progress
  const [comparing, setComparing] = useState(false);
  const dragStart = useRef(null);
  const dragKeysInstance = useRef(null);

  useEffect(() => () => {
    if (dragKeysInstance.current?.setTuneDragging)
      dragKeysInstance.current.setTuneDragging(false);
  }, []);

  const isDirty = deltaCents !== null && Math.abs(deltaCents) > 0.001;
  const delta = isDirty ? deltaCents : 0;
  const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}¢` : `${delta.toFixed(1)}¢`;

  const onCompare = useCallback(() => {
    const next = !comparing;
    setComparing(next);
    if (keysRef?.current?.previewFundamental)
      keysRef.current.previewFundamental(next ? 0 : deltaCents);
  }, [comparing, deltaCents, keysRef]);

  const onPointerDown = useCallback((e) => {
    if (keysRef?.current?.setTuneDragging) {
      keysRef.current.setTuneDragging(true);
      dragKeysInstance.current = keysRef.current;
    }
    // Snapshot base pitch of all sounding notes before drag begins
    if (keysRef?.current?.snapshotForFundamentalPreview)
      keysRef.current.snapshotForFundamentalPreview();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragStart.current = { lastX: e.clientX, acc: 0 };
  }, [keysRef]);

  const onPointerMove = useCallback((e) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.lastX;
    if (dx === 0) return;
    const speed = Math.abs(dx);
    const sensitivity = 0.05 * Math.pow(speed, 1.5);
    const newDelta = dragStart.current.acc + Math.sign(dx) * sensitivity;
    dragStart.current.lastX = e.clientX;
    dragStart.current.acc = newDelta;
    setDeltaCents(newDelta);
    if (keysRef?.current?.previewFundamental)
      keysRef.current.previewFundamental(newDelta);
  }, [keysRef]);

  const onPointerUp = useCallback(() => {
    dragStart.current = null;
    if (dragKeysInstance.current?.setTuneDragging) {
      dragKeysInstance.current.setTuneDragging(false);
      if (dragKeysInstance.current.state?.escHeld)
        dragKeysInstance.current.sustainOn();
    }
  }, []);

  const onSave = useCallback(() => {
    const newFundamental = fundamental * Math.pow(2, deltaCents / 1200);
    onChange('fundamental', newFundamental);
    // Restore notes to their scale-derived pitch — Keys rebuild will use new fundamental.
    // clearSnapshot=true ends the drag session; updateFundamental in keys.js also clears it.
    if (keysRef?.current?.previewFundamental)
      keysRef.current.previewFundamental(0, true);
    setDeltaCents(null);
    setComparing(false);
  }, [deltaCents, fundamental, onChange, keysRef]);

  const onRevert = useCallback(() => {
    // clearSnapshot=true ends the drag session so the snapshot is not reused.
    if (keysRef?.current?.previewFundamental)
      keysRef.current.previewFundamental(0, true);
    setDeltaCents(null);
    setComparing(false);
  }, [keysRef]);

  return (
    <div class="tune-cell--inline">
      {isDirty && (
        <span class={`tune-delta${comparing ? ' tune-comparing' : ''}`}>
          {comparing ? 'orig' : deltaStr}
        </span>
      )}
      {isDirty && <button type="button" class={`tune-btn${comparing ? ' tune-btn--active' : ''}`}
        onClick={onCompare} title="A/B compare with original"><span class="tune-btn-compare" style={{ display: 'block', marginTop: '-4px' }}>↺</span></button>}
      {isDirty && <button type="button" class="tune-btn tune-btn--save"
        onClick={onSave} title="Save new Reference Frequency">✓</button>}
      {isDirty && <button type="button" class="tune-btn tune-btn--revert"
        onClick={onRevert} title="Revert">✕</button>}
      <span
        class="tune-handle"
        title="Drag to adjust Reference Frequency — slow for fine, fast for coarse"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ paddingBottom: '6px' }}
      >⟺</span>
    </div>
  );
};

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
  const equaveValue = scale.length > 0 ? scale[scale.length - 1] : "2/1";

  // Handle equave change - update the last element of scale array
  const handleEquaveChange = (str) => {
    const next = [...scale];
    if (next.length > 0) {
      next[next.length - 1] = str;
      props.onChange('scale', next);
    }
  };

  return (
    <fieldset>
      <legend>
        <b>Scale Settings</b>
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
        <span class="fundamental-right">
          <input name="fundamental" type="text" inputMode="decimal"
            value={fundamentalDisplay}
            onInput={(e) => setFundamentalDisplay(e.target.value)}
            onBlur={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val) && val >= 0.015625 && val <= 16384) {
                props.onChange('fundamental', val);
              } else {
                setFundamentalDisplay(String(props.settings.fundamental ?? ''));
              }
            }}
          />
          <FundamentalTuneCell
            fundamental={props.settings.fundamental}
            keysRef={props.keysRef}
            onChange={props.onChange}
          />
        </span>
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
      {!collapsed && (
        <>
          <label>
            Equave
            <ScalaInput
              context="interval"
              value={equaveValue}
              onChange={handleEquaveChange}
              style={{ width: '4em', textAlign: 'center', height: '1.5em', boxSizing: 'border-box', background: '#faf9f8', borderRadius: '3px' }}
              wrapperClass="sidebar-input"
            />
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', paddingTop: '0.5rem', marginBottom: '0.5rem' }}>
            <button type="button" onClick={() => {
              const n = props.settings.equivSteps || 12;
              const equaveStr = (props.settings.scale && props.settings.scale[n - 1])
                ? props.settings.scale[n - 1]
                : "2/1";

              const { cents: parsed, valid } = parseScalaInterval(equaveStr, 'interval');
              const equaveCents = valid ? parsed : n * 100;

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
