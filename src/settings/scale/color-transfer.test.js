import { transferColor } from "./color-transfer.js";
import { monzoToSuggestedColor } from "./monzo-color.js";

describe("transferColor", () => {
  it("gives 11°u5 a small LED-only green saturation lift", () => {
    expect(transferColor("#e2eecd")).toBe("#66cc0c");
    expect(transferColor("#dee2da")).toBe("#425d3b");
    expect(transferColor("#c7c1a1")).toBe("#6c643f");
  });

  it("separates dark-key o5 from u5 on LEDs without changing their screen colours", () => {
    const options = { notationRole: "chromatic" };
    const over = monzoToSuggestedColor([0, 0, 1], undefined, options).screenHex;
    const under = monzoToSuggestedColor([0, 0, -1], undefined, options).screenHex;
    expect(over).toBe("#e6e0cb");
    expect(under).toBe("#c7c1a1");
    expect(transferColor(over)).toBe("#998b43");
    expect(transferColor(under)).toBe("#6c643f");
  });

  it("keeps calibrated colors exact while varying continuously near them", () => {
    expect(transferColor("#dfffd6")).toBe("#7aff4f");
    expect(transferColor("#c3ffad")).toBe("#30b604");

    expect(transferColor("#deffd5")).not.toBe("#96ba79");
    expect(transferColor("#e0ffd7")).not.toBe("#98ba7b");
    expect(transferColor("#c4ffae")).not.toBe("#7cb849");
    expect(transferColor("#deffd5")).not.toBe(transferColor("#dfffd6"));
    expect(transferColor("#c4ffae")).not.toBe(transferColor("#c3ffad"));
  });
});
