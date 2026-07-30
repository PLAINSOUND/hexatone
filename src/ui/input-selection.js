// Shared input-selection helpers for editors that select their complete value
// on first focus. The pointer-down guard matters when focus also replaces a
// rounded display string with a more precise editing string: without it, the
// browser's subsequent pointer action can collapse the new selection.

export function replaceAndSelectInputValue(event, nextValue) {
  if (nextValue != null) event.currentTarget.value = nextValue;
  event.currentTarget.select?.();
}

export function buildSelectAllOnFirstPointerDown({ stop = false } = {}) {
  return (event) => {
    if (stop) event.stopPropagation();
    if (event.currentTarget.ownerDocument?.activeElement === event.currentTarget) return;
    event.preventDefault();
    event.currentTarget.focus();
  };
}

export function buildAutoSelectInputProps({ stop = false } = {}) {
  return {
    onPointerDown: buildSelectAllOnFirstPointerDown({ stop }),
    onFocus: (event) => {
      if (stop) event.stopPropagation();
      replaceAndSelectInputValue(event);
    },
  };
}
