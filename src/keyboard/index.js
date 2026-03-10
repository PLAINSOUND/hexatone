import { h, render, Fragment } from 'preact';
import { useRef, useEffect } from 'preact/hooks';
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
  useEffect(() => {
    const keys = new Keys(canvas.current, props.settings, props.synth, props.active);
    keysRef.current = keys;
    //console.log('[Keyboard] Keys constructed, calling onKeysReady');
    if (props.onKeysReady) props.onKeysReady(keys);
    //console.log('[Keyboard] onKeysReady done');
    return () => keys.deconstruct();
  }, [canvas, props.structuralSettings, props.synth]);

  // When colors change, push them into the live Keys instance and redraw immediately.
  const noteColorsKey = props.settings.note_colors ? JSON.stringify(props.settings.note_colors) : '';
  useEffect(() => {
    if (keysRef.current && props.settings) {
      keysRef.current.updateColors({
        note_colors:       props.settings.note_colors,
        spectrum_colors:   props.settings.spectrum_colors,
        fundamental_color: props.settings.fundamental_color,
      });
    }
  }, [noteColorsKey, props.settings.spectrum_colors, props.settings.fundamental_color]);

  return (
    <Fragment>
      <canvas ref={canvas} tabindex="1" className="keyboard"
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
    midiin_degree0: PropTypes.number,

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
    tuning_map_degree0: PropTypes.number,

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