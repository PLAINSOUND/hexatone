import Point from "./point.js";

export function createTransferredHex(sourceHex, options = {}) {
  const targetCoords = options.coords instanceof Point
    ? new Point(options.coords.x, options.coords.y)
    : new Point(options.coords.x, options.coords.y);
  const proxy = {
    coords: targetCoords,
    cents: options.cents,
    release: false,
    _baseCents: sourceHex._baseCents ?? sourceHex.cents ?? options.cents,
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
    aftertouch: (value) => sourceHex.aftertouch?.(value),
    pressure: (value) => sourceHex.pressure?.(value),
    cc74: (value) => sourceHex.cc74?.(value),
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
