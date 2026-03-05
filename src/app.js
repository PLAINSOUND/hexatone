import { h, render } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';

import Keyboard from './keyboard';
import { presets, default_settings } from './settings/preset_values';
import { parseScale, scalaToCents, scalaToLabels, parsedScaleToLabels } from './settings/scale/parse-scale.js';
import { create_sample_synth } from './sample_synth';
import { instruments } from './sample_synth/instruments';

import { enableMidi, midi_in } from './settings/midi/midiin';
import { create_midi_synth} from './midi_synth';

import keyCodeToCoords from './settings/keycodes';
import { useQuery, Extract, ExtractInt, ExtractString, ExtractFloat, ExtractBool, ExtractJoinedString } from './use-query';
import Settings from './settings';
import Blurb from './blurb';

import PropTypes from 'prop-types';

import "normalize.css";
import "./hex-style.css";
import LoadingIcon from './hex.svg?react';
import './loader.css';

export const Loading = () => <LoadingIcon />;

let notChrome = !/Chrome/.test(navigator.userAgent);
let alertMessage = "Please use a desktop version of Google Chrome or Microsoft Edge to fully access this site.\nSome key features of the Web MIDI API do not currently work on phones or in other browsers. For Apple devices a recent version of iOS is required."
if (notChrome) alert(alertMessage);

const findPreset = (preset) => {
  for (let g of presets) {
    for (let p of g.settings) {
      if (p.name === preset) {
        return p;
      }
    }
  }
  console.log("Unable to find preset");
  return default_settings;
};

