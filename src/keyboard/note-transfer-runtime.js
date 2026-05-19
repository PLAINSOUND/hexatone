// This module owns note-transfer helpers used during modulation handoff.
// It builds proxy hexes that let a newly triggered target take over expression
// and lifecycle duties from an existing source note without immediately
// destroying that source note's state. It does not decide when a transfer
// should happen; callers provide the source note and invoke these helpers.

import Point from "./point.js";

function clamp7Bit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(127, n));
}

function clampPitchBend14(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 8192;
  return Math.max(0, Math.min(16383, n));
}

function clamp14Bit(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(16256, n));
}

function clampPitchBend21(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(2097024, n));
}

function createThresholdHandoff({ sourceValue, targetValue, score, send }) {
  const state = {
    sourceValue,
    targetValue,
    targetOwns: false,
  };
  const maybeTargetTakeover = () => {
    if (!state.targetOwns && score(state.targetValue) >= score(state.sourceValue)) {
      state.targetOwns = true;
    }
    return state.targetOwns;
  };
  return {
    target(value) {
      state.targetValue = value;
      if (maybeTargetTakeover()) send(state.targetValue);
    },
    source(value) {
      if (state.targetOwns) return;
      state.sourceValue = value;
      send(maybeTargetTakeover() ? state.targetValue : state.sourceValue);
    },
    sync(value) {
      state.sourceValue = value;
      state.targetValue = value;
      state.targetOwns = false;
      send(value);
    },
  };
}

export function createTransferredHex(sourceHex, options = {}) {
  const targetCoords = options.coords instanceof Point
    ? new Point(options.coords.x, options.coords.y)
    : new Point(options.coords.x, options.coords.y);
  const baseCents = sourceHex._baseCents ?? sourceHex.cents ?? options.cents;
  const pitchValue = (value14, value21, cents) => ({
    value14: clampPitchBend14(value14),
    value21: clampPitchBend21(value21),
    cents: Number.isFinite(Number(cents)) ? Number(cents) : baseCents,
  });
  const aftertouchHandoff = createThresholdHandoff({
    sourceValue: {
      value: clamp7Bit(sourceHex._lastAftertouch ?? 0),
      value14: clamp14Bit(sourceHex._lastAftertouch14),
    },
    targetValue: { value: 0, value14: null },
    score: (payload) => payload.value14 ?? (payload.value * 128),
    send: (payload) => {
      sourceHex._lastAftertouch = clamp7Bit(payload.value);
      sourceHex._lastAftertouch14 = clamp14Bit(payload.value14);
      if (sourceHex._lastAftertouch14 != null) {
        sourceHex.aftertouch?.(sourceHex._lastAftertouch, sourceHex._lastAftertouch14);
      } else {
        sourceHex.aftertouch?.(sourceHex._lastAftertouch);
      }
    },
  });
  const cc74Handoff = createThresholdHandoff({
    sourceValue: {
      value: clamp7Bit(sourceHex._lastCC74 ?? 0),
      value14: clamp14Bit(sourceHex._lastCC7414),
    },
    targetValue: { value: 0, value14: null },
    score: (payload) => payload.value14 ?? (payload.value * 128),
    send: (payload) => {
      sourceHex._lastCC74 = clamp7Bit(payload.value);
      sourceHex._lastCC7414 = clamp14Bit(payload.value14);
      if (sourceHex._lastCC7414 != null) {
        sourceHex.cc74?.(sourceHex._lastCC74, sourceHex._lastCC7414);
      } else {
        sourceHex.cc74?.(sourceHex._lastCC74);
      }
    },
  });
  const pitchBendHandoff = createThresholdHandoff({
    sourceValue: pitchValue(
      sourceHex._lastPitchBend14 ?? 8192,
      sourceHex._lastPitchBend21 ?? null,
      sourceHex._lastPitchBendCents ?? sourceHex.cents,
    ),
    targetValue: pitchValue(8192, null, baseCents),
    score: (value) => Math.abs((value.value21 ?? (value.value14 * 128)) - 1048576),
    send: (value) => {
      sourceHex._lastPitchBend14 = value.value14;
      sourceHex._lastPitchBend21 = value.value21;
      sourceHex._lastPitchBendCents = value.cents;
      if (value.value21 != null) sourceHex.retune?.(value.cents, true, value.value21);
      else sourceHex.retune?.(value.cents, true);
    },
  });
  const proxy = {
    coords: targetCoords,
    cents: options.cents,
    release: false,
    _baseCents: baseCents,
    _onsetFrameId: options.onsetFrameId ?? null,
    _noteContext: options.noteContext ?? sourceHex._noteContext ?? null,
    cents_prev: options.cents_prev ?? null,
    cents_next: options.cents_next ?? null,
    _transferredSource: sourceHex,
    noteOn() {},
    noteOff: (releaseVelocity) => {
      if (proxy.release) return;
      proxy.release = true;
      sourceHex._transferProxy = null;
      sourceHex._transferReleaseNoOp = false;
      sourceHex.noteOff(releaseVelocity);
      if (options.onTransferredRelease) options.onTransferredRelease(proxy, sourceHex, releaseVelocity);
    },
    retune: (newCents, bendOnly = false) => {
      proxy.cents = newCents;
      sourceHex.cents = newCents;
      if (sourceHex.retune) sourceHex.retune(newCents, bendOnly);
    },
    aftertouch: (value, value14 = null) => {
      proxy._lastAftertouch = clamp7Bit(value);
      proxy._lastAftertouch14 = clamp14Bit(value14);
      aftertouchHandoff.target({
        value: proxy._lastAftertouch,
        value14: proxy._lastAftertouch14,
      });
    },
    _transferSourceAftertouch: (value) => {
      aftertouchHandoff.source({
        value: clamp7Bit(value),
        value14: clamp14Bit(sourceHex._lastAftertouch14),
      });
    },
    pressure: (value, value14 = null) => {
      if (value14 != null) sourceHex.pressure?.(value, value14);
      else sourceHex.pressure?.(value);
    },
    cc74: (value, value14 = null) => {
      proxy._lastCC74 = clamp7Bit(value);
      proxy._lastCC7414 = clamp14Bit(value14);
      cc74Handoff.target({
        value: proxy._lastCC74,
        value14: proxy._lastCC7414,
      });
    },
    _transferSourceCC74: (value) => {
      cc74Handoff.source({
        value: clamp7Bit(value),
        value14: clamp14Bit(sourceHex._lastCC7414),
      });
    },
    _transferTargetPitchBend: (value) => {
      const next = pitchValue(value?.value14, value?.value21, value?.cents);
      proxy._lastPitchBend14 = next.value14;
      proxy._lastPitchBend21 = next.value21;
      proxy._lastPitchBendCents = next.cents;
      pitchBendHandoff.target(next);
    },
    _transferSourcePitchBend: (value) => {
      pitchBendHandoff.source(pitchValue(value?.value14, value?.value21, value?.cents));
    },
    _syncTransferPitchBend: (value) => {
      const next = pitchValue(value?.value14, value?.value21, value?.cents);
      sourceHex._lastPitchBend14 = next.value14;
      sourceHex._lastPitchBend21 = next.value21;
      sourceHex._lastPitchBendCents = next.cents;
      proxy._lastPitchBend14 = next.value14;
      proxy._lastPitchBend21 = next.value21;
      proxy._lastPitchBendCents = next.cents;
      pitchBendHandoff.sync(next);
    },
    modwheel: (value) => sourceHex.modwheel?.(value),
    expression: (value) => sourceHex.expression?.(value),
  };
  sourceHex._transferProxy = proxy;
  sourceHex._transferReleaseNoOp = true;
  if (options.onTransferCreated) options.onTransferCreated(proxy, sourceHex);
  return proxy;
}

