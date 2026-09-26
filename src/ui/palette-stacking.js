/** Raise only the two floating performance palettes, without an App render or
 * moving their DOM nodes. Capture-phase handlers also see stopped button events.
 */
export function bringPaletteToFront(event) {
  const palette = event.currentTarget;
  for (const id of ["snapshot-palette", "modulation-palette"]) {
    const node = palette.ownerDocument.getElementById(id);
    if (node === palette) node.setAttribute("data-palette-front", "true");
    else node?.removeAttribute("data-palette-front");
  }
}
