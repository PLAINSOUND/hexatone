import { h, createRef } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import PropTypes from 'prop-types';
import { fileToPreset, settingsToPresetJson } from './scale/parse-scale';
import { downloadLtn } from './scale/lumatone-export';

const STORAGE_KEY = 'hexatone_custom_presets';

const PRESET_FIELDS = [
  'name', 'description', 'short_description',
  'scale_import', 'scale', 'equivSteps', 'equivInterval',
  'note_names', 'note_colors', 'key_labels',
  'spectrum_colors', 'fundamental_color',
  'fundamental', 'reference_degree',
  'rSteps', 'drSteps', 'hexSize', 'rotation',
  'midiin_central_degree',
  'mpe_mode',
  'mpe_pitchbend_range',
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

const downloadFile = (content, filename, mimeType = 'application/json') => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const safeName = (name) =>
  (name || 'preset').replace(/[^a-zA-Z0-9_\-]/g, '_');

const CustomPresets = ({ settings, onLoad, onClear, isActive, activeSource, activePresetName, isPresetDirty, onRevert }) => {
  const [presets, setPresets] = useState(loadCustomPresets);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  // Only reveal the full UI once the user actively engages in this session —
  // not just because presets exist in localStorage from a previous session.
  const [expanded, setExpanded] = useState(() => loadCustomPresets().length > 0);
  const folderInputRef = createRef();

  // Reset selection only when switching away from a user preset to a built-in
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !isActive) setSelected('');
    if (isActive) setExpanded(true);
    wasActive.current = isActive;
  }, [isActive]);

  // Sync selected with activePresetName when restoring a user preset on reload
  useEffect(() => {
    if (isActive && activePresetName && !selected) {
      setSelected(activePresetName);
    }
  }, [isActive, activePresetName]);

  useEffect(() => {
    if (activeSource) setExpanded(true);
  }, [activeSource]);

  const handleSelect = (e) => {
    const val = e.target.value;
    setSelected(val);
    setExpanded(true);
    if (!val) return;
    const preset = presets.find(p => p.name === val);
    if (preset) onLoad(preset);
  };

  const tuningName = (settings.name || '').trim();
  const isExisting = presets.some(p => p.name === tuningName);

  const saveLabel = isExisting
    ? 'Save current settings and overwrite user preset'
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
    setExpanded(true);
    setError('');
    onLoad(preset); // marks this as the active source, resetting the built-in menu
  };

  const handleExport = () => {
    if (!tuningName) {
      setError('Please enter a name in the Name and Description section first.');
      return;
    }
    downloadFile(settingsToPresetJson(settings), `${safeName(tuningName)}.json`);
  };

  const handleExportLtn = () => {
    if (!tuningName) {
      setError('Please enter a name in the Name and Description section first.');
      return;
    }
    downloadLtn(settings, {}, `${safeName(tuningName)}.ltn`);
  };

  const handleDelete = () => {
    if (!selected) return;
    const next = presets.filter(p => p.name !== selected);
    saveCustomPresets(next);
    setPresets(next);
    setSelected('');
    setError('');
    if (onClear) onClear();
  };

  const handleClear = () => setConfirmClear(true);

  const handleClearConfirmed = () => {
    saveCustomPresets([]);
    setPresets([]);
    setSelected('');
    setError('');
    setConfirmClear(false);
    if (onClear) onClear();
  };

  // Folder import — reads all .scl, .ascl, .json files in the chosen folder
  const handleFolderChange = async (e) => {
    const files = Array.from(e.target.files).filter(f =>
      /\.(scl|ascl|json)$/i.test(f.name)
    );
    if (!files.length) {
      setError('No .scl, .ascl or .json files found in the chosen folder.');
      e.target.value = '';
      return;
    }

    // Read all files
    const results = await Promise.all(files.map(file =>
      new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve({ name: file.name, text: ev.target.result });
        reader.onerror = () => resolve(null);
        reader.readAsText(file);
      })
    ));

    const parsed = results
      .filter(Boolean)
      .map(({ name, text }) => fileToPreset(name, text))
      .filter(Boolean);

    if (!parsed.length) {
      setError('No valid tunings found in the chosen folder.');
      e.target.value = '';
      return;
    }

    // Handle duplicates within the imported files themselves - keep first occurrence only
    const seenNames = new Set();
    const uniqueParsed = [];
    for (const p of parsed) {
      if (!seenNames.has(p.name)) {
        seenNames.add(p.name);
        uniqueParsed.push(p);
      }
    }
    if (uniqueParsed.length < parsed.length) {
      console.log(`Skipped ${parsed.length - uniqueParsed.length} duplicate tuning(s) in folder`);
    }

    // Check for name clashes with existing presets
    const existing = loadCustomPresets();
    const clashes = uniqueParsed.filter(p => existing.some(e => e.name === p.name));

    if (clashes.length > 0) {
      const names = clashes.map(p => p.name).join(', ');
      const overwrite = window.confirm(
        `${clashes.length} tuning${clashes.length > 1 ? 's' : ''} already exist with the same name:\n\n${names}\n\nOverwrite?`
      );
      if (!overwrite) {
        // Skip clashing files, only add new ones
        const newOnly = uniqueParsed.filter(p => !existing.some(e => e.name === p.name));
        if (!newOnly.length) {
          setError('No new tunings to import.');
          e.target.value = '';
          return;
        }
        const next = [...existing, ...newOnly];
        saveCustomPresets(next);
        setPresets(next);
        setError('');
        e.target.value = '';
        return;
      }
    }

    // Merge: overwrite clashes, append new
    const next = [
      ...existing.map(ex => {
        const match = uniqueParsed.find(p => p.name === ex.name);
        return match || ex;
      }),
      ...uniqueParsed.filter(p => !existing.some(ex => ex.name === p.name)),
    ];
    saveCustomPresets(next);
    setPresets(next);
    setExpanded(true);
    setError('');
    e.target.value = '';
  };

  return (
    <fieldset>
      <legend><b>User Tunings</b></legend>

      {/* ── Selector row — only shown once there are saved presets ── */}
      {expanded && presets.length > 0 && (
        <label class="preset-selector-row">
          <select value={selected} onChange={handleSelect}>
            <option value="">Choose User Tuning:</option>
            {presets.map(p => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
          {isActive && onRevert && (
            <button type="button" onClick={onRevert}>Reload saved</button>
          )}
          <button type="button" class="delete-btn"
                  style={{ marginLeft: 'auto' }}
                  disabled={!selected}
                  onClick={handleDelete}>
            Delete
          </button>
        </label>
      )}

      {/* ── Choose folder — always visible ── */}
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory="true"
        multiple
        accept=".scl,.ascl,.json"
        style={{ display: 'none' }}
        onChange={handleFolderChange}
      />
      <div class="preset-actions">
        <button type="button"
                onClick={() => folderInputRef.current && folderInputRef.current.click()}>
          Choose folder…
        </button>
        {expanded && presets.length > 0 && (
          confirmClear ? (
            <span>
              <em>Clear all user tunings?&nbsp;</em>
              <button type="button" class="delete-btn" onClick={handleClearConfirmed}>Yes, clear</button>
              &nbsp;
              <button type="button" onClick={() => setConfirmClear(false)}>Cancel</button>
            </span>
          ) : (
            <button type="button" class="delete-btn" onClick={handleClear}>
              Clear all
            </button>
          )
        )}
      </div>

      {/* ── Save / Export — show when a preset is active ── */}
      {activeSource && (
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button type="button" onClick={handleSave}>
            {saveLabel}
          </button>
          <span style={{ display: 'flex', gap: '6px' }}>
            <button type="button" onClick={handleExport}>
              Export .json
            </button>
            <button type="button" onClick={handleExportLtn}>
              Export .ltn
            </button>
          </span>
        </label>
      )}

      {error && <p class="preset-error">{error}</p>}
    </fieldset>
  );
};

CustomPresets.propTypes = {
  settings: PropTypes.object.isRequired,
  onLoad: PropTypes.func.isRequired,
  isActive: PropTypes.bool,
  activeSource: PropTypes.string,
  activePresetName: PropTypes.string,
  isPresetDirty: PropTypes.bool,
  onRevert: PropTypes.func,
};

export default CustomPresets;