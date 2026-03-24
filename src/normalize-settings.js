import { scalaToCents, scalaToLabels } from "./settings/scale/parse-scale.js";
import keyCodeToCoords from "./settings/keycodes";

// Color fields only — changes here should NOT reconstruct the hex grid.
export const normalizeColors = (settings) => ({
  fundamental_color: (settings.fundamental_color || "").replace(/#/, ""),
  note_colors: (settings.note_colors || []).map((c) =>
    c ? c.replace(/#/, "") : "ffffff",
  ),
  spectrum_colors: settings.spectrum_colors,
});

// Everything except colors — changes here rebuild the Keys instance.
export const normalizeStructural = (settings) => {
  const rotation = (settings.rotation * Math.PI) / 180.0; // converts degrees to radians
  const result = {
    ...settings,
    keyCodeToCoords,
    rotation,
    // Provide empty array defaults for label arrays that could be undefined.
    // This prevents crashes when accessing note_names[i] or scala_names[i].
    // When the array is empty, the hex just shows no label.
    note_names: settings.note_names || [],
    scala_names: [], // Will be populated below if scale exists
  };

  // Set label flags based on key_labels selection.
  // These flags (degree, note, scala, cents, no_labels) are checked in keys.js
  // to decide what text to draw on each hex.
  if (settings.key_labels === "enumerate") {
    result["degree"] = true;
  } else if (settings.key_labels === "note_names") {
    result["note"] = true;
  } else if (settings.key_labels === "scala_names") {
    result["scala"] = true;
  } else if (settings.key_labels === "cents") {
    result["cents"] = true;
  } else if (settings.key_labels === "no_labels") {
    result["no_labels"] = true;
  } else {
    // Handle 'equaves', undefined, or unknown values:
    // Default to no_labels (blank keys) which requires no data.
    result["no_labels"] = true;
  }

  // Build scala_names and normalized scale array from the scale setting.
  // This is required for key_labels === 'scala_names' and for cents calculations.
  if (settings.scale) {
    const scaleAsStrings = settings.scale.map((i) => String(i));
    const scala_names = scaleAsStrings.map((i) => scalaToLabels(i));
    const scale = settings.scale.map((i) => scalaToCents(String(i)));
    const equivInterval = scale.pop();
    scale.unshift(0);
    scala_names.pop();
    scala_names.unshift("1/1");
    result["scala_names"] = scala_names;
    result["scale"] = scale;
    result["equivInterval"] = equivInterval;
  }
  return result;
};
