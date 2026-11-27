# User Manual

Updated: 2026-11-27

## About

`HEXATONE` is a microtonal workspace based on a two-dimensional hexagonal pitch layout invented by Erv Wilson. `SEQUENCER` edits and plays chords progressions captured in Hexatone. `SOUNDS` and `MIDI` have settings for built-in sounds and MIDI input/output. `CALCULATOR` makes JI calculations (HEJI spelling, frequency, cents deviation, and rationalisation).

## Features

- customisable keyboard layouts and tunings
- play with touch, mouse, computer keyboard, and MIDI
- polyphonic built-in sounds with tuning and expression: DSF synthesis, samples, a SoundFont player, and four SuperCollider/SuperSonic layers
- a scale table for editing tunings: use any degree as a reference note, adjust any pitch to any frequency, use scales of any size across the full frequency range
- JI tools for rationalisation of cents-based intervals, modulation to any scale degree, automatic HEJI Notation and key colours derived from a ratio’s prime exponents
- MIDI input from standard keyboards, MPE devices, or multichannel controllers like Haken Continuum, Exquis, LinnStrument, Lumatone; known controller geometries are correlated with on-screen scale layouts and assigned specialised controls
- tuning of external synths and DAWs:
    - Monophonic Single-Channel MIDI
    - MIDI Tuning: MTS Real-Time or Tuning Map
    - MPE
    - OSC output arguments to local SuperCollider using a WebSocket + OSC bridge
      - freq, bend, pressure, expressionY, on_vel, off_vel, vol, gate
      - quick_release, quick_release_time, retrigger_mode
- step sequencer and calculator

## Quick Start

To explore scales, compare tunings, build and recall chords:

- open Hexatone in the browser, choose a tuning, close the sidebar
- if Web Audio needs a user interaction to resume on your device, an alert will appear
- play with touch, mouse, or computer keyboard
- try the on-screen `OCT` and `SUSTAIN` controls, re-open the sidebar
- in the `HEXATONE` tab, open the toggle beside `Scale Settings` to reveal and edit the scale table
    - drag to retune individual scale degrees while sustaining
    - click on the arrow to obtain suggested rational pitches
- capture sounding notes as snapshots with the on-screen button or press *SHIFT+ENTER*
- open `SEQUENCER` tab to edit, navigate, and play the snapshots
- choose a built-in sequence, scroll down to `Edit & Play`
- use `PLAY FROM` to step through sounds or the `TIMED PLAYBACK` transport for automation
- change to the `SOUNDS` tab; try different sound combinations while the sequencer is playing
    - under `Built-in DSF Synthesis` adjust envelopes for volume and timbre
    - under `Built-in Samples` change `Instrument`
    - under `Built-in SoundFont Player`, in the menu `Hexatone SoundFonts` choose a sound and download it by tapping `Load Hexatone SoundFont`
    - under `Built-in scsynth` try mixing the layers and adjusting `Brightness`
- open `MANUAL` for complete documentation, or use *… more* for contextual help

## Sequencing

- capture currently sounding or sustained notes (*SHIFT+ENTER*); a collapsible palette appears: click to play, drag to reorder, x to delete, toggle `SNAP` to compare the chord rendered in different tunings
- switch tabs to `SEQUENCER`, edit the snapshot data in detail by adjusting pitch, note positions, and expression data; a step sequence of cues based on positions is generated automatically
- a `Sequence` is a collection of snapshots, ordered and numbered, along with the relative position of individual events (cues), bars with time signatures, tempo markers, and repeat markers; multiple sequences may be saved and loaded as .json files; sequences are kept in local browser storage and may be swiftly reloaded from the menu to play different sections or pieces
- a `Snapshot` is a captured chord or note collection including momentary expression data; it can be replayed as a full vertical sonority (stepping by snapshots) or automatically arpeggiated; snapshots may be ordered and are automatically re-numbered; for example, try stepping through automatically arpeggiated snapshots in the built-in sequence “Seeds of Skies, Alibis”
- `Cues` are generated automatically when the relative start and end positions of individual notes comprising a snapshot are edited, creating derived event steps; the global position of events is relative to the snapshot in which they occur; stepping by cues follows the global order of events, so cues may combine events from multiple snapshots; for example, compare the built-in sequences “FALL”, in which each snapshot is a chord, and cues turn that chord into a contrapuntal unfolding phrase using changing time signatures and tuplets in `TIMED PLAYBACK`, to “Fleeting flight sleeping woke” in which each snapshot is usually only a single note and cues are built from overlapping sustained snapshots, with `TIMED PLAYBACK` using tempo changes to create immediate and gradual transitions
- `Bars` have a user-defined time signature expressed as a fraction of one whole note: the denominator expresses what fraction of a whole note is considered one beat, and the numerator expresses how many beats comprise the bar
  - example: in a time signature like 6/7, 7 means the beat length is 1/7 of a whole note = one septuplet subdivision of a whole note, and 6 means this bar is made up of 6 septuplets
  - a bar allows the global positioning of events to be expressed in rational time units (beats, fractions of beats)
  - barlines may occur at valid boundaries in global sequence-position space, i.e., between snapshots; bars cannot be placed within a snapshot
  - for most applications, bars can be automatically generated at snapshot boundaries; any extra bars that are not needed may be deleted
- a user-defined tempo marker can occur anywhere in sequence position space; it is expressed as a beat fraction and a tempo in bpm, for example `1 / 4 = 60 bpm`; clicking on the word `tempo:` transforms the immediate tempo change to a gradual tempo transition `target`, which means that a transition occurs from the previous tempo marker to reach the target tempo at the specified position
- repeat start and repeat end markers can occur anywhere in sequence position space; the start marker defines the return point and the end marker carries a repeat count (default `2x`)
- multiple events at the same global position follow an order of precedence rule: `note-offs` of previously triggered notes → `repeat end` → `repeat start` → `tempo` → `bar` → new `note-ons` → new `note-offs`; notes are ordered by pitch with the largest frequency value first (higher notes are above lower notes, as in music notation)
- the sequence uses one exact global position space defined by the numbering of its ordered snapshots: bars, tempo markers, and repeats organise navigation and timed playback without acting as containers for the note events; when a snapshot is moved around, the relative proportions between its constituent events remain stable, but their speed in timed playback is scaled by the number of snapshots comprising a bar as well as its time signature

## Components

### Keyboard Canvas

- draws the current scale in a hexagonal 2D layout, defined by:
    - central scale degree
    - hex size
    - scale steps traversed by moving one hex to the right
    - scale steps traversed by moving one hex to the right and down
    - rotation measured in degrees clockwise
