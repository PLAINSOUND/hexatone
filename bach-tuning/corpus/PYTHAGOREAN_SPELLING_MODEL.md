# Pythagorean Spelling Model

Date: 2026-04-05
Purpose: define a clean mapping from note names such as `A#4` to monzos relative to `A4 = (0, 0, 0, ...)`, and define a first contextual spelling guesser for MIDI notes in the Bach corpus

## 1. Reference convention

We take:

- `A4 = 1/1`
- monzo prime order: `[2, 3, 5, 7, 11, 13, 17, 19]`
- `A4` monzo = `[0, 0, 0, 0, 0, 0, 0, 0]`

This means:

- the first monzo coordinate is the power of `2`
- the second monzo coordinate is the power of `3`
- higher primes are initially zero in Pythagorean spelling

So all plain note-name spellings before HEJI inflection live in the 3-limit plane:

- only primes `2` and `3` are nonzero

---

## 2. Accidental monzos

### Sharp

By your convention:

- one Pythagorean sharp = `2187/2048`
- monzo = `[-11, 7, 0, 0, 0, 0, 0, 0]`

### Flat

Inverse of sharp:

- one Pythagorean flat = `2048/2187`
- monzo = `[11, -7, 0, 0, 0, 0, 0, 0]`

### Double accidentals

These are repeated additions:

- double sharp = `2 * sharp monzo`
- double flat = `2 * flat monzo`

So:

- `x` or `##` -> `[-22, 14, 0, 0, 0, 0, 0, 0]`
- `bb` -> `[22, -14, 0, 0, 0, 0, 0, 0]`

---

## 3. Natural-note monzos in octave 4

To make the system concrete, define the seven naturals in scientific octave 4 relative to `A4`.

These are:

| Note | Ratio to A4 | Monzo `[2,3,...]` |
|---|---:|---:|
| `C4` | `16/27` | `[4, -3, 0, 0, 0, 0, 0, 0]` |
| `D4` | `2/3` | `[1, -1, 0, 0, 0, 0, 0, 0]` |
| `E4` | `3/4` | `[-2, 1, 0, 0, 0, 0, 0, 0]` |
| `F4` | `64/81` | `[6, -4, 0, 0, 0, 0, 0, 0]` |
| `G4` | `8/9` | `[3, -2, 0, 0, 0, 0, 0, 0]` |
| `A4` | `1/1` | `[0, 0, 0, 0, 0, 0, 0, 0]` |
| `B4` | `9/8` | `[-3, 2, 0, 0, 0, 0, 0, 0]` |

This is the simplest stable lookup table.

---

## 4. Octave rule

The octave number is measured relative to octave `4`.

If a note is in octave `n`, add:

- `[n - 4, 0, 0, 0, 0, 0, 0, 0]`

to the monzo.

Examples:

- `A5 = A4 + [1,0,...] = [1,0,0,0,0,0,0,0]`
- `A3 = A4 + [-1,0,...] = [-1,0,0,0,0,0,0,0]`
- `C5 = C4 + [1,0,...] = [5,-3,0,0,0,0,0,0]`

---

## 5. Full spelling formula

For a fully spelled note:

`full_pythagorean_monzo = natural_base(letter, octave) + accidental_count * sharp_monzo`

where:

- accidental count:
  - natural = `0`
  - sharp = `+1`
  - double sharp = `+2`
  - flat = `-1`
  - double flat = `-2`

More explicitly:

```text
monzo(letter, accidental, octave)
= naturalMonzo4(letter)
+ [octave - 4, 0, 0, 0, 0, 0, 0, 0]
+ accidentalCount * [-11, 7, 0, 0, 0, 0, 0, 0]
```

---

## 6. Worked examples

### `A4`

- base `A4` = `[0,0,0,0,0,0,0,0]`

### `A#4`

- `A4` + sharp
- `[0,0,0,0,0,0,0,0] + [-11,7,0,0,0,0,0,0]`
- result: `[-11,7,0,0,0,0,0,0]`

### `Bb4`

- `B4` + flat
- `[-3,2,0,0,0,0,0,0] + [11,-7,0,0,0,0,0,0]`
- result: `[8,-5,0,0,0,0,0,0]`

### `F#5`

- `F4` = `[6,-4,0,0,0,0,0,0]`
- octave 5 adds `[1,0,0,0,0,0,0,0]`
- sharp adds `[-11,7,0,0,0,0,0,0]`
- result: `[-4,3,0,0,0,0,0,0]`

This is `27/16`, the expected Pythagorean `F#` above `A4`.

### `Eb4`

- `E4` = `[-2,1,0,0,0,0,0,0]`
- flat adds `[11,-7,0,0,0,0,0,0]`
- result: `[9,-6,0,0,0,0,0,0]`

---

## 7. Why this matters for the MIDI corpus

A MIDI note number gives:

- absolute pitch height

but not:

- enharmonic spelling

For the corpus and later retuning engine, we need both:

- a guessed Pythagorean spelling from context
- a manually corrected score spelling when needed

