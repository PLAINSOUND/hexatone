import { scalaToCents, scalaToLabels } from "./settings/scale/parse-scale.js";
import keyCodeToCoords from "./settings/keycodes";
import { hex2rgb, rgb2hsv, HSVtoRGB2, rgbToHex } from "./keyboard/color_utils.js";
import { parseHejiPitchClassLabel } from "./notation/heji.js";
import { createReferenceFrame } from "./notation/reference-frame.js";
import { spelledHejiLabel } from "./notation/key-label.js";

// HEJI glyph codepoints used for deriving anchor defaults.
// U+E261 = Plainsound natural, U+E260 = flat, U+E262 = sharp.
const HEJI_NATURAL = "\uE261";

/**
 * Scan `note_names` for a plain A-natural entry and return the corresponding
 * anchor pair for auto-filling the HEJI anchor fields.
 *
 * "A-natural" is defined as: letter=A, chromatic=natural (baseId "natural:0"),
 * no schisma, no extra prime-family modifiers.  This matches `nA`, `*nA`,
 * `\uE261A`, and any other encoding that `parseHejiPitchClassLabel` resolves
 * to the same parsed structure.
 *
 * The returned label uses the canonical Unicode glyph (\uE261 + "A") rather
 * than ASCII shortcuts, per the Plainsound font convention.
 *
 * @param {string[]} noteNames   - Raw note_names array from settings (before equave pop).
 * @param {string[]} degreeTexts - Ratio/cents string per degree; index 0 = "1/1".
 * @returns {{ ratio: string, label: string } | null}
 */
export function deriveHejiAnchorFromNoteNames(noteNames, degreeTexts) {
  if (!noteNames?.length) return null;
  for (let i = 0; i < noteNames.length; i++) {
    const name = String(noteNames[i] ?? "").trim();
    if (!name) continue;
    // Accept bare "A" or "a" as A-natural (common in non-HEJI presets).
    const isBareA = /^[Aa]$/.test(name);
    if (isBareA) {
      const ratio = degreeTexts[i] ?? "1/1";
      return { ratio, label: `${HEJI_NATURAL}A` };
    }
    // Accept any HEJI-parseable label that resolves to plain A-natural
    // (letter=A, chromatic=natural, no higher-prime modifiers, no schisma).
    const parsed = parseHejiPitchClassLabel(name);
    if (
      parsed &&
      parsed.letter === "A" &&
      parsed.baseId === "natural:0" &&
      parsed.schismaAmount === 0 &&
      parsed.extraIds.length === 0
    ) {
      const ratio = degreeTexts[i] ?? "1/1";
      // Store the canonical glyph form, not the ASCII shorthand.
      return { ratio, label: `${HEJI_NATURAL}A` };
    }
  }
  return null;
}

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
    const scala_names = scaleAsStrings.map((i) => scalaToLabels(i));
    const scale = settings.scale.map((i) => scalaToCents(String(i)));
    const equivInterval = scale.pop();
    scale.unshift(0);
    scala_names.pop();
    scala_names.unshift("1/1");
    result["scala_names"] = scala_names;
    result["scale"] = scale;
    result["equivInterval"] = equivInterval;

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
        // note_names is still in its raw (pre-normalise) form here — same indexing
        // as degreeTexts (degree 0 = first entry, equave not present).
        const derived = deriveHejiAnchorFromNoteNames(settings.note_names, degreeTexts);
        if (derived) {
          anchorLabel = derived.label;
          anchorRatioText = derived.ratio;
        }
      }

      if (!anchorRatioText) anchorRatioText = "1/1";


      // Only build when we have a valid parseable anchor label.
      if (anchorLabel && parseHejiPitchClassLabel(anchorLabel)) {
        // Anchor cents: the pitch value of the anchor ratio from degree 0,
        // taken mod equave so it is comparable to scale[] values.
        const anchorCents = scalaToCents(String(anchorRatioText));

        try {
          const frame = createReferenceFrame({ anchorLabel, anchorRatio: anchorRatioText });
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
        } catch {
          // Invalid frame (e.g. unparseable anchor ratio) — leave heji_names empty.
          result["heji_names"] = [];
        }
      } else {
        result["heji_names"] = [];
      }
    }
  }
  return result;
};
