// This module owns small reusable input-event helpers for sequencer rows.
// It keeps the many row editors consistent about focus selection, blur
// commits, and Enter-key commits without repeating inline handlers.

export function stopPropagation(event) {
  event.stopPropagation();
}

export function buildStopPropagationProps() {
  return {
    onPointerDown: stopPropagation,
    onClick: stopPropagation,
  };
}

export function buildSelectOnFocus({
  stop = false,
  clearCommitted = false,
  setValue = null,
} = {}) {
  return (event) => {
    if (stop) event.stopPropagation();
    if (clearCommitted) delete event.currentTarget.dataset.lastCommittedValue;
    if (typeof setValue === "function") {
      const nextValue = setValue(event);
      if (nextValue != null) event.currentTarget.value = nextValue;
    }
    event.currentTarget.select();
  };
}

export function buildEnterCommit(editing, onCommit) {
  return (event) => editing.handleEnterCommit(event, onCommit);
}

export function buildBlurCommit(editing, onCommit, afterCommit = null) {
  return (event) => editing.handleBlurCommit(
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
