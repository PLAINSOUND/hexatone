# Bach Tuning Corpus

This folder is the machine-readable corpus layer for the `bach-tuning/` materials.

## Source materials observed

- MIDI:
  - `bach-tuning/MIDI/bwv1001/vs1-1ada.mid`
  - `bach-tuning/MIDI/bwv1001/vs1-2fug.mid`
  - `bach-tuning/MIDI/bwv1001/vs1-3sic.mid`
  - `bach-tuning/MIDI/bwv1001/vs1-4prs.mid`
- HEJI docs:
  - `bach-tuning/HEJI/HEJILegend2025_Landscape.docx`
  - `bach-tuning/HEJI/HEJI2_Algorithmic_A4Landcape.docx`
- Tuned score:
  - `bach-tuning/TUNED/Sei Bach-IntonazioniSIB2024win-FINAL.sib`
  - `bach-tuning/TUNED/Sei Bach-Intonazioni_Ia_IIa_IIIa_2024.pdf`

## Current recommendation

Use the MIDI file as the event/timing backbone and annotate a separate note list with:

- score spelling
- octave
- HEJI accidentals
  - canonical ids
  - official Unicode SMuFL glyph/codepoint data
  - HEJI2 ASCII/font-encoded typing forms

The HEJI docs already contain the rational comma data needed to derive monzo deltas.

## Layout

- `heji-map.bach-subset.json`
  - shared accidental semantics for the Bach corpus
- `bwv1001_adagio.notes.json`
  - manual/editable note-event file for the Adagio pilot

## Workflow

1. Generate or hand-fill note-event rows from MIDI.
2. Add score spelling and HEJI accidental data using one or more of:
   - canonical ids
   - Unicode glyph/codepoint data
   - HEJI2 ASCII typing text
3. Compute:
   - Pythagorean base monzo
   - HEJI delta monzo
   - full monzo
   - ratio and cents
4. Use the resulting corpus for tuning-decision analysis and retuning-engine research.
