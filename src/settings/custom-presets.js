import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import PropTypes from 'prop-types';

const STORAGE_KEY = 'hexatone_custom_presets';

const PRESET_FIELDS = [
  'name', 'description', 'short_description',
  'scale_import', 'scale', 'equivSteps', 'equivInterval',
  'note_names', 'note_colors', 'key_labels',
  'spectrum_colors', 'fundamental_color',
  'fundamental', 'reference_degree',
  'rSteps', 'urSteps', 'hexSize', 'rotation',
  'midiin_degree0',
];

export const loadCustomPresets = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveCustomPresets = (presets) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
};

const CustomPresets = ({ settings, onLoad }) => {
  const [presets, setPresets] = useState(loadCustomPresets);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');

  const handleSelect = (e) => {
    const val = e.target.value;
    setSelected(val);
    if (!val) return;
    const preset = presets.find(p => p.name === val);
    if (preset) onLoad(preset);
  };

  const tuningName = (settings.name || '').trim();
  const isExisting = presets.some(p => p.name === tuningName);

  const saveLabel = !tuningName
    ? 'Save current settings'
    : isExisting
      ? 'Save current settings and overwrite existing user preset'
      : 'Save current settings';

  const handleSave = () => {
    if (!tuningName) {
      setError('Please enter a name in the Name and Description section first.');
      return;
    }
    const preset = { name: tuningName };
    for (const key of PRESET_FIELDS) {
      if (settings[key] !== undefined) preset[key] = settings[key];
    }
    const next = isExisting
      ? presets.map(p => p.name === tuningName ? preset : p)
      : [...presets, preset];
    saveCustomPresets(next);
    setPresets(next);
    setSelected(tuningName);
    setError('');
  };

  const handleDelete = () => {
    if (!selected) return;
    const next = presets.filter(p => p.name !== selected);
    saveCustomPresets(next);
    setPresets(next);
    setSelected('');
    setError('');
  };

  return (
    <fieldset>
      <legend><b>User Tunings</b></legend>
      <label>
        <select value={selected} onChange={handleSelect}>
          <option value="">
            {presets.length === 0 ? 'No user tunings saved yet' : 'Choose User Tuning:'}
          </option>
          {presets.map(p => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </select>
        {presets.length > 0 && (
          <button type="button" class="delete-btn"
                  disabled={!selected}
                  onClick={handleDelete}>
            Delete
          </button>
        )}
      </label>
      <label>
        <button type="button" onClick={handleSave}>
          {saveLabel}
        </button>
      </label>
      {error && <p class="preset-error">{error}</p>}
    </fieldset>
  );
};

CustomPresets.propTypes = {
  settings: PropTypes.object.isRequired,
  onLoad: PropTypes.func.isRequired,
};

export default CustomPresets;