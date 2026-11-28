import { useEffect, useRef, useState } from "preact/hooks";
import { soundfontErrorDetail } from "../fluidsynth_synth/load-error.js";
import { HOSTED_SOUNDFONTS } from "../fluidsynth_synth/soundfont-catalog.js";
import { clearPreparedSoundfonts, loadFluidSynthSoundFont, peekFluidSynthEngine } from "../fluidsynth_synth/index.js";
import { createSoundfontSource } from "../fluidsynth_synth/soundfont-source.js";
import { soundfontStorageKey, storeSoundfontCopy } from "../fluidsynth_synth/soundfont-storage.js";

const formatMiB = bytes => `${Math.ceil(bytes / (1024 * 1024)).toLocaleString()} MiB`;

function loadFailures(failures, onReload = false) {
  const messages = new Set();
  for (const { name, reason } of failures) {
    if (/memory budget exceeded|out of memory|allocation failed/i.test(reason)) {
      messages.add(onReload ? "Preload memory full. Additional SoundFonts remain available." : 'Preload memory full. Please select the desired soundfont manually in "Current SoundFont".');
    }
    else {
      const detail = soundfontErrorDetail(reason);
      messages.add(onReload ? `Could not load on reload. ${name} (${detail})` : `Could not load ${name}: ${detail}`);
    }
  }
  return [...messages].join(" · ");
}

