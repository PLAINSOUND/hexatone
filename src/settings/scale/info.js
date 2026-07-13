
import { useEffect, useState } from "preact/hooks";

// scale name and description
const Info = (props) => {
  const [nameDraft, setNameDraft] = useState(props.settings.name || "");
  const [descriptionDraft, setDescriptionDraft] = useState(props.settings.description || "");

  useEffect(() => {
    setNameDraft(props.settings.name || "");
  }, [props.settings.name]);

  useEffect(() => {
    setDescriptionDraft(props.settings.description || "");
  }, [props.settings.description]);

  const commitField = (name, value) => {
    if (value === (props.settings[name] || "")) return;
    props.onChange(name, value);
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
              commitField("name", e.currentTarget.value);
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => commitField("name", e.currentTarget.value)}
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
          onBlur={(e) => commitField("description", e.currentTarget.value)}
        />
      </label>
    </fieldset>
  );
};
export default Info;
