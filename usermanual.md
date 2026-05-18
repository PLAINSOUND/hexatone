# User Manual

Updated: 2026-05-17

## About

PLAINSOUND HEXATONE is a retuneable microtonal keyboard and scale workspace.

Features:

- programmable isomorphic hexagonal keyboard layouts based on Erv Wilson’s designs
- playable using touch, mouse, computer keyboard, MIDI, and OSC
- built-in sampled sounds with polyphonic aftertouch
- scale table for editing, comparing, and displaying tunings
- scale creation, comparison, and rationalisation tools
- adjust any pitch to any frequency and automatically update the underlying scala files
- JI-focused workspace, featuring modulation and automatic HEJI Notation generation
- parses MIDI input from MPE or multichannel layout isomorphic and 2D controllers like Haken Continuum, LinnStrument, Lumatone, Exquis, and others
- sends MTS Real-Time MIDI Tuning, MPE, and OSC output to external synths and DAWs
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
- try a modulation from most recently played note to next played note with handoff
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
- MIDI Input
- Output Routing (MTS / MPE / OSC)

### Performance Controls

- `SUSTAIN` (ESC): toggle to sustain notes hands-free; click again on a note to remove it
- `OCT` (arrow keys): click to toggle functionality: retune next note / retune immediately
- `MOD` (backquote / ^ key): click to capture last played note as source, next played note becomes target, shifting the scale frequency (moveable do logic)

### Snapshots

- capture currently sounding notes (ENTER); click to play, drag to reorder

## Playing

### Mouse, Touch

Click or tap the on-screen hexes to play notes.

### Computer Keyboard

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
- sort the scale ascending by degree

### The Scale Table

The scale table is the detailed editing surface for each degree.  

It supports:

- exact ratios such as `5/4`
- cents values such as `386.3`
- EDO steps such as `7\12`
- per-degree tuning adjustment
- rationalisation suggestions
- reorder scale degrees by clicking on the degree number
- select abd delete a scale degree
- `Sort Degrees Ascending`, preserving degree `0` and the equave
- increasing scale size adds copies of the current equave
- decreasing scale size truncates

Reordering, sorting, and deleting degrees also remaps the associated note names, colours, reference degree, and central degree so the scale remains internally consistent.

### TuneCell

The small retuning control attached to scale entries and the reference frequency lets you:

- drag for smooth retuning
- preview changes while listening
- compare changes against original values
- save or revert a tuning change

Typical workflow:

1. hold notes with sustain
2. retune a degree or the reference frequency
3. compare the result
4. keep or discard the change
5. take a snapshot if desired

## Rationalisation

PLAINSOUND HEXATONE is oriented toward exploring intonation with rational intervals.

The app is designed to:

- preserve exact interval identities (ratios / harmonic space exponent vectors) when possible
- search for small-number rational interpretations of tuned pitches
- work musically with ratios

Rationalisation examines scale degrees and suggests rational interval interpretations according to the current search settings.

It helps answer questions like:

- what simple ratio is closest to this tuned pitch?
- how may this scale be read as a JI structure?

The current rationalisation workflow has two modes:

- `Keep existing ratios`: preserve ratios you already committed, rationalise around those anchors
- `Find new ratios (re-search all)`: fresh search with the current rationalisation settings

Rationalisation now works directly from the scale table, so exact interval entries, tempered entries, and committed ratio decisions can be refined in place.

The `Rationalisation Settings` include a number of options:

- symmetric, overtonal, or custom search (user-specified exponent range above and below each prime)
- prime and odd limit
- exponent range for the harmonic space region

### HEJI Notation

- scales can be displayed in HEJI-based notation (primes > 47 or irrational pitches are given tempered notation + cents deviation)
- notation is responsive to the current rational reading of the scale
- after tuning edits or modulation, displayed note names may update to reflect the current reference frame or interval interpretation

## Modulation

- `MOD` (Backquote / ^): initiates a modulation by capturing the most recent note played; transfer this source note to a target note by pressing any key
- a floating palette of MODULATION HISTORY appears, tracking all user-initiated modulations, counting the number of steps taken
- clicking the arrows takes further steps by the same transposition interval (in either direction)
- once a modulation pathway returns to zero it may be clicked away or retained for further use
- modulation updates both sounding relationships and the displayed notation context
- modulation history can be used as a live record of changing reference-frame decisions during performance or analysis
- modulation history may be reset globally, returning to the saved tuning

## Presets

