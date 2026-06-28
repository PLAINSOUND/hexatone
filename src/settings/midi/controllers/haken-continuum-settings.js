import PropTypes from "prop-types";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import OutputPortPicker from "../output-port-picker.js";
import {
  CONTINUUM_RASTER_FILTER_ALL,
  CONTINUUM_RASTER_FILTER_CUSTOM,
  CONTINUUM_RASTER_FILTER_SELECTED_KEY,
  exportableContinuumRasterFilterLibrary,
  formatContinuumRasterFilter,
  importContinuumRasterFilterLibrary,
  parseContinuumRasterFilter,
  readContinuumRasterFilterLibrary,
  writeContinuumRasterFilterLibrary,
} from "../../../controllers/continuum-raster-filters.js";

// This module owns the Haken Continuum-specific MIDI Input controls that only
// make sense for MPE input modes. It renders the Continuum X Glide mode
// selector unconditionally when the Haken is active, and keeps the shared
// performance controls visible across both live X-glide modes so the player
// can flip between them without losing access to the paired settings.

const HakenContinuumSettings = ({
  ctrl,
  settings,
  rawPorts,
  midiOutputs,
  onChange,
  saveControllerPref,
  hakenPedalLearnActive,
}) => {
  const fileInputRef = useRef(null);
  const [savedFilters, setSavedFilters] = useState(() => readContinuumRasterFilterLibrary());
  const [selectedSavedName, setSelectedSavedName] = useState(
    () => localStorage.getItem(CONTINUUM_RASTER_FILTER_SELECTED_KEY) || CONTINUUM_RASTER_FILTER_ALL,
  );
  const [draftFilter, setDraftFilter] = useState(settings.hakenaudio_raster_filter ?? "");
  const [filterError, setFilterError] = useState("");
  const xGlideMode = settings.hakenaudio_x_glide_mode ?? "pitch_bending";
  const xGlideShaping = Math.max(
    0,
    Math.min(100, Number(settings.hakenaudio_x_glide_shaping ?? 100) || 0),
  );
  const pressureVelocity = Math.max(
    0,
    Math.min(127, Number(settings.hakenaudio_pressure_velocity ?? 64) || 0),
  );
  const noteOffDelay = Math.max(
    0,
    Math.min(100, Number(settings.hakenaudio_note_off_delay ?? 45) || 0),
  );
  const rasterThrottleMs = Math.max(
    0,
    Math.min(100, Number(settings.hakenaudio_raster_throttle_ms ?? 35) || 0),
  );
  const rasterStability = Math.max(
    0,
    Math.min(100, Number(settings.hakenaudio_raster_stability ?? 50) || 0),
  );
  const glideFlipCc = Number.isFinite(settings.hakenaudio_glide_flip_cc)
    ? Math.trunc(settings.hakenaudio_glide_flip_cc)
    : 67;
  const updateHakenPref = (key, value, extra = null) => {
    onChange(key, value);
    saveControllerPref(ctrl, key, value, settings, extra ?? { [key]: value });
  };
  useEffect(() => {
    setDraftFilter(settings.hakenaudio_raster_filter ?? "");
  }, [settings.hakenaudio_raster_filter]);

  useEffect(() => {
    localStorage.setItem(CONTINUUM_RASTER_FILTER_SELECTED_KEY, selectedSavedName);
  }, [selectedSavedName]);

  const selectedSavedFilter = useMemo(
    () => savedFilters.find((entry) => entry.name === selectedSavedName) ?? null,
    [savedFilters, selectedSavedName],
  );
  const selectedSavedIndex = useMemo(
    () => savedFilters.findIndex((entry) => entry.name === selectedSavedName),
    [savedFilters, selectedSavedName],
  );
  const activeFilter = settings.hakenaudio_raster_filter ?? "";
  const filterActive = settings.hakenaudio_raster_filter_mode === "filter";
  const selectedValue = filterActive
    ? (selectedSavedFilter && selectedSavedFilter.filter === activeFilter
      ? selectedSavedFilter.name
      : CONTINUUM_RASTER_FILTER_CUSTOM)
    : CONTINUUM_RASTER_FILTER_ALL;

  const applyFilter = (rawFilter, nextSavedName = selectedSavedName) => {
    const parsed = parseContinuumRasterFilter(rawFilter);
    if (!parsed) {
      setFilterError("Scale-degree filter must use non-negative integers separated by commas.");
      return false;
    }
    const normalizedFilter = formatContinuumRasterFilter(parsed);
    setFilterError("");
    setDraftFilter(normalizedFilter);
    updateHakenPref("hakenaudio_raster_filter_mode", "filter", {
      hakenaudio_raster_filter_mode: "filter",
    });
    updateHakenPref("hakenaudio_raster_filter", normalizedFilter, {
      hakenaudio_raster_filter: normalizedFilter,
    });
    setSelectedSavedName(nextSavedName);
    return true;
  };

  const selectAllDegrees = () => {
    setFilterError("");
    setDraftFilter("");
    updateHakenPref("hakenaudio_raster_filter_mode", "all", {
      hakenaudio_raster_filter_mode: "all",
    });
    updateHakenPref("hakenaudio_raster_filter", "", {
      hakenaudio_raster_filter: "",
    });
    setSelectedSavedName(CONTINUUM_RASTER_FILTER_ALL);
  };

  const handleSelectFilter = (e) => {
    const value = e.target.value;
    if (value === CONTINUUM_RASTER_FILTER_ALL) {
      selectAllDegrees();
      return;
    }
    if (value === CONTINUUM_RASTER_FILTER_CUSTOM) return;
    const entry = savedFilters.find((filter) => filter.name === value);
    if (!entry) return;
    setSelectedSavedName(entry.name);
    applyFilter(entry.filter, entry.name);
  };

  const handleReloadSaved = () => {
    if (!selectedSavedFilter) return;
    applyFilter(selectedSavedFilter.filter, selectedSavedFilter.name);
  };

  const handleSaveFilter = () => {
    const parsed = parseContinuumRasterFilter(draftFilter);
    if (!parsed) {
      setFilterError("Scale-degree filter must use non-negative integers separated by commas.");
      return;
    }
    const normalizedFilter = formatContinuumRasterFilter(parsed);
    const nextName = window.prompt("Save Continuum raster filter as:", selectedSavedFilter?.name ?? "");
    if (nextName == null) return;
    const trimmedName = nextName.trim();
    if (!trimmedName) return;
    const nextLibrary = [
      ...savedFilters.filter((entry) => entry.name !== trimmedName),
      { name: trimmedName, filter: normalizedFilter },
    ];
    writeContinuumRasterFilterLibrary(nextLibrary);
    setSavedFilters(nextLibrary);
    setSelectedSavedName(trimmedName);
    applyFilter(normalizedFilter, trimmedName);
  };

  const moveSelectedFilter = (direction) => {
    if (!selectedSavedFilter || selectedSavedIndex < 0) return;
    const targetIndex = selectedSavedIndex + direction;
    if (targetIndex < 0 || targetIndex >= savedFilters.length) return;
    const nextLibrary = [...savedFilters];
    const [moved] = nextLibrary.splice(selectedSavedIndex, 1);
    nextLibrary.splice(targetIndex, 0, moved);
    writeContinuumRasterFilterLibrary(nextLibrary);
    setSavedFilters(nextLibrary);
    setSelectedSavedName(moved.name);
  };

  const handleDeleteFilter = () => {
    if (!selectedSavedFilter) return;
    const nextLibrary = savedFilters.filter((entry) => entry.name !== selectedSavedFilter.name);
    writeContinuumRasterFilterLibrary(nextLibrary);
    setSavedFilters(nextLibrary);
    selectAllDegrees();
  };

  const handleClearAllFilters = () => {
    writeContinuumRasterFilterLibrary([]);
    setSavedFilters([]);
    selectAllDegrees();
  };

  const handleOpenFilterFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = importContinuumRasterFilterLibrary(JSON.parse(await file.text()));
      writeContinuumRasterFilterLibrary(parsed);
      setSavedFilters(parsed);
      setFilterError("");
    } catch {
      setFilterError("No valid Continuum raster filters found in the chosen file.");
    } finally {
      e.target.value = "";
    }
  };

  const handleWriteFilterFile = () => {
    const blob = new Blob(
      [JSON.stringify(exportableContinuumRasterFilterLibrary(savedFilters), null, 2)],
      { type: "application/json" },
    );
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "continuum-raster-filters.json";
    link.click();
    URL.revokeObjectURL(href);
  };

  return (
    <>
      <OutputPortPicker
        label="Continuum Control Port"
        rawPorts={rawPorts}
        outputs={midiOutputs}
        overridePortId={settings.hakenaudio_out_port ?? null}
        onChange={(id) => {
          onChange("hakenaudio_out_port", id);
          sessionStorage.setItem("hakenaudio_out_port", id ?? "");
        }}
      />

      <label title="Controls how Continuum X-axis finger movement is translated. Pitch Bending applies continuous bend that follows the Hexatone scale. Raster to Notes turns the glide into a cascade of discrete note retriggering: each time the bend crosses a new note boundary a note-off and a fresh note-on are emitted.">
        Continuum X Glide
        <select
          class="sidebar-input"
          value={xGlideMode}
          onChange={(e) => {
            const v = e.target.value;
            updateHakenPref("hakenaudio_x_glide_mode", v, {
              hakenaudio_x_glide_mode: v,
            });
          }}
        >
          <option value="pitch_bending">Pitch Bending</option>
          <option value="raster_to_notes">Raster to Notes</option>
        </select>
      </label>

      <label title="Learns a foot pedal or other CC to momentarily flip between Pitch Bending and Raster to Notes, matching the current space-bar behavior. CC value 64 or above engages the flip; lower values release it.">
        Raster/Bend Pedal
        <span class="sidebar-input settings-form__inline-fields settings-form__inline-fields--spread">
          <span class="settings-form__tabular-value settings-form__tabular-value--muted">
            {`CC ${glideFlipCc}`}
          </span>
          <span class="settings-form__action-group">
            <button
              type="button"
              class="learn-btn"
              onClick={() => onChange("midiLearnHakenPedal", !hakenPedalLearnActive)}
            >
              {hakenPedalLearnActive ? "● Listening…" : "Learn"}
            </button>
            <button
              type="button"
              class="learn-btn"
              onClick={() => {
                updateHakenPref("hakenaudio_glide_flip_cc", 67, {
                  hakenaudio_glide_flip_cc: 67,
                });
              }}
            >
              Reset
            </button>
          </span>
        </span>
      </label>

      <label>
        Continuum Raster Filter
        <span class="sidebar-input lumatone-filter-selector">
          {selectedSavedFilter && (
            <button
              type="button"
              class="preset-refresh-btn"
              title="Reload saved filter"
              aria-label="Reload saved raster filter"
              onClick={handleReloadSaved}
            >
              <span class="preset-refresh-glyph">⟳</span>
            </button>
          )}
          <select
            aria-label="Continuum Raster Filter"
            value={selectedValue}
            onChange={handleSelectFilter}
          >
            <option value={CONTINUUM_RASTER_FILTER_ALL}>All Degrees</option>
            {savedFilters.length > 0 && (
              <option value="__separator__" disabled>──────── User Filters ────────</option>
            )}
            {filterActive && selectedValue === CONTINUUM_RASTER_FILTER_CUSTOM && (
              <option value={CONTINUUM_RASTER_FILTER_CUSTOM}>Current Custom Filter</option>
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
                aria-label="Move raster filter up"
                disabled={selectedSavedIndex <= 0}
                onClick={() => moveSelectedFilter(-1)}
              >
                ↑
              </button>
              <button
                type="button"
                class="preset-refresh-btn lumatone-filter-move-btn"
                title="Move filter down"
                aria-label="Move raster filter down"
                disabled={selectedSavedIndex < 0 || selectedSavedIndex >= savedFilters.length - 1}
                onClick={() => moveSelectedFilter(1)}
              >
                ↓
              </button>
            </span>
          )}
        </span>
      </label>
      <label class="settings-form__inline-label-row">
        <span class="settings-form__fixed-label">Scale degrees</span>
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
                  : CONTINUUM_RASTER_FILTER_CUSTOM,
              );
            }
          }}
          aria-label="Continuum raster filter scale degrees"
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
        accept="application/json,.json"
        class="settings-form__hidden-file-input"
        onChange={handleOpenFilterFile}
      />
      {filterError && <div class="scale-warning">{filterError}</div>}

      <label title="Shapes Continuum X bending around the current note. 0 is linear. Higher values create stronger pockets of stability around note centers and faster movement between them.">
        X Glide Shaping
        <span class="sidebar-input settings-form__range-row">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={xGlideShaping}
            class="settings-form__range-input"
            onInput={(e) => {
              const parsed = parseInt(e.target.value, 10);
              const v = Math.max(0, Math.min(100, Number.isNaN(parsed) ? 0 : parsed));
              updateHakenPref("hakenaudio_x_glide_shaping", v, {
                hakenaudio_x_glide_shaping: v,
              });
            }}
          />
          <span class="settings-form__range-value">
            {xGlideShaping}
          </span>
        </span>
      </label>

      <label title="Varies Continuum Raster to Notes retrigger velocity around the original attack using current Z pressure. 0 keeps the original attack for each retrigger. 127 applies the full pressure-based deviation range to both note-on and auto-generated note-off velocities.">
        Pressure → Velocity
        <span class="sidebar-input settings-form__range-row">
          <input
            type="range"
            min="0"
            max="127"
            step="1"
            value={pressureVelocity}
            class="settings-form__range-input"
            onInput={(e) => {
              const parsed = parseInt(e.target.value, 10);
              const v = Math.max(0, Math.min(127, Number.isNaN(parsed) ? 0 : parsed));
              updateHakenPref("hakenaudio_pressure_velocity", v, {
                hakenaudio_pressure_velocity: v,
              });
            }}
          />
          <span class="settings-form__range-value">
            {pressureVelocity}
          </span>
        </span>
      </label>

      <label title="Enforces a minimum lifetime for auto-generated Raster to Notes notes. Real Continuum note-off messages still release all sounding notes immediately. Uses a timer rather than requestAnimationFrame so it also works while the app is in the background.">
        Minimum Note Duration
        <span class="sidebar-input settings-form__range-row">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={noteOffDelay}
            class="settings-form__range-input"
            onInput={(e) => {
              const parsed = parseInt(e.target.value, 10);
              const v = Math.max(0, Math.min(100, Number.isNaN(parsed) ? 0 : parsed));
              updateHakenPref("hakenaudio_note_off_delay", v, {
                hakenaudio_note_off_delay: v,
              });
            }}
          />
          <span class="settings-form__range-value">
            {noteOffDelay} ms
          </span>
        </span>
      </label>

      <label title="Sets a minimum interval between Continuum Raster to Notes retriggers. Higher values reduce event density and output overload at the cost of skipping some very fast crossings.">
        Minimum Retrigger Interval
        <span class="sidebar-input settings-form__range-row">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={rasterThrottleMs}
            class="settings-form__range-input"
            onInput={(e) => {
              const parsed = parseInt(e.target.value, 10);
              const v = Math.max(0, Math.min(100, Number.isNaN(parsed) ? 0 : parsed));
              updateHakenPref("hakenaudio_raster_throttle_ms", v, {
                hakenaudio_raster_throttle_ms: v,
              });
            }}
          />
          <span class="settings-form__range-value">
            {rasterThrottleMs} ms
          </span>
        </span>
      </label>

      <label title="Adds hysteresis around the current Raster to Notes pitch so small back-and-forth movements near note boundaries do not immediately retrigger neighbouring notes.">
        Raster Stability
        <span class="sidebar-input settings-form__range-row">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={rasterStability}
            class="settings-form__range-input"
            onInput={(e) => {
              const parsed = parseInt(e.target.value, 10);
              const v = Math.max(0, Math.min(100, Number.isNaN(parsed) ? 0 : parsed));
              updateHakenPref("hakenaudio_raster_stability", v, {
                hakenaudio_raster_stability: v,
              });
            }}
          />
          <span class="settings-form__range-value">
            {rasterStability}
          </span>
        </span>
      </label>
    </>
  );
};

HakenContinuumSettings.propTypes = {
  ctrl: PropTypes.object.isRequired,
  settings: PropTypes.object.isRequired,
  rawPorts: PropTypes.object,
  midiOutputs: PropTypes.object,
  onChange: PropTypes.func.isRequired,
  saveControllerPref: PropTypes.func.isRequired,
  hakenPedalLearnActive: PropTypes.bool,
};

export default HakenContinuumSettings;
