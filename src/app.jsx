import { h, render } from "preact";
import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "preact/hooks";

import Keyboard from "./keyboard";
import { presets, default_settings } from "./settings/preset_values";
import { normalizeColors, normalizeStructural } from "./normalize-settings.js";
import { forceResumeAudioContext } from "./sample_synth";
import { instruments } from "./sample_synth/instruments";

import keyCodeToCoords from "./settings/keycodes";
import useSynthWiring from "./use-synth-wiring.js";
import {
  useQuery,
  Extract,
  ExtractInt,
  ExtractString,
  ExtractFloat,
  ExtractBool,
  ExtractJoinedString,
} from "./use-query";
import usePresets, { PRESET_SKIP_KEYS, clearScaleSettings } from "./use-presets.js";
import useImport from "./use-import.js";
import useSettingsChange from "./use-settings-change.js";
import sessionDefaults from "./session-defaults.js";
import Settings from "./settings";
import Blurb from "./blurb";

import PropTypes from "prop-types";

import "normalize.css";
import "./hex-style.css";
import LoadingIcon from "./hex.svg?react";
import "./loader.css";

// On browser refresh (not initial load), clear scale/preset sessionStorage unless
// the user has opted into "Restore last preset on page reload".
if (performance.getEntriesByType("navigation")[0]?.type === "reload") {
  const shouldPersist = localStorage.getItem("hexatone_persist_on_reload") === "true";
  if (!shouldPersist) {
    const scaleKeysToClear = [
      "scale",
      "scale_import",
      "note_names",
      "note_colors",
      "key_labels",
      "reference_degree",
      "equivSteps",
      "equivInterval",
      // midiin_central_degree excluded — hardware setting, persists across presets
      "spectrum_colors",
      "fundamental_color",
      "name",
      "description",
      "short_description",
      "hexatone_preset_source",
      "hexatone_preset_name",
    ];
    scaleKeysToClear.forEach((key) => sessionStorage.removeItem(key));
  }
}

export const Loading = () => <LoadingIcon />;

const ua = navigator.userAgent;
const isSafariOnly =
  /Safari/.test(ua) &&
  !/Chrome/.test(ua) &&
  !/Chromium/.test(ua) &&
  !/Firefox/.test(ua);
if (isSafariOnly)
  alert(
    "Safari is not fully supported.\nFor the best experience please use Firefox or a Chromium-based browser such as Brave, Edge or Chrome.",
  );

