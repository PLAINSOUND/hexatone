import { h, render, Fragment } from 'preact';
import { useRef, useEffect, useState } from 'preact/hooks';
import Keys from './keys';
import "./keyboard.css";
import PropTypes from 'prop-types';

const Keyboard = (props) => {
  if (props.synth.prepare) {
    props.synth.prepare();
  }
  const canvas = useRef(null);
  useEffect(() => {
    const keys = new Keys(canvas.current, props.settings, props.synth, props.active);
    return () => keys.deconstruct();
  }, [canvas, props.settings, props.synth]);

  return (
    <Fragment>
      <canvas ref={canvas} tabindex="1" className="keyboard"
        width={window.innerWidth} height={window.innerHeight}>
      </canvas>
    </Fragment>
  );
};

Keyboard.propTypes = {
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
    urSteps: PropTypes.number,
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
