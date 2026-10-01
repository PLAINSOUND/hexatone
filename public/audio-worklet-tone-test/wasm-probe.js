import createTiny from "./tiny.js";

class WasmProbeProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.initialize(options.processorOptions.wasmBytes);
  }

  async initialize(wasmBytes) {
    try {
      const module = await createTiny({ 
        wasmBinary: wasmBytes,
        locateFile: () => "",
      });
      const result = module._ps_probe_add(19, 23);
      this.port.postMessage({ type: "ready", result });
    } catch (error) {
      this.port.postMessage({
        type: "error",
        message: String(error),
        stack: error?.stack,
      });
    }
  }

  process(_inputs, outputs) {
    for (const channel of outputs[0] ?? []) channel.fill(0);
    return true;
  }
}

registerProcessor("wasm-probe", WasmProbeProcessor)
