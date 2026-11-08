# Lumatone firmware 1.5.0 and SysEx review

Reviewed 2026-11-08. Documentation and archive inspection only; no firmware was installed and no hardware commands were sent. Application code is unchanged.

Implementation follow-up (2026-11-08): Hexatone now queries 31h automatically for each resolved Lumatone input/output connection and shows the version beside the controller and output-port name. A verified main-controller revision >= 1.5.0 enables 55h. Complete known colour states become all-key frames (or complete single-board frames when the rest is unknown); incomplete boards retain 01h. Aftertouch and note assignments are completed before bulk colours. Matching ACKs pace updates; BUSY is retried after 40 ms, at most eight retries. Rejected bulk commands, exhausted BUSY retries, or two unanswered attempts switch that connection to per-key colours. Sleep recovery replays current colours or unfinished layout assignments. These paths have automated tests; hardware brightness, timing and preset-light behaviour still require verification. The original review below describes the findings and proposal at research time.

Sources:

- [Official SysEx reference](https://www.lumatone.io/support/sysex), supplied with a newsletter tracking parameter which was omitted for retrieval.
- [Reference data script](https://www.lumatone.io/s/lumatone-sysex-v8.js): declares firmware 1.5.0 and 86 commands, 00h–55h.
- [Software downloads and release notes](https://www.lumatone.io/support/software).
- [Firmware ZIP](https://www.lumatone.io/s/Lumatone-v150.zip), containing `Lumatone-v1.5.0.tgz`.
- Local `Lumatone-v1.4.0.tgz`, `TerpstraMidiDriver.h`, and historical command notes.

The release notes describe changes **since 1.3**, not exclusively changes since 1.4.0. The command reference separately identifies 52h as introduced in 1.4.3 and 53h–55h in 1.5.0.

## Main findings

The most useful addition for Hexatone is **55h: Set Colours**. One acknowledged transfer can update all 280 keys instead of our current 280 individual colour messages. It does not configure notes or channels, so the initial Blank Layout / Colours + Keys transfer still needs 00h assignments and the existing aftertouch preamble.

Firmware version can be queried without changing device settings. Our existing `LumatoneLEDs.probeConnection()` already performs serial identity 23h followed by firmware query 31h. It returns raw firmware response bytes; it does not yet retain a parsed version or select a bulk-colour transport.

There is **no documented new pressure sampling-rate control**. Faster colour transfers and octave communication must not be interpreted as a verified increase in aftertouch update frequency.

## New commands and message formats

All bytes below are hexadecimal. Manufacturer prefix: `F0 00 21 50`. Board 00 is the main controller; boards 01–05 are the octave boards. MIDI channels in payloads are zero-based.

### 31h: firmware query (existing command)

Request main-controller revision:

```text
F0 00 21 50 00 31 00 00 00 00 F7
```

Successful response:

```text
F0 00 21 50 00 31 01 major minor revision F7
```

The main controller stores individual board revisions; queries can target 00–05. A board that has not initialised is reported as 0.0.0. Use the main-controller revision to gate the new command, and optionally collect board revisions for diagnostics. Validate the exact framing, board, command, ACK and three version bytes; compare numeric tuples rather than version strings. An unknown, malformed or timed-out revision should retain the legacy colour path.

### 52h: confirm calibration — added 1.4.3

```text
F0 00 21 50 board 52 action 00 00 00 F7
```

Board 00 targets all boards; 01–05 targets one. Action 01 saves and 00 cancels key or aftertouch calibration. This is the only command accepted during those calibration states. ACK means forwarded to the board(s), not that every board has completed its exit. All boards must exit before normal operation resumes. NACK means no calibration is running; ERROR means invalid board/action. Older firmware responds 04h during calibration.

### 53h: set Program Change — added 1.5.0

```text
F0 00 21 50 00 53 flags channel 00 00 F7
```

Flags: 00 off, 01 send, 02 receive, 03 both. Channel: 00–0F. This setting is persisted on the keyboard. Both directions default off. Physical presets 1–10 correspond to wire program numbers 00–09. Received Program Changes select presets without being echoed back.

Do not enable this implicitly with automatic colour sending. Program Change reception can restore a device preset, replacing Hexatone's current layout/colours; transmitting Program Change may also affect connected synthesizers according to their routing.

### 54h: get Program Change — added 1.5.0

```text
request: F0 00 21 50 00 54 00 00 00 00 F7
reply:   F0 00 21 50 00 54 status flags channel F7
```

### 55h: bulk colours — added 1.5.0

```text
F0 00 21 50 board 55 RGB-data F7
reply: F0 00 21 50 board 55 status F7
```

| Target | RGB payload | Complete message length |
|---|---:|---:|
| One board, 01–05 | 56 × 3 = 168 bytes | 175 bytes |
| All boards, 00 | 280 × 3 = 840 bytes | 847 bytes |

Order is R, G, B for key 0, then key 1 through 55; for board 00, board 1 comes first, then 2–5. Each colour component is a single 7-bit value 00–7F, unlike 01h's two nibbles per component. The reference equates full brightness 7F with FE in the legacy command and says the physical LEDs provide about 50 brightness levels per colour. A proposed conversion from our 8-bit RGB is `round(component * 127 / 255)`; confirm the brightness match on hardware.

ACK 01 arrives **after all targeted boards show the frame**, approximately 20 ms for all 280 keys. Until then, every other SysEx command, including another 55h, receives BUSY 02 and is ignored. ERROR 03 indicates invalid board or message length. The command reference describes up to about 50 updates/s; the downloads page says over 50/s. Treat both as approximate claims and pace against actual ACKs rather than a fixed 50 Hz timer.

These colours are temporary and preset-button lights are extinguished while displayed. Selecting a preset, including pressing the previously selected preset button again or receiving an enabled Program Change, restores preset colours. The documentation also says the colours remain until a preset is selected or saved; do not assume 55h edits persistent preset data.

## Proposed Hexatone integration

1. Query 31h on connection while the SysEx queue is idle, using the existing handshake; store a validated version per active device connection. Clear it on disconnect/device replacement. Probe scheduling must exclude normal queued sends throughout the handshake, not only at its start.
2. Enable 55h only for a verified main revision >= 1.5.0. Keep 01h for older and unknown devices.
3. Retain a complete 280-key colour state. Coalesce changes while a frame is in flight and send the latest state after ACK; a one-board transfer can also serve partial updates.
4. Serialise 55h, 00h layout assignments, 0Eh aftertouch and all other queries through one arbiter. The current queue recognises successful ACKs but does not explicitly handle BUSY as a retry condition. A BUSY must retain the intended transfer and retry with bounded backoff, without marking it delivered or losing newer colours.
5. Preserve initial-layout and wake/resume ownership: finish required key assignments and aftertouch setup, then publish the newest colour frame. Never let a colour-only request discard pending assignments.
6. On unsupported-command rejection, retain the desired colours and fall back to legacy sends. A transient BUSY alone must not permanently downgrade capability. Bound timeout retries and expose failures.
7. Test version parsing, old/unknown fallback, both payload sizes and ordering, RGB endpoints, matching ACKs, BUSY/retry/coalescing, disconnect and wake, and preserved layout preambles. Verify actual latency, brightness, MIDI responsiveness and preset-button behaviour on hardware before making this default.

This is a proposed implementation, not an already-enabled feature.

## Other published firmware changes

- Faster octave-board communication, reducing preset/layout loading time.
- Key sensor diagnostic colours in calibration: blue at release, through cyan/green/yellow to red; magenta/white at sensor-range extremes. Enter calibration by holding both preset buttons on a board while powering up, then hold either preset button and press a key to enter the diagnostic display. Both buttons exit. Adjacent-colour flicker can be normal sensor variation.
- Calibration entry without the Editor by holding both board preset buttons at power-up.
- Ten consecutive presses of preset button 1 toggle rainbow mode; repeat to return.
- Fix for octave boards freezing during rainbow startup in 1.2/1.3.
- From 1.4.3 onward, failed/renamed/damaged update packages no longer prevent normal startup. The currently installed firmware performs an update, so retain the exact filename `Lumatone-v1.5.0.tgz` when upgrading older firmware.
- Limits accumulated logs and clears existing large logs to prevent full-storage startup failures.
- A faulty octave no longer disables the remaining octaves, preset buttons or Editor connection.
- A missing/faulty wheel board no longer prevents startup; wheels recover when communication returns.
- Manufacturer says presets and calibration are preserved during update. Installation uses Lumatone Editor and takes a few minutes including restart.

## Aftertouch timing: what the reference establishes

- 0Eh enables aftertouch; our layout preamble already uses it.
- 2Ch changes aftertouch sensitivity, not a documented sampling interval.
- 3Fh sets the delay between Note On and starting aftertouch, in **15 ms counter increments**, encoded as two nibbles. 40h reads it; 4Ch resets it. This is not a periodic aftertouch refresh-rate setting.
- 35h enables raw key sampling for factory/terminal diagnostics; the reference says to leave it off. It is not a normal MIDI refresh-rate control.
- 41h sets a Lumatouch release debounce/delay in **1.1 ms ticks**, documented maximum 2048; it does not set pressure cadence.
- Peripheral calibration messages 3Eh are about 100 ms apart during calibration; this is unrelated to normal key-pressure MIDI traffic.

No source code for the controller or octave firmware is included in the update. A verified pressure-cadence change therefore needs hardware captures or further manufacturer information.

## Archive comparison: 1.4.0 to 1.5.0

Both archives contain compiled controller software, PIC octave-board Intel HEX, configuration and installer scripts. They are update packages, not firmware source releases. The declared version file changes from 1.4.0 to 1.5.0.

| Item | 1.4.0 | 1.5.0 |
|---|---:|---:|
| Controller executable | `TerpstraController`, 248,136 bytes | `LumatoneController`, 841,700 bytes |
| Octave-board HEX text | 60,652 bytes | 59,020 bytes |
| Installer script | 2,809 bytes | 5,376 bytes |
| Launcher script | 1,493 bytes | 2,913 bytes |

Executable and HEX hashes differ. File sizes do not establish runtime performance. The USB setup script `am335x_evm.sh` is byte-identical between these packages.

Inspection of the new shell scripts corroborates the log and startup work: migration from the legacy controller directory with a compatibility link; launcher replacement on each update; guarded extraction/installation; application startup after failed updates; cleanup of attempted packages; large-log truncation at >=90% storage use; disabled rsyslog and a 20 MB journald limit. These scripts were inspected as data and never executed.

## Local reference gaps and documentation issues

The historical `LUMATONE COMMANDS.txt` stops at 48h with a TODO for 49h–4Eh. The current reference additionally documents 49h macro-light readback, 4Ah macro-light reset, 4Bh board calibration reset, 4Ch/4Dh delay resets, 4Eh wheel bounds, 4Fh pedal bounds, and 50h/51h Lumatouch deactivation threshold set/get. These should not all be called new in 1.5: their introduction versions are not marked in the current reference.

The official tables retain apparent editorial errors: 31h labels its terminal byte index 135; 40h labels delay nibbles as wheel channels; 4Eh repeats byte index 26 for the terminator; 49h describes nibbles but prints a 7-bit range. Preserve these as source issues, not protocol instructions. New integrations should follow actual field order and validated reply framing.

## Files in this update

- `SYSEX_REFERENCE_1.5.0.txt`: readable text extraction of the official introduction, all 86 command entries, extra calibration/velocity sections and manufacturer notice. Tables are flattened in source order.
- `sysex-reference-1.5.0.json`: original documentation data extracted from the script, retaining HTML tables. No script or feedback endpoint is executed.
- `Lumatone-v1.5.0.tgz`: unmodified firmware payload extracted from the official ZIP, alongside the existing 1.4.0 package.
- `sources-1.5.0.json`: source URLs, retrieval date, local byte lengths and SHA-256 hashes. The JSON snapshot is reformatted; its hash identifies our snapshot, not the remote JavaScript.

Historical files are retained unchanged. Source snapshots may contain manufacturer warnings about low-level settings; this review does not recommend changing calibration or thresholds as part of colour support.
