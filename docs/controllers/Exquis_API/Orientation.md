# Exquis orientation

IO → Exquis → Orientation describes clockwise physical rotation from upright:

- 0°: encoders at the top.
- 90°: encoders at the right (the existing default).
- 180°: encoders at the bottom.
- 270°: encoders at the left.

The local `exquis_orientation` preference is independent of the tuning. It is
available in App mode, after a successful firmware handshake. Device-managed
and nearest-scale modes do not apply this geometry transform.

`exquis-orientation.js` supplies both the integer lattice transform and the
App-mode flags. The canvas never rotates or resizes in response to this setting.
The controller selects a different subset of the fixed lattice, preserving the
same anchor key and pitch. Physical quarter turns use alternating 60° and 120°
lattice turns, since a hex lattice has no exact 90° rotational symmetry.
Opposite orientations use opposite coordinates. This preserves lattice points
and adjacency without rounding; canvas labels and pointer hit-testing are unchanged.

Both controller-map construction paths receive the orientation. LED colours
are derived from that same map, including modulation, rather than independently
permuting a colour array. Physical MIDI identifiers remain 0–60.

Changing the dropdown waits for raw held pads to be released before applying
device flags and committing the host preference. The final release is processed
by the input listeners before the deferred change. This does not rebuild synths
or stop timed playback. App-mode recovery resends the stored orientation.

## Hardware acceptance check still required

The API guide lists flipX (0x55), flipY (0x56) and flipXY (0x57), but does not
fully specify their composition order. The implementation uses the conventional
quarter-turn combinations below, preserving the established 90° configuration:

| Orientation | flipX | flipY | flipXY |
|---|---:|---:|---:|
| 0° | 0 | 0 | 0 |
| 90° | 1 | 0 | 1 |
| 180° | 1 | 1 | 0 |
| 270° | 0 | 1 | 1 |

Keep isomorphic=1 and twoPath=1. On actual firmware, verify each pad's identity
and colour, rightward positive bend, upward increasing timbre, and unchanged
pressure. Also test release during a pending change and App-mode recovery.
Automated tests establish map uniqueness, anchor invariance, opposite orientations
and emitted frames; they cannot establish firmware interpretation.

Reference: `ExquisAppModeAPI-SysexGuide.txt`, sections 4.3–4.4.

## Input CC assignments

The Exquis input section provides Sustain (default CC33).
Press Listen, then move the desired controller; the next CC
on the selected MIDI input is captured without performing its normal action.
Press Listen again to cancel, or Reset to restore that row's default.
Assignments persist locally and are available independently of App-mode SysEx.

Sustain maps to CC64 for both built-in synthesis and external output forwarding.
Standard CC1 modulation and CC74 finger timbre are unchanged unless explicitly
assigned to sustain. There is no Exquis-specific modulation mapping.
