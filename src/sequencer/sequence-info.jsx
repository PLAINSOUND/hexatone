const SequenceInfo = ({
  name,
  description,
  onNameChange,
  onDescriptionChange,
}) => (
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
        value={name}
        onInput={(e) => onNameChange(e.currentTarget.value)}
      />
    </label>
    <label>
      <textarea
        name="description"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        value={description}
        onInput={(e) => onDescriptionChange(e.currentTarget.value)}
      />
    </label>
  </fieldset>
);

export default SequenceInfo;
