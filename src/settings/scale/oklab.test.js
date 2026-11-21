import { expect, it } from "vitest";
import { srgb_to_linear, linear_to_srgb, linear_srgb_to_oklab, oklab_to_linear_srgb } from "./oklab.js";

it.each([[0, 0, 0], [1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.02, 0.5, 0.8]])(
  "round-trips sRGB %j through the shared linear/Oklab transforms", (...rgb) => {
    const linear = rgb.map(srgb_to_linear);
    const reconstructed = oklab_to_linear_srgb(...linear_srgb_to_oklab(...linear));
    reconstructed.map(linear_to_srgb).forEach((value, i) => expect(value).toBeCloseTo(rgb[i], 5));
  },
);
