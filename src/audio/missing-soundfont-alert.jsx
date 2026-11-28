import { useEffect, useMemo, useState } from "preact/hooks";
import { peekFluidSynthEngine, subscribeFluidSynthEngine } from "../fluidsynth_synth/index.js";
import { useSoundRecallState } from "../hooks/use-sound-session.js";
import { findSound, loadUserSounds, restoreSelection } from "../persistence/user-sounds.js";
import { readySoundfontRecall } from "../fluidsynth_synth/soundfont-source.js";
import AudioRecoveryAlert from "./recovery-alert.jsx";

export default function MissingSoundfontAlert({ enabled = true, startingAudio, lookupComplete, recall, onReleaseSustain, children }) {
  const state = useSoundRecallState(recall);
  const reference = useMemo(() => {
    if (state?.reference) return state.reference;
    const sounds = loadUserSounds();
    return findSound(restoreSelection(sounds).selection, sounds)?.soundfont;
  }, [state]);
  const [, refresh] = useState(0);
  const dismissed = useSoundRecallState(recall, () => recall.dismissedBankNotice);
  useEffect(() => subscribeFluidSynthEngine(() => refresh(value => value + 1)), []);
  const engine = peekFluidSynthEngine();
  const available = reference?.name
    ? !!readySoundfontRecall(reference, engine)
    : engine?.soundfontId != null;
  const missing = !available && !engine?.pendingSoundfont && (state?.phase === "missing" ||
    ((lookupComplete || state?.phase === "complete") && (!state || state.phase === "complete")));
  const revision = state?.revision ?? 0;
  const overBudget = state?.phase === "over-budget" && !available;
  const manual = useSoundRecallState(recall, () => recall.manualProgress);
  const pending = manual ?? state;
  const progress = pending?.phase === "waiting" ? "Waiting for all notes to be released..." :
    startingAudio && !(enabled && (missing || overBudget)) ? "Starting Audio..." :
    pending?.phase === "loading" ? `Loading SoundFont: ${pending.name}…` : null;
  if ((!enabled && !progress) || (!progress && !missing && !overBudget) || (!manual && dismissed === revision)) return children ?? null;
  return <AudioRecoveryAlert
    onReleaseSustain={pending?.phase === "waiting" ? onReleaseSustain : undefined}
    message={progress ?? (overBudget ? state.message : "A Hexatone SoundFont is not yet loaded in this browser. To use Built-in FluidSynth player, please go to the SOUNDS tab to download or provide a local file.")}
    onDismiss={() => manual ? recall.setManualLoadProgress(null) : recall.dismissBankNotice(revision)} />;
}
