# User Manual

Updated: 2026-07-28

## About

Choose a tab: HEXATONE is a microtonal workspace based on an hexagonal 2D pitch layout invented by Erv Wilson; SEQUENCER is a step sequencer allowing users to edit and walk through chords captured in the workspace. 

Features:

- user-programmable keyboard layouts and tunings
- playable using touch, mouse, computer keyboard, and MIDI
- built-in sampled sounds with polyphonic expression
- scale table for displaying, comparing, and editing tunings: use any degree as a reference note, adjust any pitch to any frequency
- JI tools include rationalisation of cents-based intervals, modulation, automatic HEJI Notation and key colours derived from a ratio's prime exponents
- MIDI input from standard keyboards, MPE devices, or multichannel controllers like Haken Continuum, Exquis, LinnStrument, Lumatone; known controller geometries are correlated with on-screen scale layouts
- sends MTS Real-Time MIDI Tuning, MPE, and OSC output to external synths and DAWs
- compatible with the free MTS-ESP Mini Master plug-in for retuning VST instruments
- suitable for live use: extremely low latency and jitter
- a dedicated SEQUENCER tab allows users to edit and step through captured chord snapshots

## Quick Start

WebMIDI is optional. To explore scales, compare tunings, build and recall chords:

- open Hexatone in the browser
- use built-in sounds to play with touch, mouse, computer keyboard
- use on-screen `OCT` / `SUSTAIN` / `MOD` controls or keyboard shortcuts 
- edit the scale table, drag to retune individual scale degrees
- capture snapshots, trigger them in the sequencer tab

## Components

### Keyboard Canvas

- draws the current scale in an hexagonal 2D layout, defined by:
    - central scale degree
    - scale steps to the right
    - scale steps to the right and down
    - hex size and rotation
- key labels may be blank, show scale data, custom names, or generated HEJI spellings
- key colours may be edited manually or generated

### Sidebar Settings

- Built-in Tunings
- User Tunings
- Scale Settings
- Hexatone Layout
- Built-in Sounds
- MIDI Setup
- MIDI Input
- Output Routing (MTS / MPE / OSC)

### Performance Controls

Left-to-right along the bottom of the app there are buttons and these are also mapped to key commands:

- a round `SNAPSHOT` button (SHIFT+ENTER key) captures currently played and/or sustained notes
- `OCT` (SHIFT+arrow keys, active when canvas is in focus): click the word "OCT" or press SHIFT and the <- and -> to toggle functionality between two states: retune next played note or (darker colour) retune immediately; use SHIFT + arrow-up arrow-down to change octaves
- `SUSTAIN` (SHIFT+ESC key): toggle to sustain notes hands-free; click again on a note to remove it
- `MOD` (SHIFT+BACKQUOTE / ^ key): click to capture last played note as source degree, next played note becomes target degree, shifting the scale frequency globally while maintaining layout and appearance (moveable do logic); an alternate fixed do logic keeps the source note "in place" but changes its scale degree to that of the target degree
- `PANIC` (SHIFT+BACKSPACE / DELETE key): kills sounding notes as nicely as possible

### Sequencing Snapshots

- capture currently sounding notes (ENTER key); a list appears bottom left of the app: click to play, drag to reorder, x to delete
- switch to PLAINSOUND SEQUENCER Tab to edit the snapshot data in detail by adjusting note positions, pitch, and expression data; make a step sequence of cues
- Sequence is a collection of snapshots, ordered and numbered, along with the relative position of individual events (cues), bars with time signatures, tempo markers, and repeat markers; multiple sequences may be saved and loaded as `.json` files; sequences are kept in local browser storage and may be swiftly reloaded from the menu to play different sections or pieces
- Snapshot is a captured chord or note collection including momentary expression data; it can be replayed as a full vertical sonority (stepping by snapshots); snapshots may be ordered and are automatically numbered
- Cues are generated automatically when the relative start and end positions of individual notes comprising a snapshot are edited, creating derived event steps; the global position of events is relative to the snapshot in which they occur; stepping by cues follows the global order of events, so cues may combine events from multiple snapshots
- Bars have a user-defined time signature expressed as a fraction of one whole note: the denominator expresses "what fraction of the bar is considered to be a beat" and the numerator expresses "how many" beats comprise this particular bar
- example: in a time signature like 6/7, 7 means the beat length is 1/7 of a whole note = one septuplet subdivision of a whole note, and 6 means this bar is made up of 6 septuplets
  - a bar allows the global positioning of events to be expressed in rational time units (beats, fractions of beats)
  - bars may occupy any global position: i.e. barlines may occur between snapshots or inside a snapshot
  - for most applications, bars are automatically generated at snapshot boundaries, and any extra bars that are not needed may be deleted
