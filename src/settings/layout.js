import { h } from 'preact';
import { useState } from 'preact/hooks';
import PropTypes from 'prop-types';

const Layout = (props) => {
  const [collapsed, setCollapsed] = useState(() => sessionStorage.getItem('hexatone_layout_collapsed') === 'true');
  const maxDegree = (props.settings.equivSteps || 1) - 1;

  const handleToggle = (c) => {
    sessionStorage.setItem('hexatone_layout_collapsed', c);
    setCollapsed(c);
  };

  return (
  <fieldset>
    <legend>
      <b>Hexatone Layout</b>
      <button
        type="button"
        onClick={() => handleToggle(!collapsed)}
        title={collapsed ? 'Toggle to show Hexatone Layout settings' : 'Toggle to hide Hexatone Layout settings'}
        style={{ marginLeft: '0.6em', padding: '0 0.4em', fontSize: '0.8em',
                 lineHeight: '1.4', verticalAlign: 'middle', cursor: 'pointer' }}
      >{collapsed ? '▶' : '▼'}</button>
    </legend>
    <label class="center-degree-row center-degree-label">
      Central Scale Degree
      <input name="center_degree" type="text" inputMode="numeric"
             class="sidebar-input"
             key={`${props.settings.center_degree}-${maxDegree}`}
             defaultValue={props.settings.center_degree || 0}
             step="1" min="0" max={maxDegree}
             onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
             onBlur={(e) => {
               const val = parseInt(e.target.value);
               if (!isNaN(val) && val >= 0 && val <= maxDegree) {
                 props.onChange('center_degree', val);
               } else {
                 e.target.value = props.settings.center_degree || 0;
               }
             }}
      />
    </label>
    {collapsed ? null : (
    <>
    <label>
      Right-Facing Steps
      <input name="rSteps" type="text" inputMode="numeric"
             class="sidebar-input"
             key={props.settings.rSteps}
             defaultValue={props.settings.rSteps}
             min="-1220" max="1220"
             onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
             onBlur={(e) => {
               const val = parseInt(e.target.value);
               if (!isNaN(val) && val >= -1220 && val <= 1220) {
                 props.onChange('rSteps', val);
               } else {
                 e.target.value = props.settings.rSteps;
               }
             }}
      />
    </label>
    <label>
      Right-Downward Steps
      <input name="drSteps" type="text" inputMode="numeric"
             class="sidebar-input"
             key={props.settings.drSteps}
             defaultValue={props.settings.drSteps}
             min="-1220" max="1220"
             onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
             onBlur={(e) => {
               const val = parseInt(e.target.value);
               if (!isNaN(val) && val >= -1220 && val <= 1220) {
                 props.onChange('drSteps', val);
               } else {
                 e.target.value = props.settings.drSteps;
               }
             }}
      />
    </label>
    <label>
      Hex Size
      <input name="hexSize" type="text" inputMode="numeric"
             class="sidebar-input"
             key={props.settings.hexSize}
             defaultValue={props.settings.hexSize}
             min="20" max="1000"
             onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
             onBlur={(e) => {
               const val = parseInt(e.target.value);
               if (!isNaN(val) && val >= 20 && val <= 1000) {
                 props.onChange('hexSize', val);
               } else {
                 e.target.value = props.settings.hexSize;
               }
             }}
      />
    </label>
    <label>
      Rotation Clockwise
      <input name="rotation" type="text" inputMode="decimal"
             class="sidebar-input"
             key={props.settings.rotation}
             defaultValue={props.settings.rotation}
             min="-360" max="360"
             onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
             onBlur={(e) => {
               const val = parseFloat(e.target.value);
               if (!isNaN(val) && val >= -360 && val <= 360) {
                 props.onChange('rotation', val);
               } else {
                 e.target.value = props.settings.rotation;
               }
              }}
      />
    </label>
    </>
    )}
  </fieldset>
  );
};

Layout.propTypes = {
  onChange: PropTypes.func.isRequired,
  settings: PropTypes.shape({
    rotation: PropTypes.number,
    hexSize: PropTypes.number,
    drSteps: PropTypes.number,
    rSteps: PropTypes.number,
    center_degree: PropTypes.number,
    equivSteps: PropTypes.number,
  }),
};

export default Layout;
