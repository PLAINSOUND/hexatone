import { primeSharedSampleAudio } from "../sample_synth/prime-shared-audio.js";

export async function createDsfTest() {
  const context = await primeSharedSampleAudio();

  const processorUrl = new URL("./dsf-processor.js", import.meta.url);
  await context.audioWorklet.addModule(processorUrl);

  const node = new AudioWorkletNode(context, "hexatone-dsf", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });

  node.connect(context.destination);

  return {
    start(frequency = 440) {
      node.port.postMessage({ command: "start", frequency });
    },

    frequency(frequency) {
      node.port.postMessage({ command: "frequency", frequency });
    },

    stop() {
      node.port.postMessage({ command: "stop" });
    },

    disconnect() {
      node.disconnect();
    },
  };
}
