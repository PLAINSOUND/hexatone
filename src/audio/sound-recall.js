import { soundfontCacheBudget } from "../fluidsynth_synth/cache-budget.js";
import { soundfontErrorDetail } from "../fluidsynth_synth/load-error.js";
import { ensureFluidSynthEngineAwake, isFluidSynthEngineRunning, loadFluidSynthSoundFont, peekFluidSynthEngine, stopFluidSynthEngine, waitForColdBankGap } from "../fluidsynth_synth/index.js";
import { readySoundfontRecall, resolveSoundfontRecall } from "../fluidsynth_synth/soundfont-source.js";
import { PATCH_REARTICULATION_KEY } from "../persistence/io-reload-policy.js";
import { BUILTIN_USER_SOUNDS, normalizeUserSound, storeSoundSelection } from "../persistence/user-sounds.js";
import { REVERB_KEY } from "../fluidsynth_synth/reverb.js";
import { SMOOTHING_KEY } from "../fluidsynth_synth/smoothing.js";

function storeSoundPatch(updates, sound) {
  try {
    for (const [key, value] of Object.entries(updates)) {
      sessionStorage.setItem(key, String(value));
      if (key.startsWith("dsf_") || key.startsWith("osc_")) {
        localStorage.setItem(key, String(value));
      }
    }
    localStorage.setItem("synth_volume", String(sound.sampleVolume));
    localStorage.setItem("fluidsynth_internal_volume", String(sound.soundfont.volume));
    localStorage.setItem(REVERB_KEY, String(sound.soundfont.reverb));
    localStorage.setItem(SMOOTHING_KEY, JSON.stringify(sound.soundfont.smoothing));
  } catch { /* Storage may be unavailable. Apply the patch for this session. */ }
}

