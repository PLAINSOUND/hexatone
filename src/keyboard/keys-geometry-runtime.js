import { labelDegreeFromFrame } from "./keys-display-runtime.js";

export function deriveLiveHexPitch(basePitch, options = {}) {
  const scale = Array.isArray(options.scale) ? options.scale : [];
  const frame = options.frame ?? null;
  const geometryMode =
    options.geometryMode ??
    (frame?.strategy === "reinterpret_surface_from_target" ? "stable_surface" : "moveable_surface");
  const octOff = options.octaveOffset ?? 0;
  const equivInterval = options.equivInterval ?? 1200;
  const transpositionCents = frame?.transpositionCents ?? 0;
  const scaleLength = options.scaleLength ?? scale.length ?? 1;

  const centsIndex = geometryMode === "moveable_surface"
    ? basePitch.reducedSteps
    : labelDegreeFromFrame(basePitch.reducedSteps, { frame, geometryMode, scaleLength });
  const centsIndexPrev = geometryMode === "moveable_surface"
    ? basePitch.reducedStepsPrev
    : labelDegreeFromFrame(basePitch.reducedStepsPrev, { frame, geometryMode, scaleLength });
  const centsIndexNext = geometryMode === "moveable_surface"
    ? basePitch.reducedStepsNext
    : labelDegreeFromFrame(basePitch.reducedStepsNext, { frame, geometryMode, scaleLength });
  const liveReducedSteps = labelDegreeFromFrame(basePitch.reducedSteps, {
    frame,
    geometryMode,
    scaleLength,
  });

  return {
    cents:
      (basePitch.octs + octOff) * equivInterval +
      (scale[centsIndex] ?? 0) +
      transpositionCents,
    liveReducedSteps,
    distance: basePitch.distance,
    octs: basePitch.octs,
    equivSteps: options.equivSteps ?? scaleLength,
    centsPrev:
      (basePitch.octsPrev + octOff) * equivInterval +
      (scale[centsIndexPrev] ?? 0) +
      transpositionCents,
    centsNext:
      (basePitch.octsNext + octOff) * equivInterval +
      (scale[centsIndexNext] ?? 0) +
      transpositionCents,
  };
}
