# User Manual

Updated: 2026-07-30

## About

HEXATONE is a microtonal workspace based on a hexagonal 2D pitch layout invented by Erv Wilson. SEQUENCER is a sequencer for editing and performing chords captured in the workspace. The MANUAL tab provides complete documentation. Features include:

- user-programmable keyboard layouts and tunings
- playing with touch, mouse, computer keyboard, and MIDI
- built-in sampled sounds with polyphonic expression
- a scale table for displaying, comparing, and editing tunings: use any degree as a reference note, adjust any pitch to any frequency, use scales of any size across the full frequency range
- JI tools for rationalisation of cents-based intervals, modulation, automatic HEJI Notation and key colours derived from a ratio’s prime exponents
- MIDI input from standard keyboards, MPE devices, or multichannel controllers like Haken Continuum, Exquis, LinnStrument, Lumatone; known controller geometries are correlated with on-screen scale layouts
- MTS Real-Time MIDI Tuning, MPE, and OSC output to external synths and DAWs
- compatibility with the free MTS-ESP Mini Master plug-in for retuning VST instruments
- suitability for live use: extremely low latency and jitter
- a dedicated SEQUENCER tab allows for editing, performing, and automating playback of captured chord snapshots

## Quick Start

WebMIDI is optional. To explore scales, compare tunings, build and recall chords:

- open Hexatone in the browser
- use built-in sounds to play with touch, mouse, computer keyboard
- use on-screen `OCT` / `SUSTAIN` / `MOD` controls or keyboard shortcuts
- edit the scale table, drag to retune individual scale degrees
- capture sounding notes as snapshots with `SHIFT+ENTER`
- open SEQUENCER to edit, navigate, and play the snapshots
- open MANUAL for complete documentation, or use “… more” for contextual help

## Components

### Keyboard Canvas

- draws the current scale in a hexagonal 2D layout, defined by:
    - central scale degree
    - scale steps to the right
    - scale steps to the right and down
    - hex size and rotation
- key labels may be blank, show scale data, custom names, or generated HEJI spellings
- key colours may be edited manually or generated

### Sidebar Settings

- HEXATONE
  - Built-in Tunings
  - User Tunings
  - Name and Description
  - Scale Settings / Scale Table
  - Hexatone Layout
  - Built-in Sounds
  - MIDI Setup
  - MIDI Input
  - Output Routing (MTS / MPE / OSC)
- SEQUENCER
  - Built-in Sequences
  - User Sequences
  - Name and Description
  - Snapshots
  - Copy & Insert
  - Edit & Play / Sequence Event List

### Performance Controls

Buttons along the bottom of the app, also mapped to key commands:

- `SNAPSHOT` button (SHIFT+ENTER key) captures currently played and/or sustained notes
- `OCT` (SHIFT+arrow keys, active when canvas is in focus)
  - use SHIFT + arrow-up arrow-down to change octaves
  - click the word `OCT` or press SHIFT and the <− and −> arrow keys to toggle functionality between two states: retune next played note or (darker colour) retune immediately
- `SUSTAIN` (SHIFT+ESC key): toggle to sustain notes hands-free; play a note again to remove it
- `MOD` (SHIFT+BACKQUOTE / ^ key): click to capture last played note as source degree, next played note becomes target degree
  - `Moveable Do / Fixed Layout` shifts the scale frequency globally while maintaining layout and appearance
  - `Fixed Do / Moveable Layout` keeps the source note "in place" but changes its scale degree to that of the target degree
- `PANIC` (SHIFT+BACKSPACE / DELETE key): kills sounding notes as nicely as possible

### Sequencing Snapshots

- capture currently sounding or sustained notes (`SHIFT+ENTER`); a collapsible palette appears: click to play, drag to reorder, x to delete
- switch to SEQUENCER Tab to edit the snapshot data in detail by adjusting note positions, pitch, and expression data; make a step sequence of cues
- a `Sequence` is a collection of snapshots, ordered and numbered, along with the relative position of individual events (cues), bars with time signatures, tempo markers, and repeat markers; multiple sequences may be saved and loaded as `.json` files; sequences are kept in local browser storage and may be swiftly reloaded from the menu to play different sections or pieces
- a `Snapshot` is a captured chord or note collection including momentary expression data; it can be replayed as a full vertical sonority (stepping by snapshots) or automatically arpeggiated; snapshots may be ordered and are automatically re-numbered
- `Cues` are generated automatically when the relative start and end positions of individual notes comprising a snapshot are edited, creating derived event steps; the global position of events is relative to the snapshot in which they occur; stepping by cues follows the global order of events, so cues may combine events from multiple snapshots
- `Bars` have a user-defined time signature expressed as a fraction of one whole note: the denominator expresses "what fraction of a whole note is considered to be a beat” and the numerator expresses "how many beats comprise this particular bar”
  - example: in a time signature like 6/7, 7 means the beat length is 1/7 of a whole note = one septuplet subdivision of a whole note, and 6 means this bar is made up of 6 septuplets
  - a bar allows the global positioning of events to be expressed in rational time units (beats, fractions of beats)
  - barlines may occur at valid boundaries in global sequence-position space, i.e., between snapshots; bars cannot be placed within a snapshot
  - for most applications, bars can be automatically generated at snapshot boundaries; any extra bars that are not needed may be deleted
