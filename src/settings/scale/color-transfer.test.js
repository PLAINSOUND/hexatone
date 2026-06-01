import { transferColor } from "./color-transfer.js";

describe("transferColor", () => {
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