That suggests a two-stage model.

---

## 8. Two-stage spelling model

### Stage A. MIDI to guessed Pythagorean spelling

Given MIDI note number and context, propose:

- letter
- accidental
- octave
- guessed monzo

### Stage B. Score correction / manual override

Replace the guess where the actual notation says otherwise.

Then:

- compute exact Pythagorean monzo from the corrected spelling
- add HEJI accidental deltas afterward

This is exactly the right separation:

- guess for convenience
- score for authority

---

## 9. Contextual spelling guesser for BWV 1001 in G minor

For this Bach corpus, a good first model is not a general-purpose enharmonic engine.

It is a style-aware guesser for the expected notational world of these pieces.

### Default chromatic spelling model in G minor

You suggested the most common spellings are:

- `G`
- `Ab`
- `A`
- `Bb`
- `B`
- `C`
- `C#`
- `D`
- `Eb`
- `E`
- `F`
- `F#`

with occasional:

- `Db`

This is a very good first default spelling ladder for pitch classes.

Expressed by pitch class relative to C:

| Pitch class | Default spelling |
|---|---|
| 0 | `C` |
| 1 | `C#` |
| 2 | `D` |
| 3 | `Eb` |
| 4 | `E` |
| 5 | `F` |
| 6 | `F#` |
| 7 | `G` |
| 8 | `Ab` |
| 9 | `A` |
| 10 | `Bb` |
| 11 | `B` |

This should be the first-pass guesser for the Adagio pilot.

### Why this is a good first model

Because it matches:

- the tonal environment
- your stated likely spellings
- the fact that the corpus is not chromatically arbitrary

This is much better than a generic “always choose sharps” or “always choose flats” rule.

---

## 10. Guesser output schema

For each MIDI note event, the guesser should produce:

```json
{
  "pitch_class": 1,
  "guessed_spelling": {
    "staff_note": "C",
    "western_accidental": "sharp",
    "octave": 5
  },
  "guessed_pythagorean_monzo": [-6, 4, 0, 0, 0, 0, 0, 0],
  "guess_source": "g_minor_default_map",
  "guess_confidence": 0.8
}
```

Then the score layer can override:

```json
"score_override": {
  "staff_note": "D",
  "western_accidental": "flat",
  "octave": 5
}
```

if the notation actually uses `Db5`.

---

## 11. Recommended override logic

The corpus should preserve both:

- the guessed spelling
- the final authoritative spelling

Why:

- it lets us evaluate how often the guesser succeeds
- it becomes useful training data for a later contextual spelling model

So each note should eventually contain:

- `guessed_spelling`
- `final_spelling`
- `spelling_was_overridden`

This is valuable for future learning.

---

## 12. Suggested first guesser rules

For the Bach pilot, keep the rules simple.

### Rule 1. Pitch-class default

Use the G-minor chromatic spelling table above.

### Rule 2. Octave from MIDI

Use ordinary scientific pitch notation.

For MIDI note number `m`:

- octave = `floor(m / 12) - 1`

Then apply the chosen pitch class spelling in that octave.

### Rule 3. Preserve previous local spelling tendency

If the same pitch class appears repeatedly in a short span, prefer the same spelling unless the user overrides it.

### Rule 4. Prefer scalar consistency

If a short stepwise passage is clearly moving through the G-minor ladder, prefer spellings that keep the scalar line simple.

### Rule 5. Allow explicit score override

The score always wins.

---

## 13. Where this fits in the corpus pipeline

The corpus flow should be:

1. parse MIDI note number
2. derive pitch class and octave
3. generate guessed Pythagorean spelling
4. compute guessed Pythagorean monzo
5. apply score override if present
6. compute final Pythagorean monzo
7. add HEJI accidental monzo deltas
8. get full monzo

This decomposition is very clean.

---

## 14. Recommended schema additions

The note-event schema should eventually gain fields like:

```json
"guess": {
  "staff_note": "C",
  "western_accidental": "sharp",
  "octave": 5,
  "pythagorean_monzo": [-6, 4, 0, 0, 0, 0, 0, 0],
  "source": "g_minor_default_map",
  "confidence": 0.8
},
"score": {
  "staff_note": "D",
  "western_accidental": "flat",
  "octave": 5,
  "override_guess": true
}
```

Then `computed.final_pythagorean_monzo` derives from `score`, not `guess`.

---

## 15. Summary

The correct first sub-model is:

- note spelling to Pythagorean monzo

using:

- `A4 = [0,0,0,...]`
- sharp = `[-11,7,0,...]`
- flat = `[11,-7,0,...]`
- octave shift = `[octave - 4, 0, ...]`

The right MIDI-side model is:

- MIDI note -> contextual Pythagorean spelling guess
- score/manual data -> override
- final spelling -> exact Pythagorean monzo
- HEJI -> extra prime deltas

For BWV 1001 Adagio, a G-minor default chromatic spelling model is the right first guesser, and it should already perform reasonably well before score correction.
