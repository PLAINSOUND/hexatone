
// scale name and description
const Info = (props) => (
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
        value={props.settings.name}
        onInput={(e) => props.onChange(e.currentTarget.name, e.currentTarget.value)}
      />
    </label>
    <label>
      <textarea
        name="description"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        value={props.settings.description}
        onInput={(e) => props.onChange(e.currentTarget.name, e.currentTarget.value)}
      />
    </label>
  </fieldset>
);
export default Info;
