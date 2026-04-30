function modulo(value, modulus) {
  if (!modulus) return value;
  return ((value % modulus) + modulus) % modulus;
}

export function labelDegreeFromFrame(reducedNote, options = {}) {
  const scaleLength = options.scaleLength || 1;
  const frame = options.frame ?? null;
  const geometryMode =
    options.geometryMode ??
    (frame?.strategy === "reinterpret_surface_from_target" ? "stable_surface" : "moveable_surface");
  if (geometryMode === "moveable_surface") return modulo(reducedNote, scaleLength);
  return modulo(reducedNote + (frame?.transpositionSteps ?? 0), scaleLength);
}

export function scaleCentsLabelForDegree(reducedNote, scale = []) {
  const degree0Cents = scale[0] ?? 0;
  const degreeCents = scale[reducedNote] ?? degree0Cents;
  return `${Math.round(((degreeCents - degree0Cents) + 1200) % 1200)}.`;
}

export function displayLabelForDegree(reducedNote, options = {}) {
  const liveReducedNote = labelDegreeFromFrame(reducedNote, {
    frame: options.frame,
    geometryMode: options.geometryMode,
    scaleLength: options.scaleLength,
  });
  const settings = options.settings ?? {};

  if (settings.degree) return String(liveReducedNote);
  if (settings.note) return settings.note_names?.[liveReducedNote] ?? "";
  if (settings.heji) return settings.heji_names?.[liveReducedNote] ?? "";
  if (settings.scala) return settings.scala_names?.[liveReducedNote] ?? "";
  if (settings.cents) return scaleCentsLabelForDegree(reducedNote, options.scale ?? []);
  return "";
}
