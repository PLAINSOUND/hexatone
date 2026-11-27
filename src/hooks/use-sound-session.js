import { useEffect, useRef, useState } from "preact/hooks";
import { isMixerParameter } from "../audio/sound-mixer.js";
import { createSoundRecall } from "../audio/sound-recall.js";
import { createSoundSession } from "../audio/sound-session.js";

export function useSoundSession(settings, commit, applyDsf, runtime) {
  const bindings = useRef(null);
  bindings.current = {
    ...runtime,
    settings,
    applyDsf,
    commit(updates) {
      try {
        for (const [key, value] of Object.entries(updates)) localStorage.setItem(key, String(value));
      } catch { /* Keep the live edit when browser storage is unavailable. */ }
      const settingsUpdates = Object.fromEntries(Object.entries(updates).filter(([key]) => !isMixerParameter(key)));
      if (Object.keys(settingsUpdates).length) commit(settingsUpdates);
    },
  };
  const [session] = useState(() => createSoundSession(() => bindings.current));

  useEffect(() => { session.acknowledge(settings); }, [session, settings]);
  useEffect(() => {
    const flush = () => session.flush();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      session.discardEdits();
    };
  }, [session]);
  return session;
}

export function useSoundRecall(bindings, outputEnabled) {
  const current = useRef(bindings);
  current.current = bindings;
  const [recall] = useState(() => createSoundRecall(() => current.current));
  useEffect(() => {
    if (!outputEnabled) recall.cancel({ quiet: true });
  }, [recall, outputEnabled]);
  useEffect(() => () => recall.cancel({ quiet: true }), [recall]);
  return recall;
}

const readRecallState = state => state;
export function useSoundRecallState(recall, read = readRecallState) {
  const [value, setValue] = useState(() => read(recall?.state));
  useEffect(() => {
    if (!recall) return;
    const update = () => setValue(read(recall.state));
    recall.changes.addEventListener("change", update);
    update();
    return () => recall.changes.removeEventListener("change", update);
  }, [recall, read]);
  return value;
}

// Only the sound controls and the dirty marker subscribe to live previews.
export function useWorkingSoundSettings(session, settings, prefix = "") {
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!session) return;
    const update = event => {
      if (!event.detail || event.detail.startsWith(prefix)) redraw(revision => revision + 1);
    };
    session.changes.addEventListener("change", update);
    return () => session.changes.removeEventListener("change", update);
  }, [session, prefix]);
  return session?.settings(settings) ?? settings;
}

export function useMixerValue(session, key) {
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!session) return;
    const update = event => {
      if (event.detail === key) redraw(revision => revision + 1);
    };
    session.changes.addEventListener("change", update);
    return () => session.changes.removeEventListener("change", update);
  }, [session, key]);
  return session?.readMixer(key);
}
