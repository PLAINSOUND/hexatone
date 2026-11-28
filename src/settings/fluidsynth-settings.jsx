import { soundfontErrorDetail } from "../fluidsynth_synth/load-error.js";
/** FluidSynth browser backend controls: local SoundFont, enumerated preset and level. */

import { useEffect, useRef, useState } from "preact/hooks";
import PropTypes from "prop-types";
import PrepareSoundfonts from "./prepare-soundfonts.jsx";
import { useSoundRecallState } from "../hooks/use-sound-session.js";
import CustomRangeSlider from "./shared/range-slider.jsx";
import { findSound, loadUserSounds, restoreSelection } from "../persistence/user-sounds.js";
import { createSoundfontSource, readySoundfontRecall, resolveSoundfontRecall } from "../fluidsynth_synth/soundfont-source.js";
import { soundfontCopiesChanged, workingSoundfontKeys, removeSoundfontCopy, soundfontStorageKey, readWorkingSoundfont, storeSoundfontCopy, saveSoundfontFile } from "../fluidsynth_synth/soundfont-storage.js";
import { rememberSoundSession, restoreSoundOnReload } from "../persistence/io-reload-policy.js";
import {
  clearPreparedSoundfonts,
  loadFluidSynthSoundFont,
  getFluidSynthEngine,
  ensureFluidSynthEngineAwake,
  peekFluidSynthEngine,
  subscribeFluidSynthEngine,
  stopFluidSynthEngine,
  waitForColdBankGap,
} from "../fluidsynth_synth/index.js";

import { BANK_PRESETS_KEY, HOSTED_SOUNDFONTS, hostedSoundfontUrl, LAST_BANK_KEY, LAST_SOUNDFONT_KEY, legacyLocalSoundfontKey, readRememberedSoundfont, rememberBankPreset } from "../fluidsynth_synth/soundfont-catalog.js";
import { canLoadColdSoundfont, forgetPerformanceBank, readPerformanceBanks, rememberPerformanceBanks } from "../fluidsynth_synth/performance-banks.js";
import MixerFader from "./mixer-fader.jsx";
import { FLUID_VOLUME_KEY } from "../audio/sound-mixer.js";
import { REVERB_KEY } from "../fluidsynth_synth/reverb.js";
import { SMOOTHING_KEY, normalizeFluidSynthSmoothing, readFluidSynthSmoothing } from "../fluidsynth_synth/smoothing.js";

