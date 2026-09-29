/** Optional browser scsynth output. Reuses OSC's voice/controller implementation.
 * Owns an isolated AudioContext and engine; stale async candidates are disposed
 * by the existing output-request lifecycle. Assets are staged locally, no CDN.
 */
import { create_osc_synth } from "../osc_synth/index.js";
import { createLocalOscTransport } from "./transport.js";
import { warnLog } from "../debug/logging.js";

export async function create_supersonic_synth(...args) {
  const base = new URL(`${import.meta.env.BASE_URL}supersonic/`, location.href).href;
  let sonic;
  let context;
  let disposed = false;
  const wake = () => {
    if (context && context.state !== "closed") void context.resume().catch(() => {});
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener("pointerdown", wake, true);
    document.removeEventListener("keydown", wake, true);
    void Promise.resolve(sonic?.destroy()).catch(error => warnLog("SuperSonic shutdown:", error));
    if (context?.state !== "closed") void context?.close().catch(() => {});
  };
  try {
    const { SuperSonic } = await import(/* @vite-ignore */ `${base}client/supersonic.js`);
    context = new AudioContext({ latencyHint: "interactive" });
    // Restored settings may initialise before a gesture. Resume synchronously
    // from real input, alongside the composite prepare/ensureAwake hooks.
    document.addEventListener("pointerdown", wake, true);
    document.addEventListener("keydown", wake, true);
    wake();
    sonic = new SuperSonic({ baseURL: `${base}client/`, coreBaseURL: `${base}core/`,
      mode: "postMessage", audioContext: context, maxNodes: 4096 });
    let failure = null;
    sonic.on("in", msg => {
      if (msg[0] === "/fail" && msg[1] === "/d_recv") failure = msg[2];
    });
    await sonic.init();
    sonic.send("/notify", 1);
    for (const name of args[1] ?? ["pluck", "string", "formant", "tone"]) {
      if (!["pluck", "string", "formant", "tone"].includes(name)) {
        throw new Error(`Local SuperSonic does not include SynthDef ${name}`);
      }
      failure = null;
      await sonic.loadSynthDef(`${base}synthdefs/hexlab_${name}.scsyndef`);
      await sonic.sync();
      if (failure) throw new Error(failure);
    }
    const transport = createLocalOscTransport(sonic, SuperSonic.osc.encodeBundle, dispose);
    args[10] = { ...args[10], transport };
    return await create_osc_synth(...args);
  } catch (error) {
    dispose();
    throw new Error(`Local SuperSonic unavailable (run yarn supersonic:assets): ${error.message}`);
  }
}
