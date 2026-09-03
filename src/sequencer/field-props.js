// This module owns small reusable input-event helpers for sequencer rows.
// It keeps the many row editors consistent about focus selection, blur
// commits, and Enter-key commits without repeating inline handlers.

import {
  buildSelectAllOnFirstPointerDown,
  replaceAndSelectInputValue,
} from "../ui/input-selection.js";

export { buildSelectAllOnFirstPointerDown };

export function stopPropagation(event) {
  event.stopPropagation();
}

export function buildStopPropagationProps() {
  return {
    onPointerDown: stopPropagation,
    onClick: stopPropagation,
  };
}

export function buildSelectOnFocus({ stop = false, clearCommitted = false, setValue = null } = {}) {
  return (event) => {
    if (stop) event.stopPropagation();
    if (typeof setValue === "function") {
      const nextValue = setValue(event);
      replaceAndSelectInputValue(event, nextValue);
    } else {
      replaceAndSelectInputValue(event);
    }
    // Establish the value presented for editing as the commit baseline. Blur
    // must not turn a focus/select gesture into an edit, including when focus
    // expands a rounded or normalized display value into its editable form.
    if (clearCommitted) {
      event.currentTarget.dataset.lastCommittedValue = event.currentTarget.value;
    }
  };
}

export function buildEnterCommit(editing, onCommit) {
  return (event) => editing.handleEnterCommit(event, onCommit);
}

export function buildBlurCommit(editing, onCommit, afterCommit = null) {
  return (event) =>
    editing.handleBlurCommit(
      event,
      onCommit,
      afterCommit == null ? null : () => afterCommit(event),
    );
}

export function buildDraftEnterCommit(onCommit) {
  return (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onCommit(event);
  };
}
