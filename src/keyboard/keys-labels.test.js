import { describe, expect, it, vi } from "vitest";
import { updateLabels } from "./keys-labels.js";

describe("keys-labels updateLabels", () => {
  it("refreshes cached display labels for active and sustained notes before redraw", () => {
    const activeHex = { coords: { x: 1, y: 2 }, _noteContext: { displayLabel: "old-active" } };
    const sustainedHex = { coords: { x: 3, y: 4 }, _noteContext: { displayLabel: "old-sustained" } };
    const ctx = {
      settings: {
        degree: false,
        note: true,
        scala: false,
        cents: false,
        heji: false,
        equaves: false,
        no_labels: false,
      },
      state: {
        sustainedNotes: new Map([[sustainedHex, 64]]),
      },
      _allActiveHexes: () => [activeHex],
      _frameForSoundingHex: vi.fn(() => ({ id: "frame-1" })),
      _geometryModeForSoundingHex: vi.fn(() => "moveable_surface"),
      _labelSettingsForSoundingHex: vi.fn(function _labelSettingsForSoundingHex() {
        return this.settings;
      }),
      getDisplayLabelAtCoords: vi
        .fn()
        .mockReturnValueOnce("new-active")
        .mockReturnValueOnce("new-sustained"),
      scheduleGridRedraw: vi.fn(),
      scheduleImmediateGridRedraw: vi.fn(),
    };

    updateLabels.call(ctx, {
      heji: true,
      note: false,
      heji_names: ["A", "B"],
    });

    expect(activeHex._noteContext.displayLabel).toBe("new-active");
    expect(sustainedHex._noteContext.displayLabel).toBe("new-sustained");
    expect(ctx.scheduleGridRedraw).toHaveBeenCalledTimes(1);
    expect(ctx.scheduleImmediateGridRedraw).not.toHaveBeenCalled();
  });
});
