import { h, render } from 'preact';
import { useState, useEffect, useMemo, useCallback, useRef } from 'preact/hooks';

import Keyboard from './keyboard';
import { presets, default_settings } from './settings/preset_values';
import { parseScale, scalaToCents, scalaToLabels, parsedScaleToLabels, settingsToHexatonScala } from './settings/scale/parse-scale.js';
import { create_sample_synth } from './sample_synth';
import { instruments } from './sample_synth/instruments';

import { enableMidi, midi_in } from './settings/midi/midiin';
import { create_midi_synth} from './midi_synth';
import create_mpe_synth from './mpe_synth';
import { create_composite_synth } from './composite_synth';

import keyCodeToCoords from './settings/keycodes';
import { useQuery, Extract, ExtractInt, ExtractString, ExtractFloat, ExtractBool, ExtractJoinedString } from './use-query';
import Settings from './settings';
import { loadCustomPresets } from './settings/custom-presets';
import Blurb from './blurb';

import PropTypes from 'prop-types';

import "normalize.css";
import "./hex-style.css";
import LoadingIcon from './hex.svg?react';
import './loader.css';

// On browser refresh (not initial load), clear scale settings to start fresh
if (performance.getEntriesByType('navigation')[0]?.type === 'reload') {
  const scaleKeysToClear = [
    'scale', 'scale_import', 'note_names', 'note_colors', 'key_labels',
    'fundamental', 'reference_degree', 'equivSteps', 'equivInterval',
    'rSteps', 'drSteps', 'hexSize', 'rotation', 'center_degree',
    'midiin_degree0', 'spectrum_colors', 'fundamental_color',
    'name', 'description', 'short_description',
    'hexatone_preset_source', 'hexatone_preset_name',
  ];
  scaleKeysToClear.forEach(key => sessionStorage.removeItem(key));
}

export const Loading = () => <LoadingIcon />;




const ua = navigator.userAgent;
const isSafariOnly = /Safari/.test(ua) && !/Chrome/.test(ua) && !/Chromium/.test(ua) && !/Firefox/.test(ua);
if (isSafariOnly) alert("Safari is not fully supported.\nFor the best experience please use Firefox or a Chromium-based browser such as Brave or Chrome.\nWeb MIDI features require a Chromium-based browser.");

const findPreset = (preset) => {
  for (let g of presets) {
    for (let p of g.settings) {
      if (p.name === preset) {
        return { ...p, scale_import: settingsToHexatonScala(p) };
      }
    }
  }
  console.log("Unable to find preset");
  return default_settings;
};

