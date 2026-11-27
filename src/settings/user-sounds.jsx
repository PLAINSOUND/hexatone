import { useWorkingSoundSettings } from "../hooks/use-sound-session.js";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { BUILTIN_USER_SOUNDS, defaultSound, defaultSelection, findSound, restoreSelection, storeSoundSelection, availableUserSoundName, captureUserSound, loadUserSounds, parseUserSounds, saveUserSounds, userSoundHasChanges } from "../persistence/user-sounds.js";
import { orderPresetsByName } from "../persistence/preset-name-order.js";
import { exportFilename } from "../persistence/export-filename.js";
import { peekFluidSynthEngine, subscribeFluidSynthEngine } from "../fluidsynth_synth/index.js";

export default function UserSounds({ settings, onApply, workingSoundChanges, soundSession, soundRecall, children }) {
  const workingSettings = useWorkingSoundSettings(soundSession, settings);
  const [sounds, setSounds] = useState(loadUserSounds);
  const [{ selection: selected, name, description }, setSelection] = useState(() => restoreSelection(sounds));
  const [editingName, setEditingName] = useState(false);
  const updateSelection = (selection, name, description) => {
    const next = { selection, name, description };
    setSelection(next);
    storeSoundSelection(next);
  };
  useEffect(() => {
    if (!soundRecall) return;
    const update = () => {
      const selection = soundRecall.selection;
      // A headless recall can see user sounds imported since this view mounted.
      setSounds(previous => findSound(selection.selection, previous) ? previous : loadUserSounds());
      setSelection(selection);
    };
    soundRecall.selectionChanges.addEventListener("change", update);
    return () => soundRecall.selectionChanges.removeEventListener("change", update);
  }, [soundRecall]);
  const [error, setError] = useState("");
  const [, setEngineRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setEngineRevision(value => value + 1);
    const unsubscribe = subscribeFluidSynthEngine(refresh);
    workingSoundChanges?.addEventListener("change", refresh);
    return () => { unsubscribe(); workingSoundChanges?.removeEventListener("change", refresh); };
  }, [workingSoundChanges]);
  const fileInput = useRef(null);
  const pickerRef = useRef(null);
  const attempt = action => {
    try {
      action();
      setError("");
      return true;
    } catch (error) {
      setError(error.message);
      return false;
    }
  };
  const selectedSound = findSound(selected, sounds);
  const capture = () => captureUserSound(name, soundSession?.settings(settings) ?? workingSettings, { engine: peekFluidSynthEngine(), description,
    mixer: soundSession?.mixerValues?.(), referenceSoundfont: selectedSound?.soundfont });
  const dirty = !!selectedSound && (!name.trim() || userSoundHasChanges(capture(), selectedSound));
  const displayedName = dirty && name && !editingName ? name + " *" : name;
  const recall = value => {
    const record = findSound(value, sounds);
    return record && attempt(() => {
      if (soundRecall) soundRecall.recall(record);
      else {
        onApply(record);
        updateSelection(value, record.name, record.description);
      }
    });
  };
  const save = copy => attempt(() => {
    if (!copy && selected.startsWith("builtin:")) return;
    let record = capture();
    if (copy) record = { ...record, name: availableUserSoundName(record.name, sounds) };
    const original = copy ? null : sounds.find(sound => `user:${sound.name}` === selected);
    if (!copy && sounds.some(sound => sound !== original && sound.name === record.name)) {
      throw new Error("A sound with this name already exists. Choose another name or use Save as copy.");
    }
    const next = original
      ? sounds.map(sound => sound === original ? record : sound)
      : [...sounds, record];
    setSounds(saveUserSounds(next));
    updateSelection(`user:${record.name}`, record.name, record.description);
  });
  const changePickerRef = useRef(null);
  changePickerRef.current = ({ currentTarget }) => {
    if (!recall(currentTarget.value)) currentTarget.value = selected;
  };

  // Keep live sound edits in the name field's dirty indicator. Changing a
  // native option's text can recreate an open popup, even with focus intact.
  useLayoutEffect(() => {
    if (pickerRef.current.value !== selected) pickerRef.current.value = selected;
  }, [selected, sounds]);

  const soundPicker = useMemo(() => {
    const option = (sound, value) => <option key={value} value={value}>{sound.name}</option>;
    return <select ref={pickerRef} aria-label="User sounds"
      onChange={event => changePickerRef.current(event)}>
      {BUILTIN_USER_SOUNDS.map((sound, index) => option(sound, `builtin:${index}`))}
      <option disabled>──────────</option>
      {orderPresetsByName(sounds).map(sound => option(sound, `user:${sound.name}`))}
    </select>;
  }, [sounds]);

  return <><fieldset>
    <legend><b>User Sounds</b></legend>
    <input ref={fileInput} type="file" accept=".json" multiple class="settings-form__hidden-file-input"
      onChange={async event => {
        const input = event.currentTarget;
        try {
          const imported = (await Promise.all([...input.files].map(async file => parseUserSounds(await file.text())))).flat();
          const next = loadUserSounds();
          for (const record of imported) {
            next.push({ ...record, name: availableUserSoundName(record.name, next) });
          }
          setSounds(saveUserSounds(next)); setError("");
        } catch (error) { setError(error.message); }
        input.value = "";
      }} />
    <div class="preset-actions preset-actions--library preset-actions--library-import">
      <button type="button" class="preset-action-btn" onClick={() => fileInput.current.click()}>Open File(s)...</button>
    </div>
    <div class="preset-selector-row user-sounds-selector-row">
      {soundPicker}
      <button type="button" class="preset-refresh-btn" disabled={!selected}
        aria-label="Reload selected sound" title="Reload selected sound" onClick={() => recall(selected)}>
        <span class="preset-refresh-glyph" aria-hidden="true">⟳</span>
      </button>
      {sounds.some(sound => `user:${sound.name}` === selected) && <button type="button" class="delete-btn preset-utility-btn" onClick={() => attempt(() => {
        setSounds(saveUserSounds(sounds.filter(sound => `user:${sound.name}` !== selected)));
        updateSelection(defaultSelection, defaultSound.name, defaultSound.description);
      })}>Delete</button>}
    </div>
    <div class="settings-form__action-row settings-form__action-row--top">
      <span class="settings-form__action-group settings-form__action-group--wrap">
        <button type="button" class="preset-action-btn" disabled={!name.trim() || selected.startsWith("builtin:")} onClick={() => save(false)}>Save</button>
        <button type="button" class="preset-action-btn" disabled={!name.trim()} onClick={() => save(true)}>Save as copy</button>
      </span>
      <button type="button" class="preset-utility-btn settings-form__utility-btn--export" disabled={!name.trim()}
        onClick={() => attempt(() => {
          const record = capture();
          const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
          const link = document.createElement("a"); link.href = url;
          link.download = `${exportFilename(record.name, "sound")}.json`; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
        })}>Export .json</button>
    </div>
    {error && <p class="preset-error" role="alert">{error}</p>}
    {children}
  </fieldset>
  <fieldset>
    <legend><b>Name and Description</b></legend>
    <label>
      <input type="text" aria-label="Sound name" placeholder="User Sound"
        aria-describedby={dirty ? "user-sound-unsaved" : undefined}
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} value={displayedName}
        onFocus={() => setEditingName(true)} onBlur={() => setEditingName(false)}
        onInput={event => updateSelection(selected, event.currentTarget.value, description)} />
    </label>
    {dirty && <span hidden id="user-sound-unsaved" aria-label="Unsaved sound changes">Unsaved sound changes</span>}
    <label><textarea aria-label="Sound description" autoComplete="off" autoCorrect="off"
      autoCapitalize="off" spellCheck={false} value={description}
      onInput={event => updateSelection(selected, name, event.currentTarget.value)} /></label>
  </fieldset></>;
}
