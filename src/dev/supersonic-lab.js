/** Development-only A/B surface. Loads pinned local package assets on demand;
 * owns a separate audio context and an isolated native group, not app settings.
 * Native UDP replies are not returned by the existing bridge: watch SC's log.
 */
import { COMPARISON_GROUP, COMPARISON_INSTRUMENTS, createComparisonVoice,
  nativeComparisonMessage } from "./supersonic-comparison.js";

const el = id => document.getElementById(id);
const log = text => { el("log").textContent = `${text}\n${el("log").textContent}`.slice(0, 12000); };
const values = () => Object.fromEntries(
  ["frequency", "velocity", "level", "mod", "filter", "sustain", "retrigger"].map(key =>
    [key, el(key).type === "checkbox" ? el(key).checked : el(key).value]),
);
let sonic;
let socket;
let browserVoice;
let nativeVoice;
let nativePort;
let nativeId = COMPARISON_GROUP + 1;
const available = new Set();
let definitionFailure = null;
const protect = fn => async () => { try { await fn(); } catch (error) { log(error.message); } };
const selectedVoice = () => {
  const voice = el("destination").value === "browser" ? browserVoice : nativeVoice;
  if (!voice) throw new Error("Boot/connect the selected destination first.");
  return voice;
};
const release = () => { browserVoice?.release(); nativeVoice?.release(); };
const panic = () => { browserVoice?.panic(); nativeVoice?.panic(); };

el("boot").onclick = protect(async () => {
  el("boot").disabled = true;
  try {
    // Keep GPL core assets separately served; this page is not a production entry.
    const url = "/node_modules/supersonic-scsynth/dist/supersonic.js";
    const { SuperSonic } = await import(/* @vite-ignore */ url);
    sonic = new SuperSonic({
      baseURL: new URL("/node_modules/supersonic-scsynth/dist/", location.href).href,
      coreBaseURL: new URL("/node_modules/supersonic-scsynth-core/", location.href).href,
      mode: "postMessage",
      synthdefBaseURL: new URL("/tools/supersonic/generated/", location.href).href,
    });
    sonic.on("error", error => log(`Engine: ${error.message}`));
    sonic.on("in", message => {
      if (message[0] === "/fail") log(JSON.stringify(message));
      if (message[0] === "/fail" && message[1] === "/d_recv") definitionFailure = String(message[2]);
      if (message[0] === "/n_end") browserVoice?.ended(message[1]);
    });
    await sonic.init();
    sonic.send("/notify", 1);
    sonic.send("/g_new", COMPARISON_GROUP, 0, 0);
    for (const name of COMPARISON_INSTRUMENTS) {
      try {
        definitionFailure = null;
        await sonic.loadSynthDef(`hexlab_${name}`);
        // 0.86.0 can resolve loading despite a server /fail. Wait for the
        // command barrier before accepting this definition as playable.
        await sonic.sync();
        if (definitionFailure) throw new Error(definitionFailure);
        available.add(name);
        log(`${name}: loaded`);
      } catch (error) { log(`${name}: unavailable — ${error.message}`); }
    }
    browserVoice = createComparisonVoice((...args) => sonic.send(...args), () => sonic.nextNodeId());
    log(`SuperSonic ready: ${sonic.audioContext.sampleRate} Hz; ${sonic.mode}`);
  } catch (error) {
    await sonic?.destroy();
    sonic = null;
    el("boot").disabled = false;
    throw error;
  }
});

el("connect").onclick = protect(async () => {
  nativePort = Number(el("port").value);
  if (!Number.isInteger(nativePort) || nativePort < 1024 || nativePort > 65535) {
    throw new Error("Invalid native server port");
  }
  el("connect").disabled = true;
  el("port").disabled = true;
  socket = new WebSocket("ws://127.0.0.1:8089");
  socket.onclose = () => {
    nativeVoice = null;
    el("connect").disabled = false;
    el("port").disabled = false;
    log("Bridge disconnected. If native audio remains, stop it in SuperCollider.");
  };
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("Start yarn osc-bridge first."));
  });
  const send = (address, ...args) => {
    if (socket.readyState !== WebSocket.OPEN) throw new Error("Bridge unavailable");
    socket.send(JSON.stringify(nativeComparisonMessage(nativePort, address, args)));
  };
  send("/g_new", COMPARISON_GROUP, 0, 0);
  nativeVoice = createComparisonVoice(send, () => nativeId++);
  log(`Bridge connected, native destination ${nativePort}. This is not a server acknowledgement.`);
});
el("attack").onclick = protect(async () => {
  const instrument = el("instrument").value;
  const voice = selectedVoice();
  if (voice === browserVoice) {
    if (!available.has(instrument)) throw new Error(`${instrument} did not load; see log.`);
    await sonic.audioContext.resume();
  }
  voice.attack(instrument, values());
});
el("release").onclick = protect(release);
el("panic").onclick = protect(panic);
el("destination").onchange = protect(panic);
el("instrument").onchange = protect(release);
for (const key of ["frequency", "velocity", "level", "mod", "filter", "sustain", "retrigger"]) {
  el(key).oninput = protect(() => selectedVoice().update(values()));
}
window.addEventListener("pagehide", () => {
  try { panic(); } catch { /* Native cleanup cannot be guaranteed after disconnect. */ }
  sonic?.destroy();
  socket?.close();
});
log("Compile definitions with tools/supersonic/compile.scd before booting. No CDN used.");