- a user-defined tempo marker can occur anywhere in sequence position space; it is expressed as a beat fraction and a tempo in bpm, for example `1 / 4 = 60 bpm`
- repeat start and repeat end markers can occur anywhere in sequence position space; the start marker defines the return point and the end marker carries a repeat count (default `2x`)
- multiple events at the same global position follow an order of precedence rule: `note-offs` of previously triggered notes -> `repeat end` -> `repeat start` -> `tempo` -> `bar` -> new `note-ons` -> new `note-offs`; notes are ordered by pitch with the largest frequency value first (higher notes are above lower notes, as in music notation)
- the sequence uses one exact global position space, defined by the ordered snapshots: bars and tempi are overlays on that space rather than containers for the notes; this approach allows a very flexible triggered-step or tempo driven realisation of the sequenced data

## Hexatone Tab

- load a built-in tuning
- play the on-screen keyboard with mouse or touch
- use sustain to hold a chord, add and subtract notes
- use the key labels to find sustaining scale degrees in the table
- drag a TuneCell to retune and compare
- change the tuning, make rationalisation choices
- change the scale layout, reference frequency, reference degree, central degree
- make a modulation with a non-isomorphic JI tuning
- take some snapshots and replay them, change their order

### Mouse, Touch, Computer Keyboard

Click or tap the on-screen hexes to play notes. When the sidebar is collapsed and the canvas fills the screen, the normal keyboard becomes a simple isomorphic controller. The H key is mapped automatically to play the central degree at the center of the canvas. Pressing SHIFT and a note-triggering key alternately latches and releases that particular note, allowing note-by-note sustains.

### Presets

Hexatone includes built-in tunings and supports user presets. Users may import a scala file or a previously saved Hexatone `.json` file. It is possible to set up a user folder with subfolders and import the entire folder as a library of user tunings.

- create a scale in Scala or Scale Workshop and import it into Hexatone
- edit name and description, save as a user tuning, try different layouts
- play, experiment with sustain, octave transpositions, modulations
- tune scale degrees against drones, held chords, or other instruments
- try different rationalisation settings and compare how the scale changes
- make snapshots; preserve useful scale variations as presets
- export as `.json` file to easily share or reimport settings and metadata

### Scale Settings

- assign a reference frequency (Hz) to any scale degree, directly to 1/1 (scale degree 0), or to the HEJI Spelling Note with 0¢ deviation; all three frequency assignment options interact and update each other accordingly
- change scale size
- equave (interval of transposition at which the scale pattern repeats)
- key colours
- key labels

### Scale Tools

- divide the equave equally
- divide the octave equally
- import, edit, export a Scala file
- sort the scale ascending by degree

### Key Colours

Use the Key Colours menu to choose how note colours are shown on the keyboard and in the scale table. There are three modes:

- `Manual` uses stored note colours; individual keys may be manually edited, compared, and committed in the scale table
- `Auto` provides algorithmically suggested variants for JI pitches based on component primes, interval structure, and Bosanquet layout of diatonic/chromatic notes; in addition to the default settings users may save custom palettes
- `Spectrum` automatically generates a continuous colour spectrum around a chosen central hue and maps it across the scale
- both automatic modes may be committed and edited further manually

### JI Palette by Primes

Key colouring helps identify prime factors in rational intonation (JI), using the following shape:

| Prime | Colour |
| --- | --- |
| 3° | white / black & tonal shadings based on higher primes |
| 5° | ivory |
| 7° | pink |
| 11° | bright green |
| 13° | bright violet |
| 17° | grey |
| 19° | cyan |
| 23° | dark green |
| 29° | indigo |
| 31° | turquoise |
| 37° | silver |
| 41° | dark rose |
| 43° | amber |
| 47° | magenta |

Combinations of primes saturate and blend these colours accordingly. Auto-generated JI key colours may use custom palettes defined by the user.

### Key Labels

Choose which information (`Blank Keys`, `Scale Degree`, `Scala Data`, `Scale Cents`, `Name`, `HEJI`) is displayed on the keys. Equave Numbers may be toggled on or off for each label style. The HEJI Notation options are derived based on a user-specified spelling reference which may or may not be in the actual scale. Users may choose tempered accidentals + cents or JI accidental symbols. Primes > 47 or irrational pitches are given tempered notation + cents deviation. Notation is responsive to the current rational reading of the scale; after tuning edits or modulation, displayed note names update. When automatically generated HEJI labels are edited the scale updates accordingly. Note that HEJI names for non-octave equaves are currently not implemented.

