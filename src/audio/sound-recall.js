import { loadFluidSynthSoundFont, peekFluidSynthEngine } from "../fluidsynth_synth/index.js";
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
  let bankMix;
  let revision = 0;

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
    get selection() { return selection; },
    get state() { return state; },
    cancel,
    recall(record) {
      const sound = normalizeUserSound(record);
      const bindings = getBindings();
      const outputs = { ...sound.settings, fluidsynth_preset: sound.soundfont.preset };
      const reference = sound.soundfont;
      // Keep the initial mix separate from editable controls. The graph installs
      // the current mix at handoff even when the user edits during a cold load.
      bankMix = { ...reference };
      const needsBank = outputs.output_fluidsynth && !!reference.name;
      const policy = localStorage.getItem(PATCH_REARTICULATION_KEY) === "true" ? "rearticulate" : "preserve";
      cancel({ quiet: true });
      bindings.discardEdits();
      storeSoundPatch(outputs, sound);

      const controller = new AbortController();
      const { signal } = controller;
      let finish;
      const bankReady = needsBank ? new Promise(resolve => { finish = resolve; }) : null;
      const request = { controller, finish };
      if (needsBank) pending = request;
      try {
        bindings.beginPatch(outputs, policy, bankReady, bankMix);
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
      publish({ reference, phase: needsBank ? "checking" : "complete" });
      if (!needsBank) return Promise.resolve(true);

      const current = () => pending === request && !signal.aborted;
      const complete = (phase, result = {}) => {
        if (!current()) return;
        pending = null;
        request.finish(phase === "complete");
        publish({ reference, phase, ...result });
      };

      void (async () => {
        const target = readySoundfontRecall(reference, peekFluidSynthEngine()) ??
          await resolveSoundfontRecall(reference, peekFluidSynthEngine, current);
        if (!current()) return;
        if (!target) {
          const names = reference.fallback ? `${reference.name} or ${reference.fallback.name}` : reference.name;
          return complete("missing", { message: `Add ${names} in Load SoundFonts.` });
        }

        const { active, candidate, source } = target;
        let presets;
        let chosen;
        if (active) {
          const [bank, program] = candidate.preset.split(":").map(Number);
          chosen = { bank, program };
          active.selectPreset?.(chosen, { deferAttackProgram: true });
        } else {
          const result = await loadFluidSynthSoundFont(source, {
            signal,
            preferredPreset: candidate.preset,
            retainSoundingVoices: true,
            canLoadColdBank: bindings.canLoadColdBank,
            onWaitingForSilence: () => {
              if (current()) publish({ reference, phase: "waiting", name: candidate.name });
            },
          });
          if (!current()) return;
          presets = result.presets ?? [];
          chosen = result.selectedPreset ??
            presets.find(preset => `${preset.bank}:${preset.program}` === candidate.preset) ?? presets[0];
        }

        const preset = chosen ? `${chosen.bank}:${chosen.program}` : candidate.preset;
        getBindings().updateBank(preset, !!source);
        return complete("complete", { name: candidate.name, preset, presets });
      })().catch(error => complete("failed", { message: `SoundFont recall failed: ${error.message}` }));
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
