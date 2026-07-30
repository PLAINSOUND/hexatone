export const EAGAN_BRIGHTNESS_EVENT = "hexatone:eagan-brightness";

export const EAGAN_MATRIX_CONTROLS = [
  { key: "mpe_eagan_brightness", label: "Brightness", cc: 13 },
  { key: "mpe_eagan_tilt_eq", label: "Tilt EQ", cc: 83 },
  { key: "mpe_eagan_pre_level", label: "Pre Level", cc: 26 },
  { key: "mpe_eagan_post_level", label: "Post Level", cc: 18 },
];

export const clampMidiCc = (value) => Math.max(0, Math.min(127, Math.round(Number(value) || 0)));

export function publishEaganBrightness(value) {
  const next = clampMidiCc(value);
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem("mpe_eagan_brightness", String(next));
  }
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent(EAGAN_BRIGHTNESS_EVENT, { detail: { value: next } }));
  }
}