### HEJI Spelling 

Users may specify a spelling reference with 0¢ deviation. This need not be part of the scale, but it must be expressed relative to scale degree 0 (1/1).

The spelling reference is defined by four linked fields:

- `Notation (Spelling)`: the note name and accidental used as the 0¢ spelling reference
- `Ratio/Cents from 1/1`: the interval from scale degree 0 to the spelling reference
- `Spelling Frequency`: the frequency of the spelled reference pitch
- `Frequency of 1/1`: the frequency of scale degree 0

Editing one linked reference field updates the others where possible. If the spelling interval is expressed in cents, notation uses tempered accidentals and cents deviations. If it is expressed as a ratio, rational scale degrees obtain HEJI accidentals unless the user specifies `Tempered Accidentals Only`.

## HEJI Palette

A HEJI Notation Palette is provided to generate strings of accidentals that may be copied and pasted into the scale table. The `12edo` row emits tempered accidental glyphs and allows manual cents entry for non-JI notation; the higher-prime rows emit exact HEJI accidentals up to 47-limit. Exact HEJI cents are calculated automatically from the chosen accidentals and current spelling reference; tempered accidentals allow manual cents entry.

Use `Decimal Places` to choose the display precision of the calculated cents value. `Copy` copies the combined notation-plus-cents output, and `Clear` resets the palette output.

## The Scale Table

The scale table supports:

- exact ratios such as `5/4`
- cents values such as `386.3`
- EDO steps such as `7\12`
- per-degree tuning adjustment
- rationalisation suggestions

You may:

- reorder scale degrees by clicking on the degree number
- select and delete a scale degree
- `Sort Degrees Ascending`, preserving degree `0` and the equave
- increase scale size (adds copies of the current equave as editable place-holders)
- decrease scale size (truncates)

### TuneCell

The small retuning control attached to scale entries and the reference frequency lets you:

- drag for smooth retuning while sustaining
- preview changes while listening
- compare changes against original values
- save or revert a tuning change

### Rationalisation

PLAINSOUND HEXATONE is oriented toward exploring intonation with rational intervals. Rationalisation examines scale degrees and suggests rational interval interpretations according to the current search settings.

It helps answer questions like:

- what simple ratio is closest to this tuned pitch?
- how may this scale be read as a JI structure?

The current rationalisation workflow has two modes:

- `Keep existing ratios`: preserve ratios you already committed, rationalise around those anchors
- `Find new ratios`: fresh search based upon the current settings

`Rationalisation Settings` include:

- symmetric, overtonal, or custom search (user-specified exponent range above and below each prime)
- prime and odd limit, tolerance range in cents

### Modulation

- `MOD` (SHIFT + Backquote / ^): initiates a modulation by capturing the most recent note played; transfer this source note to a target note by pressing any key
- a floating palette of MODULATION HISTORY appears, tracking all user-initiated modulations, counting the number of steps taken
- clicking the arrows takes further steps by the same transposition interval (in either direction)
- once a modulation pathway returns to zero it may be clicked away or retained for further use
- modulation updates both sounding relationships and the displayed notation context
- modulation history can be used as a live record of changing reference-frame decisions during performance or analysis
- modulation history may be reset globally, returning to the saved tuning
- there are two layout options: "moveable do" (fixed layout) or "fixed do" (moveable layout)

## MIDI

### MIDI Setup

WebMIDI is optional; allowing SysEx functionality is an additional option. WebMIDI adds:

- external MIDI input
- controller auto-detection, geometry support, with manual override
- LED color support on supported devices
- MTS and MPE output

Without SysEx, MTS MIDI Tuning and bidirectional communication with Lumatone and Exquis are disabled, but controller input and MPE remain functional.

If you do not wish to enable WebMIDI, Hexatone still works as an on-screen instrument and scale workspace.

### MIDI Input

The HEXATONE app

- responds to standard keyboard input on all channels
- handles MPE per-note expression data: pitch bend, aftertouch, pressure, control change
- knows about isomorphic and 2D controller geometries, single- or multi-channel layouts
- recognises controllers automatically, but allows manual controller geometry selection and override (sequential / bypass behaviour)
- has two Input Modes: MIDI to Hex Layout (consecutive MIDI notes trigger successive degrees of a microtonal scale); MIDI to Nearest Scale Degree (incoming notes + MPE X data are mapped to nearest notes of the scale, rather than triggering the scale note-by-note)
- Input Mode persists per detected/selected controller; 2D controllers default to MIDI to Hex Layout; Haken Continuum (1D pitch glissando) defaults to MIDI to Nearest Scale Degree

