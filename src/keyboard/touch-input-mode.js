// Diagnostic override is session-only and never changes saved musical presets.
let mode = "auto";
export const getTouchInputMode = () => mode;
export function setTouchInputMode(value) {
  if (["auto", "touch", "pointer"].includes(value)) mode = value;
}
