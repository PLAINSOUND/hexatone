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
  const pitchValue = (value14, cents) => ({
    value14: clampPitchBend14(value14),
    cents: Number.isFinite(Number(cents)) ? Number(cents) : baseCents,
  });
  const aftertouchHandoff = createThresholdHandoff({
    sourceValue: clamp7Bit(sourceHex._lastAftertouch ?? 0),
    targetValue: 0,
    score: (value) => value,
    send: (value) => {
      sourceHex._lastAftertouch = clamp7Bit(value);
      sourceHex.aftertouch?.(sourceHex._lastAftertouch);
    },
  });
  const cc74Handoff = createThresholdHandoff({
    sourceValue: clamp7Bit(sourceHex._lastCC74 ?? 0),
    targetValue: 0,
    score: (value) => value,
    send: (value) => {
      sourceHex._lastCC74 = clamp7Bit(value);
      sourceHex.cc74?.(sourceHex._lastCC74);
    },
  });
  const pitchBendHandoff = createThresholdHandoff({
    sourceValue: pitchValue(
      sourceHex._lastPitchBend14 ?? 8192,
      sourceHex._lastPitchBendCents ?? sourceHex.cents,
    ),
    targetValue: pitchValue(8192, baseCents),
    score: (value) => Math.abs(value.value14 - 8192),
    send: (value) => {
      sourceHex._lastPitchBend14 = value.value14;
      sourceHex._lastPitchBendCents = value.cents;
      sourceHex.retune?.(value.cents, true);
    },
  });
  const proxy = {
    coords: targetCoords,
    cents: options.cents,
    release: false,
    _baseCents: baseCents,
    _onsetFrameId: options.onsetFrameId ?? null,
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
    aftertouch: (value) => {
      proxy._lastAftertouch = clamp7Bit(value);
      aftertouchHandoff.target(proxy._lastAftertouch);
    },
    _transferSourceAftertouch: (value) => {
      aftertouchHandoff.source(clamp7Bit(value));
    },
    pressure: (value) => sourceHex.pressure?.(value),
    cc74: (value) => {
      proxy._lastCC74 = clamp7Bit(value);
      cc74Handoff.target(proxy._lastCC74);
    },
    _transferSourceCC74: (value) => {
      cc74Handoff.source(clamp7Bit(value));
    },
    _transferTargetPitchBend: (value) => {
      const next = pitchValue(value?.value14, value?.cents);
      proxy._lastPitchBend14 = next.value14;
      proxy._lastPitchBendCents = next.cents;
      pitchBendHandoff.target(next);
    },
    _transferSourcePitchBend: (value) => {
      pitchBendHandoff.source(pitchValue(value?.value14, value?.cents));
    },
    _syncTransferPitchBend: (value) => {
      const next = pitchValue(value?.value14, value?.cents);
      sourceHex._lastPitchBend14 = next.value14;
      sourceHex._lastPitchBendCents = next.cents;
      proxy._lastPitchBend14 = next.value14;
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
    cents: hex._baseCents ?? hex.cents ?? 0,
  });
  return true;
}