const readSavedPreset = (key) => {
  try {
    const saved = JSON.parse(localStorage.getItem(BANK_PRESETS_KEY) || "{}");
    return saved[key] ?? saved[legacyLocalSoundfontKey(key)];
  }
  catch { return undefined; }
};
const FluidSynthSettings = ({ settings, onChange, soundSession, soundRecall, onWorkingChange, keysRef, restoreProgress, cancelStartupRestore }) => {
  const [collapsed, setCollapsed] = useState(() => sessionStorage.getItem("hexatone_fluidsynth_collapsed") !== "false");
  const [presets, setPresets] = useState(() => peekFluidSynthEngine()?.presets ?? []);
  const [cache, setCache] = useState(() => peekFluidSynthEngine()?.soundfontCache);
  const [banks, setBanks] = useState(readPerformanceBanks);
  const preparationRequest = useRef(null);
  const localFiles = useRef(new Map());
  const rememberBanks = (sources, preload) => {
    for (const file of sources) if (file instanceof File) localFiles.current.set(file.name, file);
    setBanks(previous => rememberPerformanceBanks(previous, sources, preload));
  };
  const [libraryBankName, setLibraryBankName] = useState("");
  const [selectedBankName, setSelectedBankName] = useState(() =>
    peekFluidSynthEngine()?.soundfontSource?.name ?? "");
  const [smoothing, setSmoothing] = useState(readFluidSynthSmoothing);
  const smoothingRef = useRef(smoothing);
  const [busy, setBusy] = useState(false);
  const [feedbackOwner, setFeedbackOwner] = useState("restore");
  const [status, setStatus] = useState("");
  const [loadingProgress, setLoadingProgress] = useState(null);
  const [presetValue, setPresetValue] = useState(settings.fluidsynth_preset || "0:0");
  const [storageStatus, setStorageStatus] = useState("");
  const [storageBusy, setStorageBusy] = useState(false);
  const downloadControllerRef = useRef(null);
  const loadGenerationRef = useRef(0);
  useEffect(() => () => {
    ++loadGenerationRef.current;
    downloadControllerRef.current?.abort();
  }, []);
  useEffect(() => {
    if (settings.output_fluidsynth || !downloadControllerRef.current) return;
    ++loadGenerationRef.current;
    downloadControllerRef.current.abort();
    downloadControllerRef.current = null;
    setBusy(false);
    setLoadingProgress(null);
    setSelectedBankName(peekFluidSynthEngine()?.soundfontSource?.name ?? "");
  }, [settings.output_fluidsynth]);
  const recalled = useSoundRecallState(soundRecall);
  const noticeRevision = recalled?.revision ?? 0;
  const dismissBankNotice = () => soundRecall?.dismissBankNotice(noticeRevision);
  const recallReference = recalled?.reference;
  const recallPending = ["checking", "waiting", "loading"].includes(recalled?.phase);
  const activeEngine = peekFluidSynthEngine();
  const source = activeEngine?.soundfontSource;
  const [storedKeys, setStoredKeys] = useState([]);
  useEffect(() => {
    let revision = 0;
    const update = () => {
      const current = ++revision;
      workingSoundfontKeys().then(keys => { if (current === revision) setStoredKeys(keys); });
    };
    soundfontCopiesChanged.addEventListener("change", update);
    update();
    return () => { revision++; soundfontCopiesChanged.removeEventListener("change", update); };
  }, []);
  const residentKeys = new Set([...(cache?.keys ?? []), ...(cache?.preparedKeys ?? [])]);
  if (activeEngine?.soundfontId != null && source) residentKeys.add(soundfontStorageKey(source));
  const availableKeys = new Set([...storedKeys, ...Array.from(localFiles.current.values(), soundfontStorageKey)]);
  const playbackBanks = new Map(banks.map(bank => [bank.name, bank]));
  for (const bank of [readRememberedSoundfont(sessionStorage), readRememberedSoundfont(), source, recalled?.phase === "over-budget" && recalled]) {
    if (bank?.name && !playbackBanks.has(bank.name)) playbackBanks.set(bank.name, bank);
  }
  for (const key of [...availableKeys, ...residentKeys]) {
    let name = key.slice(key.lastIndexOf("/") + 1);
    if (key.startsWith("local:")) name = key.slice(6);
    else { try { name = decodeURIComponent(name); } catch { /* Preserve the stored filename. */ } }
    if (name && !playbackBanks.has(name)) playbackBanks.set(name, { name, url: key });
  }
  for (const name of HOSTED_SOUNDFONTS) {
    if (!playbackBanks.has(name)) playbackBanks.set(name, { name, url: hostedSoundfontUrl(name) });
  }
  for (const sound of loadUserSounds()) {
    for (const bank of [sound.soundfont, sound.soundfont.fallback]) {
      if (bank?.name && !playbackBanks.has(bank.name)) playbackBanks.set(bank.name, bank);
    }
  }
  const removeBank = async bank => {
    const key = soundfontStorageKey(bank);
    await removeSoundfontCopy(key);
    clearPreparedSoundfonts(key);
    localFiles.current.delete(bank.name);
    for (const storage of [sessionStorage, localStorage]) {
      const remembered = readRememberedSoundfont(storage);
      if (remembered && soundfontStorageKey(remembered) === key) storage.removeItem(LAST_SOUNDFONT_KEY);
      if (storage.getItem(LAST_BANK_KEY) === bank.name) storage.removeItem(LAST_BANK_KEY);
    }
    rememberSoundSession(settings);
    setBanks(previous => forgetPerformanceBank(previous, key));
    setStoredKeys(previous => previous.filter(candidate => candidate !== key));
    setLibraryBankName("");
  };
  const bankState = bank => {
    const key = soundfontStorageKey(bank);
    if (residentKeys.has(key)) return "loaded";
    if (availableKeys.has(key)) return "available";
    return "";
  };
  const bankLabel = bank => bank.name + (bankState(bank) ? ` (${bankState(bank)})` : "");
  useEffect(() => {
    if (source) setBanks(previous => rememberPerformanceBanks(previous, [source]));
  }, [source]);
  useEffect(() => {
    const syncEngineState = (nextEngine = peekFluidSynthEngine()) => {
      setPresets(nextEngine?.presets ?? []);
      setCache(nextEngine?.soundfontCache);
      if (nextEngine?.selectedPreset) {
        setPresetValue(`${nextEngine.selectedPreset.bank}:${nextEngine.selectedPreset.program}`);
      }
      if (!downloadControllerRef.current) {
        setSelectedBankName(nextEngine?.soundfontSource?.name ?? "");
      }
    };
    syncEngineState();
    return subscribeFluidSynthEngine(syncEngineState);
  // The warm output toggle does not reload the bank. Reopening its controls
  // must reflect the playing engine, not a previously browsed menu candidate.
  }, [settings.output_fluidsynth]);
  const loaded = activeEngine?.soundfontId != null && presets.length > 0;
  const presetControlsReady = loaded && !busy && !recallPending && !activeEngine?.pendingSoundfont;
  const selectedPreset = presetControlsReady ? presetValue : "";
  const canShutdown = activeEngine || busy || selectedBankName || preparationRequest.current || settings.output_fluidsynth;
  const storageActionsReady = loaded && !!source && !activeEngine?.pendingSoundfont;
  const waitingForSilence = loadingProgress?.phase === "Waiting for silence to load";
  const canCancelLoad = recalled?.phase === "waiting" ||
    (busy && (loadingProgress?.phase === "Downloading" || waitingForSilence) && !!downloadControllerRef.current);
  const cancelLoad = () => {
    if (!canCancelLoad) return;
    if (recalled?.phase === "waiting") {
      soundRecall.cancel();
      return;
    }
    ++loadGenerationRef.current;
    downloadControllerRef.current.abort();
    downloadControllerRef.current = null;
    setBusy(false);
    setLoadingProgress(null);
    setSelectedBankName(source?.name ?? "");
    setStatus(waitingForSilence ? "SoundFont load cancelled." : "Download cancelled.");
  };

  const changeSmoothing = (key, value, commit = false) => {
    const previous = smoothingRef.current;
    const next = normalizeFluidSynthSmoothing({ ...previous, [key]: value });
    // Keep disk-backed browser storage out of the pointer-move path.
    if (commit) {
      try { localStorage.setItem(SMOOTHING_KEY, JSON.stringify(next)); } catch { /* Private storage unavailable. */ }
    }
    if (previous.pressureMs === next.pressureMs && previous.expressionMs === next.expressionMs && previous.minimumMs === next.minimumMs) return;
    smoothingRef.current = next;
    setSmoothing(next);
    soundRecall?.editBankMix({ smoothing: next });
    peekFluidSynthEngine()?.setSmoothing?.(next);
    onWorkingChange?.();
  };

  const canLoadColdBank = () => canLoadColdSoundfont(keysRef?.current);

  const loadSoundFont = async (source, signal, requestedPreset) => {
    if (!source) return;
    setFeedbackOwner("current");
    const generation = ++loadGenerationRef.current;
    const current = () => generation === loadGenerationRef.current;
    const useRecallPreset = recalled?.phase === "missing" || recalled?.phase === "over-budget" || recallPending;
    const recalledPreset = useRecallPreset
      ? [recallReference, recallReference.fallback].find(bank => bank?.name === source.name)?.preset
      : undefined;
    const preferredPreset = requestedPreset ?? recalledPreset ?? readSavedPreset(soundfontStorageKey(source)) ??
      (source.name === localStorage.getItem(LAST_BANK_KEY) ? settings.fluidsynth_preset : undefined);
    setBusy(true);
    setStatus(source.url ? "" : `${loaded ? "Replacing" : "Loading"} ${source.name}…`);
    setStorageStatus("");
    setLoadingProgress({
      name: source.name,
      url: source.url ?? "",
      percent: 0,
      phase: source.url ? "Checking stored copy" : "Reading local file",
    });
    try {
      const result = await loadFluidSynthSoundFont(source, {
        signal,
        preferredPreset,
        canLoadColdBank,
        onWaitingForSilence: () => {
          if (current()) setLoadingProgress(progress => ({ ...progress, url: "",
            phase: "Waiting for silence to load" }));
        },
        onDownloadProgress: ({ loaded: bytesLoaded, total }) => {
          if (!current()) return;
          setLoadingProgress((current) => ({
            ...current,
            percent: total ? Math.min(100, Math.floor((bytesLoaded / total) * 100)) : null,
          }));
        },
        onDownloadComplete: () => {
          if (current()) setLoadingProgress((progress) => ({ ...progress, percent: 100, phase: "Loading instrument" }));
        },
        onBytesReady: async (bankSource, bytes) => {
          try {
            const key = soundfontStorageKey(bankSource);
            // A retained Blob already supplied these bytes; don't rewrite a
            // potentially large bank just to switch back to it.
            if (bankSource.cachedBankKey !== key) await storeSoundfontCopy(bankSource, bytes);
            if (current()) setStorageStatus("");
            if (restoreSoundOnReload()) void navigator.storage?.persist?.().catch(() => {});
          } catch (error) {
            if (current()) setStorageStatus(`Couldn’t save a browser copy of ${bankSource.name}. ${error.message}`);
          }
        },
      });
      if (!current()) return;
      dismissBankNotice();
      const nextPresets = result.presets || [];
      setPresets(nextPresets);
      setSelectedBankName(source.name);
      setLibraryBankName(source.name);
      if (nextPresets.length) {
        const chosen = result.selectedPreset ??
          nextPresets.find(preset => `${preset.bank}:${preset.program}` === preferredPreset) ?? nextPresets[0];
        const value = `${chosen.bank}:${chosen.program}`;
        setPresetValue(value);
        onChange("fluidsynth_preset", value);
        onChange(
          "fluidsynth_runtime_revision",
          (Number(settings.fluidsynth_runtime_revision) || 0) + 1,
        );
        soundRecall?.markManualBankSelection();
        setStatus("");
      }
      peekFluidSynthEngine()?.setVolume?.(soundSession.readMixer(FLUID_VOLUME_KEY));
      return true;
    } catch (error) {
      if (!current() || error.name === "AbortError") return;
      setStatus(`SoundFont load failed: ${soundfontErrorDetail(error)}`);
      const previousEngine = peekFluidSynthEngine();
      if (previousEngine?.soundfontId != null) {
        setPresets(previousEngine.presets || []);
        setSelectedBankName(previousEngine.soundfontSource?.name || "");
        return; // A failed download has not replaced the playing instrument.
      }
      setPresets([]);
      setSelectedBankName("");
      // Keep the controls and failure message visible so the user can retry.
      // A failed instrument load must not change their output preference.
      onChange(
        "fluidsynth_runtime_revision",
        (Number(settings.fluidsynth_runtime_revision) || 0) + 1,
      );
    } finally {
      if (current()) {
        setBusy(false);
        setLoadingProgress(null);
        downloadControllerRef.current = null;
      }
    }
  };

  const replaceForMemory = async (bank, signal) => {
    const report = phase => soundRecall?.setManualLoadProgress(phase, bank.name);
    try {
      const released = () => keysRef?.current?.isSoundInteractionIdle?.() !== false && canLoadColdBank();
      await waitForColdBankGap(released, signal, () => report("waiting"));
      signal.throwIfAborted();
      report("loading");
      const sounds = loadUserSounds();
      const reference = findSound(restoreSelection(sounds).selection, sounds)?.soundfont;
      const preset = [reference, reference?.fallback].find(candidate => candidate?.name === bank.name)?.preset;
      return await loadSoundFont(bank, signal, preset);
    } finally {
      report(null);
    }
  };

  const selectPreparedSoundBank = async (names, signal) => {
    if (signal.aborted || (soundRecall?.state?.revision ?? 0) !== noticeRevision) return;
    const sounds = loadUserSounds();
    const sound = findSound(restoreSelection(sounds).selection, sounds);
    const reference = sound?.soundfont ?? soundRecall?.state?.reference;
    if (!reference?.name || !names.some(name => name === reference.name || name === reference.fallback?.name)) return;
    const engine = peekFluidSynthEngine();
    const target = readySoundfontRecall(reference, engine);
    if (!target) return;
    if (target.active && soundRecall?.state?.phase !== "missing" &&
        (soundRecall?.state?.phase === "manual" ||
          target.candidate.preset === `${engine.selectedPreset?.bank}:${engine.selectedPreset?.program}`)) return;
    const source = target.source ?? createSoundfontSource({
      name: target.candidate.name, url: soundfontStorageKey(target.candidate),
    });
    const controller = new AbortController();
    downloadControllerRef.current = controller;
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    try {
      await loadSoundFont(source, controller.signal, target.candidate.preset);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  };

  const shutdownPlayer = async () => {
    cancelStartupRestore?.();
    onChange("output_fluidsynth", false);
    preparationRequest.current?.abort();
    soundRecall?.cancel({ quiet: true });
    setFeedbackOwner("current");
    const generation = ++loadGenerationRef.current;
    downloadControllerRef.current?.abort();
    downloadControllerRef.current = null;
    setBusy(true);
    setLoadingProgress(null);
    try {
      await stopFluidSynthEngine({ rememberBank: true });
      if (generation !== loadGenerationRef.current) return;
      setSelectedBankName("");
      setPresets([]);
      setCache(null);
      setStatus("");
      soundRecall?.markManualBankSelection();
      onChange("fluidsynth_runtime_revision", (Number(settings.fluidsynth_runtime_revision) || 0) + 1);
    } catch (error) {
      if (generation === loadGenerationRef.current) setStatus(soundfontErrorDetail(error));
    } finally {
      if (generation === loadGenerationRef.current) setBusy(false);
    }
  };

  const enablePlayer = async () => {
    onChange("output_fluidsynth", true);
    const controller = new AbortController();
    downloadControllerRef.current = controller;
    const { signal } = controller;
    try {
      const engine = await getFluidSynthEngine(canLoadColdBank);
      signal.throwIfAborted();
      if (engine.soundfontId != null) {
        await ensureFluidSynthEngineAwake();
        return;
      }
      const sounds = loadUserSounds();
      const selected = findSound(restoreSelection(sounds).selection, sounds);
      const reference = readRememberedSoundfont(sessionStorage) ??
        (selected?.soundfont.name ? selected.soundfont : readRememberedSoundfont());
      if (!reference?.name) return;
      const target = await resolveSoundfontRecall(reference, peekFluidSynthEngine, () => !signal.aborted);
      if (target?.source && !signal.aborted)
        await loadSoundFont(target.source, signal, target.candidate.preset);
    } catch (error) {
      if (!signal.aborted) {
        setFeedbackOwner("current");
        setStatus(soundfontErrorDetail(error));
      }
    } finally {
      if (downloadControllerRef.current === controller) downloadControllerRef.current = null;
    }
  };

  const selectSoundfont = event => {
    const bank = playbackBanks.get(event.currentTarget.value);
    if (!bank) return;
    setFeedbackOwner("current");
    setStatus("");
    soundRecall?.cancel({ quiet: true });
    if (busy) {
      downloadControllerRef.current?.abort();
      downloadControllerRef.current = null;
      ++loadGenerationRef.current;
      setBusy(false);
      setLoadingProgress(null);
    }
    setSelectedBankName(bank.name);
    if (loaded && source && soundfontStorageKey(source) === soundfontStorageKey(bank)) return;
    const controller = new AbortController();
    downloadControllerRef.current = controller;
    const cachedFile = localFiles.current.get(bank.name);
    const bankSource = createSoundfontSource({
      cachedBank: cachedFile ? { blob: cachedFile } : undefined,
      name: bank.name,
      url: soundfontStorageKey(bank),
      allowDownload: HOSTED_SOUNDFONTS.includes(bank.name),
      signal: controller.signal,
      onPhase: phase => {
        if (downloadControllerRef.current !== controller) return;
        if (phase === "Downloading") dismissBankNotice();
        setLoadingProgress(progress => ({ ...progress, phase }));
      },
    });
    void loadSoundFont(bankSource, controller.signal);
  };

  // Abort a superseded manual selection before its result can overwrite a
  // recall. Progress events for the same recall leave live mix edits alone.
  useEffect(() => {
    if (!soundRecall) return;
    let revision;
    const synchronizeRecall = () => {
      const state = soundRecall.state;
      if (!state || revision === state.revision) return;
      revision = state.revision;
      preparationRequest.current?.abort();
      setFeedbackOwner("recall");
      ++loadGenerationRef.current;
      downloadControllerRef.current?.abort();
      downloadControllerRef.current = null;
      setBusy(false);
      setLoadingProgress(null);
      setStatus("");
      smoothingRef.current = readFluidSynthSmoothing();
      setSmoothing(smoothingRef.current);
    };
    synchronizeRecall();
    soundRecall.changes.addEventListener("change", synchronizeRecall);
    return () => soundRecall.changes.removeEventListener("change", synchronizeRecall);
  }, [soundRecall]);

  useEffect(() => {
    if (recalled?.phase !== "complete" || !recalled.name) return;
    if (recalled.presets) setPresets(recalled.presets);
    setSelectedBankName(recalled.name);
    setLibraryBankName(recalled.name);
    setPresetValue(recalled.preset);
  }, [recalled]);

  const selectPreset = (event) => {
    const [bank, program] = event.currentTarget.value.split(":").map(Number);
    const preset = presets.find((item) => item.bank === bank && item.program === program);
    if (!preset) return;
    peekFluidSynthEngine()?.selectPreset(preset);
    soundRecall?.markManualBankSelection();
    setPresetValue(event.currentTarget.value);
    if (source) rememberBankPreset(soundfontStorageKey(source), event.currentTarget.value);
    onChange("fluidsynth_preset", event.currentTarget.value);
    onChange("fluidsynth_runtime_revision", (Number(settings.fluidsynth_runtime_revision) || 0) + 1);
  };

  const currentMessage = feedbackOwner === "recall" ? (recalled?.phase === "over-budget" ? "" : recalled?.message) : feedbackOwner === "current" ? status : "";
  return (
    <fieldset class="output-routing-fieldset">
      <legend>
        <b>Built-in SoundFont Player</b>
        <button type="button" class="section-collapse-toggle"
          aria-label={collapsed ? "Show SoundFont Player settings" : "Hide SoundFont Player settings"}
          aria-expanded={!collapsed}
          title={collapsed ? "Toggle to show SoundFont Player settings" : "Toggle to hide SoundFont Player settings"}
          onClick={() => {
            sessionStorage.setItem("hexatone_fluidsynth_collapsed", String(!collapsed));
            setCollapsed(!collapsed);
          }}>
          <span aria-hidden="true" class={`disclosure-toggle-glyph disclosure-toggle-glyph--${collapsed ? "collapsed" : "expanded"}`} />
        </button>
      </legend>

      <label>
        Use FluidSynth Sounds
        <input
          type="checkbox"
          aria-label="Use FluidSynth output"
          checked={!!settings.output_fluidsynth}
          onChange={(event) => event.currentTarget.checked ? void enablePlayer() : onChange("output_fluidsynth", false)}
        />
      </label>

      <div class="preset-actions preset-actions--end">
        <button type="button" class="preset-utility-btn" disabled={!canShutdown}
          onClick={shutdownPlayer}>Shut Down FluidSynth</button>
      </div>

      {!settings.output_fluidsynth && currentMessage && <p role="status" class="settings-form__feedback">{currentMessage}</p>}

      <PrepareSoundfonts onRemove={removeBank} name={libraryBankName} onSelectName={setLibraryBankName} feedbackOwner={feedbackOwner} onManualSelection={() => { setFeedbackOwner("preload"); setStatus(""); setStorageStatus(""); }} request={preparationRequest} onBanksLoaded={selectPreparedSoundBank} onBankAvailableOrDownloading={dismissBankNotice} cache={cache} disabled={busy || recallPending} canLoadColdBank={canLoadColdBank}
        onReplaceForMemory={replaceForMemory} localFiles={localFiles.current} bankState={bankState} playbackBanks={playbackBanks} bankLabel={bankLabel} banks={banks} onRemember={rememberBanks} restoreProgress={restoreProgress}>
      {storageActionsReady ? (
        <div class="fluidsynth-settings__load-row">
          <div class="preset-actions preset-actions--end fluidsynth-settings__prepare-actions">
            <button type="button" class="preset-action-btn" disabled={busy || storageBusy}
              onClick={async () => {
                setStorageBusy(true);
                try {
                  const bank = await readWorkingSoundfont(soundfontStorageKey(source)).catch(() => null);
                  if (!bank && !(source instanceof Blob)) throw new Error("The temporary copy is unavailable. Load the SoundFont again.");
                  const blob = bank?.blob ?? source;
                  saveSoundfontFile(source.name, blob);
                } catch (error) { setStorageStatus(`File save failed: ${error.message}`); }
                finally { setStorageBusy(false); }
              }}>Save Current SoundFont</button>
          </div>
        </div>
      ) : null}
      {storageStatus && <p class="settings-form__feedback" role="status">{storageStatus}</p>}
      </PrepareSoundfonts>

      {settings.output_fluidsynth && (
        <>
      <label>
        Current SoundFont
        <select class="sidebar-input" aria-label="Current SoundFont"
          value={playbackBanks.has(selectedBankName) ? selectedBankName : ""}
          disabled={busy && !canCancelLoad} onChange={selectSoundfont}>
          <option value="" disabled>{playbackBanks.size ? "Choose a SoundFont…" : "Add a bank in Load SoundFonts…"}</option>
          {[...playbackBanks.values()].map(bank =>
            <option key={bank.name} value={bank.name}>{bankLabel(bank)}</option>)}
        </select>
      </label>
      {canCancelLoad && <div class="fluidsynth-settings__load-row">
        <div class="preset-actions preset-actions--end fluidsynth-settings__prepare-actions">
          <button type="button" class="preset-action-btn" onClick={cancelLoad}>
            {waitingForSilence || recalled?.phase === "waiting" ? "Cancel Load" : "Cancel Download"}
          </button>
        </div>
      </div>}

          <label>
            Preset
            <select
              class="sidebar-input"
              aria-label="FluidSynth preset"
              value={selectedPreset}
              disabled={!presetControlsReady}
              onChange={selectPreset}
            >
              {!presetControlsReady ? <option value="">{busy ? "Loading instrument…" : "Load the selected SoundFont first"}</option> : null}
              {(presetControlsReady ? presets : []).map((preset) => (
                <option
                  key={`${preset.bank}:${preset.program}`}
                  value={`${preset.bank}:${preset.program}`}
                >
                  {preset.name} (bank {preset.bank}, program {preset.program})
                </option>
              ))}
            </select>
          </label>
          <MixerFader session={soundSession} parameter={FLUID_VOLUME_KEY} label="Volume"
            ariaLabel="FluidSynth volume" max={127} defaultValue={100} disabled={!loaded} />
          <MixerFader session={soundSession} parameter={REVERB_KEY} label="Reverb"
            ariaLabel="FluidSynth reverb" max={127} defaultValue={20} disabled={!loaded} />

          {!collapsed && <>
          {[["pressureMs", "Pressure Smoothing (ms)"], ["expressionMs", "Expression Y Smoothing (ms)"]].map(([key, label]) => (
            <label key={key}>
              <span class={smoothing[key] === 0 ? "fluidsynth-settings__smoothing-off" : undefined}>{label}</span>
              <span class="sidebar-input settings-form__range-row">
                <CustomRangeSlider ariaLabel={label} min={0} max={500} step={1}
                  defaultValue={0} value={smoothing[key]} disabled={!loaded}
                  onInputValue={(value) => changeSmoothing(key, value)}
                  onCommitValue={(value) => changeSmoothing(key, value, true)} />
                <span class="settings-form__range-value">{smoothing[key] === 0 ? "off" : smoothing[key]}</span>
              </span>
            </label>
          ))}

          <label>
            <span class={smoothing.minimumMs === 0 ? "fluidsynth-settings__smoothing-off" : undefined}>Minimum Smoothing (ms)</span>
            <span class="sidebar-input settings-form__range-row">
              <CustomRangeSlider ariaLabel="Minimum Smoothing (ms)" min={0}
                max={Math.min(...[smoothing.pressureMs, smoothing.expressionMs].filter(ms => ms > 0), 500)}
                step={1} defaultValue={0} value={smoothing.minimumMs}
                disabled={!loaded || (!smoothing.pressureMs && !smoothing.expressionMs)}
                onInputValue={value => changeSmoothing("minimumMs", value)}
                onCommitValue={value => changeSmoothing("minimumMs", value, true)} />
              <span class="settings-form__range-value">{smoothing.minimumMs}</span>
            </span>
          </label>

          </>}

      {recalled?.phase === "waiting" && <p class="settings-form__feedback" role="status">
        Waiting for silence to load {recalled.name}…
      </p>}
      {busy && loadingProgress ? (
        <div
          class="settings-form__feedback fluidsynth-settings__download-status"
          role="status"
          aria-live="polite"
        >
          <p>
            {loadingProgress.phase} {loadingProgress.name}
            {loadingProgress.url ? (
              <>
                {" — "}
                <a href={loadingProgress.url} target="_blank" rel="noreferrer">
                  {loadingProgress.url}
                </a>
              </>
            ) : null}
          </p>
          {loadingProgress.phase !== "Downloading" ? null : loadingProgress.percent == null ? (
            <p>Download progress unavailable</p>
          ) : (
            <p>
              <progress
                aria-label={`Loading ${loadingProgress.name}`}
                max="100"
                value={loadingProgress.percent}
              />{" "}
              {loadingProgress.percent}%
            </p>
          )}
        </div>
      ) : currentMessage ? (
        <p class="settings-form__feedback" role="status">
          {currentMessage}
        </p>
      ) : null}
        </>
      )}
    </fieldset>
  );
};

FluidSynthSettings.propTypes = {
  settings: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  soundRecall: PropTypes.object,
  soundSession: PropTypes.object,
  keysRef: PropTypes.object,
  onWorkingChange: PropTypes.func,
  restoreProgress: PropTypes.object,
};

export default FluidSynthSettings;
