import { Fragment } from "preact";
import { useRef, useEffect } from "preact/hooks";
import Keys from "./keys";
import "./keyboard.css";
import PropTypes from "prop-types";

const sameArray = (a = [], b = []) => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
};

const labelsMatchSettings = (labels, settings) => {
  if (!labels || !settings) return true;
  for (const flag of ["degree", "note", "scala", "cents", "heji", "equaves", "no_labels"]) {
    if (!!labels[flag] !== !!settings[flag]) return false;
  }
  return (
    labels.key_labels === settings.key_labels &&
    sameArray(labels.note_names, settings.note_names) &&
    sameArray(labels.scala_names, settings.scala_names) &&
    sameArray(labels.heji_names, settings.heji_names) &&
    labels.heji_anchor_label_eff === settings.heji_anchor_label_eff &&
    labels.heji_anchor_ratio_eff === settings.heji_anchor_ratio_eff &&
    labels.reference_degree === settings.reference_degree
  );
};

const Keyboard = (props) => {
  const canvas = useRef(null);
  const keysRef = useRef(null);
  const appliedLabelSettingsRef = useRef(null);

  // ── Keys reconstruction ────────────────────────────────────────────────────
  // Runs only when App's settings-impact registry says the keyboard must be
  // reconstructed. Live input/output/color/label updates use imperative paths.
  useEffect(() => {
    const keys = new Keys(
      canvas.current,
      props.settings,
      props.synth,
      props.active,
      props.onLatchChange,
      props.onModulationArmChange,
      props.onTakeSnapshot,
      props.inputRuntime,
      props.onFirstInteraction,
      props.tuningRuntime,
      props.onModulationStateChange,
      props.initialModulationLibrary,
    );
    keys.lumatoneLEDs = props.lumatoneLedsRef?.current ?? null;
    keys.exquisLEDs = props.exquisLedsRef?.current ?? null;
    keys.linnstrumentLEDs = props.linnstrumentLedsRef?.current ?? null;
    keysRef.current = keys;
    // Keys already draws once during construction from props.settings. Avoid an
    // immediate duplicate redraw when labelSettings is the same payload.
    if (props.labelSettings && !labelsMatchSettings(props.labelSettings, props.settings)) {
      keys.updateLabels(props.labelSettings);
    }
    appliedLabelSettingsRef.current = props.labelSettings ?? null;
    if (props.onModulationStateChange && typeof keys.getModulationState === "function") {
      props.onModulationStateChange(keys.getModulationState());
    }
    if (props.onKeysReady) props.onKeysReady(keys);
    return () => {
      keys.lumatoneLEDs = null;
      keys.exquisLEDs = null;
      keys.linnstrumentLEDs = null;
      keys.deconstruct();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- other props are stable callbacks or covered by reconstructionKey
  }, [canvas, props.reconstructionKey]);

  useEffect(() => {
    if (keysRef.current?.updateInputRuntime) {
      keysRef.current.updateInputRuntime(props.inputRuntime, props.liveInputSettings);
    }
  }, [props.inputRuntime, props.liveInputSettings]);

  // Output/synth changes should not tear down the live keyboard. Existing notes
  // keep their current hex objects so tails can decay naturally; new notes use
  // the latest synth/output configuration.
  useEffect(() => {
    if (keysRef.current?.updateLiveOutputState) {
      keysRef.current.updateLiveOutputState(props.liveOutputSettings, props.synth);
    }
  }, [props.liveOutputSettings, props.synth]);

  useEffect(() => {
    if (keysRef.current) {
      keysRef.current.resizeHandler();
      keysRef.current.typing = props.active;
      if (!props.active && typeof keysRef.current.releaseAllKeyboardNotes === "function")
        keysRef.current.releaseAllKeyboardNotes();
    }
  }, [props.active]);

  useEffect(() => {
    if (keysRef.current) {
      keysRef.current.setMidiLearnMode(!!props.midiLearnActive, props.onAnchorLearn);
    }
  }, [props.midiLearnActive, props.onAnchorLearn]);

  useEffect(() => {
    if (keysRef.current && props.colorSettings) {
      keysRef.current.updateColors(props.colorSettings);
    }
  }, [props.colorSettings]);

  // Label changes are display-only — update imperatively without reconstructing Keys.
  useEffect(() => {
    if (
      keysRef.current &&
      props.labelSettings &&
      appliedLabelSettingsRef.current !== props.labelSettings
    ) {
      keysRef.current.updateLabels(props.labelSettings);
      appliedLabelSettingsRef.current = props.labelSettings;
    }
  }, [props.labelSettings]);

  return (
    <Fragment>
      <canvas
        ref={canvas}
        tabindex="1"
        className="keyboard"
        onContextMenu={(e) => e.preventDefault()}
        width={window.innerWidth}
        height={window.innerHeight}
      ></canvas>
    </Fragment>
  );
};

Keyboard.propTypes = {
  reconstructionKey: PropTypes.string,
  liveInputSettings: PropTypes.object,
  liveOutputSettings: PropTypes.object,
  colorSettings: PropTypes.object,
  lumatoneLedsRef: PropTypes.object,
  exquisLedsRef: PropTypes.object,
  linnstrumentLedsRef: PropTypes.object,
  settings: PropTypes.shape({
    keyCodeToCoords: PropTypes.object,
    degree: PropTypes.bool,
    note: PropTypes.bool,
    scala: PropTypes.bool,
    no_labels: PropTypes.bool,
    midiin_device: PropTypes.string,
    midiin_central_degree: PropTypes.number,
    output: PropTypes.string,
    instrument: PropTypes.string,
    fundamental: PropTypes.number,
    reference_degree: PropTypes.number,
    mts_bulk_mode: PropTypes.string,
    midi: PropTypes.string,
    midi_device: PropTypes.string,
    midi_channel: PropTypes.number,
    midi_mapping: PropTypes.string,
    sysex_auto: PropTypes.bool,
    sysex_type: PropTypes.number,
    device_id: PropTypes.number,
    tuning_map_number: PropTypes.number,
    rSteps: PropTypes.number,
    drSteps: PropTypes.number,
    hexSize: PropTypes.number,
    rotation: PropTypes.number,
    scale: PropTypes.arrayOf(PropTypes.number),
    equivInterval: PropTypes.number,
    equivSteps: PropTypes.number,
    scala_names: PropTypes.arrayOf(PropTypes.string),
    cents: PropTypes.bool,
    note_names: PropTypes.arrayOf(PropTypes.string),
    note_colors: PropTypes.arrayOf(PropTypes.string),
    spectrum_colors: PropTypes.bool,
    fundamental_color: PropTypes.string,
  }).isRequired,
  tuningRuntime: PropTypes.shape({
    scale: PropTypes.arrayOf(PropTypes.number),
    equivInterval: PropTypes.number,
    equivSteps: PropTypes.number,
  }),
  onModulationArmChange: PropTypes.func,
  onModulationStateChange: PropTypes.func,
  synth: PropTypes.object.isRequired,
};

export default Keyboard;