// Color fields only — changes here should NOT reconstruct the hex grid.
const normalizeColors = (settings) => ({
  fundamental_color: (settings.fundamental_color || "").replace(/#/, ''),
  note_colors: (settings.note_colors || []).map(c => c ? c.replace(/#/, '') : "ffffff"),
  spectrum_colors: settings.spectrum_colors,
});

// Everything except colors — changes here rebuild the Keys instance.
const normalizeStructural = (settings) => {
  const rotation = settings.rotation * Math.PI / 180.0;
  const result = { ...settings, keyCodeToCoords, rotation };

  if (settings.key_labels === "enumerate") {
    result["degree"] = true;
  } else if (settings.key_labels === "note_names") {
    result["note"] = true;
  } else if (settings.key_labels === "scala_names") {
    result["scala"] = true;
  } else if (settings.key_labels === "cents") {
    result["cents"] = true;
  } else if (settings.key_labels === "no_labels") {
    result["no_labels"] = true;
  };

  if (settings.scale) {
    const scaleAsStrings = settings.scale.map(i => String(i));
    const scala_names = scaleAsStrings.map(i => scalaToLabels(i));
    const scale = settings.scale.map(i => scalaToCents(String(i)));
    const equivInterval = scale.pop();
    scale.unshift(0);
    scala_names.pop();
    scala_names.unshift("1/1");
    result["scala_names"] = scala_names;
    result["scale"] = scale;
    result["equivInterval"] = equivInterval;
  }
  return result;
};

const normalize = (settings) => ({
  ...normalizeStructural(settings),
  ...normalizeColors(settings),
});

// Preset-specific fields are never restored from URL or localStorage on reload.
// They only come from the preset_values defaults or an explicit preset load.
const PRESET_SKIP_KEYS = [
  'name', 'description', 'scale', 'note_names', 'note_colors',
  'spectrum_colors', 'fundamental_color', 'fundamental', 'reference_degree',
  'center_degree', 'equivSteps', 'rSteps', 'drSteps', 'key_labels',
  'hexSize', 'rotation',
];
// Only these text fields need to start visually empty on a fresh load
const DISPLAY_EMPTY_KEYS = ['name', 'description', 'key_labels'];

// Scale hexSize down on phones (max-width 600px), but not below 20
const scaleHexSizeForScreen = (hexSize) => {
  const size = hexSize || 42; // default to 42 if undefined
  if (window.innerWidth <= 600 && size > 20) {
    return Math.max(20, Math.floor(size * 0.75));
  }
  return size;
};

// Scale-related keys to clear on reset (keeps output settings)
const SCALE_KEYS_TO_CLEAR = [
  'scale', 'scale_import', 'note_names', 'note_colors', 'key_labels',
  'fundamental', 'reference_degree', 'equivSteps', 'equivInterval',
  'rSteps', 'drSteps', 'hexSize', 'rotation', 'center_degree',
  'midiin_degree0', 'spectrum_colors', 'fundamental_color',
  'name', 'description', 'short_description',
];

const clearScaleSettings = () => {
  SCALE_KEYS_TO_CLEAR.forEach(key => sessionStorage.removeItem(key));
};

const sessionDefaults = {
  output_sample:    (sessionStorage.getItem("output_sample") ?? "true") !== "false",
  output_mts:       sessionStorage.getItem("output_mts") === "true",
  output_mpe:       sessionStorage.getItem("output_mpe") === "true",
  mpe_device:       sessionStorage.getItem("mpe_device")       || "OFF",
  mpe_master_ch:    sessionStorage.getItem("mpe_master_ch")    || "1",
  mpe_lo_ch:        parseInt(sessionStorage.getItem("mpe_lo_ch"))   || 2,
  mpe_hi_ch:        parseInt(sessionStorage.getItem("mpe_hi_ch"))   || 8,
  mpe_mode:         sessionStorage.getItem("mpe_mode")          || "Ableton_workaround",
  mpe_pitchbend_range: parseInt(sessionStorage.getItem("mpe_pitchbend_range")) || 48,
  instrument:       sessionStorage.getItem("instrument")        || "HvP8_retuned",
  midiin_device:    sessionStorage.getItem("midiin_device")     || "OFF",
  midiin_channel:   parseInt(sessionStorage.getItem("midiin_channel"))  || 0,
  midi_device:      sessionStorage.getItem("midi_device")       || "OFF",
  midi_channel:     parseInt(sessionStorage.getItem("midi_channel"))    || 0,
  midi_mapping:     sessionStorage.getItem("midi_mapping")      || "MTS1",
  midi_velocity:    parseInt(sessionStorage.getItem("midi_velocity"))   || 72,
  sysex_type:       parseInt(sessionStorage.getItem("sysex_type"))      || 126,
  device_id:        parseInt(sessionStorage.getItem("device_id"))       || 127,
  tuning_map_number:  parseInt(sessionStorage.getItem("tuning_map_number"))  || 0,
  tuning_map_degree0: sessionStorage.getItem("tuning_map_degree0") !== null ? parseInt(sessionStorage.getItem("tuning_map_degree0")) : null,
  fundamental_color: parseInt(sessionStorage.getItem("fundamental_color")) || "#f2e3e3",
  spectrum_colors: true,
  key_labels: 'no_labels',
  fundamental: 260.740741,
  reference_degree: 0,
  equivSteps: 12,
  scale: ["100.0", "200.0", "300.0", "400.0", "500.0", "600.0", "700.0", "800.0", "900.0", "1000.0", "1100.0", "1200.0"],
  rSteps: 2,
  drSteps: 1,
  center_degree: 0,
  hexSize: 42,
  rotation: -16.102113751,
};

const App = () => {
  const [loading, setLoading] = useState(0);
  const [ready, setReady] = useState(false);
  const [userHasInteracted, setUserHasInteracted] = useState(false);
  const [activeSource, setActiveSource] = useState(null);
  const [activePresetName, setActivePresetName] = useState(null);
  // Snapshot stored in state so updating it triggers a re-render and
  // isPresetDirty recalculates correctly.
  const [savedPresetSnapshot, setSavedPresetSnapshot] = useState(null);
  const keysRef = useRef(null); // live Keys instance for imperative color updates
  const synthRef = useRef(null); // live synth instance for imperative volume/mute control

  // Fields that count as "edits" for dirty detection.
  // Reuse the same field list for dirty detection
  const DIRTY_FIELDS = PRESET_SKIP_KEYS;

  const snapshotOf = (s) => {
    const snap = {};
    for (const k of DIRTY_FIELDS) snap[k] = JSON.stringify(s[k]);
    return snap;
  };

  const isDirty = (snap, s) => {
    if (!snap) return false;
    for (const k of DIRTY_FIELDS) {
      if (JSON.stringify(s[k]) !== snap[k]) return true;
    }
    return false;
  };
  const [importCount, setImportCount] = useState(0);

  const [settings, setSettings] = useQuery({
    name: ExtractString,
    description: ExtractString,

    // Input
    midiin_device: ExtractString,
    midiin_channel: ExtractInt,
    midiin_degree0: ExtractInt,

    // Output
    output_sample: ExtractBool,
    output_mts:    ExtractBool,
    output_mpe:    ExtractBool,
    mpe_device:    ExtractString,
    mpe_master_ch: ExtractString,
    mpe_lo_ch:     ExtractInt,
    mpe_hi_ch:     ExtractInt,
    mpe_mode:      ExtractString,
    mpe_pitchbend_range: ExtractInt,
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
    tuning_map_degree0: ExtractInt,

    // Layout
    rSteps: ExtractInt,
    drSteps: ExtractInt,
    hexSize: ExtractInt,
    rotation: ExtractInt,
    // Scale
    scale: ExtractJoinedString,
    key_labels: ExtractString,
    equivSteps: ExtractInt,
    note_names: ExtractJoinedString,
    spectrum_colors: ExtractBool,
    fundamental_color: ExtractString,
    note_colors: ExtractJoinedString

  }, {
    ...default_settings,
    ...sessionDefaults,
    // Preset-specific fields start empty — populated only when a preset is loaded.
    // scale/note_names/note_colors handle null gracefully (render empty table).
    name: '', description: '',
    note_names: null, note_colors: null,
  }, PRESET_SKIP_KEYS);

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
  const [synth, setSynth] = useState(null);
  const [midi, setMidi] = useState(null);
  const wait = l => l + 1;
  const signal = l => l - 1;

  useEffect(() => {
    enableMidi().catch(err => console.warn("WebMidi could not initialise:", err));

    if (navigator.requestMIDIAccess) {
      setLoading(wait);
      navigator.requestMIDIAccess({ sysex: true }).then(
        m => {
          setLoading(signal);
          onMIDISuccess(m);
        },
        onMIDIFailure
      );
    }
  }, []);

  useEffect(() => {
    const savedSource = sessionStorage.getItem('hexatone_preset_source');
    const savedName = sessionStorage.getItem('hexatone_preset_name');

    // Enable the app - this will trigger synth creation
    // On fresh load with defaults, still enable the app
    setReady(true);

    if (!savedSource || !savedName) return;

    if (savedSource === 'builtin') {
      setActiveSource('builtin');
      setActivePresetName(savedName);
      const presetData = findPreset(savedName);
      if (presetData) {
        const adjustedPreset = { ...presetData, hexSize: scaleHexSizeForScreen(presetData.hexSize) };
        setSavedPresetSnapshot(snapshotOf({ ...settings, ...adjustedPreset }));
        setSettings(() => ({ ...settings, ...adjustedPreset }));
      }
    } else if (savedSource === 'user') {
      const customPresets = loadCustomPresets();
      const preset = customPresets.find(p => p.name === savedName);
      if (preset) {
        setActiveSource('user');
        setActivePresetName(preset.name);
        const adjustedPreset = { ...preset, hexSize: scaleHexSizeForScreen(preset.hexSize) };
        setSavedPresetSnapshot(snapshotOf({ ...settings, ...adjustedPreset }));
        setSettings(() => ({ ...settings, ...adjustedPreset }));
      }
    }
  }, []);

  function onMIDISuccess(midiAccess) {
    console.log("Web MIDI API with sysex for MTS messages is ready!");
    setMidi(midiAccess);
  }

  function onMIDIFailure() {
    console.log('Web MIDI API could not initialise!');
  }

  useEffect(() => {
    if (!ready) return;

    const wantSample = settings.output_sample && settings.instrument && settings.instrument !== 'OFF' && settings.fundamental;
    const wantMts    = settings.output_mts && midi &&
                       settings.midi_device !== "OFF" && settings.midi_channel >= 0 &&
                       settings.midi_mapping && typeof settings.midi_velocity === "number";
    const wantMpe    = settings.output_mpe && midi &&
                       settings.mpe_device !== "OFF" &&
                       settings.mpe_lo_ch > 0 && settings.mpe_hi_ch >= settings.mpe_lo_ch;

    if (!wantSample && !wantMts && !wantMpe) {
      setSynth(null);
      return;
    }

    setLoading(wait);
    const promises = [];

    if (wantSample) {
      promises.push(
        create_sample_synth(settings.instrument, settings.fundamental, settings.reference_degree, settings.scale)
      );
    }
    if (wantMts) {
      promises.push(
        create_midi_synth(settings.midiin_device, settings.midiin_degree0,
          midi.outputs.get(settings.midi_device), settings.midi_channel,
          settings.midi_mapping, settings.midi_velocity, settings.fundamental,
          settings.sysex_type, settings.device_id)
      );
    }
    if (wantMpe) {
      promises.push(
        create_mpe_synth(
          midi.outputs.get(settings.mpe_device),
          settings.mpe_master_ch,
          settings.mpe_lo_ch,
          settings.mpe_hi_ch,
          settings.fundamental,
          settings.reference_degree,
          settings.center_degree,
          settings.midiin_degree0,
          settings.scale,
          settings.mpe_mode,
          settings.mpe_pitchbend_range ?? 48,
          settings.equivSteps,
          settings.equivInterval
        )
      );
    }

    Promise.all(promises).then(synths => {
      setLoading(signal);
      // Filter out null/undefined synths (e.g., MIDI device unavailable)
      const validSynths = synths.filter(s => s != null);
      if (validSynths.length === 0) {
        setSynth(null);
        return;
      }
      const s = validSynths.length === 1 ? validSynths[0] : create_composite_synth(validSynths);
      // Only call prepare() when user has interacted (not on initial page load)
      // This avoids Chrome's autoplay policy blocking AudioContext
      if (s.prepare && userHasInteracted) {
        s.prepare();
      }
      setSynth(s);
    });
  }, [settings.instrument, settings.fundamental, settings.reference_degree, settings.scale,
    settings.midi_device, settings.midi_channel, settings.midi_mapping, settings.midi_velocity,
    settings.output_sample, settings.output_mts,
    settings.output_mpe, settings.mpe_device, settings.mpe_master_ch, settings.mpe_lo_ch, settings.mpe_hi_ch, settings.mpe_pitchbend_range,
    midi]);

  // Keep synthRef in sync so volume/mute can be applied imperatively
  useEffect(() => { synthRef.current = synth; }, [synth]);

  // On first user interaction, prepare audio (if not already done)
  useEffect(() => {
    if (userHasInteracted && synth && synth.prepare) {
      synth.prepare();
    }
  }, [userHasInteracted, synth]);

  const COLOR_KEYS = new Set(['note_colors', 'spectrum_colors', 'fundamental_color']);
  const SCALE_KEYS = new Set(['scale', 'note_names', 'fundamental', 'reference_degree']);

  const onChange = (key, value) => {
    // If scale is about to change and sustain is active, release it first
    // to prevent stuck sustain state after Keys reconstruction
    if (SCALE_KEYS.has(key)) {
      if (keysRef.current && keysRef.current.state.sustain) {
        keysRef.current.sustainOff(true);
      }
      // Also reset the React latch state to match
      setLatch(false);
    }

    // When equivSteps changes, resize the scale array to match
    if (key === 'equivSteps') {
      setSettings(s => {
        const newSize = value;
        const currentScale = s.scale || [];
        let newScale;
        if (newSize > currentScale.length) {
          // Pad with default cents values (100 cents per degree)
          const padding = [];
          for (let i = currentScale.length; i < newSize - 1; i++) {
            padding.push(String((i + 1) * 100) + '.0');
          }
          // Last one should be the equave (newSize * 100 cents)
          padding.push(String(newSize * 100) + '.0');
          newScale = [...currentScale, ...padding];
        } else {
          // Truncate to new size
          newScale = currentScale.slice(0, newSize);
        }
        return { ...s, [key]: value, scale: newScale };
      });
      return;
    }

    setSettings(s => {
      const next = { ...s, [key]: value };
      // For color changes, also push directly to the live Keys instance so the
      // hex grid updates immediately during swatch drag without waiting for a
      // full React render cycle.
      if (COLOR_KEYS.has(key) && keysRef.current) {
        keysRef.current.updateColors({
          note_colors:       key === 'note_colors'       ? normalizeColors(next).note_colors       : normalizeColors(s).note_colors,
          spectrum_colors:   key === 'spectrum_colors'   ? value                                   : s.spectrum_colors,
          fundamental_color: key === 'fundamental_color' ? (value || '').replace(/#/, '')          : (s.fundamental_color || '').replace(/#/, ''),
        });
      }
      return next;
    });
  };

  const resetScale = () => {
    setUserHasInteracted(true);
    clearScaleSettings();
    // Reload the page to apply fresh defaults
    window.location.reload();
  };

  const onClearUserPresets = () => {
    // Get remaining presets after delete/clear
    const remaining = loadCustomPresets();
    
    // Clear user preset state
    setActiveSource(null);
    setActivePresetName(null);
    sessionStorage.removeItem('hexatone_preset_source');
    sessionStorage.removeItem('hexatone_preset_name');
    
    if (remaining.length > 0) {
      // Load the first remaining preset
      const preset = remaining[0];
      setActiveSource('user');
      setActivePresetName(preset.name);
      sessionStorage.setItem('hexatone_preset_source', 'user');
      sessionStorage.setItem('hexatone_preset_name', preset.name);
      const merged = { ...settings, ...preset };
      setSavedPresetSnapshot(snapshotOf(merged));
      setSettings(() => merged);
    } else {
      // No presets left - clear scale settings and reload
      setReady(true);
      setUserHasInteracted(true);
      clearScaleSettings();
      window.location.reload();
    }
  };

  const presetChanged = e => {
    if (!e.target.value) return;
    setReady(true);
    setUserHasInteracted(true); // User gesture - AudioContext can start
    setActiveSource('builtin');
    setActivePresetName(e.target.value);
    sessionStorage.setItem('hexatone_preset_source', 'builtin');
    sessionStorage.setItem('hexatone_preset_name', e.target.value);
    const presetData = findPreset(e.target.value);
    const adjustedPreset = { ...presetData, hexSize: scaleHexSizeForScreen(presetData.hexSize) };
    const mergedBuiltin = { ...settings, ...adjustedPreset };
    setSavedPresetSnapshot(snapshotOf(mergedBuiltin));
    setSettings(() => mergedBuiltin);
  };

  const onLoadCustomPreset = (preset) => {
    setReady(true);
    setUserHasInteracted(true); // User gesture - AudioContext can start
    setActiveSource('user');
    setActivePresetName(preset.name || null);
    sessionStorage.setItem('hexatone_preset_source', 'user');
    if (preset.name) {
      sessionStorage.setItem('hexatone_preset_name', preset.name);
    } else {
      sessionStorage.removeItem('hexatone_preset_name');
    }
    const adjustedPreset = { ...preset, hexSize: scaleHexSizeForScreen(preset.hexSize) };
    const mergedUser = { ...settings, ...adjustedPreset };
    setSavedPresetSnapshot(snapshotOf(mergedUser));
    setSettings(() => mergedUser);
  };

  const onImport = () => {
    setImportCount(c => c + 1);
    // On fresh load, scale exists but scale_import may not - ensure ready is set
    if (!settings.scale_import && settings.scale) {
      setReady(true);
      setUserHasInteracted(true);
    }
    setSettings(s => {
      if (s.scale_import) {
        const parsed = parseScale(s.scale_import);
        const { filename, description, equivSteps, scale, labels, colors } = parsed;
        const scala_names = parsedScaleToLabels(scale);

        const hasNames = parsed.hexatone_note_names && parsed.hexatone_note_names.some(n => n);
        const hasColors = parsed.hexatone_note_colors && parsed.hexatone_note_colors.some(c => c);
        const hasMetadata = hasNames || hasColors;

        let note_names, note_colors;

        if (hasNames) {
          note_names = parsed.hexatone_note_names;
        } else if (labels.some(l => l)) {
          const f_name = labels.pop();
          labels.unshift(f_name === 'null' || !f_name ? '' : f_name);
          note_names = labels;
        } else {
          note_names = [];
        }

        if (hasColors) {
          note_colors = parsed.hexatone_note_colors;
        } else if (colors.some(c => c)) {
          const f_color = colors.pop();
          colors.unshift(f_color === 'null' || !f_color ? '#ffffff' : f_color);
          note_colors = colors;
        } else {
          note_colors = [];
        }

        const fundamental = parsed.hexatone_fundamental || s.fundamental;
        const reference_degree = parsed.hexatone_reference_degree !== undefined
          ? parsed.hexatone_reference_degree
          : s.reference_degree;
        const midiin_degree0 = parsed.hexatone_midiin_degree0 || s.midiin_degree0;

        return {
          ...s,
          name: filename || s.name,
          description: description || s.description,
          equivSteps,
          scale,
          scala_names,
          note_names,
          note_colors,
          fundamental,
          reference_degree,
          midiin_degree0,
          key_labels: hasMetadata ? 'note_names' : 'scala_names',
          spectrum_colors: hasMetadata ? false : true,
          fundamental_color: hasMetadata ? s.fundamental_color : '#f2e3e3',
        };
      } else {
        return s;
      }
    });
  };

  const isValid = useMemo(() => (
    settings.rSteps && settings.drSteps &&
    settings.hexSize && settings.hexSize >= 20 && typeof settings.rotation === "number" &&
    settings.scale && settings.equivSteps &&
    (settings.no_labels || settings.degree && settings.note_names || !settings.degree) &&
    ((settings.spectrum_colors && settings.fundamental_color) || settings.note_colors)
  ), [settings]);

  // Stable string keys for array deps — prevents new array references from
  // triggering spurious memo recomputations and Keys reconstructions.
  const scaleKey        = JSON.stringify(settings.scale);
  const noteNamesKey    = JSON.stringify(settings.note_names);
  const noteColorsKey   = JSON.stringify(settings.note_colors);

  // Structural settings: everything except colors. Memoized so Keys is only
  // reconstructed when scale/layout/MIDI changes — not on every color-picker drag.
  const structuralSettings = useMemo(() => normalizeStructural(settings), [
    settings.rSteps, settings.drSteps, settings.hexSize, settings.rotation,
    scaleKey, settings.equivSteps, noteNamesKey, settings.key_labels,
    settings.fundamental, settings.reference_degree, settings.center_degree,
    settings.instrument, settings.midiin_device,
    settings.midiin_channel, settings.midiin_degree0,
    settings.midi_device, settings.midi_channel, settings.midi_mapping,
    settings.midi_velocity, settings.sysex_auto, settings.sysex_type,
    settings.mpe_device, settings.mpe_master_ch, settings.mpe_lo_ch, settings.mpe_hi_ch,
  ]);

  // Color settings: only the color fields. Changes here update the live Keys
  // instance imperatively (via updateColors) without reconstructing it.
  const colorSettings = useMemo(() => normalizeColors(settings), [
    noteColorsKey, settings.spectrum_colors, settings.fundamental_color,
  ]);

  const normalizedSettings = useMemo(() => ({
    ...structuralSettings, ...colorSettings,
  }), [structuralSettings, colorSettings]);

  // Imperative volume/mute — does not rebuild Keys
  const onVolumeChange = useCallback((volume, muted) => {
    if (synthRef.current && synthRef.current.setVolume) {
      synthRef.current.setVolume(muted ? 0 : volume);
    }
  }, []);

  // Null synth: visual-only, no audio. Used when no output is configured.
  const nullSynth = {
    makeHex: (coords, cents) => ({
      coords, cents, release: false,
      noteOn: () => {}, noteOff: () => {}, retune: () => {},
    }),
  };

  return (
    <div className={active ? "hide" : "show"} onClick={() => setUserHasInteracted(true)}>
      {loading === 0 && ready && isValid && (
        <Keyboard synth={synth || nullSynth} settings={normalizedSettings}
                  structuralSettings={structuralSettings}
                  onKeysReady={useCallback(keys => { keysRef.current = keys; }, [])}
                  onLatchChange={useCallback(v => setLatch(v), [])}
                  active={active} />
      )}

      {loading > 0 && <Loading/>}
      <button id="sidebar-button" className={latch ? "latch-active" : ""} onClick={() => setActive(s => !s)} onTouchStart={onSidebarTouchStart} onTouchEnd={onSidebarTouchEnd} onTouchMove={onSidebarTouchMove} onContextMenu={e => e.preventDefault()}>
        <div>&gt;</div>
      </button>
      <div id="bottom-bar">
        <button id="sustain-island"
          className={latch ? "latch-active" : ""}
          onClick={(e) => { e.stopPropagation(); if (keysRef.current) keysRef.current.latchToggle(); }}
          onPointerDown={(e) => { if (e.pointerType === "touch") e.preventDefault(); }}
          onContextMenu={e => e.preventDefault()}>
          <b>SUSTAIN</b>
        </button>
        <button id="redraw-button"
          title="Redraw keyboard"
          onPointerDown={(e) => { e.preventDefault(); if (keysRef.current) keysRef.current.resizeHandler(); }}
          onClick={(e) => { e.stopPropagation(); if (keysRef.current) keysRef.current.resizeHandler(); }}
          onContextMenu={e => e.preventDefault()}>
          ↺
        </button>
        <button id="panic-button"
          title="Panic - kill all stuck notes"
          onClick={(e) => { e.stopPropagation(); if (keysRef.current) keysRef.current.panic(); }}
          onContextMenu={e => e.preventDefault()}>
          <b>ALL NOTES OFF</b>
        </button>
      </div>
      <nav id="sidebar">
        <h1>
          PLAINSOUND HEXATONE
        </h1>
        <p>
          <em>TO PLAY: click on notes, use a touchscreen, attach a MIDI keyboard or a Lumatone. A computer keyboard may also be used as an input device: the H key is mapped to Central Scale Degree, the spacebar acts as a sustain pedal, and the ESC key functions as a latch to permit hands free sustains.</em>
        </p>
        <Settings presetChanged={presetChanged}
                    presets={presets}
                    onChange={onChange}
                    onVolumeChange={onVolumeChange}
                    onImport={onImport}
                    importCount={importCount}
                    onLoadCustomPreset={onLoadCustomPreset}
                    onClearUserPresets={onClearUserPresets}
                    activeSource={activeSource}
                    activePresetName={activePresetName}
                    isPresetDirty={isDirty(savedPresetSnapshot, settings)}
                    onRevertBuiltin={() => {
                      setUserHasInteracted(true);
                      if (activePresetName) {
                        const presetData = findPreset(activePresetName);
                        const mergedRevertB = { ...settings, ...presetData };
                        setSavedPresetSnapshot(snapshotOf(mergedRevertB));
                        setSettings(() => mergedRevertB);
                      }
                    }}
                    onRevertUser={() => {
                      setUserHasInteracted(true);
                      if (activePresetName) {
                        const saved = loadCustomPresets().find(p => p.name === activePresetName);
                        if (saved) {
                          const mergedRevertU = { ...settings, ...saved };
                          setSavedPresetSnapshot(snapshotOf(mergedRevertU));
                          setSettings(() => mergedRevertU);
                        }
                      }
                    }}
                    settings={settings}
                    midi={midi}
                    instruments={instruments}
                    keysRef={keysRef}/>
        <Blurb />
      </nav>
    </div>
  );
};

export default App;