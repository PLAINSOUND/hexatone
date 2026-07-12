/**
 * src/tuning/use-deferred-modulation-history.js
 *
 * Defers visible modulation-history updates until sounding notes have settled.
 *
 * The tuning/modulation runtime may update immediately when the user changes
 * routes, but some sidebar and scale-table displays are easier to read if they
 * wait until currently sounding interactions have cleared. This hook keeps both
 * the live history and a deferred display history in sync.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  getActiveModulationHistory,
  hasActiveModulationHistory,
  modulationHistoryKey,
} from "./modulation-frame-runtime.js";

function cloneHistory(history = []) {
  return Array.isArray(history) ? history.map((entry) => ({ ...entry })) : [];
}

export default function useDeferredModulationHistory(modulationState, keysRef) {
  const modulationHistory = useMemo(
    () => modulationState?.history ?? [],
    [modulationState],
  );
  const activeModulationHistoryKey = useMemo(
    () => modulationHistoryKey(modulationHistory),
    [modulationHistory],
  );
  const [deferredModulationHistory, setDeferredModulationHistory] = useState(modulationHistory);
  const deferredModulationHistoryRef = useRef(modulationHistory);
  deferredModulationHistoryRef.current = modulationHistory;

  useEffect(() => {
    if ((modulationState?.mode ?? "idle") === "idle") {
      setDeferredModulationHistory(cloneHistory(deferredModulationHistoryRef.current));
      return;
    }
    let timeoutId = null;
    const syncWhenNotesAreClear = () => {
      if (keysRef.current && !keysRef.current.isSoundInteractionIdle?.()) {
        timeoutId = setTimeout(syncWhenNotesAreClear, 25);
        return;
      }
      setDeferredModulationHistory(cloneHistory(deferredModulationHistoryRef.current));
    };
    timeoutId = setTimeout(syncWhenNotesAreClear, 0);
    return () => {
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [activeModulationHistoryKey, modulationState?.mode, keysRef]);

  const deferredModulationHistoryKey = useMemo(
    () => modulationHistoryKey(deferredModulationHistory),
    [deferredModulationHistory],
  );
  const activeDeferredModulationKey = useMemo(
    () => modulationHistoryKey(getActiveModulationHistory(deferredModulationHistory)),
    [deferredModulationHistory],
  );
  const hasActiveDeferredModulation = useMemo(
    () => hasActiveModulationHistory(deferredModulationHistory),
    [deferredModulationHistory],
  );

  return {
    modulationHistory,
    activeModulationHistoryKey,
    deferredModulationHistory,
    deferredModulationHistoryKey,
    activeDeferredModulationKey,
    hasActiveDeferredModulation,
  };
}
