import { expect, it } from "vitest";
import { encodeStereoWav } from "./audio-wav.js";

it("encodes interleaved stereo IEEE float WAV without clipping", () => {
  const buffer = encodeStereoWav(new Float32Array([0.25, 1.5]),
    new Float32Array([-0.5, -2]), 48000);
  const view = new DataView(buffer);
  expect(buffer.byteLength).toBe(60);
  expect(view.getUint16(20, true)).toBe(3);
  expect(view.getUint32(24, true)).toBe(48000);
  expect(view.getUint32(40, true)).toBe(16);
  expect([44, 48, 52, 56].map(offset => view.getFloat32(offset, true)))
    .toEqual([0.25, -0.5, 1.5, -2]);
});
