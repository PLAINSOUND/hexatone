import { h, render, Fragment } from 'preact';
import { useRef, useEffect, useCallback } from 'preact/hooks';
import Keys from './keys';
import "./keyboard.css";
import PropTypes from 'prop-types';

const Keyboard = (props) => {
  if (props.synth.prepare) {
    props.synth.prepare();
  }
  const canvas = useRef(null);
  const keysRef = useRef(null);

  // Reconstruct Keys only when structural settings change (scale, layout, MIDI) —
  // NOT when colors change. Color changes are handled imperatively below.

  // Reconstruct Keys only when structural settings change (scale, layout, MIDI) —
  // NOT when colors change. Color changes are handled imperatively below.
  useEffect(() => {
    const keys = new Keys(canvas.current, props.settings, props.synth, props.active, props.onLatchChange);
    keysRef.current = keys;
    //console.log('[Keyboard] Keys constructed, calling onKeysReady');
    if (props.onKeysReady) props.onKeysReady(keys);
    //console.log('[Keyboard] onKeysReady done');
    return () => keys.deconstruct();
  }, [canvas, props.structuralSettings, props.synth]);

  // After every render that doesn't reconstruct Keys, schedule a redraw via
  // requestAnimationFrame so it runs after the browser has finished painting.
  // This covers: latch colour changes, loading state changes, any parent
  // re-render that clears the canvas without triggering a Keys reconstruction.
  const renderCount = useRef(0);
  useEffect(() => {
    renderCount.current += 1;
    if (renderCount.current <= 1) return; // skip first mount — constructor handles it
    let raf;
    if (keysRef.current) raf = requestAnimationFrame(() => keysRef.current && keysRef.current.resizeHandler());
    return () => { if (raf) cancelAnimationFrame(raf); };
  });  // no deps — runs after every render

  // Also trigger immediately (not just rAF) on sidebar open/close so the
  // CSS transition has the correct canvas size from the start, and update
  // the typing state so keyboard keys don't trigger when sidebar is open.
  // Note: props.active=true means sidebar is open, so typing should be true.
  useEffect(() => {
    if (keysRef.current) {
      keysRef.current.resizeHandler();
      keysRef.current.typing = props.active;
      // When sidebar opens, release any computer keyboard notes that are held.
      // onKeyUp won't fire for them once typing becomes true (sidebar has focus),
      // so without this they stay stuck indefinitely.
      if (!props.active && typeof keysRef.current.releaseAllKeyboardNotes === 'function')
        keysRef.current.releaseAllKeyboardNotes();
    }
  }, [props.active]);

  // Imperatively set/clear MIDI-learn mode on the live Keys instance.
  useEffect(() => {
    if (keysRef.current) {
      keysRef.current.setMidiLearnMode(!!props.midiLearnActive, props.onAnchorLearn);
    }
  }, [props.midiLearnActive, props.onAnchorLearn]);

  // When colors change, push them into the live Keys instance and redraw immediately.
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
  settings: PropTypes.shape({
    keyCodeToCoords: PropTypes.object,
    degree: PropTypes.bool,
    note: PropTypes.bool,
    scala: PropTypes.bool,
    no_labels: PropTypes.bool,

    // Input
    midiin_device: PropTypes.string,
    midiin_channel: PropTypes.number,
    midiin_central_degree: PropTypes.number,

    // Output
    output: PropTypes.string,
    instrument: PropTypes.string,
    fundamental: PropTypes.number,
    reference_degree: PropTypes.number,
    midi: PropTypes.string,
    midi_device: PropTypes.string,
    midi_channel: PropTypes.number,
    midi_mapping: PropTypes.string,
    sysex_auto: PropTypes.bool,
    sysex_type: PropTypes.number,
    device_id: PropTypes.number,
    tuning_map_number: PropTypes.number,

    // Layout
    rSteps: PropTypes.number,
    drSteps: PropTypes.number,
    hexSize: PropTypes.number,
    rotation: PropTypes.number,
    // Scale
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