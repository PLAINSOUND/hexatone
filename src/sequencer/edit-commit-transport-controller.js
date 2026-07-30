// This hook isolates the edit-commit transport queue used by the sequencer UI.
// It defers transport actions until active draft inputs blur and commit, so
// stepping/play commands do not race against in-row event edits.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";

export default function useEditCommitTransportController({ snapshots } = {}) {
  const [editCommitTick, setEditCommitTick] = useState(0);
  const pendingTransportActionRef = useRef(null);
  const editCommitPendingRef = useRef(false);

  useEffect(() => {
    if (!editCommitPendingRef.current && !pendingTransportActionRef.current) return;
    const action = pendingTransportActionRef.current;
    pendingTransportActionRef.current = null;
    editCommitPendingRef.current = false;
    action?.();
  }, [editCommitTick, snapshots]);

  const notifyEditCommitted = useCallback(() => {
    setEditCommitTick((value) => value + 1);
  }, []);

  const runTransportAction = useCallback((action) => {
    if (typeof document === "undefined") {
      action?.();
      return;
    }
    if (editCommitPendingRef.current) {
      pendingTransportActionRef.current = action;
      return;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches?.(".sequencer-event__input")) {
      editCommitPendingRef.current = true;
      pendingTransportActionRef.current = action;
      active.blur();
      return;
    }
    action?.();
  }, []);

  return {
    editCommitTick,
    notifyEditCommitted,
    runTransportAction,
  };
}
