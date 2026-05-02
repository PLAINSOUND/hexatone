import { scalaToCents } from "./parse-scale.js";

function remapDegreeIndex(index, sortedEntries, equaveDegree) {
  if (index === 0) return 0;
  if (!Number.isInteger(index) || index < 0 || index > equaveDegree) return index;
  if (index === equaveDegree) return equaveDegree;
  const match = sortedEntries.find((entry) => entry.degree === index);
  return match ? match.nextDegree : index;
}

export function sortScaleDegreesAscending(settings) {
  const scale = Array.isArray(settings?.scale) ? settings.scale : [];
  if (scale.length <= 2) return null;

  const equaveIndex = scale.length - 1;
  const interiorEntries = scale.slice(0, equaveIndex).map((value, index) => ({
    value,
    scaleIndex: index,
    degree: index + 1,
    cents: scalaToCents(String(value)),
    name: settings?.note_names?.[index + 1] ?? "",
    color: settings?.note_colors?.[index + 1] ?? null,
  }));

  const sortedEntries = [...interiorEntries]
    .sort((a, b) => a.cents - b.cents || a.degree - b.degree)
    .map((entry, index) => ({ ...entry, nextDegree: index + 1 }));

  const sortedScale = [...sortedEntries.map((entry) => entry.value), scale[equaveIndex]];
  const nextNoteNames = [...(settings?.note_names || [])];
  const nextNoteColors = [...(settings?.note_colors || [])];

  sortedEntries.forEach((entry, index) => {
    nextNoteNames[index + 1] = entry.name;
    nextNoteColors[index + 1] = entry.color;
  });

  return {
    scale: sortedScale,
    note_names: nextNoteNames,
    note_colors: nextNoteColors,
    reference_degree: remapDegreeIndex(settings?.reference_degree, sortedEntries, scale.length),
    center_degree: remapDegreeIndex(settings?.center_degree, sortedEntries, scale.length),
  };
}

export function moveScaleDegree(settings, fromDegree, toDegree) {
  const scale = Array.isArray(settings?.scale) ? settings.scale : [];
  if (scale.length <= 2) return null;

  const equaveIndex = scale.length - 1;
  const equaveDegree = scale.length;
  const maxInteriorDegree = equaveDegree - 1;

  if (
    !Number.isInteger(fromDegree) ||
    !Number.isInteger(toDegree) ||
    fromDegree < 1 ||
    fromDegree > maxInteriorDegree ||
    toDegree < 1 ||
    toDegree > maxInteriorDegree
  ) {
    return null;
  }

  if (fromDegree === toDegree) return null;

  const interiorEntries = scale.slice(0, equaveIndex).map((value, index) => ({
    value,
    degree: index + 1,
    name: settings?.note_names?.[index + 1] ?? "",
    color: settings?.note_colors?.[index + 1] ?? null,
  }));

  const fromIndex = fromDegree - 1;
  const toIndex = toDegree - 1;
  const reorderedEntries = [...interiorEntries];
  const [movedEntry] = reorderedEntries.splice(fromIndex, 1);
  reorderedEntries.splice(toIndex, 0, movedEntry);

  const remappedEntries = reorderedEntries.map((entry, index) => ({
    ...entry,
    nextDegree: index + 1,
  }));

  const reorderedScale = [...remappedEntries.map((entry) => entry.value), scale[equaveIndex]];
  const nextNoteNames = [...(settings?.note_names || [])];
  const nextNoteColors = [...(settings?.note_colors || [])];

  remappedEntries.forEach((entry, index) => {
    nextNoteNames[index + 1] = entry.name;
    nextNoteColors[index + 1] = entry.color;
  });

  return {
    scale: reorderedScale,
    note_names: nextNoteNames,
    note_colors: nextNoteColors,
    reference_degree: remapDegreeIndex(settings?.reference_degree, remappedEntries, equaveDegree),
    center_degree: remapDegreeIndex(settings?.center_degree, remappedEntries, equaveDegree),
  };
}

function remapDegreeAfterDelete(index, deletedDegree, oldEquaveDegree) {
  if (!Number.isInteger(index) || index < 0 || index > oldEquaveDegree) return index;
  if (index === 0) return 0;
  if (index === oldEquaveDegree) return oldEquaveDegree - 1;
  if (index < deletedDegree) return index;
  if (index > deletedDegree) return index - 1;
  return Math.max(0, deletedDegree - 1);
}

export function deleteScaleDegree(settings, degree) {
  const scale = Array.isArray(settings?.scale) ? settings.scale : [];
  if (scale.length <= 2) return null;

  const equaveDegree = scale.length;
  const maxInteriorDegree = equaveDegree - 1;

  if (!Number.isInteger(degree) || degree < 1 || degree > maxInteriorDegree) return null;

  const deleteIndex = degree - 1;
  const nextScale = scale.filter((_, index) => index !== deleteIndex);
  const nextNoteNames = [...(settings?.note_names || [])].filter((_, index) => index !== degree);
  const nextNoteColors = [...(settings?.note_colors || [])].filter((_, index) => index !== degree);

  return {
    equivSteps: nextScale.length,
    scale: nextScale,
    note_names: nextNoteNames,
    note_colors: nextNoteColors,
    reference_degree: remapDegreeAfterDelete(settings?.reference_degree, degree, equaveDegree),
    center_degree: remapDegreeAfterDelete(settings?.center_degree, degree, equaveDegree),
  };
}
