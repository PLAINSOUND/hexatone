import { bringPaletteToFront } from "./palette-stacking.js";

it("raises the touched palette even when a child stops propagation", () => {
  const snapshots = document.createElement("div");
  snapshots.id = "snapshot-palette";
  const modulation = document.createElement("div");
  modulation.id = "modulation-palette";
  const button = document.createElement("button");
  snapshots.append(button);
  document.body.append(snapshots, modulation);
  snapshots.addEventListener("pointerdown", bringPaletteToFront, true);
  button.addEventListener("pointerdown", event => event.stopPropagation());
  try {
    bringPaletteToFront({ currentTarget: modulation });
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(snapshots.dataset.paletteFront).toBe("true");
    expect(modulation.hasAttribute("data-palette-front")).toBe(false);
    bringPaletteToFront({ currentTarget: modulation });
    expect(modulation.dataset.paletteFront).toBe("true");
    expect(snapshots.hasAttribute("data-palette-front")).toBe(false);
    snapshots.remove();
    expect(() => bringPaletteToFront({ currentTarget: modulation })).not.toThrow();
  } finally {
    snapshots.remove();
    modulation.remove();
  }
});
