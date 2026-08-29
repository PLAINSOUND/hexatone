# Plainsound Hexatone

[Run the keyboard](https://hexatone.plainsound.org)

[Try the dev branch](https://plainsound.github.io/hexatone)

[User Manual](./usermanual.md)

[Developer Quickstart](./DEVELOPER_QUICKSTART.md)

<!-- BEGIN GENERATED CREDITS: edit src/credits-content.js -->

Design by [Siemen Terpstra](http://siementerpstra.com/) based on [Erv Wilson's microtonal keyboard designs](https://www.anaphoria.com/wilsonkeyboard.html) (1967-), inspired by [R.H.M. Bosanquet](https://en.wikipedia.org/wiki/Robert_Holford_Macdowall_Bosanquet)'s [Generalised Keyboard](https://en.wikipedia.org/wiki/Generalized_keyboard) (1873) and Ivo Salzinger's *Tastatura Nova Perfecta* (1721).

Initial development by James Fenn with additions and modifications from [Brandon Lewis](http://brandlew.com/), [Bo Constantinsen](http://whatmusicreallyis.com/), [Chengu Wang](https://sites.google.com/site/wangchengu/), [Ashton Snelgrove](https://ashton.snelgrove.science). Sampling credits to Scott Thompson, Tim Kahn, Carlos Vaquero, Dr. Ozan Yarman, Lars Palo, and Soni Musicae.

Current version 3.3.0-rc.1 (August 2026) made by [Marc Sabat](https://www.plainsound.org), released under [GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.en.html). Open source code at [github.com/PLAINSOUND/hexatone](https://github.com/PLAINSOUND/hexatone). Join the community on [discord](https://discord.gg/NGVTmDFPtf).

*The text font with embedded HEJI accidentals (Plainsound Sans) is designed by Thomas Nicholson. Unicode data for copying/pasting may be found at [w3c-cg.github.io/smufl/latest/tables](https://w3c-cg.github.io/smufl/latest/tables/extended-helmholtz-ellis-accidentals-just-intonation.html).*

**Support our open access content with a [donation](https://ko-fi.com/plainsound).**<br>
cc 2026 [PLAINSOUND MUSIC EDITION](https://www.plainsound.org)

<!-- END GENERATED CREDITS -->

## Current State

Hexatone 3.3 RC1 is a live microtonal keyboard and scale workspace featuring:

- isomorphic hexagonal layout
- rational / just intonation with automatic HEJI notation
- HEJI spelling controls with editable notation reference, ratio / cents offset, spelling frequency, and scale-degree-0 frequency
- a HEJI entry palette for building and copying exact spellings up to 47-limit
- built-in tunings, Scala import/export, and user presets
- built-in and user sequence libraries with save, load, and export support
- scale editing, including note names and colours
- live retuning of scale degrees and reference frequency
- rationalisation and modulation
- MPE-aware MIDI input with automatic mapping of 2D controller geometries
- MIDI Output (MTS and MPE)
- snapshots for comparing chords and tunings
- a Sequencer tab for editing snapshots into cue-based event sequences with bars, tempo markers, repeats, manual arpeggiation, and timed playback

PLAINSOUND HEXATONE can be used entirely in the browser:

- input with mouse / touch / computer keyboard
- output using built-in samples
- SUSTAIN, OCT, MOD controls
- retuning and scale editing using drag and drop
- scale rationalisation to user chosen parameters
- snapshots
- bar-, snapshot-, and cue-based sequence editing and playback
- manual snapshot and cue navigation alongside timed sequence playback
- repeat-aware playback with start- and end-repeat markers

Hexatone also supports:

- WebMIDI with optional SysEx
- MIDI Input mapped either to the chosen hex layout or to nearest scale degree
- controller recognition and geometry-aware mapping
- LED feedback on supported controllers
- MTS and MPE output routings
- OSC -> SuperCollider output through a local bridge in a cloned repo

Hexatone is a live performance and composition companion to [Scale Workshop](https://scaleworkshop.plainsound.org).

See also [usermanual.md](./usermanual.md).  
For local setup and development commands, see [DEVELOPER_QUICKSTART.md](./DEVELOPER_QUICKSTART.md).

## Isomorphic Keyboards

[Wikipedia](https://en.wikipedia.org/wiki/Isomorphic_keyboard)

[The Music Notation Project Wiki](http://musicnotation.org/wiki/instruments/isomorphic-instruments/)

[AltKeyboards](http://www.altkeyboards.com/instruments/isomorphic-keyboards)

## Version history

### 3.3 RC1 _(current release candidate)_

Hexatone 3.3 RC1 substantially expands the Sequencer and HEJI notation workspace.

The Sequencer supports editable snapshots, cues, bars, tempo changes, and repeat markers in a unified event list. Captured snapshots can be expanded into individual note events whose snapshot membership, position offset, MIDI¢, Hz, displayed name, bar-relative position, and expression data can be edited directly. Bars and time signatures may be placed between snapshots,
tempo markers support immediate and gradual changes, and repeat markers can loop between sequence positions.

The `PLAY FROM` transport can locate a start position by bar, snapshot, or cue, and `Auto-Scroll` keeps the event list aligned with the playhead. Sequences may be explored by triggering snapshots or cues manually, stepping through them in sequence, or by using `TIMED PLAYBACK`. Manual snapshot triggering and stepping support arpeggiation with adjustable spread, timing, and decay. Snapshot and cue triggering offer a `Legato` option to sustain common tones. `TIMED PLAYBACK` also provides live controls for `SPEED` scaling and `PITCH` transposition.

User sequences can be named, saved, reopened, exported, and continued later, with their musical material and structural settings preserved. The event list supports range-based copying and insertion, while its compact and virtualized layout keeps long sequences practical on desktop and mobile displays.

The HEJI workspace has also been expanded significantly. Spelling is now tied to an explicit reference model based on `Notation (Spelling)`, `Ratio/Cents from 1/1`, `Spelling Frequency`, and the frequency of scale degree `0`. The HEJI palette can construct tempered or exact spellings, calculate cents deviations automatically for exact HEJI accidentals, and copy combined notation-plus-cents strings for reuse in the scale table. Auto-colours and key labels are now more tightly aligned with exact interval identity, giving a more coherent rational pitch workspace across notation, colour, and tuning.

**Sequencer**

- added a dedicated Sequencer tab for editing captured snapshots as event-based sequences
- snapshot rows can now be expanded into editable note events with per-event:
  - snapshot number
  - position offset within the snapshot
  - note on / note off triggers
  - MIDI¢
  - Hz
  - displayed note name
  - bar / beat / numerator / denominator timing
  - note-on velocity
  - note-off velocity
  - pressure
  - timbre
- generated `CUE` structure follows event positions within and across snapshots
- `BAR` support includes:
  - manual bar creation at explicit positions between snapshots
  - optional automatic bar creation before snapshots
  - time signatures may include any natural number as numerator or denominator
- looping:
  - start repeat and end repeat markers may be placed anywhere in sequence position space
  - end-repeat markers carry repeat counts, defaulting to `2x`
  - `Play Repeats` option allows repeat playback to be bypassed
- `PLAY FROM` provides bar, snapshot, and cue navigation with stepping and play/retrigger/stop controls
  - selecting a snapshot or using the snapshot arrows arms Snapshot playback
  - selecting a cue, choosing a bar, or using the cue arrows arms Cue playback
  - a highlight shows which target the PLAY button will trigger
  - cue rows provide immediate play and stop controls
  - stepping beyond the end returns the transport to the sequence start
- `TIMED PLAYBACK` provides start, play/pause, stop, and end controls, following the sequence‘s bars, tempo markings, and repeats
- `Auto-Scroll` keeps the event list aligned with manual navigation and timed playback
- tempo markers have editable beat units and bpm, supporting immediate and gradual tempo changes
- `SPEED` scales the tempo of timed playback from `0.5x` to `2x`, while `PITCH` transposes by up to `±1200 cents`
- `Legato` playback sustains common tones between snapshots or cues
- `Snap Sequence to Current Hexatone Tuning` remaps sequence pitches to the closest notes in the current live tuning
- manual snapshot arpeggiation includes:
  - `Off`, `Per Snapshot`, and `All Snapshots` modes
  - a per-snapshot `Chord` / `Arp` setting
  - adjustable initial spread, spread variation, timing variation, decay, and decay variation
  - overlapping arpeggiations with legato or rearticulated playback
- snapshot ranges can be selected, copied, inserted, or deleted
  - copied ranges may optionally include associated bars, tempo markers, and repeats
  - insertion may preserve or reset sequence-position offsets
- added a built-in sequence library alongside saved user sequences
- user sequences can be named, described, saved, reopened, and exported
- unsaved, saved-clean, and saved-dirty states are reflected in the user-sequence workflow
- option-drag snapshot duplication and expanded drag / reorder support
- improved rendering and scrolling performance for long event lists

**HEJI notation and pitch model**

- HEJI spelling controls are now always exposed in the scale settings workflow
- added a HEJI entry palette up to 47-limit for building and copying exact spellings
- typed HEJI input in the scale table now resolves through a central pitch model and prefers exact ratio matches where possible
- introduced shared `PitchStructure` and `pitch_frame` groundwork to unify:
  - spelling
  - monzo structure
  - ratios
  - cents
  - frequency
- HEJI anchor derivation, typed HEJI resolution, and notation-centred colour logic are now more tightly aligned

**Auto-colours and JI workflow**

- substantial rework of HEJI-aware auto-colour generation
- improved D-centred interpretation of chromatic / diatonic 5-limit and 7-limit chains
- preserved stable mixed-prime colours across changing `3` exponents
- added non-octave-equave handling that bypasses chromatic darkening where that distinction is not musically meaningful
- expanded user-editable prime-family palette workflow

**Performance and reactivity**

- reduced repeated HEJI parsing by reusing shared notation frame data in more paths
- improved preset refresh behavior so keyboard canvas redraw stays in sync with refreshed label / colour settings

### 3.2.3 _(current mainline feature set)_

**Live performance architecture**

- added browser request for low(er)-latency AudioContext operation
- refined on-screen hex guessing to respect angle of rotation and visible canvas
- added a Rastered Notes mode for Haken Continuum which triggers scale degrees with UX controls for Glide Shaping, Minimum Note Duration, Minimum Retrigger interval, and Raster Stability, as well as a momentary pedal (default CC 67) for switching between Rastered Attack + Pitch Bend and Rastered Notes
- added Quick Release for the SuperCollider SynthDefs to reduce tail overlap in Raster to Notes
- architectural separation of `Keys` into smaller runtime modules, moving MIDI input, expression handling, snapshots, MTS output, controller maps, and settings-impact classification out of the canvas path
- reduced full `Keys` reconstruction to true tuning/layout changes; most live performance settings, including MIDI input device now update through targeted runtime paths instead of interrupting the keyboard
- controller geometry changes now rebuild only the controller map, preserving the active `Keys` runtime

**Controller and LED feedback refinements**

- refined Auto Send Colours for Lumatone, Exquis, and LinnStrument
- improved Lumatone, Exquis, and LinnStrument output-port matching
- `Input Mode` is now remembered per detected or selected controller
  - known 2D geometries use `MIDI to Hex Layout`
  - Haken Continuum uses `MIDI to Nearest Scale Degree`
- expanded LinnStrument User Firmware response shaping:
  - `X Spike Reduction` for rejecting noisy raw `X` excursions under light pressure
  - `X Input Smoothing` for event-driven per-pad smoothing without `requestAnimationFrame` or timer dependence
  - `Row Glide Shaping` for moving between near-linear glide and more quantised row transitions
  - cleaner note attack and release behavior through temporary note-on quantise assist and low-pressure release hold

**Scale workspace and rationalisation**

- exact interval parsing and workspace groundwork
- rationalisation integrated into the scale-table workflow
- support for exact ratios, cents, and EDO steps in the scale table
- clearer distinction between preserving existing ratios and re-searching a scale from pitch targets
- scale-size growth pads new degrees by repeating the equave, inheriting degree-0 names and colours
- `Sort Degrees Ascending` reorders interior scale degrees
- interior scale degrees can now be drag-reordered or deleted directly by clicking the degree

**Live tuning workflow**

- live retuning of individual degrees and reference frequency
- smooth compare/save/revert tuning workflow
- snapshots for capturing and replaying absolute-pitch chords across tuning changes
- sustain/latch and OCT controls for live testing and performance

**Notation and JI direction**

- HEJI and reference-frame groundwork in the notation layer
- increasing emphasis on exact interval identity and rational interpretation
- JI Modulation from a source note to a target with handoff, tracked in a Modulation History palette

**MIDI / controller system**

- WebMIDI permissions are user-selectable; SysEx is optional
- controller-aware geometry mapping and manual override
- Input Mode settings for:
  - MIDI to hex layout
  - MIDI to nearest scale degree
- MPE input and expression support
- LED-capable controller integration

**Outputs**

- built-in sample synth
- MTS Real-Time MIDI
- MTS bulk-dump tuning-map
- MPE
- OSC -> SuperCollider via local `yarn osc-bridge`

**Controller status**

Supported or actively integrated controllers include:

- **Lumatone**
- **Exquis**
- **LinnStrument**
- **Haken Continuum**
- **Tonal Plexus**
- **C-Thru AXIS-49**
- **TS41 MIDI Keyboard**

Other controller paths remain exploratory or less tested. Continuum MPE+ high resolution X/Y/Z data is supported (Pitch Bend Range 96, CC 87 used for one-shot LSB data staging), and this controller can move between Rastered Attack + Pitch Bend and Rastered Notes.

### Local development

```sh
yarn install
yarn start
```

Useful commands:

```sh
yarn test
yarn start
yarn build
yarn osc-bridge
```

### 3.1 _(April 2026)_

**WebMIDI and Sysex made User-Selectable**

**Controller database reactivity based on mode 2D geometry or bypass**

**TuneCell smoothing rebuilt**

**MIDI input — scale target mode:** new Input Mode selector in MIDI settings: _MIDI to Hex Layout_ (existing behaviour) or _MIDI to Nearest Scale Degree_. In scale mode, incoming MIDI pitch is matched to the closest degree of the active scale by cent distance, across any tuning or equave. User-configurable tolerance (default 25¢) and out-of-tolerance behaviour (Accept Best / Discard). Geometry, anchor, and transposition controls are hidden when scale mode is active.

**MTS output — Dynamic Bulk Dump:** new transport mode for synths that accept MTS bulk dumps but not single-note real-time SysEx. On each note-on, the carrier slot is patched in a maintained 128-note map and the full dump is sent before triggering the note. Shares carrier selection and MTS encoding with the existing real-time mode.

**MTS output — Centered Static Bulk Dump:** the static 128-note map is now automatically centered around the screen's central degree (`center_degree`). The centering algorithm searches MIDI notes 57–72 (A3–C5) for the note whose 12-EDO pitch class best matches the central pitch, maximising usable keyboard coverage. Sustained notes are protected from mid-phrase map updates; Auto-Send option resends the map whenever relevant settings change.

**Expression:** mod wheel (CC1) is now routed to the sample synth's lowpass filter, matching the MPE slide (CC74) path. Channel pressure (aftertouch) now broadcasts to all sounding voices simultaneously by default (was recency-stack only). Both are also forwarded to MIDI and MPE outputs.

**iOS fix:** audio now starts on the first touch without requiring the refresh button.

**Changed octave-to-equave hardcoded logic to allow user-specified behaviour for other scales (no transposition, transposition by a specified number of scale degrees, or by equave)**

**Independent retuneability of all scale degrees and reference**

**Fixed input interoperability logic (mouse, touch, computer keyboard, MIDI)**

**Added MPE input mode with per-voice pitch bend and pressure routing**

**Under the hood fixes: refactored persistence and loading logic. Preparing for integration of scale math with xen-devs.**

**Supported 2D isomorphic controller geometries (auto-detected by MIDI device name):**

- **Lumatone** https://www.lumatone.io/ — 280-key isomorphic surface, 5 blocks × 56 keys, channels 1–5 encode block position (0-55)
- **C-Thru AXIS-49** https://www.c-thru-music.com/cgi/?page=prod_axis-49 — 14×7 isomorphic hexes, selfless mode (ch 1, notes 1–98)
- **TS41 MIDI Keyboard** https://tristanbay.com/gear/ts41-midi-keyboard/ — 41-EDO Bosanquet layout, single channel (ch 1, notes 1–126)
- **Exquis (Intuitive Instruments)** https://dualo.com/en/welcome/ — 61-note isomorphic hex grid, Rainbow Layout (Preset 6), MPE output on ch 2–15
- **Tonal Plexus** https://hpi.zentral.zone/tonalplexus - (ch 3-14, layout for 205edo)

**In progress but untested:**

- **C-Thru AXIS-64** — 16×8 variant of the AXIS-49 layout, not tested
- **Roger Linn Design LinnStrument 128** — 16×8 grid, one row per channel (ch 1–8), full MPE support
- **Ableton Push 2 / Push 3** — 8×8 isomorphic pad grid, single channel, default 4ths tuning
- **Novation Launchpad (Pro / X / Mini mk3)** — 8×8 grid in programmer mode

---

### 3.0.2 _(March 2026)_

Major reactivity fixes; MTS & MPE functionality expanded; scale resizing and Divide Octave/Equave features.

### 3.0.1 _(early 2026)_

Updated UX; added latch sustain; moveable central scale degree.

### Version 3.0.0 _(early 2026)_

Added Scala/JSON IO; user presets; polyphonic aftertouch response with built-in sounds.

### Version 2 _(2022–2026)_

Marc Sabat forked Ashton Snelgrove's webpack rebuild with rudimentary MIDI and began Hexatone develpment from the former "Terpstra Keyboard". Renaming to acknowledge Erv Wilson's central contribution to the hexagonal 2D layout. Added full MIDI input and output path; Lumatone plug-and-play compatibility with channels-to-equaves logic; reshaped built-in presets; user-switchable Built-In/MTS/normal MIDI output options. Added and edited samples.

### Version 1 _(2016)_

[Terpstra Keyboard](http://terpstrakeyboard.com/) — hexagonal keyboard proof of concept that helped kickstart the Lumatone.
