// This hook isolates the edit-commit transport queue used by the sequencer UI.
// It defers transport actions until active draft inputs blur and commit, so
// stepping/play commands do not race against in-row event edits.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { createSequencerDiagnosticTransactionId } from "../debug/sequencer-crash-diagnostics.js";

export default function useEditCommitTransportController({ snapshots } = {}) {
  const [editCommitContext, setEditCommitContext] = useState({
    tick: 0,
    transactionId: null,
    commitKind: null,
    committedAtMs: null,
  });
  const pendingTransportActionRef = useRef(null);
  const editCommitPendingRef = useRef(false);

  useEffect(() => {
    if (!editCommitPendingRef.current && !pendingTransportActionRef.current) return;
    const action = pendingTransportActionRef.current;
    pendingTransportActionRef.current = null;
    editCommitPendingRef.current = false;
    action?.();
  }, [editCommitContext.tick, snapshots]);

  const notifyEditCommitted = useCallback((metadata = {}) => {
    const commitKind = metadata?.commitKind ?? "field-edit";
    const transactionId =
      metadata?.transactionId ?? createSequencerDiagnosticTransactionId(commitKind);
    const committedAtMs = globalThis.performance?.now?.() ?? null;
    setEditCommitContext((previous) => ({
      tick: previous.tick + 1,
      transactionId,
      commitKind,
      committedAtMs,
    }));
    return transactionId;
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
    editCommitTick: editCommitContext.tick,
    editCommitContext,
    notifyEditCommitted,
    runTransportAction,
  };
}
