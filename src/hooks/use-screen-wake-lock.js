import { useEffect, useRef, useState } from "preact/hooks";

const STORAGE_KEY = "hexatone_keep_screen_awake";

export default function useScreenWakeLock(isPlaying) {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "true"; } catch { return false; }
  });
  const activity = useRef(isPlaying);
  activity.current = isPlaying;
  useEffect(() => {
    if (!enabled || !navigator.wakeLock?.request) return;
    let disposed = false;
    let lock = null;
    let pending = false;
    const needed = () => !disposed && !document.hidden && activity.current();
    const release = () => {
      const previous = lock;
      lock = null;
      void previous?.release().catch(() => {});
    };
    const update = async () => {
      if (!needed()) { release(); return; }
      if (lock || pending) return;
      pending = true;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (!needed()) { await next.release(); return; }
        lock = next;
        next.addEventListener("release", () => { if (lock === next) lock = null; });
      } catch {
        // Unsupported/private/power-saving restrictions must never block audio.
      } finally { pending = false; }
    };
    const hide = () => release();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pagehide", hide);
    const timer = setInterval(update, 1000);
    void update();
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pagehide", hide);
      release();
    };
  }, [enabled]);
  return [enabled, value => {
    try { localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* Private storage unavailable. */ }
    setEnabled(value);
  }];
}