### Controllers

The app includes support for several recognized controller types, including devices such as:

- AXIS-49
- Haken Continuum
- Exquis
- LinnStrument
- Lumatone
- Tonal Plexus
- standard keyboards

The exact supported behaviour varies by controller, but the input system is designed to preserve each device’s geometry where musically useful for playing microtonal scales. MPE polyphony is preserved and used when chosen by the user (on appropriate outputs).

Lumatone has two modes: default is 2D geometry aware, and uses a custom key layout that matches the numbering of keys used in a standard lumatone (.ltn) file: Notes 0-55 are ordered left-to-right and top-to-bottom in 5 blocks, each on a separate MIDI channel (1-5). This fixed key layout allows Hexatone to compute the exact physical key being played from incoming MIDI data, map it to the on-screen canvas, and adapt to changing tunings, modulations, etc. Key colours are sent to Lumatone based on the user's chosen Anchor Note so Lumatone always remains aligned with the on-screen layout. There is an option to filter which scale degrees are coloured, a useful way of learning the layout when there are many different notes.

Alternately, some users may prefer to generate a "traditional" multichannel Lumatone layout usable outside of Hexatone, where MIDI notes and channels represent scale degrees and equave transpositions. Based on the current 2D geometry, Hexatone calculates a static mapping that is made available when 2D Geometry is bypassed. The central channel for untransposed playback (default = ch 4) may be chosen and the layout may be sent to Lumatone and edited further in the Lumatone Editor app. In 2D bypass, Hexatone will work with traditional Lumatone layouts, either single or multi-channel, but it is not possible to determine exactly which physical Lumatone key is being pressed, so automatic colour and screen position correlation is not available.

LinnStrument User Firmware mode also includes `Row Glide Shaping`, `X Spike Reduction`, and `X Input Smoothing` to stabilise expressive pitch input under light pressure.

Exquis needs to be updated to Firmware 3.0.0 or higher, which allows Hexatone to send LED colours and set up the MPE mode for landscape format playing using App Mode.

Haken `Continuum X Glide` offers two modes: Pitch Bending and Raster to Notes, along with controls for `X Glide Shaping` (applied to Pitch Bending) and `Pressure->Velocity`, `Minimum Note Duration`, `Minimum Retrigger Interval`, and `Raster Stability` (applied to Raster to Notes). The two modes can be toggled momentarily using a CC pedal (default controller number is 67) or by using the computer's SPACEBAR key. Incoming MPE data is expected in MPE+ format (Pitch Bend Range 96, CC 87 used to provide one-shot high resolution LSB for incoming Pitch Bend, CC74, Channel Pressure X/Y/Z data). Continuum Raster Filter allows the user to choose various collections of scale degrees that will be rastered; collections may be named, sorted, and exported as a single .json file. MPE+ PB output is optional, because the many generated CC87 LSB messages may overload older MIDI connections.

### Input Modes

Hexatone can treat MIDI input broadly in two ways:

- as geometry on the hex layout
- as nearest scale degree input

The first treats the controller as a performance surface with position meaning.
The second treats incoming pitch as musical material to be mapped into the current scale.

### MIDI Output

Hexatone can send tuning and performance data through:

- built-in sample synth
- MTS (MIDI Tuning Standard) Real-Time Tuning
- MTS Bulk Dump Tuning Maps
- MPE (MIDI Polyphonic Expression)

## OSC

Hexatone also includes an OSC output path for users who want:

- a custom synthesis backend
- direct control of a local SuperCollider setup

### What it requires

This mode requires a local clone of the repo and a locally running bridge:

1. clone the repository locally
2. build a local osc-bridge app that runs on your architecture (translates incoming websocket data for SuperCollider)

```sh
yarn build-bridge
```

--OR--

to edit hexatone code and work with custom osc setups using localhost run:

```sh
yarn start
yarn osc-bridge
```

3. load the matching SuperCollider patch/responders locally
4. enable `OSC -> SuperCollider` in Hexatone

This feature also supports a fully local workflow: run Hexatone on `localhost:5173` and the OSC bridge on the same machine, without relying on the hosted site. Users can also use this pathway to drive their own SynthDefs and patches, and support other OSC-compatible apps.

## Sequencer Tab

- open the `Sequencer` tab
- click on the toggle beside "Sequence" to collapse/expand all snapshots
- work with one snapshot: edit note timing, pitch, and expression values
- add bars and tempo changes
- choose a `BAR`, `SNAPSHOT`, or `CUE` and step through events
- save, reopen, export, and continue editing user sequences

### User Sequences

