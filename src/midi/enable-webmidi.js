import { WebMidi } from "webmidi";

export function enableMidi(options = {}) {
  const { sysex = false } = options;
  return WebMidi.enable({ sysex });
}

// Inputs
// WebMidi.inputs.forEach(input => console.log(input.manufacturer, input.name, input.id));

// Outputs
// WebMidi.outputs.forEach(output => console.log(output.manufacturer, output.name, output.id));