- a user-defined tempo marker can occur anywhere in sequence position space; it is expressed as a beat fraction and a tempo in bpm, for example `1 / 4 = 60 bpm`; clicking on the word `tempo:` transforms the immediate tempo change to a gradual tempo transition `target`, which means that a transition occurs from the previous tempo marker to reach the target tempo at the specified position
- repeat start and repeat end markers can occur anywhere in sequence position space; the start marker defines the return point and the end marker carries a repeat count (default `2x`)
- multiple events at the same global position follow an order of precedence rule: `note-offs` of previously triggered notes −> `repeat end` −> `repeat start` −> `tempo` −> `bar` −> new `note-ons` −> new `note-offs`; notes are ordered by pitch with the largest frequency value first (higher notes are above lower notes, as in music notation)
- the sequence uses one exact global position space defined by the numbering of its ordered snapshots: bars, tempo markers, and repeats organise navigation and timed playback without acting as containers for the note events; when a snapshot is moved around, the relative proportions between its constituent events remain stable, but their speed in timed playback is scaled by the number of snapshots comprising a bar as well as its time signature

## Hexatone Tab

Hexatone supports various controllers and uses a 2D hexagonal layout to represent tunings. It acts as a bridge allowing multiple software tools and instruments to receive coordinated tuning and expression data from multichannel and MPE devices.

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

Hexatone includes built-in tunings and supports user presets. Users may import a Scala file or a previously saved Hexatone `.json` file. It is possible to set up a user folder with subfolders and import the entire folder as a library of user tunings.

- create a scale in Scala or Scale Workshop and import it into Hexatone
- edit `Name and Description`, save as a `User Tuning`, try changing the `Hexatone Layout`
- play, experiment with `SUSTAIN`, `OCT`, `MOD`
- tune scale degrees against drones, held chords, or other instruments
- try different `Rationalisation Settings` and compare how the scale changes
- make snapshots; preserve useful scale variations as presets
- export as `.json` file to easily share or reimport settings and metadata

### Scale Settings

- assign a reference frequency (Hz) to any scale degree, directly to 1/1 (scale degree 0), or to the HEJI Spelling Note with 0¢ deviation; all three frequency assignment options interact and update each other accordingly
- change scale size
- set the equave (interval of transposition at which the scale pattern repeats)
- note that fields that represent a pitch use an extended version of the Scala format: integers and fractions represent frequency ratios (JI); decimal points represent cents (1/1200 of an octave measured logarithmically); backslashes indicate edo scale degrees (2\12 means 2 steps of 12edo, or 1/6 of an octave, the tempered whole tone)
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

Choose which information (`Blank Keys`, `Scale Degrees`, `Scala Data`, `Scale Cents`, `Names`, `HEJI`) is displayed on the keys. Equave Numbers may be toggled on or off for each label style. The HEJI Notation options are derived based on a user-specified spelling reference which may or may not be in the actual scale. Users may choose tempered accidentals + cents or JI accidental symbols. Primes > 47 or irrational pitches are given tempered notation + cents deviation. Notation is responsive to the current rational reading of the scale; after tuning edits or modulation, displayed note names update. When automatically generated HEJI labels are edited the scale updates accordingly. Note that HEJI names for non-octave equaves are currently not implemented.

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
- edo steps such as `7\12`
- per-degree tuning adjustment
- rationalisation suggestions

You may:

- reorder scale degrees by clicking on the degree number
- select and delete a scale degree
- `Sort Degrees Ascending`, preserving degree `0` and the equave
- increase scale size (adds copies of the current equave as editable placeholders)
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
- there are two layout options: `Fixed Do / Moveable Layout` or `Moveable Do / Fixed Layout`

## MIDI

### MIDI Setup

