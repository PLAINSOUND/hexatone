import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./preset-tunings/index.js", () => ({
  findPresetTuningByName: vi.fn((name) => (
    name === "Pauline Oliveros: Heart of Tones"
      ? { name: "Pauline Oliveros: Heart of Tones", scale: ["1.", "2."] }
      : null
  )),
}));
import {
  USER_TUNINGS_STORAGE_KEY,
  clearUserTunings,
  deleteUserTuning,
  loadUserTunings,
  parseTuningJson,
  saveUserTunings,
  uniqueTuningName,
  upsertUserTuning,
} from "./user-tunings.js";

describe("user tunings store", () => {
  beforeEach(() => {
    localStorage.removeItem(USER_TUNINGS_STORAGE_KEY);
  });

  it("loads and normalizes stored user tunings", () => {
    localStorage.setItem(USER_TUNINGS_STORAGE_KEY, JSON.stringify([
      {
        name: "Alpha",
        scale: ["100.", "1200."],
        auto_colors: true,
      },
      {
        name: "",
        scale: ["200."],
      },
    ]));

    expect(loadUserTunings()).toEqual([
      expect.objectContaining({
        name: "Alpha",
        scale: ["100.", "1200."],
        key_colors_mode: "auto",
      }),
    ]);
  });

  it("upserts and deletes canonical tuning records", () => {
    let next = upsertUserTuning({
      name: "Alpha",
      scale: ["100.", "1200."],
      modulation_library: [{ sourceDegree: 5, targetDegree: 7 }],
    }, []);

    expect(next).toEqual([
      expect.objectContaining({
        name: "Alpha",
        modulation_library: [{
          sourceDegree: 5,
          targetDegree: 7,
          count: 0,
          strategy: "retune_surface_to_source",
        }],
      }),
    ]);

    next = upsertUserTuning({
      name: "Alpha",
      scale: ["200.", "1200."],
    }, next);

    expect(next).toEqual([
      expect.objectContaining({
        name: "Alpha",
        scale: ["200.", "1200."],
      }),
    ]);

    expect(deleteUserTuning("Alpha", next)).toEqual([]);
  });

  it("generates a unique name against user and built-in tunings", () => {
    saveUserTunings([
      { name: "User Tuning", scale: ["100."] },
      { name: "Pauline Oliveros: Heart of Tones 2", scale: ["100."] },
    ]);

    expect(uniqueTuningName("User Tuning")).toBe("User Tuning 2");
    expect(uniqueTuningName("Pauline Oliveros: Heart of Tones")).toBe("Pauline Oliveros: Heart of Tones 3");
  });

  it("parses canonical tuning json payloads", () => {
    expect(parseTuningJson(JSON.stringify({
      name: "JSON tuning",
      scale: ["100.", "1200."],
      lumatone_anchor_note: 12,
      lumatone_anchor_channel: 2,
    }))).toEqual([
      expect.objectContaining({
        name: "JSON tuning",
        lumatone_anchor_note: 12,
        lumatone_anchor_channel: 2,
      }),
    ]);
  });

  it("clears the user tuning library", () => {
    saveUserTunings([{ name: "Alpha", scale: ["100."] }]);
    expect(clearUserTunings()).toEqual([]);
    expect(loadUserTunings()).toEqual([]);
  });
});
