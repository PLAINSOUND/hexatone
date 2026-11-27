import { isTextEntryElement } from "./text-entry.js";

// Sound, MIDI and Scale Settings controls can retain an activated playing keyboard.
// Select menus are choices here; text and numeric fields still own typing.
export function isCanvasKeyboardControl(element) {
  if (!(element instanceof HTMLElement) || !element.closest("[data-canvas-keyboard-controls]")) return false;
  return element.tagName === "SELECT" || !isTextEntryElement(element);
}

export function blocksCanvasKeyboard(element = document.activeElement) {
  if (isCanvasKeyboardControl(element)) return false;
  return isTextEntryElement(element) || element?.tagName === "INPUT";
}
