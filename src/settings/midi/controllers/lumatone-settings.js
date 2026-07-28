import PropTypes from "prop-types";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import OutputPortPicker from "../output-port-picker.js";
import {
  exportableLumatoneColorFilterLibrary,
  formatLumatoneDegreeFilter,
  importLumatoneColorFilterLibrary,
  LUMATONE_COLOR_FILTER_ALL,
  LUMATONE_COLOR_FILTER_DARK,
  LUMATONE_COLOR_FILTER_CUSTOM,
  LUMATONE_COLOR_FILTER_SELECTED_KEY,
  parseLumatoneDegreeFilter,
  readLumatoneColorFilterLibrary,
  writeLumatoneColorFilterLibrary,
} from "../../../controllers/lumatone-color-filters.js";
import { deriveSnapshotFilterEntries } from "../../../sequencer/snapshot-filter-library.js";

function pushFilterSettingsToKeys(keysRef, nextMode, nextFilter, shouldSync = true) {
  const keys = keysRef?.current;
  if (!keys?.settings) return;
  keys.settings.lumatone_degree_filter_mode = nextMode;
  keys.settings.lumatone_degree_filter = nextFilter;
  if (shouldSync && keys.settings.lumatone_led_sync) keys.syncLumatoneLEDs?.();
}

function persistLumatoneFilterSettings(saveControllerPref, mode, filter) {
  saveControllerPref?.(null, "lumatone_degree_filter_mode", mode);
  saveControllerPref?.(null, "lumatone_degree_filter", filter);
}

