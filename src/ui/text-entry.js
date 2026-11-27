/** Recognise fields that own ordinary typing rather than musical shortcuts. */
export function isTextEntryElement(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.tagName === "TEXTAREA") return true;
  // Native pickers are not text entry. Opening one can resize the visual
  // viewport, but must not activate the software-keyboard layout.
  if (el.tagName === "SELECT") return false;
  if (el.isContentEditable) return true;
  if (el.tagName !== "INPUT") return false;

  const type = (el.getAttribute("type") || "text").toLowerCase();
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(type);
}