export function shouldSuppressTransferredSourceRelease(hex) {
  return !!hex?._transferReleaseNoOp;
}

export function applyTransferredSourceAftertouch(hex, value) {
  if (!hex?._transferProxy?._transferSourceAftertouch) return false;
  hex._transferProxy._transferSourceAftertouch(value);
  return true;
}

export function applyTransferredCC74(hex, value) {
  if (hex?._transferProxy?._transferSourceCC74) {
    hex._transferProxy._transferSourceCC74(value);
    return true;
  }
  return false;
}

export function applyTransferredPitchBend(hex, value) {
  if (hex?._transferProxy?._transferSourcePitchBend) {
    hex._transferProxy._transferSourcePitchBend(value);
    return true;
  }
  if (hex?._transferTargetPitchBend) {
    hex._transferTargetPitchBend(value);
    return true;
  }
  return false;
}

export function synchronizeTransferredPitchBend(hex, value) {
  if (hex?._transferProxy?._syncTransferPitchBend) {
    hex._transferProxy._syncTransferPitchBend(value);
    return true;
  }
  if (hex?._syncTransferPitchBend) {
    hex._syncTransferPitchBend(value);
    return true;
  }
  return false;
}

export function releaseTransferredSourceExpression(hex) {
  if (!hex?._transferProxy) return false;
  applyTransferredSourceAftertouch(hex, 0);
  applyTransferredCC74(hex, 0);
  applyTransferredPitchBend(hex, {
    value14: 8192,
    value21: 1048576,
    cents: hex._baseCents ?? hex.cents ?? 0,
  });
  return true;
}
