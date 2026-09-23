/**
 * Small WebMidi.enable adapter for permission requests in use-synth-wiring.
 * The caller owns user intent, SysEx choice, error presentation and device discovery.
 */

import { WebMidi } from "webmidi";

export function enableMidi(options = {}) {
  const { sysex = false } = options;
  return WebMidi.enable({ sysex });
}

// Inputs
// WebMidi.inputs.forEach(input => console.log(input.manufacturer, input.name, input.id));

// Outputs
// WebMidi.outputs.forEach(output => console.log(output.manufacturer, output.name, output.id));