const LumatoneSettings = ({
  settings,
  snapshots,
  tuningRuntime,
  rawPorts,
  midiOutputs,
  keysRef,
  hasSysexMidi,
  onChange,
  onEnableLumatoneAutoSync,
  saveControllerPref,
}) => {
  const fileInputRef = useRef(null);
  const [savedFilters, setSavedFilters] = useState(() => readLumatoneColorFilterLibrary());
  const [selectedSavedName, setSelectedSavedName] = useState(
    () => localStorage.getItem(LUMATONE_COLOR_FILTER_SELECTED_KEY) || LUMATONE_COLOR_FILTER_ALL,
  );
  const [draftFilter, setDraftFilter] = useState(settings.lumatone_degree_filter ?? "");
  const [filterError, setFilterError] = useState("");

  useEffect(() => {
    setDraftFilter(settings.lumatone_degree_filter ?? "");
  }, [settings.lumatone_degree_filter]);

  useEffect(() => {
    localStorage.setItem(LUMATONE_COLOR_FILTER_SELECTED_KEY, selectedSavedName);
  }, [selectedSavedName]);

  const selectedSavedFilter = useMemo(
    () => savedFilters.find((entry) => entry.name === selectedSavedName) ?? null,
    [savedFilters, selectedSavedName],
  );
  const selectedSavedIndex = useMemo(
    () => savedFilters.findIndex((entry) => entry.name === selectedSavedName),
    [savedFilters, selectedSavedName],
  );
  const activeFilter = settings.lumatone_degree_filter ?? "";
  const filterActive = settings.lumatone_degree_filter_mode === "filter";
  const showSnapshotFilters = !!settings.lumatone_degree_filter_snapshots;
  const filterRuntime = useMemo(
    () => ({
      ...(tuningRuntime ?? {
        scale: settings.scale,
        equivInterval: settings.equivInterval,
      }),
      referenceDegree: settings.reference_degree,
      fundamental: settings.fundamental,
    }),
    [
      settings.equivInterval,
      settings.fundamental,
      settings.reference_degree,
      settings.scale,
      tuningRuntime,
    ],
  );
  const snapshotFilters = useMemo(() => !showSnapshotFilters ? [] : deriveSnapshotFilterEntries(
    snapshots,
    filterRuntime,
  ).map((entry) => ({
    ...entry,
    filter: formatLumatoneDegreeFilter(entry.degrees),
  })), [
    filterRuntime,
    showSnapshotFilters,
    snapshots,
  ]);
  const matchingGeneratedFilter = useMemo(
    () => snapshotFilters.find((entry) => entry.filter === activeFilter) ?? null,
    [activeFilter, snapshotFilters],
  );
  const matchingSavedFilter = useMemo(
    () => savedFilters.find((entry) => entry.filter === activeFilter) ?? null,
    [activeFilter, savedFilters],
  );
  const selectedGeneratedFilter = useMemo(
    () => snapshotFilters.find((entry) => entry.name === selectedSavedName) ?? null,
    [selectedSavedName, snapshotFilters],
  );
  const selectedValue = settings.lumatone_degree_filter_mode === LUMATONE_COLOR_FILTER_DARK
    ? LUMATONE_COLOR_FILTER_DARK
    : filterActive
    ? (matchingGeneratedFilter?.id ?? matchingSavedFilter?.name ?? LUMATONE_COLOR_FILTER_CUSTOM)
    : LUMATONE_COLOR_FILTER_ALL;

  const applyFilter = (rawFilter, nextSavedName = selectedSavedName, shouldSync = true) => {
    const parsed = parseLumatoneDegreeFilter(rawFilter);
    if (!parsed) {
      setFilterError("Scale-degree filter must use non-negative integers separated by commas.");
      return false;
    }
    const normalizedFilter = formatLumatoneDegreeFilter(parsed);
    setFilterError("");
    setDraftFilter(normalizedFilter);
    onChange("lumatone_degree_filter_mode", "filter");
    onChange("lumatone_degree_filter", normalizedFilter);
    persistLumatoneFilterSettings(saveControllerPref, "filter", normalizedFilter);
    pushFilterSettingsToKeys(keysRef, "filter", normalizedFilter, shouldSync);
    setSelectedSavedName(nextSavedName);
    return true;
  };

  useEffect(() => {
    if (!filterActive || !selectedGeneratedFilter) return;
    if (selectedGeneratedFilter.filter === activeFilter) return;
    setDraftFilter(selectedGeneratedFilter.filter);
    onChange("lumatone_degree_filter_mode", "filter");
    onChange("lumatone_degree_filter", selectedGeneratedFilter.filter);
    persistLumatoneFilterSettings(saveControllerPref, "filter", selectedGeneratedFilter.filter);
    pushFilterSettingsToKeys(keysRef, "filter", selectedGeneratedFilter.filter, true);
  }, [activeFilter, filterActive, keysRef, onChange, saveControllerPref, selectedGeneratedFilter]);

  const selectAllDegrees = () => {
    setFilterError("");
    setDraftFilter("");
    onChange("lumatone_degree_filter_mode", "all");
    onChange("lumatone_degree_filter", "");
    persistLumatoneFilterSettings(saveControllerPref, "all", "");
    pushFilterSettingsToKeys(keysRef, "all", "", true);
    setSelectedSavedName(LUMATONE_COLOR_FILTER_ALL);
  };

  const selectAllKeysDark = () => {
    setFilterError("");
    setDraftFilter("");
    onChange("lumatone_degree_filter_mode", LUMATONE_COLOR_FILTER_DARK);
    onChange("lumatone_degree_filter", "");
    persistLumatoneFilterSettings(saveControllerPref, LUMATONE_COLOR_FILTER_DARK, "");
    pushFilterSettingsToKeys(keysRef, LUMATONE_COLOR_FILTER_DARK, "", true);
    setSelectedSavedName(LUMATONE_COLOR_FILTER_DARK);
  };

  const handleSelectFilter = (e) => {
    const value = e.target.value;
    if (value === LUMATONE_COLOR_FILTER_ALL) {
      selectAllDegrees();
      return;
    }
    if (value === LUMATONE_COLOR_FILTER_DARK) {
      selectAllKeysDark();
      return;
    }
    if (value === LUMATONE_COLOR_FILTER_CUSTOM) return;
    const entry = snapshotFilters.find((filter) => filter.id === value)
      ?? savedFilters.find((filter) => filter.name === value);
    if (!entry) return;
    setSelectedSavedName(entry.name);
    applyFilter(entry.filter, entry.name, true);
  };

  const handleReloadSaved = () => {
    if (!selectedSavedFilter) return;
    applyFilter(selectedSavedFilter.filter, selectedSavedFilter.name, true);
  };

  const handleSaveFilter = () => {
    const parsed = parseLumatoneDegreeFilter(draftFilter);
    if (!parsed) {
      setFilterError("Scale-degree filter must use non-negative integers separated by commas.");
      return;
    }
    const normalizedFilter = formatLumatoneDegreeFilter(parsed);
    const suggestedName = selectedSavedFilter?.name ?? "";
    const nextName = window.prompt(
      "Save Lumatone colour filter as:",
      suggestedName,
    );
    if (nextName == null) return;
    const trimmedName = nextName.trim();
    if (!trimmedName) return;
    const nextLibrary = [
      ...savedFilters.filter((entry) => entry.name !== trimmedName),
      { name: trimmedName, filter: normalizedFilter },
    ];
    writeLumatoneColorFilterLibrary(nextLibrary);
    setSavedFilters(nextLibrary);
    setSelectedSavedName(trimmedName);
    applyFilter(normalizedFilter, trimmedName, false);
  };

  const moveSelectedFilter = (direction) => {
    if (!selectedSavedFilter || selectedSavedIndex < 0) return;
    const targetIndex = selectedSavedIndex + direction;
    if (targetIndex < 0 || targetIndex >= savedFilters.length) return;
    const nextLibrary = [...savedFilters];
    const [moved] = nextLibrary.splice(selectedSavedIndex, 1);
    nextLibrary.splice(targetIndex, 0, moved);
    writeLumatoneColorFilterLibrary(nextLibrary);
    setSavedFilters(nextLibrary);
    setSelectedSavedName(moved.name);
  };

  const handleDeleteFilter = () => {
    if (!selectedSavedFilter) return;
    const nextLibrary = savedFilters.filter((entry) => entry.name !== selectedSavedFilter.name);
    writeLumatoneColorFilterLibrary(nextLibrary);
    setSavedFilters(nextLibrary);
    selectAllDegrees();
  };

  const handleClearAllFilters = () => {
    writeLumatoneColorFilterLibrary([]);
    setSavedFilters([]);
    selectAllDegrees();
  };

  const handleOpenFilterFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = importLumatoneColorFilterLibrary(JSON.parse(await file.text()));
      writeLumatoneColorFilterLibrary(parsed);
      setSavedFilters(parsed);
      setFilterError("");
    } catch {
      setFilterError("No valid Lumatone colour filters found in the chosen file.");
    } finally {
      e.target.value = "";
    }
  };

  const handleWriteFilterFile = () => {
    const exportFilters = [
      ...savedFilters,
      ...snapshotFilters.map((entry) => ({ name: entry.name, filter: entry.filter })),
    ];
    const blob = new Blob(
      [JSON.stringify(exportableLumatoneColorFilterLibrary(exportFilters), null, 2)],
      { type: "application/json" },
    );
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "lumatone-colour-filters.json";
    link.click();
    URL.revokeObjectURL(href);
  };

  const handleSendBypassLayout = () => {
    const result = keysRef?.current?.sendLumatoneBypassLayout?.();
    if (!result) return;
    const { exactCount, disabledCount, totalCount } = result;
    window.alert(
      `Sent Lumatone 2D bypass layout.\n\nExact keys: ${exactCount}/${totalCount}\nDisabled dark keys: ${disabledCount}/${totalCount}`,
    );
  };

  return (
    <>
      <OutputPortPicker
        label="LED Output (SysEx)"
        rawPorts={rawPorts}
        outputs={midiOutputs}
        overridePortId={settings.lumatone_out_port ?? null}
        onChange={(id) => {
          onChange("lumatone_out_port", id);
          sessionStorage.setItem("lumatone_out_port", id ?? "");
        }}
      />
      {rawPorts && settings.midi_passthrough && (
        <label>
          2D Bypass Key Layout
          <span class="settings-form__control-row settings-form__control-row--inline">
            <button
              type="button"
              class="preset-action-btn"
              disabled={!hasSysexMidi}
              title="Send a best-effort sequential Lumatone layout matching the current 2D geometry"
              onClick={handleSendBypassLayout}
            >
              Send Layout and Colours
            </button>
          </span>
        </label>
      )}
      {!settings.midi_passthrough && (
        <>
          {rawPorts && (
            <label>
              2D Key Layout (Notes 0-55 on Ch 1-5)
              <span class="settings-form__control-row settings-form__control-row--inline">
                <button
                  type="button"
                  class="preset-action-btn"
                  disabled={!hasSysexMidi}
                  title="Send notes + blank layout to Lumatone via sysex (~10-15 s, one-time setup)"
                  onClick={() => keysRef?.current?.sendLumatoneLayout?.()}
                >
                  Send Blank Layout
                </button>
              </span>
            </label>
          )}
          {rawPorts && (
            <label>
              Automatically Send LED Colours
              <span class="settings-form__control-row settings-form__control-row--inline">
                <input
                  name="lumatone_led_sync"
                  type="checkbox"
                  checked={!!settings.lumatone_led_sync}
                  disabled={!hasSysexMidi}
                  onChange={(e) => {
                    onChange("lumatone_led_sync", e.target.checked);
                    localStorage.setItem("lumatone_led_sync", e.target.checked);
                    const keys = keysRef?.current;
                    if (keys) keys.settings.lumatone_led_sync = e.target.checked;
                    if (e.target.checked) onEnableLumatoneAutoSync?.();
                  }}
                />
                <button
                  type="button"
                  class="preset-action-btn"
                  disabled={!hasSysexMidi}
                  onClick={() => keysRef?.current?.syncLumatoneLEDs?.()}
                >
                  Send Colours
                </button>
              </span>
            </label>
          )}
          {rawPorts && (
            <>
              <label>
                Lumatone Colour Filter
                <span class="sidebar-input lumatone-filter-selector">
                  {selectedSavedFilter && (
                    <button
                      type="button"
                      class="preset-refresh-btn"
                      title="Reload saved filter"
                      aria-label="Reload saved filter"
                      onClick={handleReloadSaved}
                    >
                      <span class="preset-refresh-glyph">⟳</span>
                    </button>
                  )}
                  <select
                    aria-label="Lumatone Colour Filter"
                    value={selectedValue}
                    onChange={handleSelectFilter}
                  >
                    <option value={LUMATONE_COLOR_FILTER_ALL}>All Degrees</option>
                    <option value={LUMATONE_COLOR_FILTER_DARK}>All Keys Dark</option>
                    {snapshotFilters.length > 0 && (
                      <option value="__snapshot_separator__" disabled>──────── Snapshots ────────</option>
                    )}
                    {snapshotFilters.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                    {savedFilters.length > 0 && (
                      <option value="__separator__" disabled>──────── User Filters ────────</option>
                    )}
                    {filterActive && selectedValue === LUMATONE_COLOR_FILTER_CUSTOM && (
                      <option value={LUMATONE_COLOR_FILTER_CUSTOM}>Current Custom Filter</option>
                    )}
                    {savedFilters.map((entry) => (
                      <option key={entry.name} value={entry.name}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                  {selectedSavedFilter && (
                    <span class="lumatone-filter-move-group">
                      <button
                        type="button"
                        class="preset-refresh-btn lumatone-filter-move-btn"
                        title="Move filter up"
                        aria-label="Move filter up"
                        disabled={selectedSavedIndex <= 0}
                        onClick={() => moveSelectedFilter(-1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        class="preset-refresh-btn lumatone-filter-move-btn"
                        title="Move filter down"
                        aria-label="Move filter down"
                        disabled={selectedSavedIndex < 0 || selectedSavedIndex >= savedFilters.length - 1}
                        onClick={() => moveSelectedFilter(1)}
                      >
                        ↓
                      </button>
                    </span>
                  )}
                </span>
              </label>
              <label class="settings-form__checkbox-row settings-form__checkbox-row--tight">
                <input
                  type="checkbox"
                  checked={showSnapshotFilters}
                  onChange={(e) => {
                    onChange("lumatone_degree_filter_snapshots", e.target.checked);
                    saveControllerPref?.(null, "lumatone_degree_filter_snapshots", e.target.checked);
                  }}
                />
                <em class="settings-form__helper-text">Auto-Generate from Snapshots</em>
              </label>
              <label class="settings-form__inline-label-row">
                <span class="settings-form__inline-label settings-form__label-nowrap">Scale degrees</span>
                <input
                  type="text"
                  class="sidebar-input settings-form__text-input--wide"
                  value={draftFilter}
                  placeholder="e.g. 0, 4, 7, 11"
                  onInput={(e) => {
                    setDraftFilter(e.target.value);
                    setFilterError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      applyFilter(
                        e.currentTarget.value,
                        selectedSavedFilter?.filter === e.currentTarget.value
                          ? selectedSavedName
                          : LUMATONE_COLOR_FILTER_CUSTOM,
                        true,
                      );
                    }
                  }}
                  aria-label="Lumatone filter scale degrees"
                />
              </label>
              <div class="preset-actions settings-form__section-top--compact">
                <button type="button" class="preset-action-btn" onClick={handleSaveFilter}>
                  Save
                </button>
                <button
                  type="button"
                  class="preset-action-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Open
                </button>
                <button type="button" class="preset-action-btn" onClick={handleWriteFilterFile}>
                  Write
                </button>
                {selectedSavedFilter && (
                  <button
                    type="button"
                    class="delete-btn preset-utility-btn preset-actions__clear-trigger"
                    onClick={handleDeleteFilter}
                  >
                    Delete
                  </button>
                )}
                {selectedSavedFilter && (
                  <button
                    type="button"
                    class="delete-btn preset-utility-btn"
                    onClick={handleClearAllFilters}
                  >
                    Clear All
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                class="settings-form__hidden-file-input"
                onChange={handleOpenFilterFile}
              />
              {filterError && <p class="preset-error">{filterError}</p>}
            </>
          )}
        </>
      )}
    </>
  );
};

LumatoneSettings.propTypes = {
  settings: PropTypes.object.isRequired,
  snapshots: PropTypes.arrayOf(PropTypes.object),
  tuningRuntime: PropTypes.shape({
    scale: PropTypes.arrayOf(PropTypes.number),
    equivInterval: PropTypes.number,
    referenceDegree: PropTypes.number,
    fundamental: PropTypes.number,
  }),
  rawPorts: PropTypes.object,
  midiOutputs: PropTypes.object,
  keysRef: PropTypes.object,
  hasSysexMidi: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
  onEnableLumatoneAutoSync: PropTypes.func,
  saveControllerPref: PropTypes.func,
};

export default LumatoneSettings;