export function createSoundRecall(getBindings) {
  const changes = new EventTarget();
  const selectionChanges = new EventTarget();
  let selection;
  let state = null;
  let pending = null;
  let lastTransition;
  let bankMix;
  let manualProgress = null;
  let revision = 0;
  let dismissedBankNotice = null;

  const publish = next => {
    state = { ...next, revision };
    changes.dispatchEvent(new Event("change"));
  };
  const cancel = ({ quiet = false } = {}) => {
    if (!pending) return;
    const request = pending;
    pending = null;
    request.controller.abort();
    request.finish(false);
    publish({ reference: state?.reference, phase: "cancelled",
      message: quiet ? "" : "SoundFont load cancelled." });
  };

  return {
    changes,
    selectionChanges,
    get dismissedBankNotice() { return dismissedBankNotice; },
    dismissBankNotice(requestRevision) {
      if (revision !== requestRevision || dismissedBankNotice === revision) return;
      dismissedBankNotice = revision;
      changes.dispatchEvent(new Event("change"));
    },
    get manualProgress() { return manualProgress; },
    setManualLoadProgress(phase, name) {
      manualProgress = phase ? { phase, name } : null;
      changes.dispatchEvent(new Event("change"));
    },
    get selection() { return selection; },
    get state() { return state; },
    cancel,
    recall(record) {
      const sound = normalizeUserSound(record);
      const bindings = getBindings();
      const outputs = { ...sound.settings, fluidsynth_preset: sound.soundfont.preset };
      if (outputs.output_osc && bindings.localServerOff) outputs.osc_server_off = false;
      const reference = sound.soundfont;
      // Keep the initial mix separate from editable controls. The graph installs
      // the current mix at handoff even when the user edits during a cold load.
      bankMix = { ...reference };
      const needsBank = outputs.output_fluidsynth && !!reference.name;
      const policy = localStorage.getItem(PATCH_REARTICULATION_KEY) === "true" ? "rearticulate" : "preserve";
      const enteringFluid = needsBank && bindings.fluidOutputEnabled === false;
      const currentBank = engine => engine && !engine.pendingSoundfont && engine.soundfontId != null &&
        [reference, reference.fallback].find(bank => bank?.name && bank.name === engine.soundfontSource?.name);
      const readyTarget = engine => {
        const candidate = enteringFluid && currentBank(engine);
        return candidate ? { active: engine, candidate } : readySoundfontRecall(reference, engine);
      };
      const engine = peekFluidSynthEngine();
      const readyToSwitch = needsBank && (enteringFluid
        ? currentBank(engine) && isFluidSynthEngineRunning(engine)
        : readyTarget(engine));
      const deferPatch = needsBank && !readyToSwitch &&
        bindings.canLoadColdBank?.() === false;
      cancel({ quiet: true });

      // Bank readiness can precede installation of the other sound layers.
      // Supersede that graph build even if the earlier bank request finished.
      lastTransition?.abort();
      const controller = new AbortController();
      lastTransition = controller;
      const { signal } = controller;
      let finish;
      const bankReady = needsBank ? new Promise(resolve => { finish = resolve; }) : null;
      const request = { controller, finish };
      if (bankReady) pending = request;
      const begin = () => {
        bindings.discardEdits();
        storeSoundPatch(outputs, sound);
        bindings.beginPatch(outputs, deferPatch ? "preserve" : policy, bankReady, bankMix, signal);
      };
      try {
        if (!deferPatch) begin();
      } catch (error) {
        if (pending === request) {
          pending = null;
          controller.abort();
          finish(false);
        }
        throw error;
      }

      const builtin = BUILTIN_USER_SOUNDS.indexOf(record);
      selection = {
        selection: builtin >= 0 ? `builtin:${builtin}` : `user:${sound.name}`,
        name: sound.name,
        description: sound.description,
      };
      storeSoundSelection(selection);
      selectionChanges.dispatchEvent(new Event("change"));
      revision++;
      publish({ reference, phase: bankReady ? "checking" : "complete" });
      if (!bankReady) return Promise.resolve(true);

      const current = () => pending === request && !signal.aborted;
      const complete = (phase, result = {}) => {
        if (!current()) return;
        pending = null;
        request.finish(phase === "complete");
        publish({ reference, phase, ...result });
      };

      void (async () => {
        if (deferPatch) {
          await waitForColdBankGap(bindings.canLoadColdBank, signal, () =>
            publish({ reference, phase: "waiting", name: reference.name }));
          if (!current()) return;
          begin();
        }
        const player = peekFluidSynthEngine();
        if (enteringFluid && player && !isFluidSynthEngineRunning(player)) {
          if (!await ensureFluidSynthEngineAwake()) throw new Error("FluidSynth could not resume.");
          if (!current()) return;
        }
        const target = readyTarget(peekFluidSynthEngine()) ??
          await resolveSoundfontRecall(reference, peekFluidSynthEngine, current);
        if (!current()) return;
        if (!target) {
          const names = reference.fallback ? `${reference.name} or ${reference.fallback.name}` : reference.name;
          return complete("missing", { message: `Add ${names} in Load SoundFonts.` });
        }

        const { active, candidate, source } = target;
        const manualLoad = () => complete("over-budget", { name: candidate.name, preset: candidate.preset,
          message: `Preload memory full. Please select ${candidate.name} manually in "Current SoundFont".` });
        const cache = peekFluidSynthEngine()?.soundfontCache;
        // Match the worklet's two-times-file-size estimate before allocating any bank bytes.
        const budget = cache?.budgetBytes ?? soundfontCacheBudget();
        const estimate = 2 * (target.fileBytes ?? 0);
        if (estimate > budget) return manualLoad();
        const progress = phase => {
          if (current() && state?.phase !== phase) publish({ reference, phase, name: candidate.name });
        };
        if (estimate && (cache?.estimatedBytes ?? 0) + estimate > budget) {
          await waitForColdBankGap(bindings.canLoadColdBank, signal, () => progress("waiting"));
          if (!current()) return;
          progress("loading");
          await stopFluidSynthEngine({ naturalRelease: true });
          if (!current()) return;
        }
        let presets;
        let chosen;
        if (active) {
          const [bank, program] = candidate.preset.split(":").map(Number);
          chosen = { bank, program };
          active.selectPreset?.(chosen, { deferAttackProgram: true });
        } else {
          let result;
          try {
            result = await loadFluidSynthSoundFont(source, {
              signal,
              preferredPreset: candidate.preset,
              retainSoundingVoices: true,
              canLoadColdBank: bindings.canLoadColdBank,
              onWaitingForSilence: () => progress("waiting"),
              onLoadingBank: target.fileBytes != null ? () => progress("loading") : undefined,
            });
          } catch (error) {
            if (String(error.message).includes("SoundFont memory budget exceeded")) return manualLoad();
            throw error;
          }
          if (!current()) return;
          presets = result.presets ?? [];
          chosen = result.selectedPreset ??
            presets.find(preset => `${preset.bank}:${preset.program}` === candidate.preset) ?? presets[0];
        }

        const preset = chosen ? `${chosen.bank}:${chosen.program}` : candidate.preset;
        getBindings().updateBank(preset, !!source);
        return complete("complete", { name: candidate.name, preset, presets });
      })().catch(error => complete("failed", { message: `SoundFont recall failed: ${soundfontErrorDetail(error)}` }));
      return bankReady;
    },
    markManualBankSelection() {
      if (state && !pending) publish({ reference: state.reference, phase: "manual" });
    },
    editBankMix(updates) {
      if (bankMix) Object.assign(bankMix, updates);
    },
  };
}