WebMIDI is optional; allowing SysEx functionality is an additional option. WebMIDI adds:

- external MIDI input
- controller auto-detection and geometry support, with manual override
- LED color support on supported devices
- MTS and MPE output

Without SysEx, MTS MIDI Tuning and bidirectional communication with Lumatone and Exquis are disabled, but controller input and MPE remain functional.

If you do not wish to enable WebMIDI, Hexatone still works as an on-screen instrument and scale workspace.

### MIDI Input

HEXATONE

- responds to standard keyboard input on all channels
- handles MPE per-note expression data: pitch bend (X), channel pressure (Z), CC74 timbre (Y)
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

Lumatone has two modes: default is 2D geometry aware, and uses a custom key layout that matches the numbering of keys used in a standard lumatone (.ltn) file: Notes 0-55 are ordered left-to-right and top-to-bottom, repeated five times to form five blocks, each on a separate MIDI channel (1-5). This fixed key layout allows Hexatone to compute the exact physical key being played from incoming MIDI data, map it to the on-screen canvas, and adapt to changing tunings, modulations, etc. Key colours are sent to Lumatone based on the user's chosen Anchor Note so Lumatone always remains aligned with the on-screen layout. There is an option to filter which scale degrees are coloured, a useful way of learning the layout when there are many different notes. The `Lumatone Colour Filter` can store, order, import, and export named collections of scale degrees. `Auto-Generate from Snapshots` adds filters derived from the notes present in captured snapshots.

Alternatively, some users may prefer to generate a “traditional” multichannel Lumatone layout usable outside of Hexatone, where MIDI notes and channels represent scale degrees and equave transpositions. Based on the current 2D geometry, Hexatone calculates a static mapping that is made available when 2D Geometry is bypassed. The central channel for untransposed playback (default = ch 4) may be chosen and the layout may be sent to Lumatone and edited further in the Lumatone Editor app. In 2D bypass, Hexatone will work with traditional Lumatone layouts, either single or multi-channel, but it is not possible to determine exactly which physical Lumatone key is being pressed, so automatic colour and screen position correlation is not available.

LinnStrument User Firmware mode also includes `Row Glide Shaping`, `X Spike Reduction`, and `X Input Smoothing` to stabilise expressive pitch input under light pressure.

Exquis needs to be updated to Firmware 3.0.0 or higher, which allows Hexatone to send LED colours and set up the MPE mode for landscape format playing using App Mode. If Exquis is not working as expected, check the browser console: if a firmware update is needed, the information will be there.

Haken `Continuum X Glide` offers two modes: Rastered Attack + Pitch Bend and Rastered Notes, along with controls for `X Glide Shaping` (applied to Rastered Attack + Pitch Bend) and `Pressure->Velocity`, `Minimum Note Duration`, `Minimum Retrigger Interval`, and `Raster Stability` (applied to Rastered Notes). The two modes can be toggled momentarily using a CC pedal (default controller number is 67) or by using the computer's SPACEBAR key. Incoming MPE data is expected in MPE+ format (Pitch Bend Range 96, CC 87 used to provide one-shot high resolution LSB for incoming Pitch Bend, CC74, Channel Pressure X/Y/Z data). `Continuum Raster Filter` lets the user store and order named collections of scale degrees. The selected filter constrains attacks and subsequent retriggers in Rastered Notes. `Apply Raster in Pitch Bending Mode` optionally applies it to attacks in Rastered Attack + Pitch Bend. Independently, `Shape X Glide to Raster` uses the filtered degrees rather than every scale degree as the stability centres for continuous X Glide Shaping. Collections may be imported or exported together as a `.json` file, while `Auto-Generate from Snapshots` adds filters derived from captured snapshots. Optional MPE+ pitch-bend output adds high-resolution CC87 data; it may be disabled when older MIDI connections cannot sustain the additional message density.

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
  - MTS is used in a special way to allow large scales and many octaves to be used effortlessly: rather than setting up a tuning map in advance, each note is immediately assigned a slot and retuned on the fly, allowing up to 128-note microtonal polyphony in any size scale across the entire MIDI range; by sending Hexatone MTS Output to MTS-ESP Mini Master, instruments that do not directly support the SysEx protocol can be retuned as well
- MTS Bulk Dump Tuning Maps for legacy synths (128 notes at a time)
- MPE (MIDI Polyphonic Expression)

MPE output offers two message styles:

- `Ableton compatible` uses unique MIDI notes with a 48-semitone pitch-bend range
- `MPE standard` uses nearest MIDI notes and a user-defined pitch-bend range

