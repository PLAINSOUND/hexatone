import { applyTransferredPitchBend } from "../keyboard/note-transfer-runtime.js";

export function writeInputBend(hex, cents, { value14 = 8192, value21 = null, standard = false, mpe = false } = {}) {
  hex._lastPitchBendCents = cents;
  hex._lastPitchBend14 = value14;
  hex._lastPitchBend21 = value21;
  if (mpe && applyTransferredPitchBend(hex, { cents, value14, value21 })) return;
  if (standard && hex.standardWheelRetune) hex.standardWheelRetune(cents);
  else if (!hex.standardWheelPassthroughOnly) {
    if (value21 != null) hex.retune?.(cents, true, value21);
    else hex.retune?.(cents, true);
  }
}

// Remember the intended bend even while its audible application is bypassed.
export function applyInputBend(keys, hex, cents, expression = {}) {
  if (!hex || hex.release) return;
  hex._inputBendTarget = { cents, offset: cents - (hex._baseCents ?? hex.cents), ...expression };
  const glide = keys._bendBypassGlides?.get(hex);
  if (glide) {
    const base = hex._baseCents ?? hex.cents;
    const target = keys.inputRuntime.bypassBend ? 0 : cents - base;
    if (target !== glide.toOffset) {
      // Retarget from the current audible pitch, never from a stale start.
      glide.fromOffset = hex.cents - base;
      glide.startAt = performance.now();
      glide.toOffset = target;
    }
    glide.expression = expression;
    return;
  }
  if (keys.inputRuntime.bypassBend) writeInputBend(hex, hex._baseCents ?? hex.cents,
    { ...expression, value14: 8192, value21: expression.value21 == null ? null : 1048576 });
  else writeInputBend(hex, cents, expression);
}

export function transitionBendBypass(keys) {
  keys._bendBypassGlides ??= new Map();
  const now = performance.now();
  const duration = Math.max(1, Math.min(500, Number(keys.inputRuntime.wheelPortamentoTime ?? 60) || 60));
  for (const hex of keys._allActiveHexes()) {
    if (!hex || hex.release) continue;
    const base = hex._baseCents ?? hex.cents;
    const desired = hex._inputBendTarget ?? { cents: hex._lastPitchBendCents ?? base };
    // A wheel handoff is expression-only and is superseded by this transition;
    // a tuning/modulation glide must keep its independent destination.
    if (keys._retuneGlides.get(hex)?.wheelHandoff) keys._retuneGlides.delete(hex);
    keys._bendBypassGlides.set(hex, {
      fromOffset: hex.cents - base, toOffset: keys.inputRuntime.bypassBend ? 0 : desired.offset ?? desired.cents - base,
      expression: desired, startAt: now, duration });
  }
  if (!keys.inputRuntime.mpeInput && !keys.inputRuntime.wheelToRecent) {
    keys._bendBypassWheelGlide = { from: keys._audibleWheelValue14 ?? keys._wheelValue14 ?? 8192,
      startAt: now, duration };
  }
  keys._kickRetuneGlides();
}

export function tickBendBypassGlides(keys, now) {
  let pending = false;
  for (const [hex, glide] of keys._bendBypassGlides ?? []) {
    if (!hex?.retune || hex.release) {
      keys._bendBypassGlides.delete(hex);
      continue;
    }
    const fraction = Math.min(1, Math.max(0, (now - glide.startAt) / glide.duration));
    const offset = glide.fromOffset + (glide.toOffset - glide.fromOffset) * fraction;
    const base = hex._baseCents ?? hex.cents;
    const full = hex._inputBendTarget;
    const fullOffset = full?.offset ?? (full ? full.cents - base : 0);
    const ratio = fullOffset ? offset / fullOffset : 0;
    const value14 = Math.max(0, Math.min(16383, Math.round(8192 + ((full?.value14 ?? 8192) - 8192) * ratio)));
    writeInputBend(hex, base + offset, { ...glide.expression, value14, value21: null });
    if (fraction === 1) keys._bendBypassGlides.delete(hex);
    else pending = true;
  }
  return pending;
}

export function tickBypassWheel(keys, now) {
  const glide = keys._bendBypassWheelGlide;
  if (!glide) return false;
  const fraction = Math.min(1, (now - glide.startAt) / glide.duration);
  const target = keys.inputRuntime.bypassBend ? 8192 : keys._wheelInputValue14 ?? 8192;
  const value = Math.round(glide.from + (target - glide.from) * fraction);
  keys._passthroughPitchBend(value);
  keys._audibleWheelValue14 = value;
  if (fraction === 1) keys._bendBypassWheelGlide = null;
  return fraction < 1;
}
