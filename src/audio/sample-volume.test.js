import { afterEach, expect, it } from "vitest";
import { readSampleVolume } from "./sample-volume.js";

afterEach(() => localStorage.removeItem("synth_volume"));

it("defaults sample volume to one half", () => {
  localStorage.removeItem("synth_volume");
  expect(readSampleVolume()).toBe(0.5);
});

it.each([["0", 0], ["0.73", 0.73], ["1", 1], ["bad", 0.5]])(
  "preserves saved sample volume %s", (stored, expected) => {
    localStorage.setItem("synth_volume", stored);
    expect(readSampleVolume()).toBe(expected);
  },
);
