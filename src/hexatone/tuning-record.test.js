import { describe, expect, it } from "vitest";
import {
  CONTROLLER_ANCHOR_FIELDS,
  normalizeTuningGroup,
  normalizeTuningRecord,
  settingsToTuningRecord,
  serializeTuningRecord,
} from "./tuning-record.js";

describe("normalizeTuningRecord", () => {
  it("normalizes a tuning record into the canonical shape", () => {
    const normalized = normalizeTuningRecord({
      name: "Test tuning",
      description: "desc",
      scale: ["100.", "200.", "1200."],
      auto_colors: true,
      fundamental: 440,
      reference_degree: 9,
      note_names: ["C", "D", "E"],
      heji_names: ["C", "D", "E"],
      note_colors: ["#ffffff", "#eeeeee", "#dddddd"],
      lumatone_anchor_note: 12,
      lumatone_anchor_channel: 2,
      modulation_library: [{ sourceDegree: 5, targetDegree: 7 }],
      modulation_history_position: { x: 100, y: 200 },
      heji_anchor_label: "A",
      heji_anchor_ratio: "27/16",
      cautionary_natural: false,
    });

    expect(normalized).toEqual(
      expect.objectContaining({
        name: "Test tuning",
        description: "desc",
        scale: ["100.", "200.", "1200."],
        key_colors_mode: "auto",
        fundamental: 440,
        reference_degree: 9,
        note_names: ["C", "D", "E"],
        heji_names: ["C", "D", "E"],
        note_colors: ["#ffffff", "#eeeeee", "#dddddd"],
        lumatone_anchor_note: 12,
        lumatone_anchor_channel: 2,
        modulation_library: [
          {
            sourceDegree: 5,
            targetDegree: 7,
            count: 0,
            strategy: "retune_surface_to_source",
          },
        ],
        modulation_history_position: { x: 100, y: 200 },
        heji_anchor_label: "A",
        heji_anchor_ratio: "27/16",
        cautionary_natural: false,
        equivSteps: 3,
      }),
    );
  });

  it("returns null for records without a name or scale", () => {
    expect(normalizeTuningRecord({ scale: ["100."] })).toBeNull();
    expect(normalizeTuningRecord({ name: "x" })).toBeNull();
  });

  it("accepts empty scale only when explicitly allowed", () => {
    expect(normalizeTuningRecord({ name: "Draft", scale: [] })).toBeNull();
    expect(normalizeTuningRecord({ name: "Draft", scale: [] }, { allowEmptyScale: true })).toEqual(
      expect.objectContaining({ name: "Draft", scale: [], equivSteps: 0 }),
    );
  });

  it("derives key color mode from legacy flags", () => {
    expect(
      normalizeTuningRecord({
        name: "Auto",
        scale: ["100."],
        auto_colors: true,
      }).key_colors_mode,
    ).toBe("auto");
    expect(
      normalizeTuningRecord({
        name: "Spectrum",
        scale: ["100."],
        spectrum_colors: true,
      }).key_colors_mode,
    ).toBe("spectrum");
  });

  it("only preserves known controller anchor fields", () => {
    const normalized = normalizeTuningRecord({
      name: "Anchor test",
      scale: ["100."],
      lumatone_anchor_note: 12,
      random_anchor_note: 55,
    });
    expect(normalized.lumatone_anchor_note).toBe(12);
    expect("random_anchor_note" in normalized).toBe(false);
    expect(CONTROLLER_ANCHOR_FIELDS.includes("lumatone_anchor_note")).toBe(true);
  });

  it("serializes a normalized record", () => {
    const json = serializeTuningRecord({
      name: "Serializable",
      scale: ["100.", "1200."],
    });
    expect(JSON.parse(json)).toEqual(
      expect.objectContaining({
        name: "Serializable",
        scale: ["100.", "1200."],
        equivSteps: 2,
      }),
    );
  });

  it("builds a canonical tuning record from live settings", () => {
    const record = settingsToTuningRecord(
      {
        name: "Live settings",
        description: "desc",
        scale: ["100.", "1200."],
        auto_colors: true,
        fundamental: 440,
        midiin_controller_override: "lumatone",
        lumatone_anchor_note: 12,
        lumatone_anchor_channel: 2,
      },
      {
        modulation_library: [{ sourceDegree: 3, targetDegree: 5 }],
      },
    );

    expect(record).toEqual(
      expect.objectContaining({
        name: "Live settings",
        scale: ["100.", "1200."],
        key_colors_mode: "auto",
        lumatone_anchor_note: 12,
        lumatone_anchor_channel: 2,
        modulation_library: [
          {
            sourceDegree: 3,
            targetDegree: 5,
            count: 0,
            strategy: "retune_surface_to_source",
          },
        ],
      }),
    );
  });

  it("preserves explicit preset anchor fields even when controller override is not set to that device", () => {
    const record = settingsToTuningRecord({
      name: "Built-in anchor preserved",
      scale: ["100.", "1200."],
      fundamental: 440,
      midiin_controller_override: "auto",
      lumatone_anchor_note: 41,
      lumatone_anchor_channel: 2,
    });

    expect(record).toEqual(
      expect.objectContaining({
        name: "Built-in anchor preserved",
        lumatone_anchor_note: 41,
        lumatone_anchor_channel: 2,
      }),
    );
  });
});

