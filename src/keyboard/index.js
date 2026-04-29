import { Fragment } from "preact";
import { useRef, useEffect } from "preact/hooks";
import Keys from "./keys";
import "./keyboard.css";
import PropTypes from "prop-types";

const Keyboard = (props) => {
  const canvas = useRef(null);
  const keysRef = useRef(null);

  // ── Keys reconstruction ────────────────────────────────────────────────────
  // Runs when structural settings change. LED drivers (Exquis, Lumatone,
  // LinnStrument) are managed in app.jsx and assigned here after construction.
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
    // Apply current label settings immediately after construction so the initial
    // draw has the correct label mode even if labelSettings changed since Keys was last built.
    if (props.labelSettings) keys.updateLabels(props.labelSettings);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- other props are stable callbacks or covered by structuralSettings
  }, [canvas, props.structuralSettings, props.inputRuntime, props.initialModulationLibrary]);

  // Output/synth changes should not tear down the live keyboard. Existing notes
  // keep their current hex objects so tails can decay naturally; new notes use
  // the latest synth/output configuration.
  useEffect(() => {
    if (keysRef.current?.updateLiveOutputState) {
      keysRef.current.updateLiveOutputState(props.liveOutputSettings, props.synth);
    }
  }, [props.liveOutputSettings, props.synth]);

  // After every render, schedule a redraw via rAF.
  const renderCount = useRef(0);
  useEffect(() => {
    renderCount.current += 1;
    if (renderCount.current <= 1) return;
    let raf;
    if (keysRef.current)
      raf = requestAnimationFrame(() => keysRef.current && keysRef.current.resizeHandler());
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  });

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

  const noteColorsKey = props.settings.note_colors
    ? JSON.stringify(props.settings.note_colors)
    : "";
  useEffect(() => {
    if (keysRef.current && props.settings) {
      keysRef.current.updateColors({
        note_colors: props.settings.note_colors,
        spectrum_colors: props.settings.spectrum_colors,
        fundamental_color: props.settings.fundamental_color,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- props.settings.note_colors covered by noteColorsKey
  }, [noteColorsKey, props.settings.spectrum_colors, props.settings.fundamental_color]);

  // Label changes are display-only — update imperatively without reconstructing Keys.
  useEffect(() => {
    if (keysRef.current && props.labelSettings) {
      keysRef.current.updateLabels(props.labelSettings);
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
  structuralSettings: PropTypes.object,
  liveOutputSettings: PropTypes.object,
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
    midiin_channel: PropTypes.number,
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
    cents: PropTypes.arrayOf(PropTypes.string),
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