Sequences may be exported, loaded from disc, and stored in local browser storage, accessed through the User Sequences menu. Add a `Name` and `Description` to keep user sequences identifiable. Saved sequence data includes snapshots, note-event edits, bars, tempo markers, repeat markers, snapshot label mode, name, description, and the auto-create-bars preference.

The User Sequences menu distinguishes three states:

- empty workspace: the menu shows `Choose a user sequence`
- unsaved draft: the current working sequence appears as an unsaved draft
- saved sequence: a stored user sequence may be clean or dirty depending on whether there are unsaved changes

If the workspace is dirty and a different saved sequence is chosen, Hexatone asks once whether to discard the unsaved sequence before loading the chosen one.

### Sequence Settings

`Snapshot Labels` may be `Note Names`, `Frequencies`, `MIDIcents`, `Chord Intervals from Lowest Note (cents)`, or `Chord Proportion`. The summary text for each snapshot can be changed independently of the underlying note data and that these labels are saved with the user sequence. The reset button reloads the automatically generated label.

`Auto-Create Bars` places a new bar at each snapshot. Bars can be deleted or additional bars created at any point.

`Choose Repeat Position` inserts repeat-start or repeat-end markers at any global position. New end-repeat markers auto-create a start marker (at the beginning of the sequence or at the previous end repeat). If a start marker is later deleted, Hexatone will use an earlier marker automatically.

`Legato` prevents rearticulation of previously held notes while stepping or retriggering.

`Snap Sequence to Current Hexatone Tuning` remaps saved sequence pitches through the currently active Hexatone tuning so that the same sequence may be auditioned in another scale without rewriting the stored event data.

### Transport Bar

- `PLAY FROM`
  - transport row for selecting a starting point by `BAR`, `SNAPSHOT`, and `CUE`
  - choosing a destination cues it in brackets until stepped
  - the selected target is queued rather than played immediately
- step arrows can walk by bar, snapshot, or cue
- at the end of the sequence, the transport cues back to `(1)` for loop-oriented workflows
- controls for each snapshot or cue
  - play/retrigger
  - stop
  - expand/collapse snapshot event list
  - drag to re-order; option-drag to duplicate

### Event Row Editing

Use the arrow to move between pages of parameters. Current event fields are:

- `Snap`
- `Offset`
- `MIDI¢`
- `Hz`
- `Name` (display-only)
- `Bar`
- `Beat`
- `Num`
- `Den`
- `on-vel`
- `off-vel`
- `pressure`
- `timbre`

`Snap` changes which snapshot an event belongs to. `Offset` is the event's relative position within that snapshot. `Bar / Beat / Num / Den` are an alternate bar-relative position that automatically recalculate the event's global position value.

The `Name` field is a captured display label, not a parsable HEJI spelling field. If `MIDI¢` or `Hz` is edited and the stored label no longer describes the event, the name is shown as `edited` until the captured event values are restored.

### Bar Markers

A bar row shows:
- exact global `Position`
- bar number
- time signature fraction (number of beats / beat unit - for example, a 5/4 bar has 5 units, each 1/4 of a whole note)
- a bar may be moved or inserted at any valid position; the Bar/Beat values for events are recalculated automatically

### Tempo Markers

A tempo row shows:
- exact global `Position`
- fraction of a bar used as "beat" unit for tempo (i.e., tempo measured in dotted quarter notes: specify a beat unit 3/8)
- tempo value in `bpm`
- bar-relative position fields `Bar / Beat / Num / Den`
- the beat fraction is written in the form `3 / 8 = 80 bpm`
- if a tempo marker, bar marker, repeat marker, and note event share the same position, ordering still follows the global precedence rule described above

### Repeat Markers

A repeat row shows:

- exact global `Position`
- bar-relative timing fields `Bar / Beat / Num / Den`
- either a start-repeat sign or an end-repeat sign
- for end repeats, a repeat count such as `2x`, `3x`, or `7x`

Repeat markers participate directly in cue playback. When cue stepping crosses an end-repeat boundary, Hexatone jumps back to the associated start-repeat position and restarts the cue range as many times as the repeat count requires. Any carried note-offs that need to occur before the repeat bounce are preserved by the event-ordering rules.

## Developer Roadmap

Hexatone is currently working towards extending the sequencer functionality and integrating context-aware live retuning.
If you want to clone and run Hexatone locally, or help test, find issues, join the coding, see:

- [DEVELOPER_QUICKSTART.md](./DEVELOPER_QUICKSTART.md)

The main commands are:

- `yarn install`
- `yarn start`
- `yarn test`
- `yarn build`
- `yarn osc-bridge`
- `yarn build-bridge`
