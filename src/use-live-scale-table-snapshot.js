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