const normalize = (settings) => {
  const fundamental_color = (settings.fundamental_color || "").replace(/#/, '');
  const note_colors = settings.note_colors.map(c => c ? c.replace(/#/, '') : "ffffff");
  const rotation = settings.rotation * Math.PI / 180.0; // convert to radians
  const result = { ...settings, fundamental_color, keyCodeToCoords, note_colors, rotation };
  
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
    const scala_names = settings.scale.map(i => scalaToLabels(i));
    const scale = settings.scale.map(i => scalaToCents(i));
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

const sessionDefaults = {
  output:           sessionStorage.getItem("output")            || "sample",
  instrument:       sessionStorage.getItem("instrument")        || "WMRIByzantineST",
  midiin_device:    sessionStorage.getItem("midiin_device")     || "OFF",
  midiin_channel:   parseInt(sessionStorage.getItem("midiin_channel"))  || 0,
  midi_device:      sessionStorage.getItem("midi_device")       || "OFF",
  midi_channel:     parseInt(sessionStorage.getItem("midi_channel"))    || 0,
  midi_mapping:     sessionStorage.getItem("midi_mapping")      || "sequential",
  midi_velocity:    parseInt(sessionStorage.getItem("midi_velocity"))   || 72,
  sysex_type:       parseInt(sessionStorage.getItem("sysex_type"))      || 127,
  device_id:        parseInt(sessionStorage.getItem("device_id"))       || 127,
  tuning_map_number:  parseInt(sessionStorage.getItem("tuning_map_number"))  || 0,
  tuning_map_degree0: parseInt(sessionStorage.getItem("tuning_map_degree0")) || 60,
  reference_degree: 0,
};

const App = () => {
  const [loading, setLoading] = useState(0);
  const [ready, setReady] = useState(false);

  const [settings, setSettings] = useQuery({
    name: ExtractString,
    description: ExtractString,

    // Input
    midiin_device: ExtractString,
    midiin_channel: ExtractInt,
    midiin_degree0: ExtractInt,

    // Output
    output: ExtractString,
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
    urSteps: ExtractInt,
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

  }, { ...default_settings, ...sessionDefaults });

  const [active, setActive] = useState(false);
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

  function onMIDISuccess(midiAccess) {
    console.log("Web MIDI API with sysex for MTS messages is ready!");
    setMidi(midiAccess);
  }

  function onMIDIFailure() {
    console.log('Web MIDI API could not initialise!');
  }

  useEffect(() => {
    if (!ready) return;

    if (settings.output === "sample"
        && settings.instrument && settings.fundamental) {
      setLoading(wait);
      create_sample_synth(settings.instrument, settings.fundamental, settings.reference_degree, settings.scale)
        .then(s => {
          setLoading(signal);
          setSynth(s);
        });
    }
    if (midi && settings.output === "midi" && (settings.midi_device !== "OFF") &&
      (settings.midi_channel >= 0) && settings.midi_mapping &&
      typeof settings.midi_velocity === "number") {
      setLoading(wait);

      create_midi_synth(settings.midiin_device, settings.midiin_degree0, midi.outputs.get(settings.midi_device), settings.midi_channel, settings.midi_mapping, settings.midi_velocity, settings.fundamental)
        .then(s => {
          setLoading(signal);
          setSynth(s);
        });
    }
  }, [settings.instrument, settings.fundamental, settings.reference_degree, settings.scale,
    settings.midi_device, settings.midi_channel, settings.midi_mapping, settings.midi_velocity,
    settings.output, midi]);

  const onChange = (key, value) => {
    // ─── FIX 2: Always use the setter — never mutate settings directly ─────────
    // Previously some callers did `settings.someKey = value` which bypasses
    // Preact's state tracking entirely and won't trigger a re-render.
    // This single setter is the only correct way to update settings.
    setSettings(s => ({ ...s, [key]: value }));
  };

  const presetChanged = e => {
    if (synth && synth.prepare) synth.prepare();
    setReady(true);
    setSettings(s => ({ ...s, ...findPreset(e.target.value) }));
  };

  const onImport = () => {
    setSettings(s => {
      if (s.scale_import) {
        const { filename, description, equivSteps, scale, labels, colors } = parseScale(s.scale_import);
        const scala_names = parsedScaleToLabels(scale);
        const f_color = colors.pop();
        const f_name = labels.pop();
        colors.unshift(f_color === "null" ? "#ffffff" : f_color);
        labels.unshift(f_name === "null" ? "" : f_name);
        return { ...s, name: filename, description, equivSteps, scale, scala_names, note_names: labels, note_colors: colors, key_labels: "scala_names" };
      } else {
        return s;
      }
    });
  };

  const isValid = useMemo(() => (
    (((settings.output === "midi") && (settings.midi_device !== "OFF") && (settings.midi_channel >= 0) && settings.midi_mapping &&
      (typeof settings.midi_velocity === "number") && (settings.midi_velocity > 0)) ||
     (settings.output === "sample" && (settings.fundamental >= 0.015625) && settings.instrument)) &&
      settings.rSteps && settings.urSteps &&
      settings.hexSize && settings.hexSize >= 20 && typeof settings.rotation === "number" &&
      settings.scale && settings.equivSteps &&
      (settings.no_labels || settings.degree && settings.note_names || !settings.degree) &&
      ((settings.spectrum_colors && settings.fundamental_color) || settings.note_colors)
  ), [settings]);

  return (
    <div className={active ? "hide" : "show"}>
      {loading === 0 && ready && isValid && synth && (
        <Keyboard synth={synth} settings={normalize(settings)}
                  active={active} />
      )}

      {loading > 0 && <Loading/>}
      <button id="sidebar-button" onClick={() => setActive(s => !s)}>
        <div>&gt;</div>
      </button>
      <nav id="sidebar">
        <h1>
          PLAINSOUND HEXATONE
        </h1>
        <p>
          <em>TO PLAY: click on notes, use a touchscreen, attach a MIDI keyboard or a Lumatone. When this sidebar is minimised, a computer keyboard may also be used as an input device. The H key is mapped to scale degree 0 and the spacebar acts as a sustain pedal, allowing chords to be played.</em>
        </p>
        <Settings presetChanged={presetChanged}
                    presets={presets}
                    onChange={onChange}
                    onImport={onImport}
                    settings={settings}
                    midi={midi}
                    instruments={instruments}/>
        <Blurb />
      </nav>
    </div>
  );
};

export default App;
