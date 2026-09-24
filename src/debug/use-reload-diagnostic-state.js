/** Temporary named state-update counters for the reload investigation.
 * Imported as useState in the two instrumented owners; setters retain normal
 * stable identity and functional-update semantics. Values are never logged.
 */
import { useCallback, useState } from "preact/hooks";
import { recordReloadDiagnostic } from "./reload-diagnostics.js";

export function useReloadDiagnosticState(name, initialValue) {
  const [value, setValue] = useState(initialValue);
  const update = useCallback(next => {
    setValue(previous => {
      const resolved = typeof next === "function" ? next(previous) : next;
      if (!Object.is(previous, resolved)) recordReloadDiagnostic(`state:${name}`);
      return resolved;
    });
  }, [name]);
  return [value, update];
}
