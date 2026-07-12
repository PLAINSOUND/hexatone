/**
 * src/settings/scale/scale-table/use-live-scale-table-snapshot.js
 *
 * Subscribes the scale-table UI to the live per-degree snapshot exposed by the
 * Keys canvas.
 *
 * This is a narrow scale-table hook rather than a general app hook: it listens
 * for the imperative `subscribeLiveScaleTable` bridge on the mounted keyboard
 * instance and mirrors the latest snapshot into React state for table display.
 */
import { useEffect, useState } from "preact/hooks";

export default function useLiveScaleTableSnapshot(keysRef, keysReadyRevision, active = true) {
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    if (!active) {
      setSnapshot(null);
      return undefined;
    }

    const keys = keysRef?.current ?? null;
    if (!keys?.subscribeLiveScaleTable) {
      setSnapshot(null);
      return undefined;
    }

    return keys.subscribeLiveScaleTable((nextSnapshot) => {
      setSnapshot(nextSnapshot ?? null);
    });
  }, [active, keysReadyRevision, keysRef]);

  return snapshot;
}
