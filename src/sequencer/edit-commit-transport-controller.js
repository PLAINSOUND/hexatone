// This hook isolates the edit-commit transport queue used by the sequencer UI.
// It defers transport actions until active draft inputs blur and commit, so
// stepping/play commands do not race against in-row event edits.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { createSequencerDiagnosticTransactionId } from "../debug/sequencer-crash-diagnostics.js";

export function sequencerInputHasPendingEdit(input) {
  if (!(input instanceof HTMLInputElement)) return false;
  if (!input.matches?.(".sequencer-event__input")) return false;
  const baseline = input.dataset.lastCommittedValue;
  // `--draft` is also the persistent presentation for a pitch that differs
  // from its captured value. It does not mean that the focused DOM input has
  // an uncommitted edit. Compare the actual editing value instead, falling
  // back to defaultValue for inputs focused before a baseline was recorded.
  return input.value !== (baseline ?? input.defaultValue);
}

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
      // Firefox commonly leaves a text input as document.activeElement while
      // dispatching a button click. Do not send an unchanged field through the
      // post-render edit queue: its blur handler has nothing to commit, and the
      // unnecessary render/effect round trip makes cue attacks feel late.
      if (!sequencerInputHasPendingEdit(active)) {
        active.blur();
        action?.();
        return;
      }
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
