export const EAGAN_BRIGHTNESS_EVENT = "hexatone:eagan-brightness";
export const EAGAN_TILT_EQ_EVENT = "hexatone:eagan-tilt-eq";

export const EAGAN_MATRIX_CONTROLS = [
  { key: "mpe_eagan_brightness", label: "Brightness", cc: 13 },
  { key: "mpe_eagan_tilt_eq", label: "Tilt EQ", cc: 83 },
  { key: "mpe_eagan_pre_level", label: "Pre Level", cc: 26 },
  { key: "mpe_eagan_post_level", label: "Post Level", cc: 18 },
];

export const clampMidiCc = (value) => Math.max(0, Math.min(127, Math.round(Number(value) || 0)));

function publishEaganControl(key, eventName, value) {
  const next = clampMidiCc(value);
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(key, String(next));
  }
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent(eventName, { detail: { value: next } }));
  }
}

export function publishEaganBrightness(value) {
  publishEaganControl("mpe_eagan_brightness", EAGAN_BRIGHTNESS_EVENT, value);
}

export function publishEaganTiltEq(value) {
  publishEaganControl("mpe_eagan_tilt_eq", EAGAN_TILT_EQ_EVENT, value);
}
