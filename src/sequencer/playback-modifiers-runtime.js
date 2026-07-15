// This module owns timed-playback modifier parsing and application.
// It keeps the SPEED and PITCH controls deterministic by normalizing user
// input, formatting display values, and deciding whether playback can retune
// in place or must rearticulate notes.

import { classifyIntervalText } from "../tuning/interval.js";
import { scalaToCents } from "../settings/scale/parse-scale.js";

export const MIN_SEQUENCE_PLAYBACK_SPEED = 0.5;
export const MAX_SEQUENCE_PLAYBACK_SPEED = 2;
export const MIN_SEQUENCE_PLAYBACK_PITCH_CENTS = -1200;
export const MAX_SEQUENCE_PLAYBACK_PITCH_CENTS = 1200;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clampSequencePlaybackSpeed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return clamp(numeric, MIN_SEQUENCE_PLAYBACK_SPEED, MAX_SEQUENCE_PLAYBACK_SPEED);
}

export function clampSequencePlaybackPitchCents(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return clamp(
    numeric,
    MIN_SEQUENCE_PLAYBACK_PITCH_CENTS,
    MAX_SEQUENCE_PLAYBACK_PITCH_CENTS,
  );
}

export function parseSequencePlaybackSpeedInput(value) {
  const trimmed = String(value ?? "").trim().replace(/x$/i, "");
  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric)) return null;
  return clampSequencePlaybackSpeed(numeric);
}

export function parseSequencePlaybackPitchInput(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  try {
    const cents = scalaToCents(trimmed);
    if (!Number.isFinite(cents)) return null;
    return clampSequencePlaybackPitchCents(cents);
  } catch {
    return null;
  }
}

export function normaliseSequencePlaybackPitchInput(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";

  const kind = classifyIntervalText(trimmed);
  if (kind === "ratio" || kind === "edo") return trimmed;
  if (kind === "integer") return `${Number.parseInt(trimmed, 10)}/1`;
  if (kind === "cents") return trimmed.endsWith(".") ? `${trimmed}0` : trimmed;
  return trimmed;
}

export function formatSequencePlaybackSpeed(value) {
  return clampSequencePlaybackSpeed(value).toFixed(3);
}

export function formatSequencePlaybackPitchCents(value) {
  return clampSequencePlaybackPitchCents(value).toFixed(1);
}

export function formatSequencePlaybackPitchCourtesy(value) {
  const cents = clampSequencePlaybackPitchCents(value);
  const sign = cents > 0 ? "+" : "";
  return `${sign}${cents.toFixed(1)}¢`;
}

export function shouldRetuneSequencePlaybackInPlace({
  sequenceLegato,
  snapSequenceToCurrentTuning,
}) {
  return sequenceLegato === true && snapSequenceToCurrentTuning !== true;
}

function frequencyFromMidicents(midicents) {
  const pitch = Number(midicents);
  if (!Number.isFinite(pitch)) return null;
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

export function applyPlaybackPitchOffsetToNote(note, cents) {
  const offsetCents = clampSequencePlaybackPitchCents(cents);
  if (!Number.isFinite(offsetCents) || Math.abs(offsetCents) < 1e-9) return note;

  const currentMidicents = Number(note?.midicents);
  if (!Number.isFinite(currentMidicents)) return note;
  const nextMidicents = currentMidicents + (offsetCents / 100);
  const nextFrequency = frequencyFromMidicents(nextMidicents);
  if (!Number.isFinite(nextFrequency) || nextFrequency <= 0) return note;

  return {
    ...note,
    midicents: nextMidicents,
    frequency: nextFrequency,
  };
}

export function applyPlaybackPitchOffsetToSnapshots(snapshots, cents) {
  if (!Array.isArray(snapshots)) return [];
  const offsetCents = clampSequencePlaybackPitchCents(cents);
  if (Math.abs(offsetCents) < 1e-9) return snapshots;

  return snapshots.map((snapshot) => ({
    ...snapshot,
    notes: Array.isArray(snapshot?.notes)
      ? snapshot.notes.map((note) => applyPlaybackPitchOffsetToNote(note, offsetCents))
      : [],
  }));
}
