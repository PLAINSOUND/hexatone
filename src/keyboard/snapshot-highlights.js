// Display-only projection of scheduled snapshot voices. Audio callers only
// enqueue records; pitch lookup and canvas work happen on animation frames.
const MAX_EVENTS = 2048;
const pitchKey = pitch => Math.round(pitch * 1e6);
const now = () => performance.now();

export function createSnapshotHighlights(keys, canvas) {
  const state = keys._snapshotHighlightState ?? { events: [], active: new Map(), dropped: 0 };
  keys._snapshotHighlightState = state;
  let enabled = false;
  let disposed = false;
  let frame = null;
  let timer = null;
  let dirty = true;
  let index = null;
  let context = null;
  let drawn = new Set();
  let draws = 0, lastDrawMs = 0, maxDrawMs = 0;

  const cancel = () => {
    if (frame != null) cancelAnimationFrame(frame);
    clearTimeout(timer);
    frame = timer = null;
  };
  const clearCanvas = () => {
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
  };
  const seed = () => {
    for (const hex of keys._soundingSnapshotHexes ?? keys._snapshotHexes ?? []) {
      if (state.events.length >= MAX_EVENTS) { state.dropped++; break; }
      if (hex?.release || !Number.isFinite(hex?._snapshotMidicents)) continue;
      const at = Number.isFinite(hex._snapshotAttackAt) ? hex._snapshotAttackAt : now();
      state.events.push({ hex, pitch: hex._snapshotMidicents, at, on: true });
    }
    state.events.sort((a, b) => a.at - b.at);
  };
  const schedule = () => {
    if (!enabled || disposed || document.hidden || frame != null) return;
    clearTimeout(timer);
    timer = null;
    const wait = (state.events[0]?.at ?? 0) - now();
    if (!dirty && wait > 32) {
      timer = setTimeout(() => { timer = null; schedule(); }, wait - 16);
    } else frame = requestAnimationFrame(flush);
  };
  const buildIndex = () => {
    index = new Map();
    const fundamental = Number(keys.settings.fundamental);
    const reference = keys.tuning?.degree0toRef_asArray?.[0] ?? 0;
    if (!(fundamental > 0)) return;
    const base = 69 + 12 * Math.log2(fundamental / 440);
    for (const coords of keys._visibleGridCoords ?? []) {
      const pitch = base + (keys.hexCoordsToCents(coords)[0] - reference) / 100;
      if (!Number.isFinite(pitch)) continue;
      const key = pitchKey(pitch);
      const matches = index.get(key) ?? [];
      matches.push({ pitch, coords });
      index.set(key, matches);
    }
  };
  const paint = () => {
    const started = now();
    if (!context) {
      try { context = canvas?.getContext("2d"); } catch { return; }
    }
    if (!context) return;
    const source = keys.state.canvas;
    const resized = canvas.width !== source.width || canvas.height !== source.height;
    if (resized) { canvas.width = source.width; canvas.height = source.height; }
    for (const property of ["width", "height", "left", "top"]) canvas.style[property] = source.style[property];
    if (!index) buildIndex();
    const visible = new Map();
    for (const pitch of state.active.values()) {
      const key = pitchKey(pitch);
      for (let delta = -1; delta <= 1; delta++) {
        for (const match of index.get(key + delta) ?? []) {
          // Floating-point tolerance only, never nearest-pitch approximation.
          if (Math.abs(match.pitch - pitch) <= 1e-6)
            visible.set(`${match.coords.x},${match.coords.y}`, match.coords);
        }
      }
    }
    if (!dirty && !resized && visible.size === drawn.size && [...visible.keys()].every(key => drawn.has(key))) return;
    clearCanvas();
    const ratio = keys.state.pixelRatio || 1;
    const transform = keys._canvasTransform ?? [1, 0, 0, 1, 0, 0];
    context.setTransform(...transform.map(value => value * ratio));
    context.lineJoin = "round";
    for (const coords of visible.values()) {
      const geometry = keys._hexGeometryCache.get(`${coords.x},${coords.y}`) ?? keys._buildHexGeometry(coords);
      // A smooth fade carries the rich red edge gently into the key.
      const radius = Math.hypot(geometry.x[0] - geometry.center.x, geometry.y[0] - geometry.center.y);
      context.shadowBlur = 0;
      context.lineWidth = 2;
      for (let depth = 0; depth < 10; depth++) {
        const inset = Math.max(0, 0.96 - depth / Math.max(1, radius));
        context.beginPath();
        for (let i = 0; i < 6; i++) {
          const x = geometry.center.x + (geometry.x[i] - geometry.center.x) * inset;
          const y = geometry.center.y + (geometry.y[i] - geometry.center.y) * inset;
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.closePath();
        const fade = (1 + Math.cos(Math.PI * depth / 13)) / 13;
        context.strokeStyle = `rgba(7, 3, 0, ${0.75 * fade})`;
        context.stroke();
      }
    }
    drawn = new Set(visible.keys());
    dirty = false;
    draws++;
    lastDrawMs = now() - started;
    maxDrawMs = Math.max(maxDrawMs, lastDrawMs);
  };
  function flush() {
    frame = null;
    if (!enabled || disposed || document.hidden) return;
    const at = now();
    // Collapse overdue transitions to the current state; never draw a backlog.
    let consumed = 0;
    for (const event of state.events) {
      if (event.at > at) break;
      if (event.on) {
        if (state.active.has(event.hex) || state.active.size < MAX_EVENTS) state.active.set(event.hex, event.pitch);
        else state.dropped++;
      }
      else state.active.delete(event.hex);
      consumed++;
    }
    state.events.splice(0, consumed);
    paint();
    if (state.events.length) schedule();
  }
  const queue = (hex, on, timestamp) => {
    if (!enabled || disposed || !hex) return;
    const at = Number.isFinite(timestamp) ? timestamp : now();
    if (!on) {
      // A release before a queued attack cancels that visual attack too.
      state.events = state.events.filter(event => event.hex !== hex || event.at < at);
    }
    if (state.events.length >= MAX_EVENTS) {
      state.events = [];
      state.active.clear();
      state.dropped++;
      dirty = true;
    }
    const event = { hex, on, at, pitch: hex._snapshotMidicents };
    if (on && !Number.isFinite(event.pitch)) return;
    let low = 0, high = state.events.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (state.events[middle].at <= at) low = middle + 1;
      else high = middle;
    }
    state.events.splice(low, 0, event);
    schedule();
  };
  const visibility = () => {
    if (document.hidden) cancel();
    else if (enabled) { dirty = true; schedule(); }
  };
  document.addEventListener("visibilitychange", visibility);
  return {
    noteOn: (hex, at) => queue(hex, true, at),
    noteOff: (hex, at) => queue(hex, false, at),
    retune(hex) {
      if (!enabled || disposed || !hex || hex.release) return;
      for (const event of state.events) if (event.hex === hex && event.on) event.pitch = hex._snapshotMidicents;
      if (state.active.has(hex)) queue(hex, true);
    },
    clear() {
      if (disposed) return;
      state.events = [];
      state.active.clear();
      dirty = true;
      schedule();
    },
    setEnabled(value) {
      if (disposed || (enabled === !!value && (enabled || (!state.events.length && !state.active.size)))) return;
      enabled = !!value;
      if (!enabled) {
        cancel();
        state.events = [];
        state.active.clear();
        drawn.clear();
        clearCanvas();
        if (canvas) { canvas.width = 1; canvas.height = 1; }
      } else {
        if (!state.events.length && !state.active.size) seed();
        dirty = true;
        schedule();
      }
    },
    invalidate() {
      index = null;
      dirty = true;
      schedule();
    },
    getDiagnostics: () => ({ enabled, voices: state.active.size, pending: state.events.length,
      outlinedHexes: drawn.size, dropped: state.dropped, draws, lastDrawMs, maxDrawMs }),
    dispose() {
      disposed = true;
      cancel();
      document.removeEventListener("visibilitychange", visibility);
      clearCanvas();
    },
  };
}
