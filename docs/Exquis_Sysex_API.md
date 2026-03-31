# Exquis Developer Mode — SysEx API Reference

*Transcribed from the official Dualo developer documentation.*
*For technical issues: dualo.com/en/support*

---

## Overview

Developer Mode allows direct communication with the Exquis via MIDI SysEx and channel
messages to control LEDs, receive input events, and replace its default behaviour. It is
zone-selective: you choose which physical zones to take over; the rest of the device
continues to function normally.

All SysEx messages share the same manufacturer header:

```
F0 00 21 7E 7F <id> [...] F7
```

- `F0 00 21 7E 7F` — Dualo manufacturer + device ID
- `id` (1 byte) — command identifier (see table below)
- All commands except `00` (Setup) require Developer Mode to already be active.

### Command summary

| ID (hex) | Command |
|----------|---------|
| 00 | Setup Developer Mode |
| 01 | Use custom scale list |
| 02 | Color palette |
| 03 | Refresh |
| 04 | Set LED color (direct RGB) |
| 05 | Tempo |
| 06 | Root note |
| 07 | Scale number |
| 08 | Custom scale (12-degree bitmask) |
| 09 | Snapshot |

---

## SysEx Commands

### 00 — Setup Developer Mode

Selects which physical zones are taken over. Taken-over zones stop processing input
normally and instead forward raw events to the host via USB-MIDI (ch 16). Exquis also
accepts LED control messages for taken-over zones.

**Zone bitmask:**

| Bit | Mask | Zone |
|-----|------|------|
| 0 | `01` | Pads |
| 1 | `02` | Encoders |
| 2 | `04` | Slider |
| 3 | `08` | Up/Down buttons |
| 4 | `10` | Settings/Sound buttons |
| 5 | `20` | All other buttons |

Combine by adding values (e.g. `2F` = everything except Settings/Sound buttons).

```
Enter (pads only):  F0 00 21 7E 7F 00 01 F7
Exit dev mode:      F0 00 21 7E 7F 00 00 F7
```

Request: `F0 00 21 7E 7F 00 mask F7`
Response: None

> **Hexatone usage:** Enter with mask `01` (pads only) on device connect; exit with
> `00` on disconnect/deconstruct. This gives LED control and raw pad events while
> leaving encoders, slider, and buttons working normally.

---

### 01 — Use Custom Scale List

Replaces the internal scale list shown in the Exquis Settings menu with a custom list
of `count` entries. When the user changes scale on the device, Exquis sends a **Scale
number (07h)** SysEx to notify the host, which can then respond with a **Custom scale
(08h)** message.

```
Set custom list (N scales): F0 00 21 7E 7F 01 count F7
Revert to internal list:    F0 00 21 7E 7F 01 F7      (count omitted)
```

Request: `F0 00 21 7E 7F 01 [count] F7`
Response: None

---

### 02 — Color Palette

The palette is used when setting LED colors via MIDI CC (ch 16). Colors are 7-bit RGB
(0–127 per channel).

```
Get full palette (128 colors):
  Request:  F0 00 21 7E 7F 02 F7
  Response: F0 00 21 7E 7F 02 r(0) g(0) b(0) ... r(127) g(127) b(127) F7

Get single color at index:
  Request:  F0 00 21 7E 7F 02 index F7
  Response: F0 00 21 7E 7F 02 index red green blue F7

Set colors starting at index:
  Request:  F0 00 21 7E 7F 02 start_index r(0) g(0) b(0) [... r(N) g(N) b(N)] F7
  Response: None
```

Each `color(n)` is 3 bytes: `red green blue` (each 0–127).

---

### 03 — Refresh

Requests a refresh of the LED display. Exquis sends this when entering or returning
from the Settings menu. The host should also send it after restoring its LED state.

```
Request:  F0 00 21 7E 7F 03 [settings_page] F7
Response: None
```

- `settings_page` (optional, sent by Exquis only): page number just left; `7F` when
  *entering* the settings menu.

> **Hexatone usage:** Listen for `03` from the device and resend all LED colors on
> receipt (same pattern as Lumatone LED sync on ACK).

---

### 04 — Set LED Color (Direct RGB)

Sets one or more consecutive LEDs to exact RGB colors, bypassing the palette. This is
the preferred method for full per-key color control from Hexatone.

```
Request:  F0 00 21 7E 7F 04 start_id r(0) g(0) b(0) fx(0) [...] F7
Response: None
```

