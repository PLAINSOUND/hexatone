/** FluidSynth browser backend controls: local SoundFont, enumerated preset and level. */

import { useEffect, useRef, useState } from "preact/hooks";
import PropTypes from "prop-types";
import PrepareSoundfonts from "./prepare-soundfonts.jsx";
import { useSoundRecallState } from "../hooks/use-sound-session.js";
import CustomRangeSlider from "./shared/range-slider.jsx";
import { createSoundfontSource } from "../fluidsynth_synth/soundfont-source.js";
import { soundfontStorageKey, readWorkingSoundfont, storeSoundfontCopy, saveSoundfontFile } from "../fluidsynth_synth/soundfont-storage.js";
import { restoreSoundOnReload } from "../persistence/io-reload-policy.js";
import {
  loadFluidSynthSoundFont,
  peekFluidSynthEngine,
  subscribeFluidSynthEngine,
} from "../fluidsynth_synth/index.js";

import { BANK_PRESETS_KEY, HOSTED_SOUNDFONTS, LAST_BANK_KEY, legacyLocalSoundfontKey, readRememberedSoundfont, rememberBankPreset } from "../fluidsynth_synth/soundfont-catalog.js";
import { canLoadColdSoundfont, readPerformanceBanks, rememberPerformanceBanks } from "../fluidsynth_synth/performance-banks.js";
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
const FluidSynthSettings = ({ settings, onChange, soundSession, soundRecall, onWorkingChange, keysRef, restoreProgress }) => {
  const [collapsed, setCollapsed] = useState(() => sessionStorage.getItem("hexatone_fluidsynth_collapsed") !== "false");
  const [presets, setPresets] = useState(() => peekFluidSynthEngine()?.presets ?? []);
  const [cache, setCache] = useState(() => peekFluidSynthEngine()?.soundfontCache);
  const [banks, setBanks] = useState(readPerformanceBanks);
  const rememberBanks = (sources, preload) => setBanks(previous => rememberPerformanceBanks(previous, sources, preload));
  const [selectedBankName, setSelectedBankName] = useState(() =>
    peekFluidSynthEngine()?.soundfontSource?.name ?? "");
  const [smoothing, setSmoothing] = useState(readFluidSynthSmoothing);
  const smoothingRef = useRef(smoothing);
  const [busy, setBusy] = useState(false);
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
  const recalled = useSoundRecallState(soundRecall);
  const recallReference = recalled?.reference;
  const recallPending = recalled?.phase === "checking" || recalled?.phase === "waiting";
  const activeEngine = peekFluidSynthEngine();
  const source = activeEngine?.soundfontSource;
  const playbackBanks = new Map(banks.map(bank => [bank.name, bank]));
  const remembered = readRememberedSoundfont();
  for (const bank of [remembered, source]) {
    if (bank && !playbackBanks.has(bank.name)) playbackBanks.set(bank.name, bank);
  }
  const residentKeys = cache?.keys ?? [];
  useEffect(() => {
    if (source) setBanks(previous => rememberPerformanceBanks(previous, [source]));
  }, [source]);
  useEffect(() => {
    const syncEngineState = (nextEngine = peekFluidSynthEngine()) => {
      setPresets(nextEngine?.presets ?? []);
      setCache(nextEngine?.soundfontCache);
      if (!nextEngine?.pendingSoundfont) setStatus("");
      if (nextEngine?.selectedPreset) {
        setPresetValue(`${nextEngine.selectedPreset.bank}:${nextEngine.selectedPreset.program}`);
      }
      if (nextEngine?.soundfontSource?.name && !downloadControllerRef.current) {
        setSelectedBankName(nextEngine.soundfontSource.name);
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
  const quietOfflineLoad = busy && loadingProgress?.quiet;
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

  const loadSoundFont = async (source, signal) => {
    if (!source) return;
    const generation = ++loadGenerationRef.current;
    const current = () => generation === loadGenerationRef.current;
    const useRecallPreset = recalled?.phase === "missing" || recallPending;
    const recalledPreset = useRecallPreset
      ? [recallReference, recallReference.fallback].find(bank => bank?.name === source.name)?.preset
      : undefined;
    const preferredPreset = recalledPreset ?? readSavedPreset(soundfontStorageKey(source)) ??
      (source.name === localStorage.getItem(LAST_BANK_KEY) ? settings.fluidsynth_preset : undefined);
    setBusy(true);
    setStatus(source.url ? "" : `${loaded ? "Replacing" : "Loading"} ${source.name}…`);
    setStorageStatus("");
    setLoadingProgress({
      name: source.name,
      url: source.url ?? "",
      percent: 0,
      phase: source.url ? "Checking stored copy" : "Reading local file",
      quiet: !!source.url,
    });
    try {
      const result = await loadFluidSynthSoundFont(source, {
        signal,
        preferredPreset,
        canLoadColdBank,
        onWaitingForSilence: () => {
          if (current()) setLoadingProgress(progress => ({ ...progress, url: "",
            phase: "Waiting for silence to load", quiet: false }));
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
      const nextPresets = result.presets || [];
      setPresets(nextPresets);
      setSelectedBankName(source.name);
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
      setStatus(`SoundFont load failed: ${error.message}`);
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

  const selectSoundfont = event => {
    const bank = playbackBanks.get(event.currentTarget.value);
    if (!bank) return;
    soundRecall?.cancel({ quiet: true });
    if (busy) {
      downloadControllerRef.current?.abort();
      downloadControllerRef.current = null;
      ++loadGenerationRef.current;
      setBusy(false);
      setLoadingProgress(null);
    }
    setSelectedBankName(bank.name);
    if (source && soundfontStorageKey(source) === soundfontStorageKey(bank)) return;
    const controller = new AbortController();
    downloadControllerRef.current = controller;
    const bankSource = createSoundfontSource({
      name: bank.name,
      url: soundfontStorageKey(bank),
      allowDownload: Boolean(bank.url) && HOSTED_SOUNDFONTS.includes(bank.name),
      signal: controller.signal,
      onPhase: phase => {
        if (downloadControllerRef.current === controller)
          setLoadingProgress(progress => ({ ...progress, phase, quiet: phase !== "Downloading" }));
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
          onChange={(event) => onChange("output_fluidsynth", event.currentTarget.checked)}
        />
      </label>

      <PrepareSoundfonts engine={activeEngine} cache={cache} disabled={busy || recallPending} canLoadColdBank={canLoadColdBank}
        banks={banks} onRemember={rememberBanks} restoreProgress={restoreProgress}>
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
              }}>Save SoundFont File…</button>
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
          {[...playbackBanks.values()].map(bank => {
            const ready = (loaded && source?.name === bank.name) || residentKeys.includes(soundfontStorageKey(bank));
            return <option key={bank.name} value={bank.name}>{bank.name}{ready ? "" : " (load on selection)"}</option>;
          })}
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
              {!presetControlsReady ? <option value="">{busy && !quietOfflineLoad ? "Loading instrument…" : "Load the selected SoundFont first"}</option> : null}
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
      {busy && loadingProgress && !quietOfflineLoad ? (
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
      ) : (status || recalled?.message) && !quietOfflineLoad ? (
        <p class="settings-form__feedback" role="status">
          {status || recalled?.message}
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
