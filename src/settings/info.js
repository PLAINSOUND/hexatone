import { h, render } from "preact";

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
        onChange={(e) => props.onChange(e.target.name, e.target.value)}
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
        onChange={(e) => props.onChange(e.target.name, e.target.value)}
      />
    </label>
  </fieldset>
);
export default Info;
