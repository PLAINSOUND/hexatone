import { h, render, Fragment } from 'preact';
import { useRef, useEffect } from 'preact/hooks';
import Keys from './keys';
import "./keyboard.css";
import PropTypes from 'prop-types';

const Keyboard = (props) => {
  const canvas  = useRef(null);
  const keysRef = useRef(null);

  // ── Keys reconstruction ────────────────────────────────────────────────────
  // Runs when structural settings change. ExquisLEDs is managed in app.jsx
  // and assigned to keys.exquisLEDs via props.exquisLedsRef after construction.
  useEffect(() => {
    const keys = new Keys(
      canvas.current, props.settings, props.synth, props.active,
      props.onLatchChange, props.lumatoneRawPorts, props.onTakeSnapshot,
      props.inputRuntime, props.onFirstInteraction,
    );
    keys.exquisLEDs = props.exquisLedsRef?.current ?? null;
    keysRef.current = keys;
    if (props.onKeysReady) props.onKeysReady(keys);
    return () => {
      keys.exquisLEDs = null;
      keys.deconstruct();
    };
  }, [canvas, props.structuralSettings, props.inputRuntime]);

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
    if (keysRef.current) raf = requestAnimationFrame(() => keysRef.current && keysRef.current.resizeHandler());
    return () => { if (raf) cancelAnimationFrame(raf); };
  });

  useEffect(() => {
    if (keysRef.current) {
      keysRef.current.resizeHandler();
      keysRef.current.typing = props.active;
      if (!props.active && typeof keysRef.current.releaseAllKeyboardNotes === 'function')
        keysRef.current.releaseAllKeyboardNotes();
    }
  }, [props.active]);

  useEffect(() => {
    if (keysRef.current) {
      keysRef.current.setMidiLearnMode(!!props.midiLearnActive, props.onAnchorLearn);
    }
  }, [props.midiLearnActive, props.onAnchorLearn]);

  const noteColorsKey = props.settings.note_colors ? JSON.stringify(props.settings.note_colors) : '';
  useEffect(() => {
    if (keysRef.current && props.settings) {
      keysRef.current.updateColors({
        note_colors: props.settings.note_colors,
        spectrum_colors: props.settings.spectrum_colors,
        fundamental_color: props.settings.fundamental_color,
      });
    }
  }, [noteColorsKey, props.settings.spectrum_colors, props.settings.fundamental_color]);

  return (
    <Fragment>
      <canvas ref={canvas} tabindex="1" className="keyboard" onContextMenu={e => e.preventDefault()}
        width={window.innerWidth} height={window.innerHeight}>
      </canvas>
    </Fragment>
  );
};

Keyboard.propTypes = {
  structuralSettings: PropTypes.object,
  liveOutputSettings: PropTypes.object,
  exquisLedsRef: PropTypes.object,
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
    direct_mode: PropTypes.string,
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
  synth: PropTypes.object.isRequired,
};

export default Keyboard;
