import { h } from 'preact';
import PropTypes from 'prop-types';

const Layout = (props) => (
  <fieldset>
    <legend><b>Layout</b></legend>
    <label>
      Right-Facing Steps
      <input name="rSteps" type="text" inputMode="numeric"
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
      Right-Downward-Facing Steps
      <input name="urSteps" type="text" inputMode="numeric"
             key={props.settings.urSteps}
             defaultValue={props.settings.urSteps}
             min="-1220" max="1220"
             onBlur={(e) => {
               const val = parseInt(e.target.value);
               if (!isNaN(val) && val >= -1220 && val <= 1220) {
                 props.onChange('urSteps', val);
               } else {
                 e.target.value = props.settings.urSteps;
               }
             }}
      />
    </label>
    <label>
      Hex Size (pixels)
      <input name="hexSize" type="text" inputMode="numeric"
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
      Rotation (degrees clockwise)
      <input name="rotation" type="text" inputMode="decimal"
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

Layout.propTypes = {
  onChange: PropTypes.func.isRequired,
  settings: PropTypes.shape({
    rotation: PropTypes.number,
    hexSize: PropTypes.number,
    urSteps: PropTypes.number,
    rSteps: PropTypes.number,
  }),
};

export default Layout;