`MPE+ PB` adds CC87 low-bit messages for higher-resolution pitch bend on compatible instruments. CC74 carries per-note timbre and Channel Pressure carries per-note pressure.

### Eagan Matrix

The Eagan Matrix is a dedicated digital modular patchbay designed for XYZ control from instruments like Osmose and Haken Continuum. A set of specialised controls for this synth appear within the MPE output settings:

- `Auto-Generate MPE YZ` generates per-voice timbre (Y/CC74) and pressure (Z/Channel Pressure) envelopes from attack velocity and subsequent polyphonic pressure. It applies to live input and stored sequences, including release shaping driven by Note Off velocity.
- `Mod Wheel → Brightness` mirrors incoming modulation-wheel CC1 values to Brightness and updates its displayed fader.
- `Brightness` sends CC13.
- `Tilt EQ` sends CC83.
- `Pre Level` sends CC26.
- `Post Level` sends CC18.

The four faders use MIDI values from 0–127 and default to 64. Enabling `Auto-Generate MPE YZ` also sends their current values so the receiving Eagan Matrix begins from the displayed state.

## OSC

Hexatone also includes an OSC output path for users who want:

- a custom synthesis backend
- direct control of a local SuperCollider setup

### What it requires

This mode requires a local clone of the repo and a locally running bridge:

1. clone the repository locally
2. build a local osc-bridge app that runs on your architecture (translates incoming WebSocket data for SuperCollider)

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

This feature also supports a fully local setup: run Hexatone on `localhost:5173` and the OSC bridge on the same machine, without relying on the hosted site. Users can also use this pathway to drive their own SynthDefs and patches, and support other OSC-compatible apps.

## Sequencer Tab

The Sequencer supports three connected workflows: snapshots play captured note collections; cues trigger events grouped by position; timed playback follows the complete timeline of note events, bars, tempi, and repeats.

- open the `Sequencer` tab
- load a built-in sequence, for example "FALL"
- scroll down to `Edit & Play`
- click on the toggle to switch between the complete event view and compact snapshot view
- in collapsed mode, notice the different types of events at the sequence start
  - repeat start
  - tempo
  - bar
  - snapshot (click once to select a snapshot, drag to move it, Option-drag to duplicate)
  - a selected snapshot is also automatically selected in `Copy & Insert`, where it is possible to select and work with a range of snapshots
- each event is assigned a global position relative to the collection of snapshots; bars are restricted to positions between snapshots, other events can be positioned anywhere
- to work with a selected snapshot click on it again to open a list of individual notes
  - edit note timing, pitch, and expression values (use the right/left arrow to move to additional data fields)
  - note events can be positioned before or after the snapshot anchor position, automatically creating `Cues`; note ons always remain consistently ordered before their related note offs and shared data (pitch, expression) is updated in both data rows whenever either event is edited; by changing the `Snap` value notes may be moved to other snapshots if desired; option-drag duplicates a note
  - change the snapshot name if desired; use the reset button to reload the default style chosen under `Snapshot Labels`
  - trigger the snapshot with the play/stop controls
  - try arpeggiation
- add bars, repeats, and tempo changes (toggle between immediate `tempo` and gradual transition to `target` by clicking)
- in the `PLAY FROM` transport select a playhead location by using the `BAR`, `SNAPSHOT`, or `CUE` menus
  - selecting by bar or cue highlights cues
  - selecting by snapshot highlights snapshots
  - the highlight shows what kind of event will be triggered when the user clicks on the play button
  - a bracketed snapshot or cue number marks a queued position
  - step through snapshots or cues manually using their respective arrows
  - notice how `Auto-Scroll` works to find bars, snapshots, and cues, to highlight notes as they are played, and responds when the view is toggled
- try `TIMED PLAYBACK` to automate the sequence
- adjust playback `SPEED` and `PITCH`
- try `Snap Sequence to Current Hexatone Tuning` to hear stored snapshots remapped to the nearest notes in the current tuning; recapture and compare different versions

### User Sequences

Sequences may be saved in a user library, loaded from disc, saved as copies, accessed, and exported through the User Sequences menu. Add a `Name and Description`. Saved sequence data includes snapshots, note-event edits, bars, tempo markers, repeat markers, snapshot label mode, name, description, the auto-create-bars preference, and arpeggiation settings. Legato and tuning-snap are workspace/session settings.

The User Sequences menu distinguishes three states:

- empty workspace: the menu shows `Choose a user sequence`
- unsaved draft: the current working sequence appears as an unsaved draft
- saved sequence: a stored user sequence may be clean or dirty depending on whether there are unsaved changes

