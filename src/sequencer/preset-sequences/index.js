function normalizeSequenceModule(entryName, moduleValue) {
  if (!moduleValue || typeof moduleValue !== "object") return null;
  const path = String(entryName ?? "");
  const name = String(moduleValue.name ?? "").trim();
  if (!name) return null;
  const segments = path.split("/");
  const fileName = segments[segments.length - 1] ?? "";
  const groupName = segments.length > 1 ? segments[0] : "Built-in";
  return {
    groupName,
    fileName,
    sequence: moduleValue,
  };
}

const presetSequenceModules = import.meta.glob("./**/*.json", {
  eager: true,
  import: "default",
});

export const presetSequenceGroups = Object.entries(presetSequenceModules)
  .map(([path, value]) => normalizeSequenceModule(path.replace(/^\.\//, ""), value))
  .filter(Boolean)
  .reduce((groups, entry) => {
    const existing = groups.find((group) => group.name === entry.groupName);
    const item = entry.sequence;
    if (existing) {
      existing.sequences.push(item);
      existing._sortKeys.push(entry.fileName);
      return groups;
    }
    groups.push({
      name: entry.groupName,
      sequences: [item],
      _sortKeys: [entry.fileName],
    });
    return groups;
  }, [])
  .map((group) => ({
    name: group.name,
    sequences: group.sequences
      .map((sequence, index) => ({
        sequence,
        sortKey: group._sortKeys[index],
      }))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey, undefined, { numeric: true }))
      .map((entry) => entry.sequence),
  }))
  .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

export function findPresetSequenceByName(name) {
  const target = String(name ?? "").trim();
  if (!target) return null;
  for (const group of presetSequenceGroups) {
    const match = group.sequences.find((sequence) => sequence.name === target);
    if (match) return match;
  }
  return null;
}
