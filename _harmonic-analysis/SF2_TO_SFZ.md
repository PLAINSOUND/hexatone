# SF2 → SFZ conversion

The standalone converter is `src/sf2-to-sfz.py`. It reads the uncompressed
SoundFont binary directly, rather than repairing potentially corrupted
Polyphone-exported numbers. The former Serum-oriented script is retained as
`src/sf2-to-sfz-serum-legacy.py` for reference, not recommended for conversion.

From the Hexatone repository root:

```sh
python3 _harmonic-analysis/src/sf2-to-sfz.py \
  _sfz-test/PlainsoundOrgan.sf2 \
  _sfz-test/sfz-exports/PlainsoundOrgan \
  --samples _sfz-test/PlainsoundOrgan/samples --self-contained
```

The output directory must **not exist**. For another pass, choose a new
directory. Omit `--samples` to extract all needed WAVs from the SF2. Existing
source SF2 and WAV files are never changed.

## What is preserved

- SF2 bank/program identity, including presets with identical names.
- Instrument/preset global/local generator precedence and SF2 defaults.
- Key and velocity range intersections, written as numeric MIDI values.
- Root keys, pitch correction, tuning and generator-based envelopes/LFOs/filter.
- Sample-relative loop points, including coarse offsets and inclusive SFZ ends.
- Mode 1 → continuous loop; mode 3 → sustain loop; mode 0 → no loop.
- Polyphone mode 2 → explicit release trigger (a nonstandard SF2 extension).
- 24-bit PCM from `smpl` + `sm24`, without truncation or resampling.
- Reciprocal stereo links. Equivalent left/right regions are combined only
  when their generator-derived settings agree and their pans are hard left/right.
  Otherwise exact mono channels are exported to preserve independent settings.

An existing WAV is reused only when its PCM channels, bit depth, sample rate
and length exactly match the SF2. Filename similarity is not enough: SF2 sample
names are short and can be ambiguous. Nonmatching samples are extracted into
the output's `samples` directory. Relative references to reused WAVs mean the
output and the original sample directory must remain in the same layout unless
`--self-contained` is used. That option copies reused WAVs into the new output's
`samples` folder and verifies their file hashes before changing references.

To consolidate an already generated folder:

```sh
python3 _harmonic-analysis/src/sf2-to-sfz.py \
  --consolidate _sfz-test/sfz-exports/PlainsoundOrgan
```

Consolidation leaves original WAVs untouched and refuses filename collisions
with different contents. Source folders can be removed separately after all
outputs have been validated. The current `sfz-exports` collection is self-contained;
its redundant original Polyphone sample directories have been removed.

## Important musical limitations

This is a **static generator conversion**, not a complete SF2 synthesis emulator.
Each output has `report.json`, listing every explicit preset/instrument modulator
with its source, destination, amount, amount source and transform. These are not
silently represented as approximate SFZ mappings. In particular, Srutibox pressure,
organ Mod Wheel release-time modulation and controller effects need a separate
mapping pass before the presets are considered musically equivalent.

SF2 default velocity/pressure/filter modulators and their cancellation are not
fully reproduced. Fixed velocity sets amplitude velocity tracking to zero, but
arbitrary fixed-velocity values and other velocity-dependent destinations are
not emulated. Default SFZ pitch-bend behavior can also differ from SF2.

Envelope curves, attenuation calibration, effects routing and two simultaneous
pitch LFOs need engine-specific listening tests. Key-dependent hold/decay and
fixed-key generators are listed as unsupported rather than guessed.

Initial attenuation now uses FluidSynth's historical EMU compatibility factor
of 0.4, applied only to generator 48 before converting centibels to dB. It does
not scale envelope sustain or modulation depths. This corrects the excessively
quiet levels in the first generated SFZs; total engine gain and missing expressive
modulators can still produce differences. Reports record the applied factor.

Earlier generated outputs can be updated without touching WAVs:

```sh
python3 _harmonic-analysis/src/sf2-to-sfz.py \
  --update-levels _sfz-test/sfz-exports/PlainsoundOrgan
```

This migration is safe to repeat; it does not multiply attenuation twice.

Tiny 0–2-sample sustain loops used as release-sample workarounds are preserved
and counted in the report. They are **not** automatically changed to release
triggers: an explicit musical decision is needed about offset, envelope and
note-on versus note-off velocity. SFZ-player compatibility must be auditioned.

Negative start offsets or endpoints beyond the extracted sample require new
cropping and currently fail explicitly rather than emitting invalid references.
ROM samples and compressed SF3 PCM are not supported.

## Verification

```sh
python3 -m unittest discover -s _harmonic-analysis/tests -p test_sf2_to_sfz.py -v
```

Tests cover RIFF padding, SF2 defaults/precedence, key/velocity intersections,
loop modes and bounds, signed offsets, pitch correction, 24-bit byte recovery,
exact stereo packing, mono fallback and refusal to overwrite existing output.
Conversion also checks every generated range and loop against the referenced
WAV's frame count. This is structural validation, not a sampler playback test.

## Current export findings (10 October 2026)

All three supplied SF2 files contain `sm24` data. Harpsichord and organ samples
are 48 kHz; Srutibox is 44.1 kHz and is kept at that rate.
The supplied Polyphone WAVs do not all match the SF2 at full 24-bit precision.
Therefore the converter extracts exact SF2 PCM where necessary rather than
assuming that the two sources are interchangeable. Neither source is overwritten.

SFZ can specify controller smoothing with supported `_smoothccN` opcodes.
Smoothing should be added during the expressive-mapping pass and verified in
the chosen sfizz build, especially for channel and polyphonic pressure.