const App = () => {
  const [ready, setReady] = useState(false);
  const [userHasInteracted, setUserHasInteracted] = useState(false);
  const keysRef = useRef(null); // live Keys instance for imperative color updates
  const synthRef = useRef(null); // live synth instance for imperative volume/mute control

  const [settings, setSettings] = useQuery(
    {
      name: ExtractString,
      description: ExtractString,

      // Input
      midiin_device: ExtractString,
      midiin_channel: ExtractInt,
      midiin_steps_per_channel: ExtractInt,
      controller_anchor_note: ExtractInt,
      midiin_channel_legacy: ExtractBool,
      midi_passthrough: ExtractBool,
      midiin_central_degree: ExtractInt,
      axis49_center_note: ExtractInt,
      wheel_to_recent: ExtractBool,
      lumatone_center_channel: ExtractInt,
      lumatone_center_note: ExtractInt,

      // Output
      output_sample: ExtractBool,
      output_mts: ExtractBool,
      output_mpe: ExtractBool,
      output_direct: ExtractBool,
      fluidsynth_device: ExtractString,
      fluidsynth_channel: ExtractInt,
      direct_device: ExtractString,
      direct_channel: ExtractInt,
      direct_sysex_auto: ExtractBool,
      direct_device_id: ExtractInt,
      direct_tuning_map_number: ExtractInt,
      mpe_device: ExtractString,
      mpe_master_ch: ExtractString,
      mpe_lo_ch: ExtractInt,
      mpe_hi_ch: ExtractInt,
      mpe_mode: ExtractString,
      mpe_pitchbend_range: ExtractInt,
      mpe_pitchbend_range_manager: ExtractInt,
      instrument: ExtractString,
      fundamental: ExtractFloat,
      reference_degree: ExtractInt,
      midi_mapping: ExtractString,
      midi_device: ExtractString,
      midi_channel: ExtractInt,
      midi_velocity: ExtractInt,
      sysex_auto: ExtractBool,
      sysex_type: ExtractInt,
      device_id: ExtractInt,
      tuning_map_number: ExtractInt,

      // Layout
      rSteps: ExtractInt,
      drSteps: ExtractInt,
      hexSize: ExtractInt,
      rotation: ExtractInt,
      // Scale
      scale: ExtractJoinedString,
      key_labels: ExtractString,
      retuning_mode: ExtractString,
      equivSteps: ExtractInt,
      note_names: ExtractJoinedString,
      spectrum_colors: ExtractBool,
      fundamental_color: ExtractString,
      note_colors: ExtractJoinedString,
    },
    {
      ...default_settings,
      ...sessionDefaults,
      // Preset-specific fields start empty — populated only when a preset is loaded.
      // scale/note_names/note_colors handle null gracefully (render empty table).
      name: "",
      description: "",
      note_names: null,
      note_colors: null,
    },
    PRESET_SKIP_KEYS,
  );

  const {
    activeSource,
    activePresetName,
    isPresetDirty,
    persistOnReload,
    setPersistOnReload,
    presetChanged,
    onLoadCustomPreset,
    onClearUserPresets,
    onRevertBuiltin,
    onRevertUser,
  } = usePresets(settings, setSettings, {
    synthRef,
    onUserInteraction: () => setUserHasInteracted(true),
  });

  const { onImport, importCount, bumpImportCount } = useImport(
    settings,
    setSettings,
    {
      onReady: () => setReady(true),
      onUserInteraction: () => setUserHasInteracted(true),
    },
  );

  const {
    synth,
    midi,
    midiTick,
    loading,
    midiLearnActive,
    setMidiLearnActive,
    octaveTranspose,
    setOctaveTranspose,
    octaveDeferred,
    shiftOctave,
    toggleOctaveDeferred,
    onVolumeChange,
    onAnchorLearn,
  } = useSynthWiring(settings, setSettings, {
    ready,
    userHasInteracted,
    keysRef,
    synthRef,
  });

  const [active, setActive] = useState(false);
  const [latch, setLatch] = useState(false);

  // Long-press sidebar button to toggle latch (sustain while playing)
  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);

  const onSidebarTouchStart = useCallback((e) => {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      if (keysRef.current) keysRef.current.latchToggle();
    }, 400);
  }, []);

  const onSidebarTouchEnd = useCallback((e) => {
    clearTimeout(longPressTimer.current);
    if (longPressFired.current) {
      e.preventDefault();
    }
  }, []);

  const onSidebarTouchMove = useCallback(() => {
    clearTimeout(longPressTimer.current);
  }, []);
  useEffect(() => {
    // Enable the app — triggers synth creation and makes the keyboard visible.
    setReady(true);
  }, []);

  const COLOR_KEYS = new Set([
    "note_colors",
    "spectrum_colors",
    "fundamental_color",
  ]);
  const SCALE_KEYS = new Set([
    "scale",
    "note_names",
    "fundamental",
    "reference_degree",
    "equivSteps",
  ]);

  // Return the detectController entry for the currently connected input device, or null.
  const getConnectedController = (deviceId) => {
    if (!deviceId || deviceId === 'OFF' || !midi) return null;
    const input = Array.from(midi.inputs.values()).find(m => m.id === deviceId);
    return input ? detectController(input.name.toLowerCase()) : null;
  };

  const onChange = (key, value) => {
    // Toggle MIDI-learn mode — handled outside settings state (no URL sync needed).
    if (key === 'midiLearnAnchor') {
      setMidiLearnActive(value);
      return;
    }

    // When the MIDI input device is selected, load the per-controller saved anchor note
    // (or fall back to the controller's built-in default on first use).
    if (key === 'midiin_device') {
      let anchorMidiNote = null;
      if (value && value !== 'OFF' && midi) {
        const input = Array.from(midi.inputs.values()).find(m => m.id === value);
        if (input) {
          const ctrl = detectController(input.name.toLowerCase());
          if (ctrl) {
            const saved = localStorage.getItem(`${ctrl.id}_anchor`);
            anchorMidiNote = saved !== null ? parseInt(saved) : ctrl.anchorDefault;
          }
        }
      }
      setSettings(s => ({
        ...s,
        midiin_device: value,
        ...(anchorMidiNote !== null ? { midiin_central_degree: anchorMidiNote } : {}),
      }));
      sessionStorage.setItem('midiin_device', value);
      if (anchorMidiNote !== null) {
        sessionStorage.setItem('midiin_central_degree', String(anchorMidiNote));
      }
      return;
    }

    // When the user manually changes the anchor note for a known controller, save it
    // to localStorage keyed by controller ID so it's restored on next connect.
    if (key === 'midiin_central_degree') {
      const ctrl = getConnectedController(settings.midiin_device);
      if (ctrl) {
        // value IS the raw physical MIDI note number — store directly.
        localStorage.setItem(`${ctrl.id}_anchor`, String(value));
      }
      // Fall through to normal setSettings
    }

    // If instrument is about to change, stop all currently playing notes
    // This prevents the old instrument's sounds from continuing after switch
    if (key === "instrument") {
      if (keysRef.current) {
        keysRef.current.panic();
      }
      // Reset latch state to match
      setLatch(false);
    }

    // When equivSteps changes, resize the scale array and reset scale-related settings
    // This must be handled BEFORE the SCALE_KEYS block so panic() is called instead of sustainOff()
    if (key === "equivSteps") {
      // Kill all notes and clear sustain state - scale is being fundamentally restructured
      if (keysRef.current) {
        keysRef.current.panic();
      }
      setLatch(false);
      bumpImportCount();

      setSettings((s) => {
        const newSize = value;
        const currentScale = s.scale || [];
        let newScale;
        if (newSize > currentScale.length) {
          // Pad with default cents values (100 cents per degree)
          const padding = [];
          for (let i = currentScale.length; i < newSize - 1; i++) {
            padding.push(String((i + 1) * 100) + ".0");
          }
          // Last one should be the equave (newSize * 100 cents)
          padding.push(String(newSize * 100) + ".0");
          newScale = [...currentScale, ...padding];
        } else {
          // Truncate or keep same size
          newScale = currentScale.slice(0, newSize);
        }
        // Populate note_names from scale with shift: degree i has name scale[(i - 1 + n) % n]
        const newNoteNames = newScale.map(
          (_, i) => newScale[(i - 1 + newScale.length) % newScale.length],
        );
        return {
          ...s,
          [key]: value,
          scale: newScale,
          note_names: newNoteNames,
          spectrum_colors: true,
          fundamental_color: "#f2e3e3",
        };
      });
      return;
    }

    // When scale is divided into equal parts (Divide Equave / Divide Octave buttons)
    // Same treatment as equivSteps: panic and reset scale-related settings
    if (key === "scale_divide") {
      if (keysRef.current) {
        keysRef.current.panic();
      }
      setLatch(false);
      bumpImportCount();

      setSettings((s) => {
        // Use the incoming value (new scale), not s.scale (old scale)
        const newScale = value;
        const equivSteps = s.equivSteps || newScale.length;
        const equaveValue = newScale[newScale.length - 1];

        // Check if equave is an octave (1200 cents, 1200.0, 2/1, or "2")
        const isOctave =
          equaveValue === "2" ||
          equaveValue === "2/1" ||
          equaveValue === "1200" ||
          equaveValue === "1200.0" ||
          /^1200\.?0*$/.test(equaveValue);

        // Generate name and description (simplify for octave)
        const equaveForName = isOctave ? "2" : equaveValue;
        const equaveForDesc = isOctave ? "Octave" : `${equaveValue} cents`;
        const newName = `${equivSteps}ed${equaveForName}`;
        const newDescription = `${equaveForDesc} divided into ${equivSteps} equal steps`;

        // Populate note_names from scale with shift: degree i has name scale[(i - 1 + n) % n]
        const newNoteNames = newScale.map(
          (_, i) => newScale[(i - 1 + newScale.length) % newScale.length],
        );
        return {
          ...s,
          scale: newScale,
          name: newName,
          description: newDescription,
          note_names: newNoteNames,
          spectrum_colors: true,
          fundamental_color: "#f2e3e3",
        };
      });
      return;
    }

    // For color changes, push to the live Keys instance BEFORE setSettings.
    // This uses the current keysRef at call time, avoiding stale references
    // if a reconstruction happens during the React batch.
    if (COLOR_KEYS.has(key) && keysRef.current) {
      const colorUpdate = {
        note_colors:
          key === "note_colors"
            ? normalizeColors({ ...settings, [key]: value }).note_colors
            : normalizeColors(settings).note_colors,
        spectrum_colors:
          key === "spectrum_colors" ? value : settings.spectrum_colors,
        fundamental_color:
          key === "fundamental_color"
            ? (value || "").replace(/#/, "")
            : (settings.fundamental_color || "").replace(/#/, ""),
      };
      keysRef.current.updateColors(colorUpdate);
    }

    setSettings((s) => ({ ...s, [key]: value }));
  };

  const onAtomicChange = (updates) => {
    setSettings((s) => ({ ...s, ...updates }));
  };

  // Called by keys.js when the user presses a key during MIDI-learn mode.
  // Saves the physical MIDI note as the new anchor for this controller and
  // updates midiin_central_degree so the controller map rebuilds immediately.

  const resetScale = () => {
    setUserHasInteracted(true);
    clearScaleSettings();
    // Reload the page to apply fresh defaults
    window.location.reload();
  };


  // Validate that all required settings are present and consistent.
  // This prevents Keys from being constructed with invalid state that would crash.
  const isValid = useMemo(() => {
    // Layout validation: hexSize must be >= 20, rotation must be a number
    const hasLayout =
      settings.rSteps &&
      settings.drSteps &&
      settings.hexSize &&
      settings.hexSize >= 20 &&
      typeof settings.rotation === "number";

    // Scale validation: must have a scale array with at least one element
    const hasScale =
      settings.scale &&
      Array.isArray(settings.scale) &&
      settings.scale.length > 0 &&
      settings.equivSteps;

    // Label validation: check requirements based on selected key_labels type.
    // Each label type has different data requirements:
    // - 'no_labels', 'equaves', 'enumerate', 'cents': need only scale
    // - 'scala_names': needs scale (to generate scala_names)
    // - 'note_names': needs note_names array with elements
    const labelType = settings.key_labels;
    const labelsValid =
      !labelType ||
      labelType === "no_labels" ||
      labelType === "equaves" ||
      labelType === "enumerate" ||
      labelType === "cents" ||
      (labelType === "scala_names" && hasScale) ||
      (labelType === "note_names" &&
        settings.note_names &&
        Array.isArray(settings.note_names) &&
        settings.note_names.length > 0);

    // Color validation: either use spectrum_colors with fundamental_color,
    // or use note_colors array
    const colorsValid =
      (settings.spectrum_colors && settings.fundamental_color) ||
      (settings.note_colors &&
        Array.isArray(settings.note_colors) &&
        settings.note_colors.length > 0);

    return hasLayout && hasScale && labelsValid && colorsValid;
  }, [settings]);

  // Stable string keys for array deps — memoized so stringify only runs when
  // the array content actually changes, not on every render.
  const scaleKey = useMemo(
    () => JSON.stringify(settings.scale),
    [settings.scale],
  );
  const noteNamesKey = useMemo(
    () => JSON.stringify(settings.note_names),
    [settings.note_names],
  );
  const noteColorsKey = useMemo(
    () => JSON.stringify(settings.note_colors),
    [settings.note_colors],
  );

  // Structural settings: everything except colors. Memoized so Keys is only
  // reconstructed when scale/layout/MIDI changes — not on every color-picker drag.
  const structuralSettings = useMemo(
    () => normalizeStructural(settings),
    [
      settings.rSteps,
      settings.drSteps,
      settings.hexSize,
      settings.rotation,
      scaleKey,
      settings.equivSteps,
      noteNamesKey,
      settings.key_labels,
      // fundamental handled imperatively via keysRef.current.updateFundamental
      settings.reference_degree,
      settings.center_degree,
      settings.instrument,
      settings.midiin_device,
      settings.midiin_channel,
      settings.midiin_steps_per_channel,
      settings.controller_anchor_note,
      settings.midiin_channel_legacy,
      settings.midi_passthrough,
      settings.midiin_central_degree,
      settings.axis49_center_note,
      settings.wheel_to_recent,
      settings.lumatone_center_channel,
      settings.lumatone_center_note,
      settings.output_mts,
      settings.output_mpe,
      settings.output_sample,
      settings.midi_device,
      settings.midi_channel,
      settings.midi_mapping,
      settings.midi_velocity,
      settings.sysex_auto,
      settings.output_direct,
      settings.direct_device,
      settings.direct_channel,
      settings.direct_sysex_auto,
      settings.fluidsynth_device,
      settings.fluidsynth_channel,
      settings.sysex_type,
      settings.mpe_device,
      settings.mpe_master_ch,
      settings.mpe_lo_ch,
      settings.mpe_hi_ch,
    ],
  );

  // Reset latch (sustain UI state) when Keys is reconstructed.
  // The new Keys instance starts with sustain: false, so the UI must match.
  // Using a ref to skip the initial render (no reconstruction on first mount).
  const prevStructuralRef = useRef(null);
  useEffect(() => {
    if (
      prevStructuralRef.current !== null &&
      prevStructuralRef.current !== structuralSettings
    ) {
      setLatch(false);
    }
    prevStructuralRef.current = structuralSettings;
  }, [structuralSettings]);

  // Reset octave transpose display when structuralSettings change (preset load etc.)
  useEffect(() => {
    setOctaveTranspose(0);
  }, [structuralSettings]);

  // Color settings: only the color fields. Changes here update the live Keys
  // instance imperatively (via updateColors) without reconstructing it.
  const colorSettings = useMemo(
    () => normalizeColors(settings),
    [noteColorsKey, settings.spectrum_colors, settings.fundamental_color],
  );

  const normalizedSettings = useMemo(
    () => ({
      ...structuralSettings,
      ...colorSettings,
    }),
    [structuralSettings, colorSettings],
  );

  // Imperative volume/mute — does not rebuild Keys

  // Null synth: visual-only, no audio. Used when no output is configured.
  const nullSynth = {
    makeHex: (coords, cents) => ({
      coords,
      cents,
      release: false,
      noteOn: () => {},
      noteOff: () => {},
      retune: () => {},
    }),
  };

  return (
    <div
      className={active ? "hide" : "show"}
      onClick={() => setUserHasInteracted(true)}
    >
      {loading === 0 && ready && isValid && (
        <Keyboard
          synth={synth || nullSynth}
          settings={normalizedSettings}
          structuralSettings={structuralSettings}
          onKeysReady={useCallback((keys) => {
            keysRef.current = keys;
          }, [])}
          onLatchChange={useCallback((v) => setLatch(v), [])}
          active={active}
          midiLearnActive={midiLearnActive}
          onAnchorLearn={onAnchorLearn}
        />
      )}

      {loading > 0 && <Loading />}
      <button
        id="sidebar-button"
        className={latch ? "latch-active" : ""}
        onClick={() => setActive((s) => !s)}
        onTouchStart={onSidebarTouchStart}
        onTouchEnd={onSidebarTouchEnd}
        onTouchMove={onSidebarTouchMove}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div>&gt;</div>
      </button>
      <div id="bottom-bar">
        <div id="octave-island">
          <button className="octave-btn" title="Octave down"
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); shiftOctave(-1); }}
            onContextMenu={(e) => e.preventDefault()}
          >▼</button>
          <span
            className={`octave-display${octaveDeferred ? ' octave-defer-active' : ''}`}
            title={octaveDeferred ? 'Transpose on next event' : 'Transpose immediately'}
            onClick={toggleOctaveDeferred}
            style={{ cursor: 'pointer', pointerEvents: 'auto' }}
          >
            {octaveTranspose === 0 ? "OCT" : octaveTranspose > 0
              ? `+${octaveTranspose}` : `${octaveTranspose}`}
          </span>
          <button className="octave-btn" title="Octave up"
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); shiftOctave(+1); }}
            onContextMenu={(e) => e.preventDefault()}
          >▲</button>
        </div>
        <button
          id="sustain-island"
          className={latch ? "latch-active" : ""}
          onClick={(e) => {
            e.stopPropagation();
            if (keysRef.current) keysRef.current.latchToggle();
          }}
          onPointerDown={(e) => {
            if (e.pointerType === "touch") e.preventDefault();
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <b>SUSTAIN</b>
        </button>
        <button
          id="redraw-button"
          title="Redraw keyboard / Resume audio"
          onPointerDown={(e) => {
            e.preventDefault();
            if (keysRef.current) keysRef.current.resizeHandler();
          }}
          onClick={async (e) => {
            e.stopPropagation();
            if (keysRef.current) keysRef.current.resizeHandler();
            // Resume AudioContext if suspended (iOS background recovery)
            await forceResumeAudioContext();
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          ↺
        </button>
        <button
          id="panic-button"
          title="Panic - kill all stuck notes"
          onClick={(e) => {
            e.stopPropagation();
            if (keysRef.current) keysRef.current.panic();
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <b>ALL NOTES OFF</b>
        </button>
      </div>
      <nav id="sidebar">
        <h1>PLAINSOUND HEXATONE</h1>
        <p>
          <em>
            TO PLAY click or touch notes, attach a MIDI keyboard or a Lumatone.
            With sidebar closed, a computer keyboard also plays notes: H is
            mapped to Central Scale Degree; SPACEBAR sustains while pressed;
            SHIFT+keys sustains individual notes; ESC toggles a hand-free latch
            sustain.
          </em>
        </p>
        <p>
          <em>
            Setting Reference Frequency and Assigned Scale Degree automatically
            transposes built-in and external sounds. Edit scale degrees, note
            names, and colours below: pitches may be retuned, compared, saved,
            or reverted in real-time. Layouts and scala files may be exported
            and loaded to the User Tunings menu.
          </em>
        </p>
        <Settings
          presetChanged={presetChanged}
          presets={presets}
          onChange={onChange}
          onAtomicChange={onAtomicChange}
          midiLearnActive={midiLearnActive}
          onVolumeChange={onVolumeChange}
          onImport={onImport}
          importCount={importCount}
          onLoadCustomPreset={onLoadCustomPreset}
          onClearUserPresets={onClearUserPresets}
          activeSource={activeSource}
          activePresetName={activePresetName}
          isPresetDirty={isPresetDirty}
          persistOnReload={persistOnReload}
          setPersistOnReload={setPersistOnReload}
          onRevertBuiltin={onRevertBuiltin}
          onRevertUser={onRevertUser}
          settings={settings}
          midi={midi}
          midiTick={midiTick}
          instruments={instruments}
          keysRef={keysRef}
        />
        <Blurb />
        <div id="sidebar-spacer"></div>
      </nav>
    </div>
  );
};

export default App;