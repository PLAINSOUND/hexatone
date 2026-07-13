import { useEffect, useState } from "preact/hooks";

const SequenceInfo = ({
  name,
  description,
  onNameChange,
  onDescriptionChange,
}) => {
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
    onNameChange(value);
  };

  const commitDescription = (value) => {
    if (value === (description || "")) return;
    onDescriptionChange(value);
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
          placeholder="User Sequence"
          width="100%"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={nameDraft}
          onInput={(e) => setNameDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitName(e.currentTarget.value);
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => commitName(e.currentTarget.value)}
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
};

export default SequenceInfo;
