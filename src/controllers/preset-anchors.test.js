import { describe, expect, it } from "vitest";
import {
  applyControllerPresetAnchor,
  buildControllerPresetAnchorUpdate,
  deriveControllerPresetAnchorFields,
  hasControllerPresetAnchor,
} from "./preset-anchors.js";

describe("controller preset anchors", () => {
  it("omits an unchanged active controller default", () => {
    expect(deriveControllerPresetAnchorFields({
      midiin_controller_override: "lumatone",
      midi_passthrough: false,
      midiin_anchor_note: 26,
      midiin_anchor_channel: 3,
    })).toEqual({});
  });

  it("derives changed Lumatone note and channel values", () => {
    expect(deriveControllerPresetAnchorFields({
      midiin_controller_override: "lumatone",
      midi_passthrough: false,
      midiin_anchor_note: 41,
      midiin_anchor_channel: 2,
    })).toEqual({
      lumatone_anchor_note: 41,
      lumatone_anchor_channel: 2,
    });
  });

  it("preserves other preset anchors while deriving the active controller", () => {
    expect(deriveControllerPresetAnchorFields({
      midiin_controller_override: "exquis",
      midi_passthrough: false,
      midiin_anchor_note: 27,
      lumatone_anchor_note: 41,
      lumatone_anchor_channel: 2,
    })).toEqual({
      lumatone_anchor_note: 41,
      lumatone_anchor_channel: 2,
      exquis_anchor_note: 27,
    });
  });

  it("supports LinnStrument row/channel and Haken note metadata", () => {
    expect(buildControllerPresetAnchorUpdate("linnstrument", 12, 6)).toEqual({
      linnstrument_anchor_note: 12,
      linnstrument_anchor_channel: 6,
    });
    expect(buildControllerPresetAnchorUpdate("hakenaudio", 67, 4)).toEqual({
      haken_anchor_note: 67,
    });
  });

  it("detects and reapplies any configured controller anchor", () => {
    const settings = {
      midi_passthrough: false,
      linnstrument_anchor_note: 12,
      linnstrument_anchor_channel: 6,
    };
    expect(hasControllerPresetAnchor(settings, "linnstrument")).toBe(true);
    expect(applyControllerPresetAnchor(settings, "linnstrument", {
      midiin_anchor_note: 9,
      midiin_anchor_channel: 4,
    })).toEqual({
      midiin_anchor_note: 12,
      midiin_anchor_channel: 6,
    });
  });
});
