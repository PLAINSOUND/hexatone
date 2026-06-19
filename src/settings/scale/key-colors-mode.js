export const KEY_COLOR_MODES = ["manual", "auto", "spectrum"];

export const resolveKeyColorsMode = (settings = {}) => {
  if (KEY_COLOR_MODES.includes(settings?.key_colors_mode)) {
    return settings.key_colors_mode;
  }
  if (settings?.auto_colors === true) return "auto";
  if (settings?.spectrum_colors === true) return "spectrum";
  return "manual";
};

export const deriveKeyColorFlags = (settings = {}) => {
  const key_colors_mode = resolveKeyColorsMode(settings);
  return {
    key_colors_mode,
    auto_colors: key_colors_mode === "auto",
    spectrum_colors: key_colors_mode === "spectrum",
  };
};
