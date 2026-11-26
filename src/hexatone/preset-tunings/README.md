# Preset Tuning JSON Format

Built-in Hexatone tunings live here as one JSON file per preset, plus one
global [preset-registry.json](./preset-registry.json) that controls category
order and per-category preset order.

JSON does not support comments, so this note documents the indexing convention
used by the preset files.

## Degree Indexing

Hexatone distinguishes between fields that include the implicit `degree 0`
(`1/1`) and fields that begin at the first stored scale step.

Fields that begin with `degree 1` and therefore have length `scale.length`:

- `scale`
  The stored scale steps above the implicit `degree 0`. The equave is normally
  the last item in this array.
- `note_names`
  One entry per stored scale step, aligned with `scale[0]`, `scale[1]`, ...
- `note_colors`
  One entry per stored scale step, aligned with `scale[0]`, `scale[1]`, ...

So:

- `scale[0]` = `degree 1`
- `note_names[0]` = label for `degree 1`
- `note_colors[0]` = colour for `degree 1`

Fields that refer explicitly to `degree 0`:

- `reference_degree`
- `center_degree`
- controller anchor and layout-related degree fields when present

These use Hexatone's full degree numbering, where:

- `degree 0` = implicit `1/1`
- `degree 1` = first item of `scale`
- `degree n` = `scale[n - 1]`

## Practical Rule

When editing a preset JSON by hand:

- if you are editing the scale content itself, think in terms of stored degrees
  starting at `degree 1`
- if you are editing a field that points to a degree number, think in terms of
  Hexatone's full numbering starting at `degree 0`

## Registry

`preset-registry.json` is the single ordering source of truth:

- category order is the order of `categories`
- preset order inside a category is the order of `presets`

New folders or preset files discovered by the generator fall through to the end
unless manually reordered in the registry.

## Exquis-specific layout

Built-in and user tuning JSON may include these optional fields:

```json
{
  "rSteps": 9,
  "drSteps": 4,
  "exquis_rsteps": 5,
  "exquis_drsteps": 6,
  "exquis_anchor_note": 35
}
```

With Exquis selected as the MIDI input geometry, `exquis_rsteps` and
`exquis_drsteps` replace the ordinary steps for the canvas and controller
mapping. Loading a preset or switching to Exquis applies them automatically.
Each missing Exquis step falls back to its ordinary counterpart. Other
controllers always use `rSteps` and `drSteps`. Step values are integers
from −1220 to 1220; zero is allowed.

The manual **Hexatone Layout Override** takes precedence over either preset
layout while enabled. Its saved preferences are separate from these JSON
fields and are not exported with a tuning. Saving while Exquis is active captures
the visible steps (including any enabled override) as `exquis_rsteps` and
`exquis_drsteps`, together with the current anchor. The override toggle itself
is never stored in the tuning.

`exquis_anchor_note` selects the Exquis MIDI note aligned with the tuning's
`center_degree`. Its existing preset-anchor handling applies on loading the
tuning and when switching to Exquis.

These optional fields survive user-tuning save/export/import. Loading another
tuning without them clears the previous preset's Exquis-specific values.
