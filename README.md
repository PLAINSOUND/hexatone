# Plainsound Hexatone

[Run the keyboard](https://hexatone.plainsound.org)  

[Try the dev branch](https://plainsound.github.io/hexatone)

[User Manual](./usermanual.md)  

[Developer Quickstart](./DEVELOPER_QUICKSTART.md)

Designed by [Siemen Terpstra](http://siementerpstra.com/) in the late 1980s, based on [Erv Wilson's microtonal keyboard designs](https://www.anaphoria.com/wilsonkeyboard.html) (1967-), inspired by [R.H.M. Bosanquet](https://en.wikipedia.org/wiki/Robert_Holford_Macdowall_Bosanquet)'s [Generalised Keyboard](https://en.wikipedia.org/wiki/Generalized_keyboard) (1873) and Ivo Salzinger's Tastatura Nova Perfecta (1721).

Initial development by James Fenn with additions and modifications from [Brandon Lewis](http://brandlew.com/), [Bo Constantinsen](http://whatmusicreallyis.com/), [Chengu Wang](https://sites.google.com/site/wangchengu/), [Ashton Snelgrove](https://ashton.snelgrove.science).
Sampling credits to Scott Thompson, Tim Kahn, Carlos Vaquero, Dr. Ozan Yarman, Lars Palo, Soni Musicae.

MIDI version designed and programmed by [Marc Sabat](https://www.plainsound.org).
Current dev version 3.2.0-alpha.1 (2026), released as Free/Libre and Open Source Software under [GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.en.html). Current stable release: 3.1.0. Code on github: https://github.com/PLAINSOUND/hexatone. Discord: https://discord.gg/NGVTmDFPtf.

## Current State

Hexatone 3.2.0-alpha.1 is a live microtonal keyboard and scale workspace built around:

- isomorphic hexagonal layout performance
- rational intonation / just intonation workflows
- live retuning of scale degrees and reference frequency
- Scala import/export and user presets
- snapshots for comparing chords and tunings
- MIDI input and output support
- controller-aware 2D / isomorphic performance surfaces

PLAINSOUND HEXATONE can be used entirely in the browser with:

- mouse
- touch
- computer keyboard
- built-in samples
- SUSTAIN and OCT controls
- TuneCell retuning
- snapshots

Hexatone also supports:

- WebMIDI with optional SysEx
- MIDI input mapped either to the hex layout or to nearest scale degree
- MTS, MPE, and direct tuning-map output workflows
- controller recognition and geometry-aware mapping
- LED feedback on supported controllers
- OSC -> SuperCollider output through a local bridge
- scale rationalisation to user parameters

Hexatone is conceived as a live performance and composition companion to [Scale Workshop](https://scaleworkshop.plainsound.org).

See also [usermanual.md](./usermanual.md).  
For local setup and development commands, see [DEVELOPER_QUICKSTART.md](./DEVELOPER_QUICKSTART.md).

## Isomorphic Keyboards
[Wikipedia](https://en.wikipedia.org/wiki/Isomorphic_keyboard)

[The Music Notation Project Wiki](http://musicnotation.org/wiki/instruments/isomorphic-instruments/)

[AltKeyboards](http://www.altkeyboards.com/instruments/isomorphic-keyboards)

## Version history

### 3.2.0-alpha.2 *(currently in dev branch)*

Current 3.2 alpha work includes:

**Scale workspace and rationalisation**

- exact interval parsing and workspace groundwork
- rationalisation integrated into the scale-table workflow
- support for exact ratios, cents, and EDO steps in the scale table
- clearer distinction between preserving existing ratios and re-searching a scale from pitch targets

**Live tuning workflow**

- TuneCell-based live retuning of individual degrees and the reference frequency
- smooth compare/save/revert tuning workflow
- snapshots for capturing and replaying absolute-pitch chords across tuning changes
- sustain/latch and OCT controls for live testing and performance

**Notation and JI direction**

- HEJI and reference-frame groundwork in the notation layer
- increasing emphasis on exact interval identity and rational interpretation
- preparation for future live modulation and reference-frame reinterpretation

**MIDI / controller system**

- WebMIDI permissions are user-selectable
- SysEx is optional
- controller-aware geometry mapping and manual override
- input modes for:
  - MIDI to hex layout
  - MIDI to nearest scale degree
- MPE input and expression support
- LED-capable controller integration

**Outputs**

- built-in sample synth
- standard MIDI
- MTS Real-Time
- MTS bulk-dump tuning-map workflows
- MPE
- OSC -> SuperCollider via local `yarn osc-bridge`

**Controller status**

Supported or actively integrated controllers include:

- **Lumatone**
- **Exquis**
- **LinnStrument 128**
- **Tonal Plexus**
- **C-Thru AXIS-49**
- **TS41 MIDI Keyboard**

Other controller paths remain exploratory or less tested.

### Local development

```sh
yarn install
yarn start
```

Useful commands:

```sh
yarn test
yarn build
yarn osc-bridge
```

### 3.1.0 *(April 2026)*

**WebMIDI and Sysex made User-Selectable**

**Controller database reactivity based on mode 2D geometry or bypass**

**TuneCell smoothing rebuilt**

**MIDI input — scale target mode:** new Input Mode selector in MIDI settings: *MIDI to Hex Layout* (existing behaviour) or *MIDI to Nearest Scale Degree*. In scale mode, incoming MIDI pitch is matched to the closest degree of the active scale by cent distance, across any tuning or equave. User-configurable tolerance (default 25¢) and out-of-tolerance behaviour (Accept Best / Discard). Geometry, anchor, and transposition controls are hidden when scale mode is active.

**MTS output — Dynamic Bulk Dump:** new transport mode for synths that accept MTS bulk dumps but not single-note real-time SysEx. On each note-on, the carrier slot is patched in a maintained 128-note map and the full dump is sent before triggering the note. Shares carrier selection and MTS encoding with the existing real-time mode.

**MTS output — Centered Static Bulk Dump:** the static 128-note map is now automatically centered around the screen's `center_degree`. The centering algorithm searches MIDI notes 57–72 (A3–C5) for the note whose 12-EDO pitch class best matches the center pitch, maximising usable keyboard coverage. Sustained notes are protected from mid-phrase map updates; Auto-Send option resends the map whenever relevant settings change.

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

### 3.0.2 *(March 2026)*
Major reactivity fixes; MTS & MPE functionality expanded; scale resizing and Divide Octave/Equave features.

### 3.0.1 *(early 2026)*
Updated UX; added latch sustain; moveable centre scale degree.

### Version 3.0.0 *(early 2026)*
Added Scala/JSON IO; user presets; polyphonic aftertouch response with built-in sounds.

### Version 2 *(2022–2026)*
Marc Sabat forked from Ashton Snelgrove's webpack rebuild with rudimentary MIDI. Added full MIDI input and output path; Lumatone plug-and-play compatibility with channels-to-equaves logic; reshaped built-in presets; user-switchable Built-In/MTS/normal MIDI output options. Added and edited samples.

### Version 1 *(2016)*
[Terpstra Keyboard](http://terpstrakeyboard.com/) — hexagonal keyboard proof of concept.
