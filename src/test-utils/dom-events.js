import { fireEvent as preactFireEvent } from "@testing-library/preact";
import { createEvent } from "@testing-library/dom";

// Keep Preact's act wrapper, but avoid its blanket compat change -> input
// rewrite: native select controls still emit change. Compat focus handlers
// listen to focusin/focusout rather than focus/blur.
export const fireEvent = Object.assign((...args) => preactFireEvent(...args), preactFireEvent, {
  change: (element, init) => preactFireEvent(element, createEvent.change(element, init)),
  focus: (element, init) => preactFireEvent(element, createEvent.focusIn(element, init)),
  blur: (element, init) => preactFireEvent(element, createEvent.focusOut(element, init)),
});
