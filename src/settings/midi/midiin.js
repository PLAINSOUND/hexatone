import { WebMidi } from "webmidi";

export var midi_in = [];

export function enableMidi(options = {}) {
  const { sysex = false } = options;
  return WebMidi
    .enable({ sysex })
    .then(() => {
      midi_in = WebMidi.inputs; // assign to global
    });
}


  // Inputs
  // WebMidi.inputs.forEach(input => console.log(input.manufacturer, input.name, input.id));
  
  // Outputs
  // WebMidi.outputs.forEach(output => console.log(output.manufacturer, output.name, output.id));
