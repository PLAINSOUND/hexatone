import { useEffect, useRef, useState } from "preact/hooks";
import { loadUserSounds } from "../persistence/user-sounds.js";
import { HOSTED_SOUNDFONTS, hostedSoundfontUrl } from "../fluidsynth_synth/soundfont-catalog.js";
import { clearPreparedSoundfonts, loadFluidSynthSoundFont } from "../fluidsynth_synth/index.js";
import { createSoundfontSource } from "../fluidsynth_synth/soundfont-source.js";
import { soundfontStorageKey, storeSoundfontCopy } from "../fluidsynth_synth/soundfont-storage.js";

const formatMiB = bytes => `${Math.ceil(bytes / (1024 * 1024)).toLocaleString()} MiB`;

export default function PrepareSoundfonts({ engine, cache, disabled, canLoadColdBank, banks, onRemember, restoreProgress, children }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [unsavedCopies, setUnsavedCopies] = useState([]);
  const request = useRef(null);
  const localInput = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); request.current = null; };
  }, []);
  const names = [...new Set([
    ...HOSTED_SOUNDFONTS,
    ...banks.map(bank => bank.name),
    engine?.soundfontSource?.name,
    ...loadUserSounds().flatMap(sound => [sound.soundfont.name, sound.soundfont.fallback?.name]),
  ].filter(Boolean))];
  const references = new Map(banks.map(bank => [bank.name, bank]));
  const reference = name => references.get(name) ?? {
    name, url: HOSTED_SOUNDFONTS.includes(name) ? hostedSoundfontUrl(name) : "",
  };
  const keyFor = name => soundfontStorageKey(reference(name));
  const prepared = new Set(cache?.preparedKeys ?? []);
  const resident = new Set(cache?.keys ?? cache?.preparedKeys ?? []);
  if (engine?.soundfontId != null && engine.soundfontSource?.name) {
    resident.add(soundfontStorageKey(engine.soundfontSource));
  }
  const preparedNames = [...prepared].map(key =>
    names.find(candidate => keyFor(candidate) === key) ?? key);
  const deferredBanks = restoreProgress?.unavailable?.filter(({ name }) =>
    references.get(name)?.preload && !prepared.has(keyFor(name))) ?? [];
  const saveCopy = (source, bytes) => {
    void storeSoundfontCopy(source, bytes).then(() => {
      if (mounted.current) setUnsavedCopies(names => names.filter(name => name !== source.name));
    }, () => {
      if (mounted.current) setUnsavedCopies(names => [...new Set([...names, source.name])]);
    });
  };
  const prepare = async (banks) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const { signal } = controller;
    const errors = [];
    const show = message => {
      if (request.current === controller) setStatus(message);
    };
    setBusy(true);
    try {
      for (const [index, bank] of banks.entries()) {
        signal.throwIfAborted();
        const bankName = typeof bank === "string" ? bank : bank.name;
        onRemember([typeof bank === "string" ? reference(bank) : bank], true);
        const prefix = banks.length > 1 ? `${index + 1} of ${banks.length} · ` : "";
        const hosted = typeof bank === "string" && HOSTED_SOUNDFONTS.includes(bankName);
        show(`${prefix}Loading ${bankName}…`);
        try {
          const source = typeof bank === "string" ? createSoundfontSource({
            name: bankName, url: keyFor(bankName), allowDownload: hosted, signal,
            onPhase: phase => show(`${prefix}${phase} ${bankName}…`),
          }) : bank;
          if (typeof bank !== "string") saveCopy(bank, bank);
          await loadFluidSynthSoundFont(source, {
            prepareOnly: true, signal, canLoadColdBank,
            onWaitingForSilence: () => show(`${prefix}Waiting for silence to load ${bankName}…`),
            onBytesReady: (file, bytes) => {
              // Offline storage may be slow or blocked. The worklet only
              // needs the ArrayBuffer, so don't await an IndexedDB write.
              if (typeof bank === "string" && !file.cachedBankKey) {
                saveCopy(file, bytes);
              }
            },
          });
        } catch (error) {
          signal.throwIfAborted();
          errors.push(`${bankName}: ${error.message}`);
        }
      }
      show(errors.length ? `Could not load ${errors.join(" · ")}. These banks remain in Current SoundFont.` : "");
    } catch (error) {
      show(error.name === "AbortError" ? "Loading cancelled." : error.message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  };
  return <>
    <label>
      Load SoundFonts
      <select class="sidebar-input" value={name} disabled={disabled || busy}
        onChange={event => { setName(event.currentTarget.value); setStatus(""); }}>
        <option value="">Choose a bank…</option>
        {names.map(candidate => <option key={candidate} value={candidate}>
          {candidate}{resident.has(keyFor(candidate)) ? " (loaded)" : ""}
        </option>)}
      </select>
    </label>
    <div class="fluidsynth-settings__load-row">
      <div class="preset-actions preset-actions--end fluidsynth-settings__prepare-actions">
        <button type="button" class="preset-action-btn"
          disabled={!busy && (disabled || !name || prepared.has(keyFor(name)))}
          onClick={() => busy ? request.current?.abort() : void prepare([name])}>
          {busy ? "Cancel Load" : "Load Bank"}
        </button>
        <button type="button" class="preset-action-btn" disabled={disabled || busy}
          onClick={() => localInput.current?.click()}>Load Local Files…</button>
        <input ref={localInput} type="file" multiple aria-label="Local SoundFonts to load"
          class="settings-form__hidden-file-input" disabled={disabled || busy} onChange={event => {
            const input = event.currentTarget;
            const files = Array.from(input.files ?? []);
            input.value = "";
            if (!files.length) return;
            if (files.some(file => !/\.(sf2|sf3)$/i.test(file.name))) {
              setStatus("Choose SoundFont files in .sf2 or .sf3 format.");
            } else void prepare(files);
          }} />
        {name && (prepared.has(keyFor(name)) || references.get(name)?.preload) &&
          <button type="button" class="preset-action-btn" disabled={disabled || busy} onClick={() => {
            clearPreparedSoundfonts(keyFor(name));
            onRemember([reference(name)], false);
            setStatus(`${name} will unload when it is inactive and the player is silent.`);
          }}>Unload Bank</button>}
      </div>
    </div>
    {restoreProgress && restoreProgress.phase !== "complete" &&
      <p role="status" class="settings-form__feedback">
        {restoreProgress.phase === "starting" ? "Restoring saved SoundFonts…" :
          `${restoreProgress.phase === "waiting" ? "Waiting for silence to load" : "Loading"} ${restoreProgress.name} (${restoreProgress.index} of ${restoreProgress.total})…`}
      </p>}
    {!!deferredBanks.length && <p class="settings-form__feedback">
      Could not load on reload. {deferredBanks.map(({ name, reason }) => `${name} (${reason})`).join(" · ")}
    </p>}
    {!!preparedNames.length && <p class="settings-form__feedback">Loaded: {preparedNames.join(", ")}</p>}
    {Number.isFinite(cache?.estimatedBytes) && <p class="settings-form__feedback">
      SoundFonts in memory: {formatMiB(cache.estimatedBytes)} estimated of {formatMiB(cache.budgetBytes)}.
    </p>}
    {status && <p role="status" class="settings-form__feedback">{status}</p>}
    {!!unsavedCopies.length && <p class="settings-form__feedback">
      Could not save browser copies of {unsavedCopies.join(", ")}. These files may need to be added again after reload.
    </p>}
    {children}
  </>;
}