export default function PrepareSoundfonts({ name, onSelectName, request, cache, disabled, canLoadColdBank, banks, onRemember, onBankAvailableOrDownloading, onBanksLoaded, onManualSelection, playbackBanks, bankState, localFiles, onReplaceForMemory, bankLabel, feedbackOwner, restoreProgress, children }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [download, setDownload] = useState(null);
  const beginManual = () => {
    setStatus("");
    onManualSelection?.();
  };
  const [unsavedCopies, setUnsavedCopies] = useState([]);
  const localInput = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); request.current = null; };
  }, [request]);
  const names = [...playbackBanks.keys()];
  const references = new Map(banks.map(bank => [bank.name, bank]));
  const reference = name => playbackBanks.get(name);
  const keyFor = name => soundfontStorageKey(reference(name));
  const state = name && bankState(reference(name));
  const prepared = new Set(cache?.preparedKeys ?? []);
  const preparedNames = [...prepared].map(key =>
    names.find(candidate => keyFor(candidate) === key) ?? key);
  const deferredBanks = restoreProgress?.unavailable?.filter(({ name }) =>
    references.get(name)?.preload && !prepared.has(keyFor(name))) ?? [];
  const saveCopy = (source, bytes) => {
    return storeSoundfontCopy(source, bytes).then(() => {
      if (mounted.current) setUnsavedCopies(names => names.filter(name => name !== source.name));
    }, () => {
      if (mounted.current) setUnsavedCopies(names => [...new Set([...names, source.name])]);
    });
  };
  const prepare = async (banks, reload = false) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const { signal } = controller;
    const errors = [];
    const loadedNames = [];
    const show = message => {
      if (request.current === controller) setStatus(message);
    };
    beginManual();
    setBusy(true);
    try {
      for (const [index, bank] of banks.entries()) {
        signal.throwIfAborted();
        const bankName = typeof bank === "string" ? bank : bank.name;
        setDownload(null);
        let downloading = false;
        onRemember([typeof bank === "string" ? reference(bank) : bank], true);
        const prefix = banks.length > 1 ? `${index + 1} of ${banks.length} · ` : "";
        const hosted = typeof bank === "string" && HOSTED_SOUNDFONTS.includes(bankName);
        show(`${prefix}Loading ${bankName}…`);
        let copySaved;
        let source;
        let size;
        let memory;
        try {
          source = typeof bank === "string" ? createSoundfontSource({
            name: bankName, url: keyFor(bankName), allowDownload: hosted, signal, cachedBank: localFiles.has(bankName) ? { blob: localFiles.get(bankName) } : undefined,
            onPhase: phase => {
              if (signal.aborted) return;
              downloading = phase === "Downloading";
              if (downloading) {
                setDownload({ name: bankName });
                onBankAvailableOrDownloading?.();
              }
              show(`${prefix}${phase} ${bankName}…`);
            },
          }) : bank;
          if (typeof bank !== "string") saveCopy(bank, bank);
          await loadFluidSynthSoundFont(source, {
            prepareOnly: true, forceReload: reload, signal, canLoadColdBank,
            onDownloadProgress: ({ loaded, total }) => {
              if (downloading && !signal.aborted)
                setDownload({ name: bankName, percent: total ? Math.min(100, Math.floor(100 * loaded / total)) : undefined });
            },
            onDownloadComplete: () => {
              if (signal.aborted) return;
              setDownload(null);
              show(`${prefix}Loading ${bankName}…`);
            },
            onWaitingForSilence: () => show(`${prefix}Waiting for silence to load ${bankName}…`),
            onBytesReady: (file, bytes) => {
              size = bytes.byteLength;
              memory = peekFluidSynthEngine()?.soundfontCache ?? cache;
              // Offline storage may be slow or blocked. The worklet only
              // needs the ArrayBuffer, so don't await an IndexedDB write.
              if (typeof bank === "string" && !file.cachedBankKey) {
                copySaved = saveCopy(file, bytes);
              }
              if (size * 2 <= memory?.budgetBytes && size * 2 + memory.estimatedBytes > memory.budgetBytes) {
                throw new Error("SoundFont memory budget exceeded");
              }
            },
          });
          loadedNames.push(bankName);
          if (!signal.aborted) onBankAvailableOrDownloading?.();
        } catch (error) {
          signal.throwIfAborted();
          if (/memory budget exceeded|out of memory|allocation failed/i.test(error.message) &&
              memory?.estimatedBytes > 0 && size * 2 <= memory.budgetBytes) {
            await copySaved;
            signal.throwIfAborted();
            await onReplaceForMemory(source, signal);
            continue;
          }
          const tooLarge = size * 2 > memory?.budgetBytes;
          errors.push({ name: bankName, reason: tooLarge
            ? `This bank needs ${formatMiB(size * 2)} estimated. The player limit is ${formatMiB(memory.budgetBytes)}.`
            : error.message });
        }
      }
      if (loadedNames.length && !signal.aborted) await onBanksLoaded?.(loadedNames, signal);
      show(loadFailures(errors));
    } catch (error) {
      show(error.name === "AbortError" ? "Loading cancelled." : error.message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
        setDownload(null);
      }
    }
  };
  return <>
    <label>
      Load SoundFonts
      <select class="sidebar-input" value={name} disabled={disabled || busy}
        onChange={event => { onSelectName(event.currentTarget.value); beginManual(); }}>
        <option value="">Choose a bank…</option>
        {names.map(candidate => <option key={candidate} value={candidate}>
          {bankLabel(reference(candidate))}
        </option>)}
      </select>
    </label>
    <div class="fluidsynth-settings__load-row">
      <div class="preset-actions preset-actions--end fluidsynth-settings__prepare-actions">
        <button type="button" class="preset-action-btn"
          disabled={!busy && (disabled || !name || (!state && !HOSTED_SOUNDFONTS.includes(name)))}
          onClick={() => busy ? request.current?.abort() : void prepare([name], state === "loaded")}>
          {busy ? "Cancel Load" : state === "loaded" ? "Reload" : state === "available" ? "Load SoundFont" : "Download SoundFont"}
        </button>
        {!state && <button type="button" class="preset-action-btn" disabled={disabled || busy}
          onClick={() => localInput.current?.click()}>Load Local File</button>}
        <input ref={localInput} type="file" multiple aria-label="Local SoundFonts to load"
          class="settings-form__hidden-file-input" disabled={disabled || busy} onChange={event => {
            const input = event.currentTarget;
            const files = Array.from(input.files ?? []);
            input.value = "";
            if (!files.length) return;
            beginManual();
            if (files.some(file => !/\.(sf2|sf3)$/i.test(file.name))) {
              setStatus("Choose SoundFont files in .sf2 or .sf3 format.");
            } else void prepare(files);
          }} />
        {state === "loaded" &&
          <button type="button" class="preset-action-btn" disabled={disabled || busy} onClick={() => {
            beginManual();
            clearPreparedSoundfonts(keyFor(name));
            onRemember([reference(name)], false);
            setStatus(`${name} will unload when the player is silent.`);
          }}>Unload</button>}
      </div>
    </div>
    {feedbackOwner === "restore" && restoreProgress && restoreProgress.phase !== "complete" &&
      <p role="status" class="settings-form__feedback">
        {restoreProgress.phase === "starting" ? "Restoring saved SoundFonts…" :
          `${restoreProgress.phase === "waiting" ? "Waiting for silence to load" : "Loading"} ${restoreProgress.name} (${restoreProgress.index} of ${restoreProgress.total})…`}
      </p>}
    {feedbackOwner === "restore" && !!deferredBanks.length && <p class="settings-form__feedback">
      {loadFailures(deferredBanks, true)}
    </p>}
    {!!preparedNames.length && <p class="settings-form__feedback">Loaded: {preparedNames.join(", ")}</p>}
    {Number.isFinite(cache?.estimatedBytes) && <p class="settings-form__feedback">
      SoundFonts in memory: {formatMiB(cache.estimatedBytes)} estimated of {formatMiB(cache.budgetBytes)}.
    </p>}
    {feedbackOwner === "preload" && status && <p role="status" class="settings-form__feedback">{status}
      {download && <> <progress aria-label={`Downloading ${download.name}`} max="100" value={download.percent} />
        {download.percent != null && ` ${download.percent}%`}</>}
    </p>}
    {!!unsavedCopies.length && <p class="settings-form__feedback">
      Could not save browser copies of {unsavedCopies.join(", ")}. These files may need to be added again after reload.
    </p>}
    {children}
  </>;
}