If the workspace is dirty and a different saved sequence is chosen, Hexatone asks once whether to discard the unsaved sequence before loading the chosen one.

### Snapshots

- buttons to `Capture`, `Append Empty Snapshot`, `Clear All`
- an empty snapshot allows for a bar rest, structural position, or timed sustain
- the `chord` box can be toggled to `arp` to manually control where arpeggiation is applied when `Per Snapshot` is selected in the `Arpeggiation` menu

### Copy & Insert
- select a range of snapshots by `Start` and `End` (both positions are included in the selected range)
- optionally include bars, repeats, tempo markers
- `Edit Selected Range` in place
  - reset `Note Offsets` to default positions
  - set arpeggiation of snapshots in the chosen range to `chord` or `arp`
  - revert the most recent range edit
  - delete the snapshots
- copy, insert at bar or snapshot position, moving the existing sequence events accordingly
- after insertion, copied range is automatically selected for further edits if needed

### Edit & Play

`Choose Tempo Position` inserts a tempo marker; `Add Target Tempo` makes a gradual transition from the previous tempo marker.

`Auto-Create Bars` places a new bar at each snapshot. Bars can be deleted or additional bars created at any valid snapshot boundary (integer position).

`Choose Repeat Position` inserts repeat-start or repeat-end markers at any global position. New end-repeat markers auto-create a start marker (at the beginning of the sequence or at the previous end repeat). If a start marker is later deleted, Hexatone will use an earlier marker automatically.

`Snapshot Labels` may be `Note Names`, `Frequencies (Hz)`, `MIDIcents`, `Chord Intervals from Lowest Note (¢)`, `Chord Proportions` or `Odd Partial Proportions`. The label for each snapshot can be customised. The reset button reloads the automatically generated label.

`Snapshot Arpeggiation` affects manual stepping by snapshot only. It spreads the individual note ons and note offs across a time range `Initial Spread` according to the chosen parameters `Spread Variation` and `Timing Variation`. Timing varies how much the note offset positions in timed playback affect the arpeggiation. Notes sharing a common position are arpeggiated upward, whereas the event list is ordered to resemble staff notation, with the highest note first/uppermost. `Decay`can be immediate, timed up to 10s, or sustained; it begins when a new snapshot is triggered, and may be subject to `Decay Variation`. Thus, arpeggiations of multiple snapshots may overlap.

`Legato` prevents rearticulation of previously held notes while stepping or retriggering. It also applies when snapshots are arpeggiated and notes overlap.

`Auto-Scroll` finds the bar, snapshot, or cue that is queued for next playback, follows manual navigation and timed playback, and reanchors when changing the event-list view with the toggle beside `Edit & Play`.

`Play Repeats` allows repeat markers to be toggled on and off.

`Snap Sequence to Current Hexatone Tuning` plays saved sequence pitches through the currently active Hexatone tuning so that the same sequence may be auditioned in another scale without rewriting the stored event data; capturing the sounds while snapping is active stores the recomputed and retuned note data as new snapshots.

### Transport

- `PLAY FROM`
  - transport row for selecting a starting point by `BAR`, `SNAPSHOT`, and `CUE`; choosing by bar or cue line up a cue, choosing by snapshot lines up a snapshot, and the next event up for playback is gently highlighted
  - choosing a destination queues it in brackets until stepped with the arrows or playback controls
  - controls to play/retrigger/stop each snapshot or cue; a highlight indicates which type of event will be triggered
  - only a snapshot played manually observes arpeggiation, cues and timed playback do not

- `TIMED PLAYBACK`
  - transport row with clock and bar/beat readouts
  - start, play/pause, stop, and end controls trigger an automated playback of cues including tempo changes and enabled repeats
  - live SPEED scaling from 0.5×–2× and displayed effective tempo
  - live PITCH transposition up to ±1200 cents
  - Auto-Scroll keeps the event list aligned with playback
  - arpeggiation is NOT applied in this mode

### Event Row Editing

Use the left-right arrow to move between pages of parameters. Current event fields are:

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
- a bar may be moved or inserted at any valid snapshot boundary (integer position); the Bar/Beat values for events are recalculated automatically

### Tempo Markers

A tempo row shows:
- exact global `Position`
- `tempo` for immediate change, `target` when the tempo has transitioned gradually from the previous tempo marker
- fraction of a whole note used as "beat" unit for tempo (i.e., tempo measured in dotted quarter notes = 3 eighth notes: specify a beat unit 3/8)
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
