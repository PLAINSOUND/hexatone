# Exquis User Manual (v3.0.0)

*Transcribed from the official Intuitive Instruments user guide.*
*For technical issues: dualo.com/en/support*

---

## Introduction

This user manual describes the functionalities of the keyboard used without the Exquis
application, that is to say connected via USB, MIDI DIN or CV, to third-party software,
hardware synthesizer, or modular synthesizer.

The features currently available and presented here are subject to change.

---

## Essential to Know

You can use Exquis:
- in **MPE (MIDI Polyphonic Expression)** on multiple MIDI channels simultaneously, with
  synthesizers and software that are specifically compatible or that partially support it
- in **classic MIDI (Polyphonic aftertouch)** on a single MIDI channel, with any synthesizer
  and software

Configure Exquis accordingly from the Settings (2) menu.

If you use Exquis in MPE on a synthesizer that isn't officially compatible, it is probably able
to listen to all MIDI channels (often labeled "All" or "Omni"). Otherwise, use Exquis in
Polyphonic aftertouch mode on the same selected channel.

If using MIDI cables, communication types A and B are incompatible. Use the supplied adapters
or any MIDI TRS Type A adapter.

---

## Connectors

- **USB (USB-C)** — power supply and use with third-party software
- **MIDI IN / OUT (minijack)** — use with software or hardware synthesizers
- **CV 0–5V** — "GATE", "PITCH", "MOD" minijack connectors for modular synthesizers
- **Kensington Nano Security Slot™**

---

## Startup

The Exquis requires power via USB (5 V, 0.9 A max). It starts automatically once plugged in.

---

## Controls

From bottom to top:
- **10 backlit action push buttons**
- **1 continuous capacitive slider** divided into 6 zones with light feedback
- **61 backlit hex keys**, sensitive to:
  - Velocity: strike and lift force
  - Horizontal tilt (X): Pitch Bend
  - Vertical tilt (Y): CC#74
  - Pressure (Z): Channel Pressure or Polyphonic Aftertouch
- **4 clickable rotary encoders** with light feedback

### MIDI THRU

When received at MIDI IN, the following CCs are forwarded via USB and MIDI OUT:
- CC#64 — sustain pedal
- CC#11 — expression pedal
- CC#65 — portamento on/off
- CC#67 — soft pedal

---

## Keyboard Layout

By default, Exquis arranges consecutive notes (semitones) horizontally and harmonious notes
(thirds) vertically, from lowest at bottom to highest at top.

When plugged in, the keyboard displays the **C major scale** by default.

---

## Play Controls

| # | Control | Function |
|---|---------|----------|
| 1 | Settings (1) hold | Keyboard settings |
| 2 | Settings (2) hold | MIDI and layout settings |
| 3 | Button | MIDI CC#32 (click to activate) |
| 4 | Button | MIDI CC#33 (hold to activate) |
| 5 | Button | MIDI CC#34 (hold to activate) |
| 6 | Button | MIDI clock play (green) / stop (orange) |
| 7 | Octave buttons | Transpose keyboard ±1 octave (12 semitones) |
| 8 | Slider | Arpeggiator speed (4=quarter note, 8=eighth, 16=sixteenth…) |
| 9 | Encoder | MIDI CC#41 (click: CC#21) |
| 10 | Encoder | MIDI CC#42 (click: CC#22) |
| 11 | Encoder | MIDI CC#43 (click: CC#23) |
| 12 | Encoder | MIDI CC#44 / Freeze: click to freeze held notes |

**Freeze**: hold and modulate notes, then click the encoder to lock them. Add more notes,
or unfreeze by touching them again. Click with no notes held to disable all frozen notes.

---

## Settings (1) — Keyboard Settings

| # | Control | Function |
|---|---------|----------|
| 1 | Encoder | MIDI clock output: USB (red), DIN (blue), both (magenta), none (white) |
| 2 | Encoder | Transpose: shift keyboard ±1 semitone |
| 3 | Slider | Arpeggiator pattern (touch briefly to change; hold 1s for latch/toggle mode) |
| | | Order / Up / Down / Convergent / Divergent / Note repeat |
| 4 | Encoder | Internal tempo (default 120 BPM; follows received MIDI clock) |
| 5 | Encoder | **Tonic note**: central note of the piece (C, D, E…) |
| 6 | Encoder | **Scale**: modal subset for key highlighting |
| 7 | Encoder turn/click | Brightness (turn) / sensitivity threshold (click + turn), 1–99, default 50 |
| 8 | Encoder hold | Firmware version (X.X.X = major.minor.patch) |

### Built-in Scales (Settings 1, item 6)

| Index | Scale |
|-------|-------|
| 1 | Major |
| 2 | Natural Minor |
| 3 | Melodic Minor |
| 4 | Harmonic Minor |
| 5 | Dorian |
| 6 | Phrygian |
| 7 | Lydian |
| 8 | Mixolydian |
| 9 | Locrian |
| 10 | Phrygian dominant |
| 11 | Major Pentatonic |
| 12 | Minor Pentatonic |
| 13 | Whole Tone |
| 14 | Chromatic |

> **Note:** "Scale" here is a 12-EDO modal subset used for **key highlighting only**. It does
> not change which MIDI note numbers the pads send — those are determined by the Note Layout
> (Settings 2, item 3). This is distinct from Hexatone's concept of "scale" (an explicitly
> defined tuning in cents/ratios).

---

## Settings (2) — MIDI and Layout Settings

| # | Control | Function |
|---|---------|----------|
| 1 | Encoder | **MPE / Poly aftertouch** mode |
| 2 | Encoder | **Per-note pitchbend range** (MPE, in 48ths of max range; CV in semitones) |
| 3 | Encoder | **Note layout** |

### MPE Mode (Settings 2, item 1)

- **MPE (blue LED)**: per-key X/Y/Z on independent channels, one note per channel.
  - Channel 1: global messages
  - Channels 2–15: voice channels (rotate encoder to set count, 1–14; 14 recommended)
  - Channel 16: DAW communication (e.g. Ableton Live Remote Script)
- **Poly aftertouch (yellow LED)**: independent Z-axis per note on a single channel (1–16).

### Note Layouts (Settings 2, item 3)

| Index | Layout | MIDI Note Range |
|-------|--------|----------------|
| 1 | Exquis (default) | device-specific arrangement |
| 2 | Exquis with duplicates | scale duplicates enabled |
| 3 | Chromatic | chromatic arrangement |
| 4 | 4×4 for drums | notes 36–51 |
| 5 | General MIDI percussion | notes 35–81 |
| **6** | **Rainbow** | **notes 0–60** (one per pad, bottom-left to top-right) |

> **Hexatone integration**: Layout 6 (Rainbow) sends notes 0–60 in a fixed one-per-pad
> mapping that matches Hexatone's `buildExquisMap` geometry. **2D geometry mode in Hexatone
> requires Rainbow Layout to be active on the device.** Layout cannot be set remotely via
> SysEx — the user must select it manually.

---

## MIDI Score Display

The Exquis displays (in green) all notes received via MIDI IN or USB. Notes outside the
displayed range light the corresponding octave button. The display algorithm is optimized
for the Exquis note layout.

---

## Saving and Resetting

All settings are automatically saved when exiting the settings menu and kept when unplugged.

**Factory reset**: hold the 2nd rotary encoder clicked while plugging into a power source.
