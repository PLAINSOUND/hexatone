import { h } from 'preact';
import PropTypes from 'prop-types';

const Presets = (props) => (
  <select onChange={props.onChange} name="presets" value={props.isActive ? undefined : ''}>
    <option value="">Choose a built-in tuning:</option>
    {props.presets.map(group => (
      <optgroup label={group.name}>
        {group.settings.map(setting => (
          <option value={setting.name}>{setting.name}</option>
        ))}
      </optgroup>
    ))}
  </select>
);

Presets.propTypes = {
  onChange: PropTypes.func.isRequired,
  isActive: PropTypes.bool,
  presets: PropTypes.arrayOf(PropTypes.shape({
    name: PropTypes.string.isRequired,
    settings: PropTypes.arrayOf(PropTypes.shape({
      name: PropTypes.string.isRequired,
    })),
  })).isRequired,
};

export default Presets;