- key labels may be blank, show scale information, custom names, or generated HEJI spellings
- key colours may be edited manually or generated

### Sidebar Settings

In the `HEXATONE` tab, `Keep screen awake`, below `Restore on reload`, prevents
automatic screen locking during playback or held notes when the browser permits
it. The preference is saved independently of tuning restoration. Manual locking
and system power-saving restrictions can still interrupt audio.

`HEXATONE`
  - Built-in Tunings
  - User Tunings
  - Name and Description
  - Scale Settings / Scale Table
  - Hexatone Layout
`SEQUENCER`
  - Built-in Sequences
  - User Sequences
  - Name and Description
  - Snapshots
  - Copy & Insert
  - Edit & Play / Sequence Event List
`SOUNDS`
  - User Sounds
  - Built-in DSF Synthesis
  - Built-in Samples
  - Built-in SoundFont Player (based on FluidSynth)
  - Built-in scsynth (SuperSonic / OSC to external SuperCollider)
`MIDI`
  - MIDI Setup
  - MIDI Input
  - MIDI Output (Monophonic Single-Channel / MTS / MPE)
`CALCULATOR`
  - Reference
  - HEJI Spelling
  - Palette Input
  - Ratio/Cents Input
  - Rationalisation Search
  - Calculated Data
  - Nearby Rational Pitches

### Performance Controls

Buttons along the bottom of the app, also mapped to key commands:

- `SNAPSHOT` button (*SHIFT+ENTER*) captures currently played and/or sustained notes
    - `SNAPSHOTS` palette appears with a list of sounds and controls to trigger or stop them; sounds may be reordered or deleted
    - `Snap to current tuning` applies a chord-aware best fit drawn from notes in the currently selected scale
    - go to `SEQUENCER` to edit snapshots into a score for timed playback
- `OCT` (*SHIFT+arrow*) is active when canvas is in focus
  - press *SHIFT + up / down arrow* to change octaves
  - click the word `OCT` or press *SHIFT + left / right arrow* to toggle between two states: retune the next played note or (darker colour) retune all sounds immediately
- `SUSTAIN` (*SHIFT+ESC* / *F8*): the on-screen control toggles hands-free sustain; playing a sustained note again turns it off rather than adding another voice
    - after clicking the canvas, hold *SPACE* for momentary pedal sustain, even with the sidebar open; the on-screen control lights while pressed. Repeatedly playing a note adds new voices while its earlier voices keep sounding, allowing layers of the same pitch. Release SPACE to clear sustained notes, including individual Shift latches. Physically held notes continue until released. 
   - *SHIFT+note key* sustains one note independently; play it again or click its hex to release it
- `MOD` (*SHIFT+BACKQUOTE / °*): toggle to activate or deactivate modulation mode (see detailed description below)
    - a single played or already playing note is treated as the source degree
    - next overlapping note becomes target degree (no additional sound is triggered)
    - the target scale degree is retuned to the pitch of the source degree and the entire scale is transposed accordingly
    - layout is determined by `Modulation Style`
        - `Moveable Do / Fixed Layout` shifts the scale frequency globally while maintaining layout and appearance
        - `Fixed Do / Moveable Layout` keeps the source note “in place” but changes its scale degree to that of the target degree, re-anchoring the layout
    - `MODULATION HISTORY` palette appears indicating
        - `1/1 Shift` in cents (total of all transpositions)
        - list of captured modulations: Source — Target, cents deviation, step buttons to modulate, x to delete (visible only when modulation has returned back to starting pitch)
- `PANIC` (*SHIFT+BACKSPACE / DELETE*): kills sounding notes as nicely as possible

## HEXATONE tab

Hexatone supports various controllers and uses a 2D hexagonal layout to represent tunings. It acts as a bridge for devices connected in the `MIDI` tab, allowing multiple software tools and instruments to receive coordinated tuning and expression data from multichannel and MPE devices.

### Mouse, Touch, Computer Keyboard

Click or tap the on-screen hexes to play notes. Click the canvas to use the computer keyboard as a simple isomorphic controller, even while the sidebar is open. The H key is mapped automatically to play the central degree at the centre of the canvas. Pressing *SHIFT* and a note-triggering key alternately latches and releases that particular note, allowing note-by-note sustains. When a sidebar field requiring typing is clicked, the keybindings to canvas are automatically released. To resume playing, click again on the canvas.

### Presets

Hexatone includes built-in tunings and supports user presets. You may import a Scala file or a previously saved Hexatone tuning preset .json file. You can also import a folder of scales and hexatone presets.

- create a scale in Scala or Scale Workshop and import it into Hexatone
- edit `Name and Description`, save as a `User Tuning`, try changing the `Hexatone Layout`
- play, experiment with `SUSTAIN`, `OCT`, `MOD`
- tune scale degrees against drones, held chords, or other instruments
- try different `Rationalisation Settings` and compare how the scale changes
- make snapshots; preserve useful scale variations as presets
- export as .json file to easily share or reimport settings and metadata

### Scale Settings / Hexatone Layout

`Scale Settings` toggles to reveal `HEJI Spelling` controls, a table layout of the scale degrees, and additional features.

`Hexatone Layout` toggles to reveal scale to canvas mapping parameters and rotation, in addition to `Central Scale Degree` and `Hex Size`.

