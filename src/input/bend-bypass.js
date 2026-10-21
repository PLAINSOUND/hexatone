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
  hex._inputBendTarget = { cents, ...expression };
  const glide = keys._retuneGlides?.get(hex);
  if (glide?.inputBendBypass) {
    const target = keys.inputRuntime.bypassBend ? hex._baseCents ?? hex.cents : cents;
    if (target !== glide.to) {
      // Retarget from the current audible pitch, never from a stale start.
      glide.from = hex.cents;
      glide.startAt = performance.now();
      glide.to = target;
    }
    glide.expression = expression;
    return;
  }
  if (keys.inputRuntime.bypassBend) writeInputBend(hex, hex._baseCents ?? hex.cents,
    { ...expression, value14: 8192, value21: expression.value21 == null ? null : 1048576 });
  else writeInputBend(hex, cents, expression);
}

export function transitionBendBypass(keys) {
  const now = performance.now();
  const duration = Math.max(1, Math.min(500, Number(keys.inputRuntime.wheelPortamentoTime ?? 60) || 60));
  for (const hex of keys._allActiveHexes()) {
    if (!hex || hex.release) continue;
    const base = hex._baseCents ?? hex.cents;
    const desired = hex._inputBendTarget ?? { cents: hex._lastPitchBendCents ?? base };
    keys._retuneGlides.set(hex, { inputBendBypass: true,
      from: hex.cents, to: keys.inputRuntime.bypassBend ? base : desired.cents,
      expression: desired, startAt: now, duration });
  }
  if (!keys.inputRuntime.mpeInput && !keys.inputRuntime.wheelToRecent) {
    keys._bendBypassWheelGlide = { from: keys._audibleWheelValue14 ?? keys._wheelValue14 ?? 8192,
      startAt: now, duration };
  }
  keys._kickRetuneGlides();
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
