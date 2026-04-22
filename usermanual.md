# User Manual

Updated: 2026-04-20

## About

PLAINSOUND HEXATONE is a retuneable microtonal keyboard and scale workspace built around isomorphic layouts and rational intonation (JI).

Features:

- playable on-screen hexagonal keyboard based on Erv Wilson’s designs
- built-in sampled sounds with polyphonic aftertouch
- scale table for editing, comparing, and displaying tunings
- scale creation, comparison, and rationalisation tools
- JI-focused workspace, featuring automatic HEJI Notation generation
- parse MIDI input from MPE or multichannel layout isomorphic and 2D controllers
- send MTS Real-Time MIDI Tuning, MPE, and OSC output to external synths and DAWs
- a live-oriented composition, improvisation, and performance companion to [Scale Workshop](https://scaleworkshop.plainsound.org)

## Quick Start

WebMIDI need not be activated.

Minimum setup to explore scales, compare tunings, build and recall chords:

- open Hexatone in the browser
- use built-in sounds
- play with:
  - touch
  - mouse
  - computer keyboard
  - SUSTAIN / OCT controls
- edit the scale table, drag to retune
- capture snapshots

## Components

### Keyboard Canvas

- draws the current scale in a 2D layout, defined by:
    - central scale degree
    - scale steps to the right
    - scale steps to the right and down
    - hex size
    - rotation
- key labels may be blank, show scale data, custom names, or generated HEJI spellings

### Sidebar

- Built-in Tunings
- User Tunings
- Scale Settings
- Hexatone Layout
- Built-in Sounds
- MIDI Permissions
- MIDI In
- MIDI Out (MTS / MPE / OSC)

### Performance Controls

- `SUSTAIN` (ESC): toggle to sustain notes hands-free; click again on a note to remove it
- `OCT` (arrow keys): click to toggle functionality: retune next note / retune immediately

### Snapshots

- capture currently sounding notes (ENTER); click to play, drag to reorder

## Playing

### Mouse, Touch

Click or tap the on-screen hexes to play notes.

### Computer keyboard

The H key is mapped automatically to the central degree at the center of the canvas.

## Scale Settings

- reference frequency (Hz)
- any scale degree may be assigned to this frequency
- scale size
- equave (interval of transposition at which the scale pattern repeats)
- colours
- key labels

You can also:

- divide the equave equally
- divide the octave equally
- import, edit, export a Scala file

### The scale table

The scale table is the detailed editing surface for each degree.  

It supports:

- exact ratios such as `5/4`
- cents values such as `386.3`
- EDO steps such as `7\\12`
- per-degree tuning adjustment
- rationalisation suggestions

### TuneCell

TuneCell is the small retuning control attached to scale entries and the reference frequency.

It lets you:

- drag for smooth retuning
- preview changes while listening
- compare original and preview values
- save or revert a tuning decision

A typical use is:

1. hold notes with sustain
2. retune one degree or the reference
3. compare the result live
4. keep or discard the change
5. take a snapshot

## Rationalisation

PLAINSOUND HEXATONE is oriented toward exploring rational intonation and rational intervals.

The app is designed to:

- preserve exact interval identities when possible
- compare tempered and rational readings
- search for plausible rational interpretations of tuned pitches
- work musically with ratios rather than only floating-point cents

Rationalisation examines scale degrees and suggests or assigns rational interval interpretations according to the current search settings.

In practical terms, it helps answer questions like:

- what simple ratio is closest to this tuned pitch?
- can this scale be read more coherently as a rational or JI structure?
- what happens if I preserve existing ratio decisions and rationalise only the unresolved notes?

The current rationalisation workflow has two modes:

- `Keep existing ratios`: preserve ratios you already committed, rationalise around those anchors
- `Find new ratios (re-search all)`: fresh search with the current rationalisation settings

The `Rationalisation Settings` include a number of options:

- symmetric, overtonal, or custom search (user-specified exponent range above and below each prime)
- prime and odd limit
- exponent range for the harmonic space region

### HEJI

- scales can be displayed in HEJI-based notation (primes > 47 or irrational pitches are given tempered notation + cents deviation)

## Creating Presets

Hexatone includes built-in tunings and supports user presets. Users may import a Scala file or a previously saved Hexatone `.json` file including all local settings. Also, it is possible to set up a user folder with subfolders and import the entire folder as a library of user tunings.

A recommended workflow for new scales is:

1. create, import, or analyze a scale in Scale Workshop
2. bring that scale into Hexatone
3. play it
4. tune it against drones, held chords, or other instruments
5. compare alternate rational or reference-frequency readings
6. preserve useful versions as presets
7. export .json to easily share or reimport settings and metadata

## WebMIDI

WebMIDI is optional, and SysEx is also optional. If you enable it, Hexatone becomes a much broader live instrument and MIDI hub.Without SysEx, MTS MIDI Tuning and bidirectional communication with Lumatone and Exquis are disabled, but controller input and MPE remain functional.

WebMIDI adds:

- external MIDI input
- controller auto-detection, geometry support, with manual override
- LED color support on supported devices
- MTS and MPE output

If you do not enable WebMIDI, Hexatone still works as a complete on-screen instrument and scale workspace.

## MIDI In

- standard keyboard input on all channels
- isomorphic and 2D controller geometries, single- or multi-channel layouts
- controller recognition and manual controller geometry override (sequential / bypass behaviour)
- scale-target mode (tune incoming MIDI to chosen scale)
- handling of incoming expression data as MPE, pitch bend, aftertouch, pressure, control change

### Controller support

The app includes support for several recognized controller types, including devices such as:

- Lumatone
- Exquis
- LinnStrument
- Tonal Plexus
- AXIS-style controllers
- standard keyboards

The exact supported behavior varies by controller, but the input system is designed to preserve each device’s geometry where that is musically useful for microtonal scales. MPE polyphony is preserved and used when chosen by the user.

### Two broad input styles

Hexatone can treat MIDI input broadly in two ways:

- as geometry on the hex layout
- as nearest scale degree input

The first treats the controller as a performance surface with position meaning.

The second treats incoming pitch as musical material to be mapped into the current scale.

## Colours

Hexatone supports:

- controller geometry recognition
- live key colouring
- supported LED synchronization
- device-specific lifecycle handling where required

Supported controllers like Lumatone, Exquis, and LinnStrument function as mirrors of the Hexatone on-screen layout.

Key colouring helps identify prime factors in rational intonation (JI), using the following shape:

| Prime / role | Colour |
| --- | --- |
| Pythagorean spine (3°), sharp / flat shading | white / black & tonal shading |
| 5° | ivory / yellow |
| 7° | pink / magenta |
| 11° | bright green |
| 13° | bright violet |
| 17° | white / black; evenly divides the whole tone |
| 19° | cyan |
| 23° | dark green |
| 29° | indigo |
| 31° | turquoise |
| 37° | silver |
| 41° | dark rose |
| 43° | amber |
| 47° | bright magenta |

Combinations of primes mix and saturate these colours.

## MIDI Out

Hexatone can send tuning and performance data through:

- built-in sample synth
- MTS (MIDI Tuning Standard) Real-Time Tuning
- MTS Bulk Dump Tuning Maps
- MPE (MIDI Polyphonic Expression)
- direct tuning map workflows
- OSC

## OSC

Hexatone also includes a OSC output path aimed at custom SuperCollider work for users who want:

- a custom synthesis backend
- direct control of a local SuperCollider setup
- Hexatone as the performance and tuning front end

### What it requires

This mode requires a local clone of the repo and a locally running bridge.

The current path is:

1. clone the repository locally
2. run:

```sh
yarn start
yarn osc-bridge
```

3. load the matching SuperCollider patch/responders locally
4. enable `OSC -> SuperCollider` in Hexatone

This feature also supports a fully local workflow: run Hexatone on `localhost:5173` and the OSC bridge on the same machine, without relying on the hosted site.

## Starting

Try

- loading a built-in tuning
- playing the on-screen keyboard with mouse or touch
- using sustain to hold a chord, add and subtract notes
- use the key labels to find sustaining scale degrees in the table
- drag a TuneCell to retune and compare
- change the tuning, try rationalisation
- change the scale layout, reference frequency, reference degree, central degree
- take some snapshots and replay them

## Roadmap

Hexatone is currently moving towards live modulation and reference-frame reinterpretation, advanced sequencing, and eventually context-aware live retuning.

## Developer

If you want to clone and run Hexatone locally, or help test, find issues, join the coding, see:

- [DEVELOPER_QUICKSTART.md](./DEVELOPER_QUICKSTART.md)

The main commands are:

- `yarn install`
- `yarn start`
- `yarn test`
- `yarn build`
- `yarn osc-bridge`