- assign a reference frequency (Hz) to any scale degree, directly to 1/1 (scale degree 0), or to the `HEJI Anchor (Spelling Note with 0¢ deviation)`; all three frequency assignment options interact and update each other accordingly
- change scale size
- set the equave (interval of transposition at which the scale pattern repeats)
- perform quick actions to generate an equal division of any interval into a scale of the chosen size
- set `Modulation Style` (see also the `MOD` button entry under [Performance Controls](#manual-performance-controls)) and the description of Modulation below
    - `Moveable Do / Fixed Layout` shifts the scale frequency globally while maintaining layout and appearance
    - `Fixed Do / Moveable Layout` keeps the source note “in place” but changes its scale degree to that of the target degree, re-anchoring the layout
- key colours can be edited manually or derived automatically with a user-definable palette of colours
- key labels can be edited manually or HEJI notation may be derived automatically from a user-specified `HEJI Anchor`, visibility of equave numbers can be toggled

### Modulation

- `MOD` (*SHIFT + Backquote / °*): initiates a modulation
- as single notes are played, they become "source notes"
- these may be transferred to a "target note" by simultaneously playing a second key (which will NOT sound)
- instead, the frequency of the source note will be automatically assigned to the scale degree of the target note, and the scale will automatically be transposed accordingly
- the canvas layout responds according to the `Modulation Style` setting
- a floating palette of `MODULATION HISTORY` appears, tracking all user-initiated modulations, counting the number of steps taken
- clicking the arrows takes further steps by the same transposition interval (in either direction)
- once a modulation pathway returns to zero it may be clicked away or retained for further use
- modulation updates both sounding relationships and the displayed notation context
- modulation history can be used as a live record of changing reference-frame decisions during performance or analysis
- modulation history may be reset globally, returning to the saved tuning

### Key Colours

Use the `Key Colours` menu to choose how note colours are shown on the keyboard and in the scale table. There are three modes:

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

Choose which information (`Blank Keys`, `Scale Degrees`, `Scala Data`, `Scale Cents`, `Names`, `HEJI`) is displayed on the keys. `Equave Numbers` may be toggled on or off for each label style. HEJI spelling is derived based on the options described below. Users may choose tempered accidentals + cents or JI accidental symbols. Primes > 47 or irrational pitches are given tempered notation + cents deviation. Notation is responsive to the current rational reading of the scale; after tuning edits or modulation, displayed note names update. When automatically generated HEJI labels are edited, the scale updates accordingly. Note that HEJI names for non-octave equaves are currently not implemented.

### HEJI Spelling

Users may specify a spelling reference with 0¢ deviation. This need not be part of the scale, but it must be expressed relative to scale degree 0 (1/1). If the relationship to the scale is not expressed rationally, the resulting notation will be tempered accidentals + cents deviations. If it is expressed as a ratio, rational scale degrees obtain HEJI accidentals unless the user specifies `Tempered Accidentals Only`.

The spelling reference is defined by four linked fields:

- `Notation (Spelling)`: the note name and accidental used as the 0¢ spelling reference
- `Ratio/Cents from 1/1`: the interval from scale degree 0 to the spelling reference
- `Spelling Frequency`: the frequency of the spelled reference pitch
- `Frequency of 1/1`: the frequency of scale degree 0

Editing one linked reference field updates the others where possible.

Changing `Ratio/Cents from 1/1` recalculates the reference spelling while preserving the original spelling of 1/1, including when switching to cents and back to a ratio. An explicit edit to `Notation (Spelling)` establishes a new spelling reference.

### HEJI Palette

A `HEJI Notation Palette` is provided to generate strings of accidentals that may be copied and pasted into the scale table. The `12edo` row emits tempered accidental glyphs and allows manual cents entry for non-JI notation; the higher-prime rows emit exact HEJI accidentals up to 47-limit. Exact HEJI cents are calculated automatically from the chosen accidentals and current spelling reference; tempered accidentals allow manual cents entry.

Use `Decimal Places` to choose the display precision of the calculated cents value. `Copy` copies the combined notation-plus-cents output, and `Clear` resets the palette output.

### The Scale Table

The scale table supports:

- exact ratios such as `5/4`
- cents values such as `386.3`
- edo steps such as `7\12`
- rationalisation suggestions (see Rationalisation, below)
- per-degree tuning adjustment (see TuneCell, below)
- frequencies in Hz
- HEJI Notation when Key Labels are set to `HEJI`
- editing key colours manually

You may:

- `Sort Degrees Ascending`, preserving degree `0` and the equave
- reorder scale degrees by clicking on the degree number and dragging
- delete a selected scale degree
- `Add Scale Degree` to increase scale size (adds copies of the current equave as editable placeholders); to decrease scale size adjust the `Scale Size` at the beginning of `Scale Settings`: this setting automatically extends or truncates the existing scale

### Rationalisation

PLAINSOUND `HEXATONE` is oriented toward exploring intonation with rational intervals. Rationalisation examines scale degrees and suggests rational interval interpretations according to the current search settings.

It helps answer questions like:

- what simple ratio is closest to this tuned pitch?
- how may this scale be read as a JI structure?

The current rationalisation workflow has two modes:

- `Keep existing ratios`: preserve ratios you already committed, rationalise around those anchors
- `Find new ratios`: fresh search based on the current settings

`Rationalisation Settings` include:

- symmetric, overtonal, or custom search (user-specified exponent range above and below each prime)
- prime and odd limit, tolerance range in cents

### TuneCell

The small retuning control attached to scale entries and the reference frequency lets you:

- drag for smooth retuning while sustaining
- preview changes while listening
- compare changes against original values
- save or revert a tuning change

## SEQUENCER tab

The Sequencer supports three connected workflows: snapshots play captured note collections; cues trigger events grouped by position; timed playback follows the complete timeline of note events, bars, tempi, and repeats.

- open the `SEQUENCER` tab
- load a built-in sequence, e.g. “FALL”
- scroll down to `Edit & Play`
- open the toggle to show editing controls
- notice the different types of events at the sequence start (position 1.000000)
  - repeat start (with an option to remove)
  - tempo: 1/4 = 58 bpm
  - bar with time signature 1/1
  - `Reference` marker: A4 = 441 Hz = 27/16 = HEJI A natural (0¢)
  - snapshot 1 (click once to select a snapshot, drag to move it, *Option-*drag to duplicate)
  - a selected snapshot is also automatically selected in `Copy & Insert`, where it is possible to select and work with a range of snapshots
- each event is assigned a global position relative to the collection of snapshots, which are numbered automatically; bars are restricted to positions between snapshots, other events can be positioned anywhere
- to work with a selected snapshot
  - edit note timing, pitch, and expression values (use the left or right arrow to move to additional data fields)
  - note events can be positioned before or after the snapshot anchor position, automatically creating `Cues`; note-ons always remain consistently ordered before their related note-offs, and shared data (pitch, expression) is updated in both data rows whenever either event is edited; by changing the `Snap` value, notes may be moved to other snapshots if desired; *Option-*drag duplicates a note
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
  - `Auto-Scroll` finds bars, snapshots, and cues, and highlights notes as they are played
- try `TIMED PLAYBACK` to automate the sequence
- adjust playback `SPEED` and `PITCH`
- try `Snap Sequence to Current Hexatone Tuning` to hear stored snapshots remapped to the nearest notes in the current tuning; recapture and compare different versions of a snapshot

### User Sequences

Sequences may be saved in a user library, loaded from disc, saved as copies, accessed, and exported through the `User Sequences` menu. Add a `Name and Description`. Saved sequence data includes snapshots, note-event edits, bars, tempo markers, repeat markers, snapshot label mode, name, description, the auto-create-bars preference, arpeggiation and legato settings. Tuning-snap is a workspace/session setting.

The `User Sequences` menu distinguishes three states:

- empty workspace: the menu shows `Choose a user sequence`
- unsaved draft: the current working sequence appears as an unsaved draft
- saved sequence: a stored user sequence may be clean or dirty depending on whether there are unsaved changes

If the workspace has unsaved changes and a different saved sequence is chosen, Hexatone asks once whether to discard the unsaved sequence before loading the chosen one.

### Snapshots

- buttons to `Capture`, `Append Empty Snapshot`, `Clear All`
- an empty snapshot allows for a bar rest, structural position, or timed sustain
- in the event list, snapshots have a box which can be toggled between `chord` and `arp` to manually control where arpeggiation is applied when `Per Snapshot` is selected in the `Snapshot Arpeggiation` menu of `Edit & Play`

### Copy & Insert

- select a range of snapshots by `Start` and `End` (both positions are included in the selected range)
- an endpoint beyond the sequence resolves to its last snapshot; the delete preview shows the selected range and how many snapshots will remain
- optionally include bars, repeats, tempo markers
- `Edit Selected Range` in place appears when toggle is opened
  - reset `Note Offsets` to default positions
  - set arpeggiation of snapshots in the chosen range to `chord` or `arp`
  - revert the most recent range edit
  - delete the snapshots
- `Include Bars` deletes bars within the selected range; it does not extend deletion to whole bars
- copy, insert at bar or snapshot position, moving the existing sequence events accordingly
- after insertion, copied range is automatically selected for further edits if needed

### Edit & Play

Editing controls start closed and may be toggled open.

`Choose Tempo Position` inserts a tempo marker; `Add Target Tempo` makes a gradual transition from the previous tempo marker.

`Auto-Create Bars` places a new bar at each snapshot. Bars can be deleted or additional bars created at any valid snapshot boundary (integer position).

`Choose Repeat Position` inserts repeat-start or repeat-end markers at any global position. New end-repeat markers auto-create a start marker (at the beginning of the sequence or at the previous end repeat). If a start marker is later deleted, Hexatone will use an earlier marker automatically.

`Snapshot Labels` may be `Note Names`, `Frequencies (Hz)`, `MIDIcents`, `Chord Intervals from Lowest Note (¢)`, `Chord Proportions` or `Odd Partial Proportions`. The label for each snapshot can be customised. The reset button reloads the automatically generated label.

`Snapshot Arpeggiation` affects manual stepping by snapshot only. It spreads the individual note-ons and note-offs across an `Initial Spread` time range according to the chosen `Spread Variation` and `Timing Variation` parameters. Timing varies how much the note-offset positions in timed playback affect the arpeggiation. Notes sharing a common position are arpeggiated upward, whereas the event list is ordered to resemble staff notation, with the highest note first (uppermost). `Decay` can be immediate, timed up to 10 s, or sustained; it begins when a new snapshot is triggered and may be subject to `Decay Variation`. Thus, arpeggiations of multiple snapshots may overlap.

`Legato` prevents rearticulation of previously held notes while stepping or retriggering. It also applies when snapshots are arpeggiated and notes overlap. It may be set to `Off`, applied `Per Note`, or applied to `All Common Tones`. Individual continuations may be forced to reattack in the event editor.

`Auto-Scroll` finds the bar, snapshot, or cue that is queued for next playback and follows manual navigation and timed playback. Manual-trigger highlights and scrolling update on the next display frame.

The floating Snapshots palette also scrolls to keep the current snapshot in view when navigating by snapshot or cue, including timed playback.

`Play Repeats` allows repeat markers to be toggled on and off.

`Snap Sequence to Current Hexatone Tuning` plays saved sequence pitches through the currently active Hexatone tuning so that the same sequence may be auditioned in another scale without rewriting the stored event data; capturing the sounds while snapping is active stores the recomputed and retuned note data as new snapshots.

With `Snap` enabled, playing sequence notes also highlights matching visible hexes at their sounding register. The shaded edges follow note attacks and releases, including legato and overlapping notes. Stop or disabling Snap clears them. Notes outside the visible layout are not shown. Snapped note names retain their octave annotations.

With a blank Hexatone canvas (no scale loaded), this option has no effect: the sequence keeps its stored pitches.

With `Snap` active, `Chord Drift` favours the snapshot’s original interval pattern. Drift ranges from 0–66 cents, initially set to 33; 0 snaps to nearest note. The snapshots palette and `SEQUENCER` share controls for snap and chord drift.

The whole snapshot is considered intentionally: later entries or replacement notes can influence the opening chord’s placement. `Chord Drift` permits movement upward or downward; its value is an allowed maximum.

Chord choices are prepared in the background, favouring upcoming snapshots. If a choice is not ready, or a formation exceeds the search limits, ordinary nearest-note Snap keeps playback on time. A late result does not change an arpeggio midway; it can be used on the next trigger. Explicit fader changes retune the sounding formation live within the search limits.

A manually triggered SNAPSHOT keeps sounding when you switch to `HEXATONE`, `SOUNDS` and `MIDI`, `CALCULATOR` or `MANUAL`, with the active snapshot highlighted in the floating palette. You can stop it there. CUES or timed playback of notes are only active in `SEQUENCER` and `SOUNDS` and `MIDI` tabs, where transport controls are provided.

`Sequencer Timbre Control` is enabled by default and allows the selected timbre controller to shape recorded sequence timbre while playing. The scsynth `Brightness` fader can also shape sequence timbre through this option. For Lumatone this follows the enabled `Mod Wheel` and/or `Foot Controller` timbre assignments, including soft pickup when both are selected. Disable it to retain the recorded sequence timbre unchanged.

The control shapes rather than replaces the saved values: 0 moves timbre to its minimum, 64 leaves the saved values unchanged, and 127 moves it to its maximum. Other controllers use the existing CC1 modulation-wheel path. This option affects playback expression, not the stored sequence data.

### Transport

- `PLAY FROM`
  - transport row for selecting a starting point by `BAR`, `SNAPSHOT`, and `CUE`; choosing by bar or cue lines up a cue, choosing by snapshot lines up a snapshot, and the next event up for playback is gently highlighted
  - choosing a destination queues it in brackets until stepped with the arrows or playback controls
  - controls to play/retrigger/stop each snapshot or cue; a highlight indicates which type of event will be triggered
  - only a snapshot played manually observes arpeggiation; cues and timed playback do not

- `TIMED PLAYBACK`
  - transport row with clock and bar/beat readouts
  - start, play/pause, stop, and end controls trigger an automated playback of cues including tempo changes and enabled repeats
  - live `SPEED` scaling from 0.5×–2× and displayed effective tempo
  - live `PITCH` transposition up to ±1200 cents
  - Auto-Scroll keeps the event list aligned with playback
  - arpeggiation is NOT applied in this mode

### Event Row Editing

Use the left and right arrows to move between pages of parameters. Current event fields are:

- `Snap`
- `Offset`
- `MIDI¢`
- `Hz`
- `HEJI`
- `Bar`
- `Beat`
- `Num`
- `Den`
- `on-vel`
- `off-vel`
- `pressure`
- `timbre`

`Snap` changes which snapshot an event belongs to. `Offset` is the event’s relative position within that snapshot. `Bar / Beat / Num / Den` are an alternate bar-relative position that automatically recalculate the event’s global position value.

The `HEJI` field is a parsable HEJI spelling field, alongside `MIDI¢` or `Hz`, using the Reference and Anchor data to determine the frequency of new notes.

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
- fraction of a whole note used as “beat” unit for tempo (i.e., tempo measured in dotted quarter notes = 3 eighth notes: specify a beat unit 3/8)
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

Repeat markers participate directly in cue playback. When cue stepping crosses an end-repeat boundary, Hexatone jumps back to the associated start-repeat position and restarts the cue range as many times as the repeat count requires. Any carried note-offs that need to occur before the repeat bounce are preserved by the event-ordering rules. Users can bypass repeat playback with the `Play Repeats` setting.

## SOUNDS and MIDI tabs

`SOUNDS` contains User Sounds and four built-in engines, which can be used independently or layered. `MIDI` contains MIDI Setup, MIDI Input, and MIDI Output. Switching between these tabs keeps live and sequenced playback running. A loaded sequence shares the same transport controls as the `SEQUENCER` tab.

After clicking the canvas, you can keep playing the computer keyboard while moving faders or using other non-typing controls in SOUNDS, MIDI, and Scale Settings. Focusing a typing field suspends keyboard playing and releases sustained notes; click the canvas to resume.

### User Sounds

Choose **Default**, **Reed Organ**, **Hammond**, **Baroque Organ**, **Harpsichord**, or **Test Tone**, or recall one of your saved sounds. Each sound remembers the four engines' enabled states, instruments, levels, envelopes, and expression settings. Toggling an engine off and on keeps its current working settings.

- **Save** updates the selected user sound; **Save as copy** creates a new entry. Built-in sounds can only be saved as copies.
- An **asterisk** after the sound name marks unsaved edits. **⟳** restores the selected sound's saved settings.
- **Open File(s)** imports sound JSON; **Export .json** saves the current named sound.

SoundFont files are stored separately. Recall uses an available browser copy or asks you to provide the bank. Baroque Organ prefers the full Organ bank on desktop and the smaller Principal bank on phones and tablets. Sound recall does not change tuning or MIDI connections.

`Restore SOUND settings on reload` and `Restore MIDI settings on reload` work independently. Turning either off resets its active setup on the next reload, while keeping saved sounds, SoundFonts, and controller profiles. MIDI permissions must still be granted and the selected ports must be available.

### Built-in DSF Synthesis

Enable `Use Oscillator` for a polyphonic additive sound. The fieldset arrow reveals the envelope and velocity controls.

- **Volume** sets the level. **ISO-226 compensation** adjusts loudness across registers; 0% is off.
- **Partials** sets the number of harmonics. **Timbre** moves from a sine wave toward a brighter spectrum.
- **Volume Envelope** enables attack, decay, sustain, and release (ADSR). Sustain can reach 200%; turning the envelope off keeps its saved settings.
- **Timbre ADSR** shapes brightness independently. Peak and sustain offsets are relative to the main Timbre value: negative values darken the sound and positive values brighten it.
- **Velocity → Volume**, **Velocity → Timbre**, **Velocity → Attack**, and **Release Velocity → Release** set how playing dynamics affect the sound.
- **Pressure (Z)** adds level and brightness; **Expression (Y/Mod/Foot)** changes timbre. Set an amount to 0% to disable that response.

Times are in milliseconds. Hold Shift while dragging an envelope-time fader for finer adjustment.

### Built-in Samples

Enable the sample engine, choose an `Instrument`, and set its `Volume`. The library includes simple harmonic timbres and sampled instruments for testing and sketching. When changing instruments, held notes keep their original sound and new attacks use the replacement once it has loaded.

### Built-in SoundFont Player

Enable `Use FluidSynth Sounds`, choose a bank from `Hexatone SoundFonts`, then select its `Preset`. An available browser copy loads automatically; otherwise click `Load Hexatone SoundFont` or use `Choose Local File` for a `.sf2` / `.sf3` file. Downloads can be cancelled.

**Volume** and **Reverb** set the mix. The fieldset arrow reveals **Pressure Smoothing**, **Expression Y Smoothing**, and **Minimum Smoothing**. Smoothing softens supported pressure/timbre loudness changes; 0 ms is off. Minimum Smoothing sets a lower time limit for small changes. The SoundFont determines how expression affects its sound.

Recently used banks are cached for faster switching. Larger banks may take longer to load, especially on phones. Selecting a preset affects new attacks; held notes keep their sound. A bank that needs loading while notes are sounding waits for a new attack or silence and may briefly delay that attack.

- **Save SoundFont File…** saves the original file to your device.
- **Keep for Offline Use** retains a browser copy.
- **Remove Offline Copy** removes that retained copy without stopping playback. The current page can still reuse its temporary working copy.

A local file matching a supplied bank's filename can be reused through that bank's menu entry. Choose the file again to pick up later edits. Browser copies can be lost when site data is cleared or a private session ends; saving a file to your device is separate from browser storage.

### Built-in scsynth

Enable `Use SuperCollider Sounds` and select **SuperSonic** under `scsynth Server` to run **Pluck**, **Buzz**, **Formant**, and **Saw** in the browser. Each layer has its own level; 0 turns that layer off. **Brightness** also responds to the assigned wheel or pedal.

The fieldset toggle reveals **Release Envelope**, **Release Time**, and **Apply release envelope to Rastered Glissando only**. These shorten or blend the release of Pluck, Buzz, and Formant. Uncheck the raster-only option to apply them to ordinary played notes. **Retrigger Buzz + Formant** creates repeating swells while notes are held.

### OSC

For an external SuperCollider server, select **Local via OSC Bridge** under `scsynth Server`. This requires a local copy of Hexatone, the matching SuperCollider patch, and a running bridge:

```sh
yarn osc-bridge
```

Set `Bridge URL` and paste the token printed by the bridge into `Bridge pairing token`, then leave the field to connect. The token lasts for the current tab session; restarting the bridge generates a new one. To run Hexatone locally as well, use `yarn start` in another terminal. `yarn build-bridge` builds a standalone bridge app.

See the [Developer Quickstart](./DEVELOPER_QUICKSTART.md) for local setup and [the supplied SynthDefs](./Synths/SuperCollider-OSC/LumatoneSynths.scd) for custom SuperCollider controls.

### Audio recovery

If audio needs activation or recovery, use **Retry** in the audio popup. **Report** saves diagnostics, and **Dismiss** hides the popup. Audio Diagnostics also offers **Suspend & Resume Audio**, **Restart FluidSynth worklet**, and **Recreate audio contexts** for troubleshooting.

### MIDI Setup

WebMIDI is optional; allowing SysEx functionality is an additional option. WebMIDI adds:

- external MIDI input
- controller auto-detection and geometry support, with manual override
- LED colour support on supported devices
- MTS and MPE output

Without SysEx, MTS MIDI Tuning and bidirectional communication with Lumatone and Exquis are disabled, but controller input and MPE remain functional.

If you do not wish to enable WebMIDI, Hexatone still works as an on-screen instrument and scale workspace.

### MIDI Input

The fieldset starts collapsed on a fresh load. Its toggle hides detailed settings while keeping `Input Port`, `Controller Geometry`, the geometry information, `Input Mode`, and the applicable anchor and sequential-mode controls visible.

`HEXATONE`

- responds to standard keyboard input on all channels
- handles MPE per-note expression data: pitch bend (X), channel pressure (Z), CC74 timbre (Y)
- knows about isomorphic and 2D controller geometries, single- or multi-channel layouts
- recognises controllers automatically, but allows manual controller geometry selection and override (sequential / bypass behaviour)
- has two input modes: `MIDI to Hex Layout` (consecutive MIDI notes trigger successive degrees of a microtonal scale); `MIDI to Nearest Scale Degree` (incoming notes + MPE X data are mapped to nearest notes of the scale, rather than triggering the scale note-by-note)
- `MIDI to Nearest Scale Degree` always accepts the nearest note, regardless of its distance from the incoming pitch
- `Input Mode` persists per detected/selected controller; 2D controllers default to `MIDI to Hex Layout`; Haken Continuum (1D pitch glissando) defaults to `MIDI to Nearest Scale Degree`

### Controllers

The app includes support for several recognised controller types, including devices such as:

- AXIS-49
- Haken Continuum
- Exquis
- LinnStrument
- Lumatone
- Tonal Plexus
- standard keyboards

The exact supported behaviour varies by controller, but the input system is designed to preserve each device’s geometry where musically useful for playing microtonal scales. MPE polyphony is preserved and used when chosen by the user (on appropriate outputs).

For non-MPE input with `Pitch Wheel → Most Recent`, `Pitch Wheel Handoff Portamento` glides the bend back to an older held note when the newest note is released. It is enabled by default at 60 ms; `Portamento Time` ranges from 0–500 ms. The glide uses a power ease-in (exponent 2.5) in cents, starting slowly and accelerating toward the target. Wheel movement during a handoff updates its destination without extending its time or restarting the slow beginning. New attacks and wheel movements outside the handoff remain immediate. This does not affect MPE per-note expression.

`Bypass Bend`, where pitch bend is available, keeps tracking incoming bend without applying it. Switching it on glides back to the unbent pitch; switching it off glides to the current bend.

Lumatone has two modes: the default is 2D-geometry-aware and uses a custom key layout that matches the numbering of keys in a standard Lumatone (`.ltn`) file. Notes 0–55 are ordered from left to right and top to bottom, repeated five times to form five blocks, each on a separate MIDI channel (1–5). This fixed key layout allows Hexatone to compute the exact physical key being played from incoming MIDI data, map it to the on-screen canvas, and adapt to changing tunings, modulations, etc. Key colours are sent to Lumatone based on the user’s chosen `Anchor Note`, so Lumatone always remains aligned with the on-screen layout. There is an option to filter which scale degrees are coloured, a useful way of learning the layout when there are many different notes. The `Lumatone Colour Filter` can store, order, import, and export named collections of scale degrees. `Auto-Generate from Snapshots` adds filters derived from the notes present in captured snapshots.

The Lumatone input options also offer `Mod Wheel → Timbre` (CC1, enabled by default) and `Foot Controller → Timbre` (CC4, disabled by default). Either can drive the existing mod-wheel timbre mapping for the active outputs. With both enabled, soft pickup prevents abrupt changes: the inactive control takes over when it reaches or crosses the current value. Lumatone foot-controller values are calibrated before pickup: 18 and below becomes 0, 125 and above becomes 127, with linear scaling between these endpoints. An unassigned foot controller retains CC4 forwarding with this calibration; disabling wheel-to-timbre suppresses its CC1 timbre route.

Enabling automatic sending in 2D mode sends the fixed note/channel layout and colours together. This also happens when a saved automatic-send setting meets a newly selected or detected Lumatone, and when returning from 2D bypass. Later colour changes follow automatically. In 2D bypass, sending the layout remains manual.

`LED Brightness` and `LED Saturation` adjust the Lumatone colours from 0–200%, with the original colours at the centre, 100%. Brightness at 0% turns the LEDs off; saturation at 0% makes them grey. The adjustments are saved and apply after colour matching, without changing the screen palette. Moving a fader updates the last layout sent by Hexatone, including a manually sent bypass layout. Firmware 1.5.0 or newer uses bulk colour updates; older firmware uses individual key updates.

Newly activated outputs receive the last received, selected timbre value before held notes join them; another wheel or pedal movement is not needed. This uses the existing output-specific mapping, including the optional `Eagan Brightness / Tilt EQ` mapping. Hexatone cannot know a physical controller position that the device has not yet sent.

Alternatively, some users may prefer to generate a “traditional” multichannel Lumatone layout usable outside of Hexatone, where MIDI notes and channels represent scale degrees and equave transpositions. Based on the current 2D geometry, Hexatone calculates a static mapping that is made available when `2D Geometry` is bypassed. The central channel for untransposed playback (default = ch 4) may be chosen and the layout may be sent to Lumatone and edited further in the Lumatone Editor app. In 2D bypass, Hexatone will work with traditional Lumatone layouts, either single or multi-channel, but it is not possible to determine exactly which physical Lumatone key is being pressed, so automatic colour and screen position correlation is not available.

LinnStrument User Firmware mode also includes `Row Glide Shaping`, `X Spike Reduction`, and `X Input Smoothing` to stabilise expressive pitch input under light pressure.

Exquis needs to be updated to firmware 3.0.0 or higher, which allows Hexatone to send LED colours and set up the MPE mode for landscape format playing using `App Mode`. If Exquis is not working as expected, check the browser console: if a firmware update is needed, the information will be there.

`Hexatone Layout Override` in the Exquis MIDI Input settings enables separate `Right-Facing Steps` and `Right-Downward Steps`, defaulting to 5 and 6. They override the current built-in or user tuning’s layout while Exquis is the selected controller geometry, including the canvas and key colours. Switching the override off restores the current tuning’s Exquis-specific steps, if supplied, or its ordinary steps; the override values are retained for reuse. Tuning JSON may specify `exquis_rsteps`, `exquis_drsteps` and `exquis_anchor_note`. The Exquis layout applies automatically when loading that tuning with Exquis selected, or when selecting Exquis later. Other controllers use the ordinary tuning layout. The manual override takes precedence over either preset layout. Saving a user tuning while Exquis is active captures the currently visible steps and anchor as `exquis_rsteps`, `exquis_drsteps` and `exquis_anchor_note`, including steps set with the override. The override switch and its preferences are not part of the tuning. The HEXATONE layout fields display and edit the active steps, matching the canvas; edits to an Exquis-specific layout leave the ordinary layout unchanged. Layout edits wait for held Exquis keys to be released.

In Exquis App Mode:

- octave buttons shift by one equave; white marks the centre, with yellow-to-red shades below and green-to-violet above, and a brighter flash on press
- the toggle button with a single dot controls `Bypass Bend` (CC32): green means bend on, red means bypassed
- the button with round arrows is a momentary sustain (CC33 by default)
- the four-circle button reassigns the anchor to the last played key; held sounds continue without rearticulation

Button assignments and lighting are restored when App Mode resumes after losing browser focus.

`Enable MPE Input` changes expression processing without changing `Input Mode`. With MPE off, Exquis pitch bend is ignored and its pitch-bend controls are hidden. The arpeggiator is shown only for MPE input in 2D layout mode; it is hidden in nearest-scale-degree and sequential bypass modes. Patterns are `Order` (default), `Up`, `Down`, `Convergent`, `Divergent`, and `Note Repeat`.

Haken `Continuum X Glide` offers two modes: `Rastered Attack + Pitch Bend` and `Rastered Notes`, along with controls for `X Glide Shaping` (applied to `Rastered Attack + Pitch Bend`) and `Pressure → Velocity`, `Minimum Note Duration`, `Minimum Retrigger Interval`, and `Raster Stability` (applied to `Rastered Notes`). The two modes can be toggled momentarily using a CC pedal (default controller number is 67). The MIDI Input MPE Pitch Bend Range is the master incoming scaling setting; Continuum defaults to 96 semitones and honors explicit edits, including 0 for no incoming pitch bend. Incoming MPE data is expected in MPE+ format (normally Pitch Bend Range 96, with CC87 providing a one-shot high-resolution LSB for incoming Pitch Bend, CC74, and Channel Pressure X/Y/Z data). `Continuum Raster Filter` lets the user store and order named collections of scale degrees. The selected filter constrains attacks and subsequent retriggers in `Rastered Notes`. `Apply Raster in Pitch Bending Mode` optionally applies it to attacks in `Rastered Attack + Pitch Bend`. Independently, `Shape X Glide to Raster` uses the filtered degrees rather than every scale degree as the stability centres for continuous X Glide Shaping. Collections may be imported or exported together as a .json file, while `Auto-Generate from Snapshots` adds filters derived from captured snapshots. Optional MPE+ pitch-bend output adds high-resolution CC87 data; it may be disabled when older MIDI connections cannot sustain the additional message density.

### Input Modes

Continuum `Minimum Note Duration` extends to 200 ms, allowing more overlap with slow sounds.

`Raster Attack Suppression` gives each new Continuum touch a short period of
`Rastered Attack + Pitch Bend` before entering `Rastered Notes`. The default is
80 ms; 0 is displayed as `off`. The initial attack remains immediate, X Glide
Shaping applies during suppression, and pressure/timbre continue normally.
Afterwards, the usual mode-switch handoff avoids a forced pitch jump; generated
raster notes do not restart the interval. Physical release always ends the touch.

Hexatone can treat MIDI input broadly in two ways:

- as geometry on the hex layout
- as nearest scale degree input

The first treats the controller as a performance surface with position meaning.
The second treats incoming pitch as musical material to be mapped into the current scale.

### MIDI Output

This fieldset starts closed, hiding descriptions while keeping its four output on/off rows visible. Enabled Monophonic output also shows Port, Ch, PB Range, and the Portamento toggle; MTS Real-Time and Bulk retain all their fields. MPE hides its MPE+ and pitch-bend configuration until expanded. Monophonic and MPE switches are disabled until MIDI is enabled; MTS also requires SysEx access.

Enabling an output opens the fieldset to reveal its configuration. Disabling an output leaves the fieldset’s open/closed state unchanged.

The `MIDI Output` fieldset provides:

- `Monophonic Single-Channel MIDI`
- `MTS Real-Time Tuning` (MIDI Tuning Standard)
  - MTS is used in a special way to allow large scales and many octaves to be used effortlessly: rather than setting up a tuning map in advance, each note is immediately assigned a slot and retuned on the fly, allowing up to 128-note microtonal polyphony in any size scale across the entire MIDI range
  - by sending Hexatone MTS Output to MTS-ESP Mini Master, instruments that do not directly support the SysEx protocol can be retuned as well
- `MTS Bulk Dump Tuning Maps` for legacy synths (limited to 128 notes at a time)
- `MPE` (MIDI Polyphonic Expression)

Built-in sounds and OSC can be layered with these MIDI outputs.

MPE output offers two message styles:

- `Ableton compatible` uses unique MIDI notes with a 48-semitone pitch-bend range
- `MPE standard` uses nearest MIDI notes and a user-defined pitch-bend range

`MPE+ PB` adds CC87 low-bit messages for higher-resolution pitch bend on compatible instruments. CC74 carries per-note timbre and Channel Pressure carries per-note pressure. Warning: this setting can generate a dense MIDI stream and is only suitable for fast interfaces.

### Monophonic Single-Channel MIDI

In `I/O → MIDI Output`, this independent output sends the most recently played held note to its own `Port` and `Channel`. Releasing that note returns to the most recently held earlier note. Other enabled outputs retain their normal polyphony.

Set `PB Range (semitones)` to match the receiving instrument (default **2**). Hexatone sends the corresponding MIDI pitch-bend-range RPN, but instruments that ignore it must be configured manually. Use a separate port or channel from other outputs to avoid conflicting bends and note messages.

With `Portamento` enabled, overlapping notes retain the sounding carrier note whenever the next pitch fits its bend range. `Portamento Time` controls the transition of pitch, timbre (CC74), and channel pressure, including returns to earlier held notes; **0 / off** makes these transitions immediate. The default is **80 ms**. Non-overlapping attacks retrigger immediately. When a new carrier is necessary, Hexatone chooses one covering as many held pitches as possible, favouring recently played notes when not all fit.

`Map MPE ExpressionY (CC74) to` selects the outgoing controller by number and standard name (default `74 — Brightness`), including during portamento transitions. This affects only the monophonic output. Bank selection, RPN/NRPN, data entry, portamento note selection, velocity prefix and channel-mode commands are excluded. Previously saved excluded destinations fall back to CC74. Undefined and LSB controllers remain available for instrument-specific mappings; choose a controller supported by the receiving instrument.

Transitions use a worker-driven, timestamped MIDI scheduler rather than animation frames, so they do not depend on visible canvas animation. Browser suspension can still interrupt processing. The receiving instrument must support the selected expressionY CC and channel pressure to respond to those dimensions.

### Eagan Matrix

The Eagan Matrix is a programmable modular synthesis engine designed for XYZ control from instruments such as Osmose and Haken Continuum. A set of specialised controls for this synth appears within the MPE output settings:

- `Auto-Generate MPE YZ` generates per-voice timbre (Y/CC74) and pressure (Z/Channel Pressure) envelopes from attack velocity and subsequent polyphonic pressure. It applies to live input and stored sequences, including release shaping driven by note-off velocity.
- `Pedal/Wheel → Brightness + Tilt EQ` maps the selected timbre controller to `Brightness / Tilt EQ` and updates its displayed faders. For Lumatone it follows the enabled wheel and/or foot-controller timbre options, including soft pickup when both are enabled. Other controllers retain the modulation-wheel CC1 path.
- `Brightness` sends CC13.
- `Tilt EQ` sends CC83.
- `Pre Level` sends CC26.
- `Post Level` sends CC18.

The four faders use MIDI values from 0–127 and default to 64. Enabling `Auto-Generate MPE YZ` also sends their current values so the receiving Eagan Matrix begins from the displayed state.

The pedal/wheel option is independent of `Sequencer Timbre Control`: it controls the Eagan Matrix’s global `Brightness / Tilt EQ` parameters, whereas the sequencer option shapes the saved per-note timbre. Either or both may be enabled. Lumatone’s foot-controller calibration also applies to this global control path.

## CALCULATOR tab

The `CALCULATOR` tab obtains its initial values from the currently selected `HEXATONE` tuning. These values may subsequently be edited without affecting the active tuning.

Entering `CALCULATOR` stops cue and timed playback. Live keyboard and external-controller notes are not interrupted.

### Reference

Choose a `Reference Frequency` and its ratio or cents value from 1/1. For example, if a scale is based on C but you wish to specify A as the reference, define A as a ratio (such as 5/3 or 27/16) or as an arbitrary value in cents.

### HEJI Spelling

Choose a spelling to which a deviation of 0 cents will be assigned, and express this note as a ratio/cents value from 1/1 or as a ratio/cents value from Reference. For example, with a `Reference Frequency` of 10 Hz, you could spell the reference as *fE; this note would then have a deviation of 0 cents. In this system, 440 Hz would be partial 44°, written as A. The three frequency inputs (`Reference`, `1/1`, and `HEJI Spelling`) are interdependent and adjust together whenever one is changed.

### Input

There are two input options: enter a HEJI spelling and octave register using the palette, or specify an offset and pitch as a ratio or cents value. The HEJI palette allows prime-based accidentals to be incremented or decremented with repeated clicks. The octave position may be specified using the ISO standard (C4 = middle C). In the `Ratio/Cents` input, `Offset (from HEJI Notation Anchor)` defaults to 1/1, placing it at the chosen 0-cents note. `Pitch (from Offset)` specifies the interval from that offset. Changing `Offset` leaves `Pitch (from Offset)` unchanged and updates the calculated pitch. Choosing a spelling in the palette updates `Pitch (from Offset)` while preserving `Offset`.

### Rationalisation

Toggle the section to reveal the harmonic-space parameters for rationalisation (`symmetric`, `overtonal`, or `custom`). Traditionally, JI pitch sets have been constructed symmetrically (every ratio is taken upward and downward from 1/1) or overtonally (based on the harmonic series). `Custom` allows you to specify the number of steps in each prime dimension up to 47. The search space is restricted by prime limit, odd limit, cents tolerance, and a maximum number of results. Results are sorted according to the selected criterion: search ranking, cents deviation, harmonic radius, odd radius, prime limit, or odd limit.

`Nearby Rational Pitches` searches for alternatives to `Pitch (from Offset)`. Both `Harmonic radius from Offset` and `Odd radius from Offset` rank each candidate’s interval from Offset, rather than from the tuning’s global 1/1. Harmonic radius includes powers of 2; odd radius ignores them. Selecting a candidate puts its ratio into `Pitch (from Offset)` and leaves `Offset` unchanged. With `Normalise` selected, the search uses the octave-normalised interval from Offset.

### Data

Calculated values include the pitch ratio and cents from 1/1 and the reference, its frequency, and the nearest MIDI note. `Deviation` is measured in the tempered lattice defined by the HEJI notation anchor, so the anchor spelling itself always has a deviation of zero; this provides a tuning-meter indication independent of the absolute A440 offset. MIDI accidentals use the same Plainsound Sans tempered symbols as the palette’s 12edo row. `Include tempered accidentals in Deviation` combines the nearest pitch class with its deviation as one copyable string, repeating the deviation for both enharmonic spellings where applicable. The section also provides a list of `Nearby Rational Pitches`. Values may optionally be normalised within one octave. Clicking a nearby rational pitch makes it the new target and updates the calculated data.

## Developer Roadmap

Hexatone is currently working towards integrating custom control surfaces and context-aware live retuning.
For instructions on cloning and running Hexatone locally, testing, reporting issues, or contributing code, see:

- [DEVELOPER_QUICKSTART.md](./DEVELOPER_QUICKSTART.md)

The main commands are:

- `yarn install`
- `yarn start`
- `yarn test`
- `yarn build`
- `yarn osc-bridge`
- `yarn build-bridge`