- `start_id` (1 byte) — first LED ID (see [LED identifiers](#led-identifiers))
- Each `color(n)` is **4 bytes**: `red green blue fx`
  - `red`, `green`, `blue`: 0–127
  - `fx`: LED effect byte (see [LED effects](#led-effects))

To set all 61 pads in one message: `start_id = 0`, followed by 61 × 4 bytes.

> **Hexatone usage:** Send pad colors (IDs 0–60) mapped from Hexatone's `note_colors`
> array. Pad ID = note number in Rainbow Layout (Preset 6). Use `fx = 00` (no effect)
> for static colors, or `3F`/`7F` for pulsate on active notes.

---

### 05 — Tempo

Synchronize Exquis BPM with the host. Exquis sends this when the user changes tempo
in settings while Developer Mode is active.

Tempo is encoded as a 14-bit value split across 2 bytes:
- `tempo[0]`: most significant bit
- `tempo[1]`: seven least significant bits

Examples: 120 BPM = `00 78` · 200 BPM = `01 48`

```
Get: F0 00 21 7E 7F 05 F7
     → F0 00 21 7E 7F 05 tempo[0] tempo[1] F7

Set: F0 00 21 7E 7F 05 tempo[0] tempo[1] F7  (range: 20–240 BPM)
     Response: None
```

---

### 06 — Root Note

Synchronize the root note (0–11, C=0 … B=11). Exquis sends this when the user
changes the root note in settings while Developer Mode is active.

```
Get: F0 00 21 7E 7F 06 F7
     → F0 00 21 7E 7F 06 note F7

Set: F0 00 21 7E 7F 06 note F7
     Response: None
```

- `note` (1 byte): 0=C, 1=C♯, 2=D, … 11=B

> **Hexatone usage:** On connect, send the current `reference_degree` mapped to its
> chromatic pitch class. On scale/fundamental change, resend.

---

### 07 — Scale Number

Reports or sets which scale (by index) is selected on the device. Sent by Exquis when
the user changes scale in settings. Used together with **01** (custom scale list) and
**08** (custom scale degrees).

```
Get: F0 00 21 7E 7F 07 F7
     → F0 00 21 7E 7F 07 scale F7

Set: F0 00 21 7E 7F 07 scale F7
     Response: None
```

- `scale` (1 byte): scale index (0–127)

---

### 08 — Custom Scale (12-degree bitmask)

Sends a 12-entry bitmask to Exquis representing which chromatic degrees are active in
the current scale. Exquis uses this for its own key highlighting while Developer Mode
is active.

```
Get: F0 00 21 7E 7F 08 F7
     → F0 00 21 7E 7F 08 d(0) d(1) ... d(11) F7

Set: F0 00 21 7E 7F 08 d(0) d(1) ... d(11) F7
     Response: None
```

- `d(n)` (1 byte each): `01` if degree `n` is in the scale, `00` if not.
- Degree 0 = C, degree 1 = C♯, …, degree 11 = B.

> **Hexatone usage:** Derive from the current scale's chromatic footprint and send on
> connect and on every scale change. For microtonal scales that don't align to 12-EDO
> chromatic degrees, this is approximate — per-key LED color via **04** is the precise
> alternative.

---

### 09 — Snapshot

Save and restore the complete device state (layout + MIDI settings), as used by the
Ableton Live MIDI Remote Script.

```
Get: F0 00 21 7E 7F 09 F7
     → F0 00 21 7E 7F 09 <255 bytes> F7

Restore: F0 00 21 7E 7F 09 <255 bytes> F7
         Response: None
```

- `snapshot`: 255 bytes of opaque device state data.

> **Hexatone usage:** Optionally save/restore on session load to preserve device
> settings across Hexatone sessions.

---

## MIDI Channel Messages (ch 16)

Channel 16 (`BF` / `9F` / `AF`) is reserved for Developer Mode communication.

### LED control via CC (palette-indexed)

```
BF id palette_index    (CC ch 16)
```

Sets the color of control `id` to `palette_index` from the current palette.

For pads, a Note On/Off on ch 16 can also be used:
```
9F pad velocity    (Note On ch 16 — sets pad color from palette)
8F pad 00          (Note Off ch 16)
```

### LED effect

```
AF id fx    (Poly AT ch 16)
```

Sets the LED effect for control `id` (see [LED effects](#led-effects)).

### Input events (from Exquis, ch 16)

```
Pad pressed:   9F pad 7F     (Note On ch 16,  pad = 0–60)
Pad released:  8F pad 00     (Note Off ch 16, pad = 0–60)

Button:        BF button state    (CC ch 16, button = 100–109, state: 7F=pressed 00=released)
Encoder turn:  BF encoder delta   (CC ch 16, encoder = 110–113, delta − 64 = steps CW)
Slider touch:  BF 90 portion      (CC ch 16, portion = 0–5, or 127 if untouched)
```

### Highlighting notes (without Developer Mode)

Independently of Developer Mode, send Note On/Off messages on **ch 1** to highlight
pads by MIDI note number on the device's own display.

---

## Reference

### LED Identifiers

| IDs (decimal) | Description | Count |
|---------------|-------------|-------|
| 0–60 | Pads (0 = bottom-left, 60 = top-right) | 61 |
| 80–85 | Individual slider portions | 6 |
| 90 | Slider position (127 = untouched) | 1 |
| 100 | Settings button | 1 |
| 101 | Sound button | 1 |
| 102 | Record button | 1 |
| 103 | Loop button | 1 |
| 104 | Clips button | 1 |
| 105 | Play/Stop button | 1 |
| 106 | Down button | 1 |
| 107 | Up button | 1 |
| 108 | Undo button | 1 |
| 109 | Redo button | 1 |
| 110–113 | Encoders | 4 |
| 114–118 | Encoder push buttons | 4 |

### LED Effects

Specified as a single 7-bit byte in the `fx` field of command **04** or the poly-AT
message. Only one effect per LED.

| Value (hex) | Effect |
|-------------|--------|
| `00` | No effect (static color) |
| `3F` | Pulsate to black |
| `7F` | Pulsate to white |
| `3E` | Pulsate to red |
| `7E` | Pulsate to green |
| `00`–`3D` | Alpha channel (00 = fully opaque, 3D = fully transparent) |
| `40`–`7D` | Blend to white (40 = 0% white, 7D = 100% white) |

Pulsate effects are synchronized with the current tempo (command **05**).

---

## Hexatone Integration Notes

| Feature | Command | Notes |
|---------|---------|-------|
| Enter dev mode on connect | `00 01` | Pads only; exit with `00 00` on disconnect |
| Per-key colors | `04` | IDs 0–60 map directly to Rainbow Layout note numbers |
| Chromatic scale highlight | `08` | 12-byte bitmask; approximate for microtonal scales |
| Root note sync | `06` | Send chromatic pitch class of `reference_degree` |
| Refresh after settings | `03` | Listen for `03` from device, resend all LED state |
| Snapshot save/restore | `09` | Optional; preserves device state across sessions |

The LED color pipeline mirrors the Lumatone LED sync model already in Hexatone:
compute per-key colors from `note_colors` + `centsToColor`, send on connect and on
every color/scale change, resend on `03` (Refresh) from the device.

---

## Hexatone + Exquis: Integration Mode Design

*Written 2026-03-31. To be refined through testing.*

When Hexatone detects an Exquis, it should offer the user a choice of integration
mode. The right mode depends on whether the user wants to play the Exquis's own
built-in scales (with the device handling its own display) or hand full control to
Hexatone (which then drives LEDs, scale, and tuning).

---

### Mode A — Hexatone Full Control (Developer Mode, pads only)

**What it does:**
Hexatone enters Developer Mode (mask `01`, pads only). The Exquis pads send raw
Note On/Off on **ch 16** (`9F pad 7F` / `8F pad 00`, pad IDs 0–60) instead of MPE
voice-channel events. Hexatone sends per-key colors via command `04`, syncs the
root note via `06`, and sends a chromatic scale hint via `08`. LED state is refreshed
on every color/scale change and on receipt of a `03` (Refresh) from the device.

**What the Exquis displays:**
Hexatone's `note_colors` mapped to pads, updated live. The device's own scale
selection is bypassed.

**Note input routing — open question:**
In dev mode, pad presses arrive on ch 16, not on MPE voice channels 2–15. It is
currently unknown whether MPE note-ons on channels 2–15 *also* fire alongside the
ch 16 events, or whether ch 16 replaces them entirely. This needs to be tested:

- **If MPE events still fire on ch 2–15:** we can ignore ch 16 pad events for note
  triggering and use the existing MPE input path unchanged. Ch 16 pad events are
  only needed to know which pad to highlight (already covered by MPE note-on).
- **If ch 16 replaces MPE events:** we need a new input branch in `midinoteOn` that
  handles ch 16 note-on, triggers the hex via `buildExquisMap` lookup (pad ID =
  note number, same as Rainbow Layout), and correlates with subsequent MPE
  expression events on ch 2–15 by timing. This correlation is undocumented.

**Pitch bend in dev mode:**
MPE pitch bend on voice channels 2–15 should still work regardless — it is
independent of the pad input routing. The existing MPE input path (`activeMidiByChannel`)
handles this correctly already.

**Use this mode when:**
- User wants Hexatone to control the Exquis display (colors, scale layout)
- User is playing a Hexatone scale (EDO or JI), not the Exquis's own built-in scales
- User wants live color feedback matching the Hexatone canvas

**Implementation status:** Not yet built. Requires:
1. SysEx send helper (`F0 00 21 7E 7F ...`) — straightforward
2. Enter/exit dev mode on connect/disconnect
3. Color sync (mirror of `lumatone-leds.js`)
4. `03` Refresh listener
5. Testing ch 16 ↔ MPE voice channel correlation

---

### Mode B1 — Device-Native Display, Geometry Input (No Dev Mode)

**What it does:**
No Developer Mode. The Exquis handles its own display using its internal scale
selection. Hexatone syncs the root note (`06`) and an approximate chromatic scale
bitmask (`08`) so the device's own highlighting is roughly correct. Note input uses
the existing MPE path: pad positions are resolved via `buildExquisMap` (Rainbow
Layout, notes 0–60), and per-voice pitch bend, pressure, and CC74 are routed by
`activeMidiByChannel`.

The Exquis should be set to **12-EDO** (its default) so that the MPE pitch bend
center is always 0 (no pre-bend from the device's own tuning). Hexatone ignores
the device's pitch and uses hex-grid position only.

**What the Exquis displays:**
Its own built-in scale colors, updated to reflect the root note and scale bitmask
Hexatone sends. Approximate for microtonal scales — the 12-degree bitmask cannot
represent arbitrary cent values.

**Use this mode when:**
- User wants a quick start without configuring anything
- Scale is close enough to 12-EDO that the bitmask is meaningful
- User prefers the Exquis's own visual style

**Implementation status:** Mostly working today. Missing:
- Root note sync (`06`) on connect + scale change — not yet sent
- Scale bitmask (`08`) on connect + scale change — not yet sent
- UI to prompt the user to set the Exquis to 12-EDO / Rainbow Layout

---

### Mode B2 — Device-Native Display, Scale Target Input (No Dev Mode)

**What it does:**
Same as B1 for display. For input, instead of resolving notes by pad geometry,
incoming MIDI note pitches are matched to the nearest Hexatone scale degree within
a configurable tolerance (Step 3.6 — `findNearestDegree` in `scale-mapper.js`).

This means:
- The Exquis can be in *any* of its built-in scales (not necessarily 12-EDO or
  Rainbow Layout)
- Each incoming note's 12-EDO pitch is compared to the current Hexatone scale
  degrees; the nearest match within tolerance triggers that hex
- MPE pitch bend then applies microtonal expression on top of the matched degree
- The user can change scales on the Exquis, and Hexatone responds to the new
  scale via the `07` (Scale number) event — though mapping between the Exquis's
  internal scale indices and Hexatone presets requires a lookup table

**Use this mode when:**
- User wants to play the Exquis's own scales and have Hexatone map them
- User is exploring scales interactively on the device
- Microtonality is expressed entirely through MPE pitch bend, not grid geometry

**Implementation status:** Not yet built. Requires Step 3.6 (`scale-mapper.js`).

---

### Recommended on-connect flow

When Hexatone detects an Exquis:

1. **Send root note** (`06`) and **scale bitmask** (`08`) immediately — free, no
   mode selection needed, improves display in any mode.
2. **Offer mode choice** in the MIDI input panel (collapsible, under the Exquis
   anchor section):
   - ◉ Geometry input, Hexatone colors (Mode A) — *requires dev mode*
   - ○ Geometry input, device display (Mode B1) — *default, works now*
   - ○ Scale-target input, device display (Mode B2) — *requires Step 3.6*
3. **If Mode A selected:** enter dev mode (`00 01`), start color sync.
4. **On disconnect or deconstruct:** exit dev mode (`00 00`) if active.

---

### Key unknowns requiring hardware testing

1. **Ch 16 vs MPE in dev mode:** do MPE note-ons on ch 2–15 still fire when pads
   are taken over by dev mode? Answer determines Mode A input routing complexity.
2. **Pitch bend direction:** does the Exquis send positive bend = up in pitch on
   all layouts? (Currently investigating — `midiin_mpe_bend_flip` option planned.)
3. **Dev mode persistence:** does dev mode survive a USB reconnect, or must it be
   re-entered every time the device is detected?
4. **Ch 16 Note On for LED:** the doc says Note On/Off on ch 16 can set pad colors
   from the palette — does this conflict with the pad input events also using ch 16
   Note On? (They use velocity `7F` for input; presumably palette index ≠ `7F` is
   safe for LED control.)
