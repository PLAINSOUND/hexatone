import { useEffect, useState } from "preact/hooks";

// Keep text drafts local until blur. The star is a display of buffer state.
export default function PresetInfo({ name, description, dirty, label, placeholder, onNameChange, onDescriptionChange }) {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(name || "");
  const [descriptionDraft, setDescriptionDraft] = useState(description || "");

  useEffect(() => {
    setNameDraft(name || "");
  }, [name]);

  useEffect(() => {
    setDescriptionDraft(description || "");
  }, [description]);

  const commitName = (value) => {
    if (value === (name || "")) return;
    onNameChange?.(value);
  };

  const commitDescription = (value) => {
    if (value === (description || "")) return;
    onDescriptionChange?.(value);
  };

  return (
    <fieldset>
      <legend>
        <b>Name and Description</b>
      </legend>
      <label>
        <input
          name="name"
          type="text"
          placeholder={placeholder}
          aria-label={label}
          aria-description={dirty ? "Unsaved changes" : undefined}
          width="100%"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={dirty && !editing ? (nameDraft ? nameDraft + " *" : "*") : nameDraft}
          onFocus={() => setEditing(true)}
          onInput={(e) => setNameDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          onBlur={() => {
            setEditing(false);
            commitName(nameDraft);
          }}
        />
      </label>
      <label>
        <textarea
          name="description"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={descriptionDraft}
          onInput={(e) => setDescriptionDraft(e.currentTarget.value)}
          onBlur={(e) => commitDescription(e.currentTarget.value)}
        />
      </label>
    </fieldset>
  );
}
