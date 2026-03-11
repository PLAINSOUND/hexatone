import { h } from 'preact';
import PropTypes from 'prop-types';

const Layout = (props) => {
  const maxDegree = (props.settings.equivSteps || 1) - 1;
  return (
  <fieldset>
    <legend><b>Layout</b></legend>
    <label>
      Right-Facing Steps
      <input name="rSteps" type="text" inputMode="numeric"
             class="sidebar-input"
             key={props.settings.rSteps}
             defaultValue={props.settings.rSteps}
             min="-1220" max="1220"
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
      Central Scale Degree
      <input name="center_degree" type="text" inputMode="numeric"
             class="sidebar-input"
             key={`${props.settings.center_degree}-${maxDegree}`}
             defaultValue={props.settings.center_degree || 0}
             step="1" min="0" max={maxDegree}
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
    <label>
      Hex Size (pixels)
      <input name="hexSize" type="text" inputMode="numeric"
             class="sidebar-input"
             key={props.settings.hexSize}
             defaultValue={props.settings.hexSize}
             min="20" max="1000"
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
      Rotation Clockwise (°)
      <input name="rotation" type="text" inputMode="decimal"
             class="sidebar-input"
             key={props.settings.rotation}
             defaultValue={props.settings.rotation}
             min="-360" max="360"
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
