import { scalaToCents, scalaToLabels } from "./settings/scale/parse-scale.js";
import keyCodeToCoords from "./settings/keycodes";
import { hex2rgb, rgb2hsv, HSVtoRGB2, rgbToHex } from "./keyboard/color_utils.js";
import { parseHejiPitchClassLabel } from "./notation/heji.js";
import { createReferenceFrame } from "./notation/reference-frame.js";
import { spelledHejiLabel } from "./notation/key-label.js";
import { createScaleWorkspace, normalizeWorkspaceForKeys } from "./tuning/workspace.js";
export { deriveHejiAnchor, deriveHejiAnchorFromNoteNames } from "./notation/heji-normalization.js";
import { deriveHejiAnchor } from "./notation/heji-normalization.js";

export function deriveSpectrumNoteColors(settings, fundamentalColor) {
  const count = settings.equivSteps || settings.scale?.length || 0;
  if (!count) return [];

  let fcolor = hex2rgb(`#${fundamentalColor || "f2e3e3"}`);
  fcolor = rgb2hsv(fcolor[0], fcolor[1], fcolor[2]);
  const baseHue = fcolor.h / 360;
  const sat = fcolor.s / 100;
  const val = fcolor.v / 100;

  return Array.from({ length: count }, (_, index) => {
    const hue = (baseHue + index / count) % 1;
    const rgb = HSVtoRGB2(hue, sat, val);
    return rgbToHex(rgb.red, rgb.green, rgb.blue).replace(/^#/, "");
  });
}

// Color fields only — changes here should NOT reconstruct the hex grid.
export const normalizeColors = (settings) => {
  const fundamental_color = (settings.fundamental_color || "").replace(/#/, "");
  const note_colors = (settings.note_colors || []).map((c) => (c ? c.replace(/#/, "") : "ffffff"));

  return {
    fundamental_color,
    note_colors:
      note_colors.length > 0 ? note_colors : deriveSpectrumNoteColors(settings, fundamental_color),
    spectrum_colors: settings.spectrum_colors,
  };
};

// Everything except colors — changes here rebuild the Keys instance.
export const normalizeStructural = (settings, options = {}) => {
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
  } else if (settings.key_labels === "heji") {
    result["heji"] = true;
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
    const workspaceRuntime =
      options.tuningRuntime ??
      normalizeWorkspaceForKeys(createScaleWorkspace(settings));
    const scala_names = scaleAsStrings.map((i) => scalaToLabels(i));
    scala_names.pop();
    scala_names.unshift("1/1");
    result["scala_names"] = scala_names;
    result["scale"] = workspaceRuntime.scale;
    result["equivInterval"] = workspaceRuntime.equivInterval;
    result["equivSteps"] = workspaceRuntime.equivSteps;

    // Build heji_names when heji label mode is active.
    //
    // The reference frame is defined by two user-supplied values:
    //   heji_anchor_ratio — the ratio from scale degree 0 (1/1) of the pitch
    //     whose tuning-meter deviation is 0¢.  This is a free-form Scala
    //     interval string; it does not need to coincide with any scale degree.
    //     Default "1/1" = root is the 0¢ reference.
    //   heji_anchor_label — the HEJI pitch-class spelling for that pitch
    //     (e.g. "nA" for A natural).
    //
    // Every scale degree's cents-from-anchor is computed as:
    //   scaleCents[degree] − scalaToCents(heji_anchor_ratio)
    //
    // Degree 0 is always 1/1 (the root); the scale entries are degrees 1..n-1
    // (the equave has already been popped off `scale` above).  We reconstruct the
    // full degree list as ratioText strings from the original scaleAsStrings:
    //   degree 0  → "1/1"
    //   degrees 1..n-1 → scaleAsStrings[0..n-2]  (equave was last, now popped)
    if (settings.key_labels === "heji") {
      // Build the ratio/cents text for each degree (same order as `scale`).
      // degree 0 = "1/1"; degrees 1..n-1 = scaleAsStrings entries minus equave.
      const degreeTexts = ["1/1", ...scaleAsStrings.slice(0, -1)];

      // Resolve anchor: use user-supplied values if present, otherwise auto-derive
      // from note_names by searching for a plain A-natural entry.
      let anchorLabel = settings.heji_anchor_label || "";
      let anchorRatioText = settings.heji_anchor_ratio || "";

      if (!anchorLabel || !parseHejiPitchClassLabel(anchorLabel)) {
        // Auto-derive anchor. Priority: reference_degree note name → scan note_names
        // for A-natural → infer from fundamental frequency → default C natural at 1/1.
        // note_names is still in raw (pre-normalise) form; same indexing as degreeTexts.
        const derived = deriveHejiAnchor(
          settings.reference_degree,
          settings.note_names,
          degreeTexts,
          settings.fundamental,
        );
        anchorLabel = derived.label;
        // Always take the derived ratio when auto-deriving the label — the label
        // and ratio are a pair.  A stale heji_anchor_ratio from a previous preset
        // (e.g. the registry default "1/1") must not override the derived value.
        anchorRatioText = derived.ratio;
      }

      // Expose the resolved anchor values so the UI can show what is actually
      // being used (including auto-derived values from note_names).
      result["heji_anchor_label_effective"] = anchorLabel;
      result["heji_anchor_ratio_effective"] = anchorRatioText;

      // Only build when we have a valid parseable anchor label.
      if (anchorLabel && parseHejiPitchClassLabel(anchorLabel)) {
        // Anchor cents: the pitch value of the anchor ratio from degree 0,
        // taken mod equave so it is comparable to scale[] values.
        const anchorCents = scalaToCents(String(anchorRatioText));
        const scale = workspaceRuntime.scale;

        try {
          const frame = createReferenceFrame({ anchorLabel, anchorRatio: anchorRatioText });
          const showCents = settings.heji_show_cents !== false;
          const heji_names = degreeTexts.map((text, i) => {
            // Cents of this degree relative to the anchor pitch.
            const degCents = scale[i] ?? 0;
            const centsFromAnchor = ((degCents - anchorCents) % 1200 + 1200) % 1200;
            // Use ratio text only when it looks like a ratio (contains "/").
            // EDO steps and decimal cents fall back to the tempered path.
            const ratioText = text.includes("/") ? text : null;
            return spelledHejiLabel(frame, ratioText, centsFromAnchor);
          });
          result["heji_names"] = heji_names;
          // heji_names_keys: same labels but without the cents deviation suffix
          // when heji_show_cents is false. Always generated so keys.js can use it.
          result["heji_names_keys"] = showCents
            ? heji_names
            : degreeTexts.map((text, i) => {
                const degCents = scale[i] ?? 0;
                const centsFromAnchor = ((degCents - anchorCents) % 1200 + 1200) % 1200;
                const ratioText = text.includes("/") ? text : null;
                return spelledHejiLabel(frame, ratioText, centsFromAnchor, { suppressDeviation: true });
              });
        } catch {
          // Invalid frame (e.g. unparseable anchor ratio) — leave heji_names empty.
          result["heji_names"] = [];
          result["heji_names_keys"] = [];
        }
      } else {
        result["heji_names"] = [];
      }
    }
  }
  return result;
};