describe("normalizeTuningGroup", () => {
  it("normalizes a built-in preset group while dropping invalid entries", () => {
    const group = normalizeTuningGroup({
      name: "Tests",
      settings: [
        { name: "A", scale: ["100."] },
        { name: "", scale: ["200."] },
      ],
    });
    expect(group).toEqual({
      name: "Tests",
      settings: [
        expect.objectContaining({
          name: "A",
          scale: ["100."],
          built_in_group: "Tests",
        }),
      ],
    });
  });
});


it("round-trips preset Exquis geometry and anchor without exporting the manual override", () => {
  const settings = { name: "Exquis tuning", scale: ["100.", "1200."],
    rSteps: 9, drSteps: 4, exquis_rsteps: 5, exquis_drsteps: 6, exquis_anchor_note: 27,
    exquis_layout_override: true, exquis_rSteps: 2, exquis_drSteps: 1 };
  const record = settingsToTuningRecord(settings);
  expect(record).toMatchObject({ rSteps: 9, drSteps: 4, exquis_rsteps: 5, exquis_drsteps: 6, exquis_anchor_note: 27 });
  expect(record).not.toHaveProperty("exquis_layout_override");
  expect(record).not.toHaveProperty("exquis_rSteps");
  expect(normalizeTuningRecord(JSON.parse(serializeTuningRecord(record)))).toEqual(record);
  const invalid = normalizeTuningRecord({ ...settings, exquis_rsteps: 1.5, exquis_drsteps: 1221 });
  expect(invalid).not.toHaveProperty("exquis_rsteps");
  expect(invalid).not.toHaveProperty("exquis_drsteps");
});

it.each([
  [{}, 5, 3],
  [{ exquis_rsteps: 7, exquis_drsteps: 4 }, 7, 4],
  [{ exquis_rsteps: 7, exquis_drsteps: 4, exquis_layout_override: true, exquis_rSteps: 5, exquis_drSteps: 6 }, 5, 6],
])("captures the active Exquis layout without serializing override preferences (%j)", (preferences, right, down) => {
  const settings = { name: "Saved Exquis", scale: ["100.", "1200."], rSteps: 5, drSteps: 3,
    midiin_controller_override: "auto", midiin_anchor_note: 17, exquis_anchor_note: 12, ...preferences };
  const record = settingsToTuningRecord(settings, {}, { controllerId: "exquis" });
  expect(record).toMatchObject({ rSteps: 5, drSteps: 3,
    exquis_rsteps: right, exquis_drsteps: down, exquis_anchor_note: 17 });
  for (const field of ["exquis_layout_override", "exquis_rSteps", "exquis_drSteps"])
    expect(record).not.toHaveProperty(field);
  expect(normalizeTuningRecord(JSON.parse(serializeTuningRecord(record)))).toEqual(record);
});
