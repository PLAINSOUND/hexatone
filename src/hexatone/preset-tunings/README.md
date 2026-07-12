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