Hexatone includes built-in tunings and supports user presets. Users may import a Scala file or a previously saved Hexatone `.json` file including all local settings. Also, it is possible to set up a user folder with subfolders and import the entire folder as a library of user tunings.

A recommended workflow for new scales is:

1. create, import, or analyze a scale in Scala, Scale Workshop or Hexatone
2. bring that scale into Hexatone if needed
3. play it, experiment with sustain, octave transpositions, modulations
4. tune scale degrees against drones, held chords, or other instruments
5. compare alternate rational or reference-frequency readings
6. make snapshots; preserve useful scale variations as presets
7. export .json files to easily share or reimport settings and metadata

## WebMIDI

WebMIDI is optional; allowing SysEx functionality is an additional option. If you enable it, Hexatone becomes a much broader live instrument and MIDI hub. Without SysEx, MTS MIDI Tuning and bidirectional communication with Lumatone and Exquis are disabled, but controller input and MPE remain functional.

WebMIDI adds:

- external MIDI input
- controller auto-detection, geometry support, with manual override
- LED color support on supported devices
- MTS and MPE output

If you do not enable WebMIDI, Hexatone still works as a complete on-screen instrument and scale workspace.

## MIDI Input

- standard keyboard input on all channels
- isomorphic and 2D controller geometries, single- or multi-channel layouts
- controller recognition and manual controller geometry override (sequential / bypass behaviour)
- scale-target mode (tune incoming MIDI to chosen scale)
- handling of incoming expression data as MPE, pitch bend, aftertouch, pressure, control change

### Controllers

The app includes support for several recognized controller types, including devices such as:

- Lumatone
- Exquis
- LinnStrument
- Tonal Plexus
- AXIS-style controllers
- standard keyboards

The exact supported behaviour varies by controller, but the input system is designed to preserve each device’s geometry where musically useful for playing microtonal scales. MPE polyphony is preserved and used when chosen by the user.

LinnStrument User Firmware mode also includes `Row Glide Shaping`, `X Spike Reduction`, and `X Input Smoothing` to stabilise expressive pitch input under light pressure.

### Input Modes

Hexatone can treat MIDI input broadly in two ways:

- as geometry on the hex layout
- as nearest scale degree input

The first treats the controller as a performance surface with position meaning.
The second treats incoming pitch as musical material to be mapped into the current scale.

## Colours

Hexatone supports:

- controller geometry recognition
- live key colouring / LED synchronization
- device-specific firmware control (Lumatone, Exquis, LinnStrument) allows devices to mirror Hexatone on-screen layout.

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

## MIDI Output

Hexatone can send tuning and performance data through:

- built-in sample synth
- MTS (MIDI Tuning Standard) Real-Time Tuning
- MTS Bulk Dump Tuning Maps
- MPE (MIDI Polyphonic Expression)

## OSC Output

Hexatone also includes a OSC output path aimed at users who want:

- a custom synthesis backend
- direct control of a local SuperCollider setup
- Hexatone as the performance and tuning front end

### What it requires

This mode requires a local clone of the repo and a locally running bridge:

1. clone the repository locally
2. build a local osc-bridge app that runs on your architecture (translates incoming websocket data for SuperCollider)

```sh
yarn build-bridge
```

--OR--

to edit hexatone code and work with custom osc setups run:

```sh
yarn start
yarn osc-bridge
```

3. load the matching SuperCollider patch/responders locally
4. enable `OSC -> SuperCollider` in Hexatone

This feature also supports a fully local workflow: run Hexatone on `localhost:5173` and the OSC bridge on the same machine, without relying on the hosted site. Users can also use this pathway to drive their own SynthDefs and patches, and support other OSC-compatible apps.

## Try

- loading a built-in tuning
- playing the on-screen keyboard with mouse or touch
- using sustain to hold a chord, add and subtract notes
- using the key labels to find sustaining scale degrees in the table
- dragging a TuneCell to retune and compare
- changing the tuning, making rationalisation choices
- changing the scale layout, reference frequency, reference degree, central degree
- making a modulation
- taking some snapshots and replaying them

## Roadmap

Hexatone is currently developing modulation, moving towards sequencing, and eventually integrating context-aware live retuning.

## Developer

If you want to clone and run Hexatone locally, or help test, find issues, join the coding, see:

- [DEVELOPER_QUICKSTART.md](./DEVELOPER_QUICKSTART.md)

The main commands are:

- `yarn install`
- `yarn start`
- `yarn test`
- `yarn build`
- `yarn osc-bridge`
- `yarn build-bridge`
