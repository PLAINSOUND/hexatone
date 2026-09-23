/**
 * Natural, case-insensitive name ordering for tuning and sequence libraries.
 * Centralises numeric-name sorting so both library menus use the same ordering.
 */

const presetNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function presetName(value) {
  return String(value?.name ?? value ?? "").trim();
}

export function comparePresetNames(left, right) {
  const leftName = presetName(left);
  const rightName = presetName(right);
  return presetNameCollator.compare(leftName, rightName) || leftName.localeCompare(rightName);
}

export function orderPresetsByName(presets = []) {
  return [...presets].sort(comparePresetNames);
}
